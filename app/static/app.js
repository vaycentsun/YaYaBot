const state = { tasks: [], runs: [], mountInfo: { supported: false, mounts: [] }, loading: false, editingCron: null, activeRun: null };
const $ = (selector) => document.querySelector(selector);
const { t } = window.YaYaI18n;
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatTime(value) {
  if (!value) return "—";
  const locale = window.YaYaI18n.language === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3500);
}

function localizeServerMessage(message) {
  const messages = {
    "脚本内容不能为空": "script.empty",
    "Python 语法检查通过": "script.pythonValid",
    "Shell 语法检查通过": "script.shellValid",
    "访问令牌无效": "api.tokenRequired",
  };
  return messages[message] ? t(messages[message]) : message;
}

function displayOutput(output) {
  if (!output) return t("run.noOutput");
  if (window.YaYaI18n.language === "zh") return output;
  return output
    .replaceAll("[标准输出]", "[stdout]")
    .replaceAll("[错误输出]", "[stderr]")
    .replace(/^执行超过 (\d+) 秒，已终止。$/gm, "Execution exceeded $1 seconds and was terminated.")
    .replace(/^执行异常：/gm, "Execution error: ");
}

async function api(path, options = {}) {
  const token = sessionStorage.getItem("yaya-token") || "";
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-API-Token": token, ...(options.headers || {}) },
  });
  if (response.status === 401) {
    if (!$("#token-dialog").open) $("#token-dialog").showModal();
    throw new Error(t("api.tokenRequired"));
  }
  if (!response.ok) {
    let message = t("api.requestFailed", { status: response.status });
    try {
      const body = await response.json();
      if (body.detail) message = typeof body.detail === "string" ? localizeServerMessage(body.detail) : body.detail.map((item) => item.msg).join(window.YaYaI18n.language === "zh" ? "；" : "; ");
    } catch (_) {
      message = t("api.requestFailed", { status: response.status });
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function renderServiceStatus(online) {
  $("#service-status").classList.toggle("offline", !online);
  $("#service-status").innerHTML = `<i></i><span>${t(online ? "service.online" : "service.offline")}</span>`;
}

async function loadData(showErrors = true) {
  if (state.loading) return;
  state.loading = true;
  try {
    [state.tasks, state.runs, state.mountInfo] = await Promise.all([
      api("/api/tasks"),
      api("/api/runs?limit=100"),
      api("/api/mounts"),
    ]);
    renderTasks();
    renderRuns();
    renderStats();
    renderMounts();
    renderServiceStatus(true);
  } catch (error) {
    if (showErrors && !$("#token-dialog").open) toast(error.message, true);
    renderServiceStatus(false);
  } finally {
    state.loading = false;
  }
}

function renderMounts() {
  const { supported, mounts } = state.mountInfo;
  if (!supported) {
    $("#mount-list").innerHTML = `<div class="mount-empty">${t("mounts.unsupported")}</div>`;
    return;
  }
  if (!mounts.length) {
    $("#mount-list").innerHTML = `<div class="mount-empty">${t("mounts.empty")}</div>`;
    return;
  }
  $("#mount-list").innerHTML = mounts.map((mount) => `
    <div class="mount-item">
      <div class="mount-path"><span class="mount-path-icon">↳</span><div><small>${t("mounts.containerPath")}</small><code title="${escapeHtml(mount.container_path)}">${escapeHtml(mount.container_path)}</code></div></div>
      <div class="mount-source"><small>${t("mounts.sourcePath")}</small><code title="${escapeHtml(mount.source_path)}">${escapeHtml(mount.source_path)}</code></div>
      <div><span class="mount-access${mount.writable ? "" : " read-only"}">${t(mount.writable ? "mounts.writable" : "mounts.readOnly")}</span><span class="mount-filesystem">${escapeHtml(mount.filesystem)}</span></div>
    </div>`).join("");
}

function expandWeekdays(expression) {
  const values = [];
  for (const part of expression.split(",")) {
    if (/^\d$/.test(part)) {
      values.push(Number(part) % 7);
    } else if (/^\d-\d$/.test(part)) {
      const [start, end] = part.split("-").map(Number);
      if (start > end || end > 7) return [];
      for (let value = start; value <= end; value += 1) values.push(value % 7);
    } else {
      return [];
    }
  }
  return [...new Set(values)];
}

function parseSchedule(cron) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields;
  if (month !== "*") return null;
  if (day === "*" && hour === "*" && weekday === "*") {
    if (minute === "*") return { frequency: "minutes", interval: 1 };
    if (/^\*\/\d+$/.test(minute)) {
      const interval = Number(minute.slice(2));
      if (interval >= 1 && interval <= 59) return { frequency: "minutes", interval };
    }
    if (/^\d+$/.test(minute) && Number(minute) <= 59) return { frequency: "hourly", minute: Number(minute) };
  }
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || Number(minute) > 59 || Number(hour) > 23) return null;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (day === "*" && weekday === "*") return { frequency: "daily", time };
  if (day === "*" && weekday !== "*") {
    const weekdays = expandWeekdays(weekday);
    if (weekdays.length) return { frequency: "weekly", time, weekdays };
  }
  if (/^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 31 && weekday === "*") return { frequency: "monthly", time, monthDay: Number(day) };
  return null;
}

function describeSchedule(cron) {
  const schedule = parseSchedule(cron);
  if (!schedule) return t("schedule.advanced");
  if (schedule.frequency === "minutes") return schedule.interval === 1 ? t("schedule.everyMinute") : t("schedule.everyMinutes", { interval: schedule.interval });
  if (schedule.frequency === "hourly") return t("schedule.hourly", { minute: schedule.minute });
  if (schedule.frequency === "daily") return t("schedule.daily", { time: schedule.time });
  if (schedule.frequency === "monthly") return t("schedule.monthly", { day: schedule.monthDay, time: schedule.time });
  const weekdays = schedule.weekdays;
  const isWorkdays = [1, 2, 3, 4, 5].every((day) => weekdays.includes(day)) && weekdays.length === 5;
  if (isWorkdays) return t("schedule.workdays", { time: schedule.time });
  const separator = window.YaYaI18n.language === "zh" ? "、" : ", ";
  const label = weekdays.map((day) => t(`weekday.${day}`)).join(separator);
  return t("schedule.weekly", { weekdays: label, time: schedule.time });
}

function selectedWeekdays() {
  return [...document.querySelectorAll("#schedule-weekly-field input:checked")].map((input) => Number(input.value));
}

function buildCron() {
  const frequency = $("#schedule-frequency").value;
  if (frequency === "custom") return state.editingCron;
  if (frequency === "minutes") {
    const interval = Number($("#schedule-interval").value);
    if (!Number.isInteger(interval) || interval < 1 || interval > 59) throw new Error(t("form.intervalError"));
    return interval === 1 ? "* * * * *" : `*/${interval} * * * *`;
  }
  if (frequency === "hourly") {
    const minute = Number($("#schedule-minute").value);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error(t("form.hourlyError"));
    return `${minute} * * * *`;
  }
  const time = $("#schedule-time").value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(t("form.timeError"));
  const [hour, minute] = time.split(":").map(Number);
  if (frequency === "daily") return `${minute} ${hour} * * *`;
  if (frequency === "monthly") {
    const day = Number($("#schedule-month-day").value);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(t("form.monthDayError"));
    return `${minute} ${hour} ${day} * *`;
  }
  const weekdays = selectedWeekdays();
  if (!weekdays.length) throw new Error(t("form.weekdaysError"));
  return `${minute} ${hour} * * ${weekdays.join(",")}`;
}

function updateScheduleSummary() {
  try {
    $("#schedule-summary").textContent = `${describeSchedule(buildCron())} · ${$("#task-timezone").value || t("schedule.noTimezone")}`;
  } catch (error) {
    $("#schedule-summary").textContent = error.message;
  }
}

function updateScheduleFields() {
  const frequency = $("#schedule-frequency").value;
  $("#schedule-time-field").hidden = !["daily", "weekly", "monthly"].includes(frequency);
  $("#schedule-hourly-field").hidden = frequency !== "hourly";
  $("#schedule-interval-field").hidden = frequency !== "minutes";
  $("#schedule-monthly-field").hidden = frequency !== "monthly";
  $("#schedule-weekly-field").hidden = frequency !== "weekly";
  $("#custom-schedule-note").hidden = frequency !== "custom";
  $("#schedule-time").required = ["daily", "weekly", "monthly"].includes(frequency);
  updateScheduleSummary();
}

function loadSchedule(cron) {
  const schedule = parseSchedule(cron) || { frequency: "custom" };
  $("#custom-schedule-option").hidden = schedule.frequency !== "custom";
  $("#schedule-frequency").value = schedule.frequency;
  $("#schedule-time").value = schedule.time || "09:00";
  $("#schedule-minute").value = schedule.minute ?? 0;
  $("#schedule-interval").value = schedule.interval || 10;
  $("#schedule-month-day").value = schedule.monthDay || 1;
  document.querySelectorAll("#schedule-weekly-field input").forEach((input) => { input.checked = (schedule.weekdays || [1]).includes(Number(input.value)); });
  updateScheduleFields();
}

function taskCount(count) {
  return t(count === 1 ? "tasks.countOne" : "tasks.count", { count });
}

function renderTasks() {
  $("#stat-total").textContent = state.tasks.length;
  $("#stat-enabled").textContent = state.tasks.filter((task) => task.enabled).length;
  $("#task-count").textContent = taskCount(state.tasks.length);
  $("#task-empty").hidden = state.tasks.length > 0;
  $("#task-list").innerHTML = state.tasks.map((task) => `
    <tr>
      <td><div class="task-name"><span class="type-icon ${task.type}">${task.type === "wol" ? "WOL" : task.type === "python" ? "PY" : ">_"}</span><div><strong>${escapeHtml(task.name)}</strong><small>${task.type === "wol" ? t("type.wol") : task.type === "python" ? "Python" : "Shell"}</small></div></div></td>
      <td class="schedule-cell"><span class="schedule-description">${escapeHtml(describeSchedule(task.cron))}</span><small>${escapeHtml(task.timezone)}</small></td>
      <td class="next-run">${task.enabled ? formatTime(task.next_run_at) : t("tasks.schedulingDisabled")}</td>
      <td><span class="status ${task.enabled ? "" : "disabled"}">${t(task.enabled ? "tasks.enabled" : "tasks.disabled")}</span></td>
      <td><div class="row-actions"><button class="text-button" data-action="run" data-id="${task.id}">${t("tasks.run")}</button><button class="text-button" data-action="edit" data-id="${task.id}">${t("tasks.edit")}</button><button class="text-button danger" data-action="delete" data-id="${task.id}">${t("tasks.delete")}</button></div></td>
    </tr>`).join("");

  const selected = $("#history-filter").value;
  $("#history-filter").innerHTML = `<option value="">${t("history.filterAll")}</option>` + state.tasks.map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`).join("");
  $("#history-filter").value = selected;
}

function renderRuns() {
  const filter = $("#history-filter").value;
  const runs = filter ? state.runs.filter((run) => run.task_id === filter) : state.runs;
  $("#run-empty").hidden = runs.length > 0;
  $("#run-list").innerHTML = runs.map((run) => `
    <article class="run-item" data-run-id="${run.id}">
      <div class="run-title"><strong>${escapeHtml(run.task_name)}</strong><small>${formatTime(run.queued_at)} · ${t(run.trigger_kind === "manual" ? "runs.manual" : "runs.scheduled")}</small></div>
      <div class="run-output-preview">${escapeHtml(displayOutput(run.output))}</div>
      <div><span class="status ${run.status}">${run.status in { queued: 1, running: 1, success: 1, failed: 1, timeout: 1 } ? t(`status.${run.status}`) : run.status}</span></div>
      <div class="run-time">${run.finished_at ? t("runs.finishedAt", { time: formatTime(run.finished_at) }) : run.started_at ? t("runs.startedAt", { time: formatTime(run.started_at) }) : t("runs.waiting")}</div>
    </article>`).join("");
}

function renderStats() {
  const locale = window.YaYaI18n.language === "zh" ? "zh-CN" : "en-US";
  const today = new Date().toLocaleDateString(locale);
  const runs = state.runs.filter((run) => new Date(run.queued_at).toLocaleDateString(locale) === today);
  const finished = runs.filter((run) => ["success", "failed", "timeout"].includes(run.status));
  const succeeded = finished.filter((run) => run.status === "success").length;
  $("#stat-runs").textContent = runs.length;
  $("#stat-success").textContent = finished.length ? `${Math.round(succeeded / finished.length * 100)}%` : "—";
}

function setScriptCheckResult(message = "", kind = "") {
  $("#script-check-result").textContent = message;
  $("#script-check-result").className = kind;
}

function openTask(task = null) {
  $("#task-form").reset();
  state.editingCron = task?.cron || "0 9 * * *";
  $("#task-id").value = task?.id || "";
  $("#dialog-title").textContent = t(task ? "task.edit" : "task.new");
  $("#task-name").value = task?.name || "";
  $("#task-type").value = task?.type || "shell";
  $("#task-timeout").value = task?.timeout || 300;
  $("#task-timezone").value = task?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  $("#task-script").value = task?.script || "";
  $("#task-mac").value = task?.mac || "";
  $("#task-broadcast").value = task?.broadcast || "255.255.255.255";
  $("#task-port").value = task?.port || 9;
  $("#task-enabled").checked = task?.enabled ?? true;
  setScriptCheckResult();
  loadSchedule(state.editingCron);
  updateTaskType();
  updateScheduleSummary();
  $("#task-dialog").showModal();
}

function updateTaskType() {
  const type = $("#task-type").value;
  const isWol = type === "wol";
  $("#wol-fields").hidden = !isWol;
  $("#script-field").hidden = isWol;
  $("#task-script").required = !isWol;
  $("#task-mac").required = isWol;
  $("#task-timeout").disabled = isWol;
  $("#script-file").accept = type === "python" ? ".py" : ".sh,.bash";
  $("#script-help").textContent = t(type === "python" ? "script.pythonHelp" : "script.shellHelp");
  $("#task-script").placeholder = type === "python" ? 'from datetime import datetime\nprint("Hello YaYa", datetime.now())' : '#!/usr/bin/env bash\necho "Hello YaYa"';
  setScriptCheckResult();
}

async function checkScript(showToast = true) {
  const type = $("#task-type").value;
  if (type === "wol") return true;
  const script = $("#task-script").value;
  if (!script.trim()) {
    setScriptCheckResult(t("script.empty"), "invalid");
    return false;
  }
  $("#check-script-button").disabled = true;
  setScriptCheckResult(t("script.checking"), "checking");
  try {
    const result = await api("/api/scripts/check", { method: "POST", body: JSON.stringify({ type, script }) });
    if (script !== $("#task-script").value || type !== $("#task-type").value) return false;
    const message = localizeServerMessage(result.message);
    setScriptCheckResult(message, result.valid ? "valid" : "invalid");
    if (showToast) toast(message, !result.valid);
    return result.valid;
  } catch (error) {
    setScriptCheckResult(error.message, "invalid");
    if (showToast) toast(error.message, true);
    return false;
  } finally {
    $("#check-script-button").disabled = false;
  }
}

async function uploadScript(file) {
  if (!file) return;
  const type = $("#task-type").value;
  const extensions = type === "python" ? [".py"] : [".sh", ".bash"];
  if (!extensions.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    toast(t("script.chooseFile", { extensions: extensions.join(" / ") }), true);
    return;
  }
  if (file.size > 200000) {
    toast(t("script.tooLarge"), true);
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    $("#task-script").value = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    setScriptCheckResult(t("script.loaded", { name: file.name }), "checking");
    await checkScript(false);
  } catch (error) {
    setScriptCheckResult(t("script.readError"), "invalid");
    toast(t("script.readError"), true);
  }
}

async function saveTask(event) {
  event.preventDefault();
  const id = $("#task-id").value;
  const type = $("#task-type").value;
  let cron;
  try {
    cron = buildCron();
  } catch (error) {
    toast(error.message, true);
    return;
  }
  $("#save-button").disabled = true;
  try {
    if (type !== "wol" && !(await checkScript(false))) {
      toast(t("script.fixErrors"), true);
      return;
    }
    const payload = {
      name: $("#task-name").value,
      type,
      script: type === "wol" ? "" : $("#task-script").value,
      cron,
      timezone: $("#task-timezone").value,
      enabled: $("#task-enabled").checked,
      timeout: Number($("#task-timeout").value) || 300,
      mac: $("#task-mac").value,
      broadcast: $("#task-broadcast").value,
      port: Number($("#task-port").value),
    };
    await api(id ? `/api/tasks/${id}` : "/api/tasks", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    $("#task-dialog").close();
    toast(t(id ? "task.updated" : "task.created"));
    await loadData();
  } catch (error) {
    toast(error.message, true);
  } finally {
    $("#save-button").disabled = false;
  }
}

async function runTask(id) {
  try {
    await api(`/api/tasks/${id}/run`, { method: "POST" });
    toast(t("task.queued"));
    setTimeout(() => loadData(false), 300);
  } catch (error) { toast(error.message, true); }
}

async function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!confirm(t("task.deleteConfirm", { name: task.name }))) return;
  try {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    toast(t("task.deleted"));
    await loadData();
  } catch (error) { toast(error.message, true); }
}

function renderRunDialog(run) {
  $("#run-dialog-title").textContent = run.task_name;
  const details = [
    run.status in { queued: 1, running: 1, success: 1, failed: 1, timeout: 1 } ? t(`status.${run.status}`) : run.status,
    t(run.trigger_kind === "manual" ? "runs.manual" : "runs.scheduled"),
    formatTime(run.queued_at),
  ];
  if (run.exit_code !== null) details.push(t("run.exitCode", { code: run.exit_code }));
  $("#run-dialog-meta").textContent = details.join(" · ");
  $("#run-output").textContent = displayOutput(run.output);
}

function openRun(run) {
  state.activeRun = run;
  renderRunDialog(run);
  if (!$("#run-dialog").open) $("#run-dialog").showModal();
}

$("#new-task-button").addEventListener("click", () => openTask());
$("#task-form").addEventListener("submit", saveTask);
$("#task-type").addEventListener("change", updateTaskType);
$("#schedule-frequency").addEventListener("change", updateScheduleFields);
$("#task-form").addEventListener("input", (event) => {
  if (event.target.closest(".schedule-box")) updateScheduleSummary();
  if (event.target.id === "task-script") setScriptCheckResult();
});
$("#task-form").addEventListener("change", (event) => {
  if (event.target.closest(".schedule-box")) updateScheduleSummary();
});
$("#upload-script-button").addEventListener("click", () => $("#script-file").click());
$("#script-file").addEventListener("change", async (event) => {
  await uploadScript(event.target.files[0]);
  event.target.value = "";
});
$("#check-script-button").addEventListener("click", () => checkScript());
$("#refresh-button").addEventListener("click", () => loadData());
$("#history-filter").addEventListener("change", renderRuns);
$("#task-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "run") runTask(button.dataset.id);
  if (button.dataset.action === "edit") openTask(state.tasks.find((task) => task.id === button.dataset.id));
  if (button.dataset.action === "delete") deleteTask(button.dataset.id);
});
document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="new"]')) openTask();
  const close = event.target.closest("[data-close]");
  if (close) document.getElementById(close.dataset.close).close();
  const runItem = event.target.closest("[data-run-id]");
  if (runItem) openRun(state.runs.find((run) => run.id === runItem.dataset.runId));
});
$("#token-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  sessionStorage.setItem("yaya-token", $("#api-token").value);
  $("#token-dialog").close();
  await loadData();
});

window.YaYaI18n.onChange(() => {
  document.title = t("page.title");
  renderTasks();
  renderRuns();
  renderStats();
  renderMounts();
  renderServiceStatus(!$("#service-status").classList.contains("offline"));
  updateTaskType();
  updateScheduleSummary();
  $("#dialog-title").textContent = t($("#task-id").value ? "task.edit" : "task.new");
  if (state.activeRun && $("#run-dialog").open) renderRunDialog(state.activeRun);
});

document.title = t("page.title");
updateTaskType();
updateScheduleSummary();
loadData();
setInterval(() => { if (!document.hidden && !$("#token-dialog").open) loadData(false); }, 5000);

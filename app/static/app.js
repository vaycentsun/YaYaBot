const state = { tasks: [], runs: [], mountInfo: { supported: false, mounts: [] }, loading: false, editingCron: null };
const $ = (selector) => document.querySelector(selector);
const typeNames = { shell: "Shell", python: "Python", wol: "网络唤醒" };
const statusNames = { queued: "等待中", running: "运行中", success: "成功", failed: "失败", timeout: "已超时" };
const weekdayNames = { 0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六" };
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3500);
}

async function api(path, options = {}) {
  const token = sessionStorage.getItem("yaya-token") || "";
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-API-Token": token, ...(options.headers || {}) },
  });
  if (response.status === 401) {
    if (!$("#token-dialog").open) $("#token-dialog").showModal();
    throw new Error("需要有效的访问令牌");
  }
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = await response.json();
      if (body.detail) message = typeof body.detail === "string" ? body.detail : body.detail.map((item) => item.msg).join("；");
    } catch (_) {
      message = `请求失败（${response.status}）`;
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
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
    $("#service-status").classList.remove("offline");
    $("#service-status").innerHTML = "<i></i>服务正常";
  } catch (error) {
    if (showErrors && !$("#token-dialog").open) toast(error.message, true);
    $("#service-status").classList.add("offline");
    $("#service-status").innerHTML = "<i></i>连接异常";
  } finally {
    state.loading = false;
  }
}

function renderMounts() {
  const { supported, mounts } = state.mountInfo;
  if (!supported) {
    $("#mount-list").innerHTML = '<div class="mount-empty">当前环境无法读取容器挂载信息，通过 Docker 运行后即可查看。</div>';
    return;
  }
  if (!mounts.length) {
    $("#mount-list").innerHTML = '<div class="mount-empty">还没有额外挂载目录，可以点击右上角“怎么挂载？”添加。</div>';
    return;
  }
  $("#mount-list").innerHTML = mounts.map((mount) => `
    <div class="mount-item">
      <div class="mount-path"><span class="mount-path-icon">↳</span><div><small>容器路径 · 任务中使用这个</small><code title="${escapeHtml(mount.container_path)}">${escapeHtml(mount.container_path)}</code></div></div>
      <div class="mount-source"><small>挂载来源路径</small><code title="${escapeHtml(mount.source_path)}">${escapeHtml(mount.source_path)}</code></div>
      <div><span class="mount-access${mount.writable ? "" : " read-only"}">${mount.writable ? "可读写" : "只读"}</span><span class="mount-filesystem">${escapeHtml(mount.filesystem)}</span></div>
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
  if (!schedule) return "高级自定义计划";
  if (schedule.frequency === "minutes") return schedule.interval === 1 ? "每分钟执行" : `每 ${schedule.interval} 分钟执行`;
  if (schedule.frequency === "hourly") return `每小时第 ${schedule.minute} 分钟`;
  if (schedule.frequency === "daily") return `每天 ${schedule.time}`;
  if (schedule.frequency === "monthly") return `每月 ${schedule.monthDay} 日 ${schedule.time}`;
  const weekdays = schedule.weekdays;
  const label = [1, 2, 3, 4, 5].every((day) => weekdays.includes(day)) && weekdays.length === 5 ? "工作日" : weekdays.map((day) => weekdayNames[day]).join("、");
  if (label === "工作日") return `${label} ${schedule.time}`;
  return `每${label.startsWith("周") ? "" : "周"}${label} ${schedule.time}`;
}

function selectedWeekdays() {
  return [...document.querySelectorAll("#schedule-weekly-field input:checked")].map((input) => Number(input.value));
}

function buildCron() {
  const frequency = $("#schedule-frequency").value;
  if (frequency === "custom") return state.editingCron;
  if (frequency === "minutes") {
    const interval = Number($("#schedule-interval").value);
    if (!Number.isInteger(interval) || interval < 1 || interval > 59) throw new Error("间隔分钟数必须在 1-59 之间");
    return interval === 1 ? "* * * * *" : `*/${interval} * * * *`;
  }
  if (frequency === "hourly") {
    const minute = Number($("#schedule-minute").value);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("每小时的分钟数必须在 0-59 之间");
    return `${minute} * * * *`;
  }
  const time = $("#schedule-time").value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("请选择有效的执行时间");
  const [hour, minute] = time.split(":").map(Number);
  if (frequency === "daily") return `${minute} ${hour} * * *`;
  if (frequency === "monthly") {
    const day = Number($("#schedule-month-day").value);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("每月日期必须在 1-31 之间");
    return `${minute} ${hour} ${day} * *`;
  }
  const weekdays = selectedWeekdays();
  if (!weekdays.length) throw new Error("请至少选择一个星期");
  return `${minute} ${hour} * * ${weekdays.join(",")}`;
}

function updateScheduleSummary() {
  try {
    $("#schedule-summary").textContent = `${describeSchedule(buildCron())} · ${$("#task-timezone").value || "未设置时区"}`;
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

function renderTasks() {
  $("#stat-total").textContent = state.tasks.length;
  $("#stat-enabled").textContent = state.tasks.filter((task) => task.enabled).length;
  $("#task-count").textContent = `${state.tasks.length} 项`;
  $("#task-empty").hidden = state.tasks.length > 0;
  $("#task-list").innerHTML = state.tasks.map((task) => `
    <tr>
      <td><div class="task-name"><span class="type-icon ${task.type}">${task.type === "wol" ? "WOL" : task.type === "python" ? "PY" : ">_"}</span><div><strong>${escapeHtml(task.name)}</strong><small>${typeNames[task.type]}</small></div></div></td>
      <td class="schedule-cell"><span class="schedule-description">${escapeHtml(describeSchedule(task.cron))}</span><small>${escapeHtml(task.timezone)}</small></td>
      <td class="next-run">${task.enabled ? formatTime(task.next_run_at) : "调度已停用"}</td>
      <td><span class="status ${task.enabled ? "" : "disabled"}">${task.enabled ? "已启用" : "已停用"}</span></td>
      <td><div class="row-actions"><button class="text-button" data-action="run" data-id="${task.id}">运行</button><button class="text-button" data-action="edit" data-id="${task.id}">编辑</button><button class="text-button danger" data-action="delete" data-id="${task.id}">删除</button></div></td>
    </tr>`).join("");

  const selected = $("#history-filter").value;
  $("#history-filter").innerHTML = '<option value="">全部任务</option>' + state.tasks.map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`).join("");
  $("#history-filter").value = selected;
}

function renderRuns() {
  const filter = $("#history-filter").value;
  const runs = filter ? state.runs.filter((run) => run.task_id === filter) : state.runs;
  $("#run-empty").hidden = runs.length > 0;
  $("#run-list").innerHTML = runs.map((run) => `
    <article class="run-item" data-run-id="${run.id}">
      <div class="run-title"><strong>${escapeHtml(run.task_name)}</strong><small>${formatTime(run.queued_at)} · ${run.trigger_kind === "manual" ? "手动执行" : "定时触发"}</small></div>
      <div class="run-output-preview">${escapeHtml(run.output || "暂无输出")}</div>
      <div><span class="status ${run.status}">${statusNames[run.status] || run.status}</span></div>
      <div class="run-time">${run.finished_at ? `结束于 ${formatTime(run.finished_at)}` : run.started_at ? `开始于 ${formatTime(run.started_at)}` : "等待执行"}</div>
    </article>`).join("");
}

function renderStats() {
  const today = new Date().toLocaleDateString();
  const runs = state.runs.filter((run) => new Date(run.queued_at).toLocaleDateString() === today);
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
  $("#dialog-title").textContent = task ? "编辑任务" : "新建任务";
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
  $("#script-help").textContent = type === "python" ? "支持 .py 文件；使用容器内 Python 3 执行" : "支持 .sh、.bash 文件；使用 Bash 执行";
  $("#task-script").placeholder = type === "python" ? 'from datetime import datetime\nprint("Hello YaYa", datetime.now())' : '#!/usr/bin/env bash\necho "Hello YaYa"';
  setScriptCheckResult();
}

async function checkScript(showToast = true) {
  const type = $("#task-type").value;
  if (type === "wol") return true;
  const script = $("#task-script").value;
  if (!script.trim()) {
    setScriptCheckResult("脚本内容不能为空", "invalid");
    return false;
  }
  $("#check-script-button").disabled = true;
  setScriptCheckResult("正在检查…", "checking");
  try {
    const result = await api("/api/scripts/check", { method: "POST", body: JSON.stringify({ type, script }) });
    if (script !== $("#task-script").value || type !== $("#task-type").value) return false;
    setScriptCheckResult(result.message, result.valid ? "valid" : "invalid");
    if (showToast) toast(result.message, !result.valid);
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
    toast(`请选择 ${extensions.join(" 或 ")} 文件`, true);
    return;
  }
  if (file.size > 200000) {
    toast("脚本文件不能超过 200 KB", true);
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    $("#task-script").value = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    setScriptCheckResult(`已载入 ${file.name}，正在检查…`, "checking");
    await checkScript(false);
  } catch (error) {
    setScriptCheckResult("文件读取失败，请使用 UTF-8 文本文件", "invalid");
    toast("文件读取失败，请使用 UTF-8 文本文件", true);
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
      toast("请先修正脚本语法错误", true);
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
    toast(id ? "任务已更新" : "任务已创建");
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
    toast("任务已加入执行队列");
    setTimeout(() => loadData(false), 300);
  } catch (error) { toast(error.message, true); }
}

async function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!confirm(`确定删除“${task.name}”吗？该任务的全部执行记录也会删除。`)) return;
  try {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    toast("任务已删除");
    await loadData();
  } catch (error) { toast(error.message, true); }
}

function openRun(run) {
  $("#run-dialog-title").textContent = run.task_name;
  $("#run-dialog-meta").textContent = `${statusNames[run.status] || run.status} · ${run.trigger_kind === "manual" ? "手动执行" : "定时触发"} · ${formatTime(run.queued_at)}${run.exit_code !== null ? ` · 退出码 ${run.exit_code}` : ""}`;
  $("#run-output").textContent = run.output || "暂无输出";
  $("#run-dialog").showModal();
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

loadData();
setInterval(() => { if (!document.hidden && !$("#token-dialog").open) loadData(false); }, 5000);

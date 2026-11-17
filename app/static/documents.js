const documentState = { items: [], active: null };
const documentElement = (selector) => document.querySelector(selector);
const { t } = window.YaYaI18n;

function escapeDocumentText(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function baseDocumentName(name) {
  return name?.endsWith(".en.md") ? `${name.slice(0, -6)}.md` : name;
}

function localizedDocumentName(name) {
  const base = baseDocumentName(name);
  if (!base || window.YaYaI18n.language === "zh") return base;
  const translated = base.replace(/\.md$/, ".en.md");
  return documentState.items.some((item) => item.name === translated) ? translated : base;
}

function visibleDocuments() {
  const names = new Set(documentState.items.map((item) => item.name));
  return documentState.items.filter((item) => {
    if (window.YaYaI18n.language === "zh") return !item.name.endsWith(".en.md");
    if (item.name.endsWith(".en.md")) return true;
    return !names.has(item.name.replace(/\.md$/, ".en.md"));
  });
}

function renderDocumentList() {
  const items = visibleDocuments();
  documentElement("#document-count").textContent = t(items.length === 1 ? "docs.countOne" : "docs.count", { count: items.length });
  documentElement("#document-list-empty").hidden = items.length > 0;
  documentElement("#document-list").innerHTML = items.map((item) => `
    <a class="document-link${item.name === documentState.active ? " active" : ""}" href="?doc=${encodeURIComponent(item.name)}" data-document="${escapeDocumentText(item.name)}">
      <strong>${escapeDocumentText(item.title)}</strong>
      <small>${escapeDocumentText(item.description || t("docs.defaultDescription"))}</small>
    </a>`).join("");
}

async function openDocument(name, updateHistory = true) {
  const localizedName = localizedDocumentName(name);
  if (!localizedName) return;
  documentState.active = localizedName;
  renderDocumentList();
  documentElement("#document-content").innerHTML = `<div class="docs-loading">${t("docs.loading")}</div>`;
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(localizedName)}`);
    if (!response.ok) throw new Error(response.status === 404 ? t("docs.notFound") : t("docs.loadError"));
    const item = await response.json();
    documentElement("#document-content").innerHTML = item.html;
    document.title = `${item.title} · YaYa bot`;
    documentElement("#document-content").querySelectorAll("a[href^='http']").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    if (updateHistory) history.pushState(null, "", `?doc=${encodeURIComponent(localizedName)}`);
  } catch (error) {
    documentElement("#document-content").innerHTML = `<div class="docs-error"><h2>${t("docs.openError")}</h2><p>${escapeDocumentText(error.message)}</p></div>`;
  }
}

async function loadDocuments() {
  try {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error(t("docs.listLoadFailed"));
    documentState.items = await response.json();
    const requested = new URLSearchParams(location.search).get("doc");
    const requestedName = localizedDocumentName(requested);
    const first = documentState.items.find((item) => item.name === requestedName) || visibleDocuments()[0];
    renderDocumentList();
    if (first) {
      await openDocument(first.name, false);
    } else {
      documentElement("#document-content").innerHTML = `<div class="docs-error"><h2>${t("docs.emptyTitle")}</h2><p>${t("docs.emptyDescription")}</p></div>`;
    }
  } catch (error) {
    documentElement("#document-content").innerHTML = `<div class="docs-error"><h2>${t("docs.unavailable")}</h2><p>${escapeDocumentText(error.message)}</p></div>`;
  }
}

documentElement("#document-list").addEventListener("click", (event) => {
  const link = event.target.closest("[data-document]");
  if (!link) return;
  event.preventDefault();
  openDocument(link.dataset.document);
});
window.addEventListener("popstate", () => openDocument(new URLSearchParams(location.search).get("doc"), false));
window.YaYaI18n.onChange(() => {
  const next = localizedDocumentName(documentState.active);
  if (next) history.replaceState(null, "", `?doc=${encodeURIComponent(next)}`);
  if (next && next !== documentState.active) {
    openDocument(next, false);
  } else {
    renderDocumentList();
    if (!next) document.title = t("docs.title");
  }
});
document.title = t("docs.title");
loadDocuments();

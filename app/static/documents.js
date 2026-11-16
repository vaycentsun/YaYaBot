const documentState = { items: [], active: null };
const documentElement = (selector) => document.querySelector(selector);

function escapeDocumentText(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function renderDocumentList() {
  documentElement("#document-count").textContent = `${documentState.items.length} 篇`;
  documentElement("#document-list-empty").hidden = documentState.items.length > 0;
  documentElement("#document-list").innerHTML = documentState.items.map((item) => `
    <a class="document-link${item.name === documentState.active ? " active" : ""}" href="?doc=${encodeURIComponent(item.name)}" data-document="${escapeDocumentText(item.name)}">
      <strong>${escapeDocumentText(item.title)}</strong>
      <small>${escapeDocumentText(item.description || "打开文档，查看详细说明")}</small>
    </a>`).join("");
}

async function openDocument(name, updateHistory = true) {
  if (!name) return;
  documentState.active = name;
  renderDocumentList();
  documentElement("#document-content").innerHTML = '<div class="docs-loading">正在打开文档…</div>';
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(response.status === 404 ? "这篇文档不存在或已被移动" : "文档暂时打不开，请稍后重试");
    const item = await response.json();
    documentElement("#document-content").innerHTML = item.html;
    document.title = `${item.title} · YaYa bot`;
    documentElement("#document-content").querySelectorAll("a[href^='http']").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    if (updateHistory) history.pushState(null, "", `?doc=${encodeURIComponent(name)}`);
  } catch (error) {
    documentElement("#document-content").innerHTML = `<div class="docs-error"><h2>暂时打不开这篇文档</h2><p>${escapeDocumentText(error.message)}</p></div>`;
  }
}

async function loadDocuments() {
  try {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error("文档列表加载失败");
    documentState.items = await response.json();
    const requested = new URLSearchParams(location.search).get("doc");
    const first = documentState.items.find((item) => item.name === requested) || documentState.items[0];
    renderDocumentList();
    if (first) {
      await openDocument(first.name, false);
    } else {
      documentElement("#document-content").innerHTML = '<div class="docs-error"><h2>还没有文档</h2><p>把 Markdown 文件放进 doc 目录，就能在这里阅读。</p></div>';
    }
  } catch (error) {
    documentElement("#document-content").innerHTML = `<div class="docs-error"><h2>文档中心暂时不可用</h2><p>${escapeDocumentText(error.message)}</p></div>`;
  }
}

documentElement("#document-list").addEventListener("click", (event) => {
  const link = event.target.closest("[data-document]");
  if (!link) return;
  event.preventDefault();
  openDocument(link.dataset.document);
});
window.addEventListener("popstate", () => openDocument(new URLSearchParams(location.search).get("doc"), false));
loadDocuments();

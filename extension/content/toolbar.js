const HOST_ID = "littp-toolbar-host";

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (host) return host;
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483646";
  host.style.right = "16px";
  host.style.bottom = "16px";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bar {
        font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
        display: flex;
        flex-wrap: wrap;
        max-width: calc(100vw - 52px);
        gap: 6px;
        align-items: center;
        padding: 8px 10px;
        background: #142523;
        color: #f4f4f1;
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
      }
      button {
        border: 0;
        background: #1f3d3a;
        color: inherit;
        border-radius: 999px;
        padding: 6px 10px;
        cursor: pointer;
      }
      button[data-active="true"] { background: #9fe0ce; color: #142523; }
      #hide {
        padding: 6px 9px;
        background: transparent;
        color: #9fb3af;
        line-height: 1;
        font-size: 15px;
      }
      #hide:hover { background: #1f3d3a; color: #f4f4f1; }
      .status { padding: 0 6px; color: #c5d5d1; max-width: 16rem; }
      .status:empty { display: none; }
      .notice { font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; box-sizing: border-box; max-width: min(420px, calc(100vw - 32px)); margin: 0 0 8px auto; padding: 12px; background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; border-radius: 12px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2); }
      .notice[hidden] { display: none; }
      .notice p { margin: 0 0 8px; overflow-wrap: anywhere; }
      .notice button { background: #9a3412; color: #fff; }
    </style>
    <div class="notice" id="notice" role="alert" hidden>
      <p id="noticeText"></p>
      <button id="retry" type="button">重试</button>
      <button id="dismissNotice" type="button">关闭提示</button>
    </div>
    <div class="bar">
      <button id="original" type="button">原文</button>
      <button id="learning" type="button">学习视图</button>
      <button id="translated" type="button">全文翻译</button>
      <button id="highlighted" type="button">重点标记</button>
      <span class="status" id="status">Littp</span>
      <button id="hide" type="button" title="临时隐藏" aria-label="临时隐藏 Littp 工具条">×</button>
    </div>
  `;
  return host;
}

export function mountToolbar({ onOriginal, onLearning, onTranslate, onHighlight, onHide }) {
  const host = ensureHost();
  const root = host.shadowRoot;
  root.getElementById("original").onclick = onOriginal;
  root.getElementById("learning").onclick = onLearning;
  root.getElementById("translated").onclick = onTranslate;
  root.getElementById("highlighted").onclick = onHighlight;
  root.getElementById("dismissNotice").onclick = clearProcessingNotice;
  root.getElementById("hide").onclick = onHide;
  return host;
}

export function clearProcessingNotice() {
  const notice = document.getElementById(HOST_ID)?.shadowRoot?.getElementById("notice");
  if (notice) notice.hidden = true;
}

export function showProcessingNotice(message, onRetry) {
  const host = ensureHost();
  const root = host.shadowRoot;
  root.getElementById("noticeText").textContent = message;
  root.getElementById("retry").onclick = onRetry;
  root.getElementById("notice").hidden = false;
}

// The bar is not resident: `visible` is false while the page sits in the original
// view, so it only appears for the reading view (or while one is being prepared).
export function setToolbar({ mode, status, visible = true }) {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  const root = host.shadowRoot;
  root.getElementById("original").dataset.active = String(mode === "original");
  root.getElementById("learning").dataset.active = String(mode === "learning");
  root.getElementById("translated").dataset.active = String(mode === "translated");
  root.getElementById("highlighted").dataset.active = String(mode === "highlighted");
  if (status != null) root.getElementById("status").textContent = status;
  host.style.display = visible ? "" : "none";
}

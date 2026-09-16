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
      .status { padding: 0 6px; color: #c5d5d1; max-width: 16rem; }
    </style>
    <div class="bar">
      <button id="original" type="button">原文</button>
      <button id="learning" type="button">学习视图</button>
      <span class="status" id="status">Littp</span>
    </div>
  `;
  return host;
}

export function mountToolbar({ onOriginal, onLearning }) {
  const host = ensureHost();
  const root = host.shadowRoot;
  root.getElementById("original").onclick = onOriginal;
  root.getElementById("learning").onclick = onLearning;
  return host;
}

export function setToolbar({ mode, status }) {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  const root = host.shadowRoot;
  root.getElementById("original").dataset.active = String(mode === "original");
  root.getElementById("learning").dataset.active = String(mode === "learning");
  if (status != null) root.getElementById("status").textContent = status;
}

import { BAND_LABELS, BAND_ORDER } from "../shared/constants.js";
import { formatTokens } from "../shared/usage.js";

const bandsRoot = document.getElementById("bands");
const knownList = document.getElementById("knownList");
const draftList = document.getElementById("draftList");
const knownMeta = document.getElementById("knownMeta");
const usageRoot = document.getElementById("usage");
const logsRoot = document.getElementById("logs");
const debugEnabled = document.getElementById("debugEnabled");
const knownQuery = document.getElementById("knownQuery");

let state = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderBands() {
  const selected = new Set(state.coverageBands || []);
  bandsRoot.innerHTML = BAND_ORDER.map(
    (band) => `
      <label>
        <input type="checkbox" data-band="${band}" ${selected.has(band) ? "checked" : ""} />
        ${BAND_LABELS[band]}
      </label>
    `,
  ).join("");
}

function renderKnown() {
  const query = knownQuery.value.trim().toLowerCase();
  const words = (state.knownLemmas || []).filter((word) => !query || word.includes(query));
  const shown = words.slice(0, 200);
  knownMeta.textContent = `共 ${state.knownCount || 0} 个熟词，当前显示 ${shown.length} 条。`;
  knownList.innerHTML = shown
    .map(
      (word) => `
      <li>
        <span>${escapeHtml(word)}</span>
        <button type="button" data-remove-known="${escapeHtml(word)}">移除</button>
      </li>
    `,
    )
    .join("") || "<li>没有匹配的熟词</li>";
}

function renderDrafts() {
  const drafts = state.unknownDrafts || [];
  draftList.innerHTML = drafts.length
    ? drafts
        .map(
          (word) => `
        <li>
          <span>${escapeHtml(word)}</span>
          <button type="button" data-remove-draft="${escapeHtml(word)}">移出草稿</button>
        </li>
      `,
        )
        .join("")
    : "<li>还没有生词草稿。网页划词后点圆点，选「加入生词草稿」。</li>";
}

function renderUsage(usage) {
  const items = [
    ["调用次数", usage.calls],
    ["Prompt tokens", usage.promptTokens],
    ["Completion tokens", usage.completionTokens],
    ["合计", usage.totalTokens],
  ];
  usageRoot.innerHTML = items
    .map(
      ([label, value]) => `
      <div class="stat">
        <b>${formatTokens(value)}</b>
        <span>${label}</span>
      </div>
    `,
    )
    .join("");
}

function renderLogs(logs) {
  if (!logs?.length) {
    logsRoot.innerHTML = '<p class="hint">还没有调试日志。打开开关后再跑一次学习视图。</p>';
    return;
  }
  logsRoot.innerHTML = logs
    .map((entry) => {
      const time = new Date(entry.ts).toLocaleString("zh-CN");
      const body = [
        entry.prompt && `PROMPT\n${entry.prompt}`,
        entry.userInput && `USER INPUT\n${entry.userInput}`,
        entry.response && `RESPONSE\n${entry.response}`,
        entry.usage?.totalTokens
          ? `USAGE prompt=${entry.usage.promptTokens} completion=${entry.usage.completionTokens} total=${entry.usage.totalTokens}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return `<article class="log"><div class="meta">${escapeHtml(time)} · ${escapeHtml(entry.kind)} · ${escapeHtml(entry.action)}</div>${escapeHtml(body)}</article>`;
    })
    .join("");
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
  debugEnabled.checked = Boolean(state.debugEnabled);
  renderBands();
  renderKnown();
  renderDrafts();
  renderUsage(stats.usage || {});
  renderLogs(stats.logs || []);
}

bandsRoot.addEventListener("change", async (event) => {
  const input = event.target.closest("input[data-band]");
  if (!input) return;
  const bands = [...bandsRoot.querySelectorAll("input[data-band]:checked")].map(
    (item) => item.dataset.band,
  );
  await chrome.runtime.sendMessage({ type: "SET_BANDS", bands });
  await refresh();
});

knownList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-known]");
  if (!button) return;
  await chrome.runtime.sendMessage({ type: "REMOVE_KNOWN", text: button.dataset.removeKnown });
  await refresh();
});

draftList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-draft]");
  if (!button) return;
  await chrome.runtime.sendMessage({ type: "REMOVE_DRAFT", text: button.dataset.removeDraft });
  await refresh();
});

document.getElementById("addKnownBtn").onclick = async () => {
  const text = document.getElementById("addKnown").value;
  const result = await chrome.runtime.sendMessage({ type: "ADD_KNOWN", text });
  if (result?.error) {
    knownMeta.textContent = result.error;
    return;
  }
  document.getElementById("addKnown").value = "";
  await refresh();
};

knownQuery.addEventListener("input", renderKnown);

debugEnabled.onchange = async () => {
  await chrome.runtime.sendMessage({ type: "SET_DEBUG", enabled: debugEnabled.checked });
  await refresh();
};

document.getElementById("clearLogs").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
  await refresh();
};

document.getElementById("clearStats").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_STATS" });
  await refresh();
};

document.getElementById("openOnboarding").onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/index.html") });
};

refresh().catch((error) => {
  knownMeta.textContent = error.message || "无法读取词表";
});

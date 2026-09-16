const debugEnabled = document.getElementById("debugEnabled");
const logsRoot = document.getElementById("logs");
const debugStatus = document.getElementById("debugStatus");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  const [state, stats] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATE", includeLemmas: false, includeCounts: false }),
    chrome.runtime.sendMessage({ type: "GET_STATS" }),
  ]);
  debugEnabled.checked = Boolean(state.debugEnabled);
  renderLogs(stats.logs || []);
}

debugEnabled.onchange = async () => {
  await chrome.runtime.sendMessage({ type: "SET_DEBUG", enabled: debugEnabled.checked });
  const stats = await chrome.runtime.sendMessage({ type: "GET_STATS" });
  renderLogs(stats.logs || []);
};

document.getElementById("clearLogs").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
  await refresh();
};

refresh().catch((error) => {
  debugStatus.textContent = error.message || "无法读取调试状态";
  debugStatus.className = "status error";
});

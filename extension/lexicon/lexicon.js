import { BAND_LABELS, BAND_ORDER } from "../shared/constants.js";
import { bindInitForm } from "../onboarding/flow.js";
import { wordsForDisplay } from "../shared/lexicon-view.js";

const countsRoot = document.getElementById("counts");
const bandsRoot = document.getElementById("bands");
const tiersRoot = document.getElementById("tiers");
const unknownList = document.getElementById("unknownList");
const knownQuery = document.getElementById("knownQuery");
const lexiconStatus = document.getElementById("lexiconStatus");
const keyBanner = document.getElementById("keyBanner");
const keyGate = document.getElementById("keyGate");
const gateKey = document.getElementById("gateKey");
const gateStatus = document.getElementById("gateStatus");
const gateSave = document.getElementById("gateSave");

let lexicon = null;
let renderingBands = false;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCounts() {
  const breakdown = (lexicon.groups || [])
    .filter((group) => group.count > 0)
    .map(
      (group) => `<span class="count">${escapeHtml(group.label)} <b>${group.count}</b></span>`,
    );
  countsRoot.innerHTML = [
    `<span class="count">种子熟词 <b>${lexicon.knownCount || 0}</b></span>`,
    ...breakdown,
    `<span class="count">补充生词 <b>${lexicon.unknownCount || 0}</b></span>`,
  ].join("");
}

function renderBands() {
  renderingBands = true;
  const selected = new Set(lexicon.coverageBands || []);
  bandsRoot.innerHTML = BAND_ORDER.map(
    (band) => `
      <label>
        <input type="checkbox" data-band="${band}" ${selected.has(band) ? "checked" : ""} />
        ${BAND_LABELS[band]}
      </label>
    `,
  ).join("");
  renderingBands = false;
}

function renderTiers() {
  const query = knownQuery.value.trim().toLowerCase();
  tiersRoot.innerHTML = (lexicon.groups || [])
    .filter((group) => group.count > 0)
    .map((group) => {
      const listed = wordsForDisplay(group.words, query);
      const items = listed.words.length
        ? listed.words
            .map(
              (word) => `
            <li>
              <span>${escapeHtml(word)}</span>
              <button type="button" data-remove-known="${escapeHtml(word)}">移除</button>
            </li>
          `,
            )
            .join("")
        : "<li>这一档没有匹配项</li>";
      const overlapped =
        group.sourceCount && group.sourceCount > group.count
          ? `，本档 ${group.sourceCount}（其余已计入更常见档）`
          : "";
      const matched = query ? `，匹配 ${listed.total}` : "";
      const preview =
        listed.truncated
          ? `，列出前 ${listed.words.length}，搜索可定位其余`
          : listed.words.length && listed.words.length !== group.count && !query
            ? `，列出 ${listed.words.length}`
            : "";
      return `
        <h3>${escapeHtml(group.label)} · ${group.count} 条${overlapped}${matched}${preview}</h3>
        <ul class="word-list">${items}</ul>
      `;
    })
    .join("");
}

function renderSideLists() {
  const unknowns = lexicon.extraUnknowns || [];
  unknownList.innerHTML = unknowns.length
    ? unknowns
        .map(
          (word) => `
        <li>
          <span>${escapeHtml(word)}</span>
          <button type="button" data-remove-unknown="${escapeHtml(word)}">移出</button>
        </li>
      `,
        )
        .join("")
    : "<li>还没有补充生词。</li>";
}

async function refresh() {
  try {
    const [state, data] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_STATE", includeLemmas: false }),
      chrome.runtime.sendMessage({ type: "GET_LEXICON" }),
    ]);
    if (state?.error) throw new Error(state.error);
    if (data?.error) throw new Error(data.error);
    lexicon = data;
    keyBanner.hidden = Boolean(state.apiKeyPresent);
    renderCounts();
    renderBands();
    renderTiers();
    renderSideLists();
    return state;
  } catch (error) {
    countsRoot.innerHTML = `<span class="count">词表读取失败</span>`;
    lexiconStatus.textContent = error.message || "词表加载失败，请稍后重试。";
    lexiconStatus.className = "status error";
    return null;
  }
}

function scrollToInit() {
  document.getElementById("init")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showKeyGate() {
  keyGate.hidden = false;
  document.body.style.overflow = "hidden";
  gateKey.focus();
}

function hideKeyGate() {
  keyGate.hidden = true;
  document.body.style.overflow = "";
}

async function saveGateKey() {
  const value = gateKey.value.trim();
  if (!value) {
    gateStatus.textContent = "请填写 API Key";
    gateStatus.className = "status error";
    return;
  }
  gateSave.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "SAVE_KEY", apiKey: value });
    if (result?.error) throw new Error(result.error);
    keyBanner.hidden = true;
    gateStatus.textContent = "";
    hideKeyGate();
    scrollToInit();
  } catch (error) {
    gateStatus.textContent = error.message || "保存失败，请重试";
    gateStatus.className = "status error";
  } finally {
    gateSave.disabled = false;
  }
}

bandsRoot.addEventListener("change", async (event) => {
  if (renderingBands) return;
  if (!event.target.closest("input[data-band]")) return;
  const bands = [...bandsRoot.querySelectorAll("input[data-band]:checked")].map(
    (item) => item.dataset.band,
  );
  await chrome.runtime.sendMessage({ type: "SET_BANDS", bands });
  await refresh();
});

tiersRoot.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-known]");
  if (!button) return;
  await chrome.runtime.sendMessage({ type: "REMOVE_KNOWN", text: button.dataset.removeKnown });
  await refresh();
});

unknownList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-unknown]");
  if (!button) return;
  await chrome.runtime.sendMessage({ type: "REMOVE_UNKNOWN", text: button.dataset.removeUnknown });
  await refresh();
});

knownQuery.addEventListener("input", renderTiers);

gateSave.addEventListener("click", () => saveGateKey());
gateKey.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveGateKey();
  }
});

await bindInitForm(document, { onDone: refresh }).catch((error) => {
  lexiconStatus.textContent = error.message || "初始化表单加载失败";
  lexiconStatus.className = "status error";
});
const state = await refresh();
if (state && !state.apiKeyPresent && !state.onboardingDone) {
  showKeyGate();
} else if (!state?.onboardingDone || location.hash === "#init") {
  scrollToInit();
}

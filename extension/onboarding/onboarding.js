import { BAND_LABELS, MOTTO } from "../shared/constants.js";

const itemsRoot = document.getElementById("items");
const status = document.getElementById("status");
const form = document.getElementById("form");
const submit = document.getElementById("submit");
const skip = document.getElementById("skip");
const motto = document.getElementById("motto");

const directionLabel = {
  "en-zh": "英译中",
  "zh-en": "中译英",
};

let placementItems = [];

function collectProfile() {
  const levels = [...form.querySelectorAll("input[name='levels']:checked")].map(
    (input) => input.value,
  );
  return {
    education: form.education.value,
    levels,
    score: form.score.value.trim(),
    workFrequency: form.workFrequency.value,
  };
}

function collectAnswers() {
  return placementItems.map((item) => ({
    id: item.id,
    band: item.band,
    direction: item.direction,
    prompt: item.prompt,
    reference: item.reference,
    answer: document.getElementById(`answer-${item.id}`)?.value.trim() || "",
  }));
}

function renderItems(items) {
  itemsRoot.innerHTML = items
    .map(
      (item, index) => `
      <div class="item">
        <div class="meta">${index + 1} / ${items.length} · ${BAND_LABELS[item.band] || item.band} · ${directionLabel[item.direction]}</div>
        <p class="prompt">${item.prompt}</p>
        <textarea id="answer-${item.id}" placeholder="写下对应译文"></textarea>
      </div>
    `,
    )
    .join("");
}

async function saveKey() {
  const apiKey = form.apiKey.value.trim();
  if (!apiKey) throw new Error("请先填写 API Key");
  await chrome.runtime.sendMessage({ type: "SAVE_KEY", apiKey });
}

async function generate({ skipped }) {
  status.className = "status";
  status.textContent = skipped
    ? "正在按基础信息生成种子词表…"
    : "正在根据画像和互译答卷生成种子词表…";
  submit.disabled = true;
  skip.disabled = true;
  try {
    await saveKey();
    const result = await chrome.runtime.sendMessage({
      type: "GENERATE_SEED",
      profile: collectProfile(),
      answers: skipped ? [] : collectAnswers(),
      skipped,
    });
    if (result?.error) throw new Error(result.error);
    motto.hidden = false;
    motto.textContent = MOTTO;
    status.textContent = `已生成种子熟词表，覆盖 ${result.coverageBands.join("、")}，约 ${result.knownCount} 个词。可以关掉本页，打开网页后点「学习视图」，或去词表面板查看编辑。`;
  } catch (error) {
    motto.hidden = true;
    status.className = "status error";
    status.textContent = error.message || "生成失败。可稍后重试；失败时仍会尽量使用托底词表。";
  } finally {
    submit.disabled = false;
    skip.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate({ skipped: false });
});

skip.addEventListener("click", () => generate({ skipped: true }));

(async () => {
  const url = chrome.runtime.getURL("lexicon/placement-items.json");
  const data = await fetch(url).then((res) => res.json());
  placementItems = data.items || [];
  renderItems(placementItems);
  const stored = await chrome.storage.local.get(["apiKey", "profile"]);
  if (stored.apiKey) form.apiKey.value = stored.apiKey;
  if (stored.profile?.education) form.education.value = stored.profile.education;
  if (stored.profile?.score) form.score.value = stored.profile.score;
  if (stored.profile?.workFrequency) form.workFrequency.value = stored.profile.workFrequency;
  if (stored.profile?.levels) {
    for (const input of form.querySelectorAll("input[name='levels']")) {
      input.checked = stored.profile.levels.includes(input.value);
    }
  }
})();

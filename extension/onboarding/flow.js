import { BAND_LABELS, MOTTO } from "../shared/constants.js";

const directionLabel = {
  "en-zh": "英译中",
  "zh-en": "中译英",
};

export async function bindInitForm(root = document, { onDone } = {}) {
  const form = root.querySelector("#form");
  const itemsRoot = root.querySelector("#items");
  const status = root.querySelector("#status");
  const submit = root.querySelector("#submit");
  const skip = root.querySelector("#skip");
  const motto = root.querySelector("#motto");
  const banner = root.querySelector("#keyBanner");
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
      answer: root.querySelector(`#answer-${item.id}`)?.value.trim() || "",
    }));
  }

  itemsRoot.innerHTML = "";
  const data = await fetch(chrome.runtime.getURL("lexicon/placement-items.json")).then((res) =>
    res.json(),
  );
  placementItems = data.items || [];
  itemsRoot.innerHTML = placementItems
    .map(
      (item, index) => `
      <div class="item">
        <div class="meta">${index + 1} / ${placementItems.length} · ${BAND_LABELS[item.band] || item.band} · ${directionLabel[item.direction]}</div>
        <p class="prompt">${item.prompt}</p>
        <textarea id="answer-${item.id}" placeholder="写下对应译文"></textarea>
      </div>
    `,
    )
    .join("");

  const stored = await chrome.storage.local.get(["profile"]);
  if (stored.profile?.education) form.education.value = stored.profile.education;
  if (stored.profile?.score) form.score.value = stored.profile.score;
  if (stored.profile?.workFrequency) form.workFrequency.value = stored.profile.workFrequency;
  if (stored.profile?.levels) {
    for (const input of form.querySelectorAll("input[name='levels']")) {
      input.checked = stored.profile.levels.includes(input.value);
    }
  }

  async function generate({ skipped }) {
    status.className = "status";
    motto.hidden = true;
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE", includeLemmas: false });
    if (banner) banner.hidden = Boolean(state.apiKeyPresent);
    if (!state.apiKeyPresent) {
      throw new Error("请先填写 API Key");
    }
    status.textContent = skipped
      ? "正在按基础信息生成种子词表…"
      : "正在根据画像和互译答卷生成种子词表…";
    submit.disabled = true;
    skip.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "GENERATE_SEED",
        profile: collectProfile(),
        answers: skipped ? [] : collectAnswers(),
        skipped,
      });
      if (result?.error) throw new Error(result.error);
      motto.hidden = false;
      motto.textContent = MOTTO;
      status.textContent = `已生成种子熟词表，覆盖 ${result.coverageBands.join("、")}，约 ${result.knownCount} 个词。补充熟词和生词记录会保留。`;
      if (onDone) await onDone(result);
      return result;
    } catch (error) {
      motto.hidden = true;
      status.className = "status error";
      status.textContent = error.message || "生成失败。可稍后重试；失败时仍会尽量使用托底词表。";
      throw error;
    } finally {
      submit.disabled = false;
      skip.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    generate({ skipped: false }).catch(() => {});
  });
  skip.addEventListener("click", () => generate({ skipped: true }).catch(() => {}));
  return { generate };
}

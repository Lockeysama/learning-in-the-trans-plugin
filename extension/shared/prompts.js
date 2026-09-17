import {
  GLOSS_SYSTEM,
  PARAGRAPH_SYSTEM,
  PRONOUNCE_SYSTEM,
  SEED_SYSTEM,
} from "./constants.js";

export const DEFAULT_PROMPTS = {
  gloss: GLOSS_SYSTEM,
  seed: SEED_SYSTEM,
  translate: PARAGRAPH_SYSTEM,
  pronounce: PRONOUNCE_SYSTEM,
};

export const PROMPT_JSON_EXAMPLES = {
  gloss: '{"items":[{"span":"...","gloss":"..."}]}',
  seed: '{"coverageBands":["junior","senior"],"extraLemmas":["nonetheless"]}',
  translate: '{"paragraphs":["English paragraph", "..."]}',
  pronounce: '{"text":"...","ipa":"/ˈwɛðər/","ipaUk":"","hint":"韦-德尔","hintUk":""}',
};

export const PROMPT_META = [
  {
    id: "gloss",
    title: "生词释义",
    hint: `学习视图里给未知英文单位出简短中文释义。可以改任务说明，但不要改输出 JSON 结构 ${PROMPT_JSON_EXAMPLES.gloss}，否则会报错。`,
  },
  {
    id: "seed",
    title: "种子词表",
    hint: `初始化时根据学习者画像和入学测验选择覆盖档位。可以改任务说明，但不要改输出 JSON 结构 ${PROMPT_JSON_EXAMPLES.seed}，否则会报错。`,
  },
  {
    id: "translate",
    title: "中译英",
    hint: `把中文网页段落译成英文。可以改任务说明，但不要改输出 JSON 结构 ${PROMPT_JSON_EXAMPLES.translate}，否则会报错。`,
  },
  {
    id: "pronounce",
    title: "发音音标",
    hint: `划词「这个怎么读」时给出国际音标。可以改任务说明，但不要改输出 JSON 结构 ${PROMPT_JSON_EXAMPLES.pronounce}，否则会报错。`,
  },
];

const JSON_CHECKS = {
  gloss: (obj) =>
    Array.isArray(obj?.items) && obj.items.some((item) => item && "span" in item && "gloss" in item),
  seed: (obj) => Array.isArray(obj?.coverageBands) && Array.isArray(obj?.extraLemmas),
  translate: (obj) => Array.isArray(obj?.paragraphs),
  pronounce: (obj) =>
    typeof obj?.ipa === "string" && obj.ipa.trim().length > 0 && typeof obj?.hint === "string",
};

export function jsonObjectsIn(text) {
  const out = [];
  const source = String(text || "");
  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (!depth) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(source.slice(start, i + 1)));
        } catch {
          /* skip */
        }
        start = -1;
      }
    }
  }
  return out;
}

export function promptJsonError(id, text) {
  const meta = PROMPT_META.find((item) => item.id === id);
  const check = JSON_CHECKS[id];
  if (!meta || !check) return "";
  const ok = jsonObjectsIn(text).some(check);
  if (ok) return "";
  return `「${meta.title}」不要改输出 JSON 结构，必须保留 ${PROMPT_JSON_EXAMPLES[id]}，否则运行会报错。`;
}

export function validatePrompts(prompts = {}) {
  const merged = mergePrompts(prompts);
  const errors = PROMPT_META.map((item) => promptJsonError(item.id, merged[item.id])).filter(Boolean);
  if (!errors.length) return { ok: true, prompts: merged };
  return { ok: false, error: errors.join(" "), prompts: merged };
}

export function mergePrompts(stored = {}) {
  const out = {};
  for (const item of PROMPT_META) {
    const value = String(stored?.[item.id] || "").trim();
    out[item.id] = value || DEFAULT_PROMPTS[item.id];
  }
  return out;
}

export function promptOverrides(prompts = {}) {
  const out = {};
  for (const item of PROMPT_META) {
    const value = String(prompts?.[item.id] || "").trim();
    if (value && value !== DEFAULT_PROMPTS[item.id]) out[item.id] = value;
  }
  return out;
}

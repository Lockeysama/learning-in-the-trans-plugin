export const MODEL = "deepseek-flash";
export const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export const BAND_ORDER = [
  "primary",
  "junior",
  "senior",
  "cet4",
  "cet6",
  "academic",
];

export const BAND_LABELS = {
  primary: "小学",
  junior: "初中",
  senior: "高中",
  cet4: "四级",
  cet6: "六级",
  academic: "专业/学术",
};

export const DIFFICULTIES = ["easy", "default", "hard"];

export const MOTTO = "莫问当下（什么水平），只求前程！";

export const STORAGE_KEYS = {
  apiKey: "apiKey",
  onboardingDone: "onboardingDone",
  profile: "profile",
  coverageBands: "coverageBands",
  extraLemmas: "extraLemmas",
  extraUnknowns: "extraUnknowns",
  removedLemmas: "removedLemmas",
  unknownDrafts: "unknownDrafts",
  difficulty: "difficulty",
  disabledHosts: "disabledHosts",
  autoLearnHosts: "autoLearnHosts",
  skipPlacement: "skipPlacement",
  debugEnabled: "debugEnabled",
  usage: "usage",
  debugLogs: "debugLogs",
  prompts: "prompts",
  glossStyle: "glossStyle",
};

export const GLOSS_SYSTEM = `你只为给定英文单位提供简短中文释义。单位由调用方指定。
- 释义必须且仅覆盖该单位。
- 释义本身应能独立理解，对应完整词义或完整短语意义。
- 不要把该单位之外的句法成分写进释义。
- 不要翻译整句，不要改英文，不要增删单位边界。
输出 JSON：{"items":[{"span":"...","gloss":"..."}]}
gloss 不含括号、不含英文。`;

export const SEED_SYSTEM = `你根据学习者画像和短句互译答卷，选择应覆盖的英语词表档位。
不要枚举用户会的每一个词，也不要根据十几句答卷推出完整词表。
可选档位只能是：primary, junior, senior, cet4, cet6, academic（由低到高）。
规则：
- 答卷明显弱于学历/证书时，以下调档位为准，不要按画像抬档。
- 功能词和高词频词会由程序托底，不必写进 extraLemmas。
- extraLemmas 最多 40 个，小写 lemma，只补充档位之间可能漏掉的词。
输出 JSON：{"coverageBands":["junior","senior"],"extraLemmas":["nonetheless"]}`;

export const PARAGRAPH_SYSTEM = `把每段中文译成通顺、自然的英文。不要解释，不要编号，不要添加原文没有的信息。
保持输入段落数量和顺序。
输出 JSON：{"paragraphs":["English paragraph", "..."]}`;

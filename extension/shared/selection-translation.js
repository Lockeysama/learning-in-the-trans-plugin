export const MAX_SELECTION_LENGTH = 2000;
export const MAX_SELECTION_CONTEXT = 4000;

export function translationInput(text, sentence = "", mode = "natural", natural = "") {
  const source = typeof text === "string" ? text.trim() : "";
  if (!source || !/\p{L}/u.test(source)) throw new Error("请先选中要翻译的单词、短语或句子");
  if (source.length > MAX_SELECTION_LENGTH) throw new Error("选中内容过长，请选择 2000 字符以内的短句或段落");
  if (!["natural", "literal", "analysis"].includes(mode)) throw new Error("未知的翻译方式");
  return {
    text: source,
    context: String(sentence || "").slice(0, MAX_SELECTION_CONTEXT),
    mode,
    ...(mode === "natural" ? {} : { natural: String(natural || "").slice(0, 6000) }),
  };
}

function value(text) {
  return typeof text === "string" ? text.trim() : "";
}

export function translationResult(payload, mode) {
  if (mode === "analysis") {
    const units = Array.isArray(payload?.units) ? payload.units.map((unit) => ({
      source: value(unit?.source), meaning: value(unit?.meaning), role: value(unit?.role),
    })).filter((unit) => unit.source && unit.meaning) : [];
    const structure = value(payload?.structure);
    const usage = value(payload?.usage);
    if (!units.length || (!structure && !usage)) throw new Error("没有得到完整的词句解析，请重试");
    return { units, structure, usage };
  }
  const translation = value(payload?.translation);
  if (mode === "natural") {
    if (!translation || !["word", "phrase", "sentence"].includes(payload?.kind)) {
      throw new Error("没有得到有效译文，请重试");
    }
    return { translation, kind: payload.kind, partOfSpeech: value(payload.partOfSpeech), note: value(payload.note) };
  }
  if (!translation && !value(payload?.note)) throw new Error("没有得到贴近原文的译文，请重试");
  return { translation, note: value(payload?.note) };
}

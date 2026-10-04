export const KEY_INFO_MAX_CHARS = 4000;

// Recover selection boundaries only when every non-whitespace character still
// aligns. The sole punctuation equivalence is the final '.' / '。'. Always
// reconstruct from source, never render a model-rewritten string.
export function restoreKeyInfoSource(source, annotated) {
  let originalError;
  try { keyInfoRanges(source, annotated); return annotated; }
  catch (error) { originalError = error; }
  if (typeof annotated !== "string" || source.includes("**")) throw originalError;
  const spans = [];
  let plain = "", start = null;
  for (let i = 0; i < annotated.length;) {
    if (annotated.startsWith("**", i)) {
      if (start === null) start = plain.length;
      else { spans.push({ start, end: plain.length }); start = null; }
      i += 2;
    } else { plain += annotated[i++]; }
  }
  if (start !== null) throw originalError;
  const original = [...source.matchAll(/\S/gu)];
  const proposed = [...plain.matchAll(/\S/gu)];
  if (original.length !== proposed.length) throw originalError;
  for (let i = 0; i < original.length; i++) {
    const a = original[i][0], b = proposed[i][0];
    if (a !== b && !(i === original.length - 1 && /[.。]/u.test(a) && /[.。]/u.test(b))) throw originalError;
  }
  let result = "", cursor = 0;
  for (const span of spans) {
    const from = proposed.findIndex(char => char.index >= span.start && char.index < span.end);
    let to = from;
    while (to + 1 < proposed.length && proposed[to + 1].index < span.end) to++;
    if (from < 0) throw originalError;
    const begin = original[from].index;
    const end = original[to].index + original[to][0].length;
    result += source.slice(cursor, begin) + "**" + source.slice(begin, end) + "**";
    cursor = end;
  }
  result += source.slice(cursor);
  keyInfoRanges(source, result);
  return result;
}

export function keyInfoCoverage(source, ranges) {
  const count = text => (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return ranges.reduce((sum, range) => sum + count(source.slice(range.start, range.end)), 0) / Math.max(1, count(source));
}

// Only complete explicit multi-character connectives or delimited temporal
// clauses. Bare Chinese characters and English "For" have many non-conditional
// uses; uncertain scope belongs to semantic review, not automatic formatting.
export function keyInfoRelationGaps(source, ranges) {
  const gaps = [];
  const prefixes = [
    /^(?:对于|针对|如果|假如|只有|仅在|除非|由于|因为|为避免|为了)[^，,；;。！？\n]{1,70}(?=[，,])/u,
    /^(?:在|将|把)[^，,；;。！？\n]{1,40}(?:之后|之前|后|前|时)(?=[，,])/u,
    /^(?:If|When|Unless|Only when|After|Before|Because)\s+[^,;.!?\n]{1,120}(?=,)/iu,
  ];
  // Fold soft line breaks for segmentation only, preserving every UTF-16
  // offset. A wrapped action still belongs to its condition; a new sentence
  // does not. Native segmentation also handles decimal and identifier dots.
  const segmentationText = source.replace(/[\r\n\u2028\u2029]/gu, " ");
  for (const sentence of new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(segmentationText)) {
    const original = source.slice(sentence.index, sentence.index + sentence.segment.length);
    const leading = original.match(/^\s*/u)[0].length;
    const text = original.slice(leading);
    const prefix = prefixes.map(pattern => text.match(pattern)?.[0]).find(Boolean);
    if (!prefix) continue;
    const start = sentence.index + leading;
    const end = start + prefix.length;
    const sentenceEnd = sentence.index + sentence.segment.length;
    const hasAction = ranges.some(range => range.end > end && range.start < sentenceEnd
      && /[\p{L}\p{N}]/u.test(source.slice(Math.max(range.start, end), Math.min(range.end, sentenceEnd))));
    const covered = [...prefix.matchAll(/[\p{L}\p{N}]/gu)].every(char => ranges.some(range => range.start <= start + char.index && range.end > start + char.index));
    if (hasAction && !covered) gaps.push({ start, end });
  }
  return gaps;
}

// Keep a selected action together with its explicit leading condition. Only
// insert delimiters at original offsets; never rewrite text or choose actions.
export function completeKeyInfoRelations(source, annotated) {
  const ranges = keyInfoRanges(source, annotated);
  const gaps = keyInfoRelationGaps(source, ranges);
  if (!gaps.length) return annotated;
  const merged = [];
  for (const range of [...ranges, ...gaps].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  let result = "", cursor = 0;
  for (const range of merged) {
    result += source.slice(cursor, range.start) + "**" + source.slice(range.start, range.end) + "**";
    cursor = range.end;
  }
  result += source.slice(cursor);
  // In a very short all-core sentence, completing the relation can conflict
  // with the no-whole-sentence rule. Leave that decision to semantic review.
  try { keyInfoRanges(source, result); return result; } catch { return annotated; }
}

// Density triggers a semantic revision, never mechanical deletion of highlights.
// Short labels and compact requirements do not need a percentage quota.
export function keyInfoRevisionReason(source, annotated) {
  let ranges;
  try { ranges = keyInfoRanges(source, annotated); }
  catch (error) { return error.message; }
  if (keyInfoRelationGaps(source, ranges).length) return "存在句首适用对象、条件或时机未与已标注动作一起突出；请整组补齐关系，或整组取消次要关系的标注，不要只标动作";
  const seen = new Set();
  for (const range of ranges) {
    const phrase = source.slice(range.start, range.end).replace(/\s+/g, "");
    if ([...phrase.matchAll(/[\p{L}\p{N}]/gu)].length < 12) continue;
    if (seen.has(phrase)) return "相同的完整判断被重复标注，请优先保留首次完整关系，取消重复内容的整组标注";
    seen.add(phrase);
  }
  const length = (source.match(/[\p{L}\p{N}]/gu) || []).length;
  if (length < 40) return "";
  if (!ranges.length) return "较长句段完全没有重点，请重新检查是否存在具体结论或行动要求；纯背景可以保持原样";
  if (keyInfoCoverage(source, ranges) > 0.65) return "标注覆盖了超过 65% 的实质文字，重点与背景缺少层次";
  return "";
}

// Accept only inserted ** delimiters. Never repair a rewritten translation or
// interpret arbitrary Markdown/HTML from the model.
export function keyInfoRanges(source, annotated) {
  if (typeof annotated !== "string") throw new Error("重点标注不是文本");
  const ranges = [];
  let cursor = 0;
  let start = null;
  for (let index = 0; index < annotated.length;) {
    if (annotated.startsWith("**", index) && !source.startsWith("**", cursor)) {
      if (start === null) start = cursor;
      else {
        const text = source.slice(start, cursor);
        if ((text.match(/[\p{L}\p{N}]/gu) || []).length < 2 || text.trim() !== text) throw new Error("重点标注不是完整短语");
        ranges.push({ start, end: cursor });
        start = null;
      }
      index += 2;
    } else {
      if (cursor >= source.length || annotated[index] !== source[cursor]) throw new Error("重点标注改动了译文");
      cursor += 1;
      index += 1;
    }
  }
  if (cursor !== source.length || start !== null) throw new Error("重点标注不完整");
  const meaningful = [...source.matchAll(/[\p{L}\p{N}]/gu)];
  if (ranges.length && meaningful.every(match => ranges.some(range => match.index >= range.start && match.index < range.end))) {
    throw new Error("重点标注覆盖了全部内容");
  }
  return ranges;
}

// Keep sentence boundaries when bounding long paragraphs. A single oversized
// sentence is left plain, rather than splitting its condition/result relation.
export function keyInfoSegments(text) {
  if (text.length <= KEY_INFO_MAX_CHARS) return [{ text, offset: 0 }];
  const result = [];
  let chunk = "";
  let offset = 0;
  for (const item of new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)) {
    if (chunk && chunk.length + item.segment.length > KEY_INFO_MAX_CHARS) {
      result.push({ text: chunk, offset });
      chunk = "";
    }
    if (!chunk) offset = item.index;
    chunk += item.segment;
  }
  if (chunk) result.push({ text: chunk, offset });
  return result;
}

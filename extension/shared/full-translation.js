export function validateFullTranslation(payload, items) {
  if (!Array.isArray(payload?.items) || payload.items.length !== items.length) {
    throw new Error("全文翻译结果不完整，请重试");
  }
  const byId = new Map();
  for (const item of payload.items) {
    if (!item || typeof item.id !== "string" || typeof item.translation !== "string" || !item.translation.trim() || byId.has(item.id)) {
      throw new Error("全文翻译结果格式不正确，请重试");
    }
    byId.set(item.id, item.translation.trim());
  }
  return items.map(({ id }) => {
    if (!byId.has(id)) throw new Error("全文翻译结果缺少原文片段，请重试");
    return byId.get(id);
  });
}

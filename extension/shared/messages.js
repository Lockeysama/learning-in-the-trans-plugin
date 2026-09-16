export const QUEUED_MESSAGE_TYPES = new Set(["GLOSS", "TRANSLATE_PARAS", "GENERATE_SEED"]);

export function shouldQueueMessage(type) {
  return QUEUED_MESSAGE_TYPES.has(type);
}

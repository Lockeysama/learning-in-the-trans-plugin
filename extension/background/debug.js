import { STORAGE_KEYS } from "../shared/constants.js";
import { addUsage, emptyUsage, readUsage } from "../shared/usage.js";

const MAX_LOGS = 80;
const MAX_FIELD = 12000;
let writes = Promise.resolve();

// Model requests can finish concurrently (page processing and instant lookups).
// Serialize only the storage updates so token counts and logs are not lost.
function record(work) {
  const next = writes.then(work, work);
  writes = next.catch(() => {});
  return next;
}

function clip(value) {
  const text = String(value ?? "");
  if (text.length <= MAX_FIELD) return text;
  return `${text.slice(0, MAX_FIELD)}\n…(truncated)`;
}

export function recordCall(args) {
  return record(() => writeCall(args));
}

async function writeCall({ action, request, rawContent, usage, error }) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.debugEnabled,
    STORAGE_KEYS.usage,
    STORAGE_KEYS.debugLogs,
  ]);
  const nextUsage = addUsage(readUsage(stored.usage) || emptyUsage(), {
    ...usage,
    calls: 1,
  });
  const patch = { [STORAGE_KEYS.usage]: nextUsage };
  if (stored.debugEnabled) {
    const entry = {
      ts: Date.now(),
      kind: error ? "error" : "agent",
      action,
      model: request?.model,
      prompt: clip(request?.system),
      userInput: clip(request?.user),
      response: clip(rawContent || error || ""),
      usage: usage || emptyUsage(),
    };
    const logs = [entry, ...(stored.debugLogs || [])].slice(0, MAX_LOGS);
    patch[STORAGE_KEYS.debugLogs] = logs;
    console.info("[Littp]", action, {
      prompt: entry.prompt,
      userInput: entry.userInput,
      response: entry.response,
      usage: entry.usage,
    });
  }
  await chrome.storage.local.set(patch);
  return nextUsage;
}

export function recordBehavior(action, detail) {
  return record(() => writeBehavior(action, detail));
}

async function writeBehavior(action, detail) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.debugEnabled,
    STORAGE_KEYS.debugLogs,
  ]);
  if (!stored.debugEnabled) return;
  const entry = {
    ts: Date.now(),
    kind: "behavior",
    action,
    prompt: "",
    userInput: "",
    response: clip(typeof detail === "string" ? detail : JSON.stringify(detail)),
    usage: emptyUsage(),
  };
  const logs = [entry, ...(stored.debugLogs || [])].slice(0, MAX_LOGS);
  await chrome.storage.local.set({ [STORAGE_KEYS.debugLogs]: logs });
  console.info("[Littp]", action, detail);
}

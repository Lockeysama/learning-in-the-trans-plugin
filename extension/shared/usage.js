export function emptyUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
  };
}

export function readUsage(raw) {
  const usage = emptyUsage();
  if (!raw || typeof raw !== "object") return usage;
  usage.promptTokens = Number(raw.prompt_tokens ?? raw.promptTokens) || 0;
  usage.completionTokens = Number(raw.completion_tokens ?? raw.completionTokens) || 0;
  usage.totalTokens = Number(raw.total_tokens ?? raw.totalTokens) || 0;
  if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens;
  usage.calls = Number(raw.calls) || 0;
  return usage;
}

export function addUsage(acc, delta) {
  const left = readUsage(acc);
  const right = readUsage(delta);
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    calls: left.calls + (right.calls || 1),
  };
}

export function formatTokens(n) {
  return new Intl.NumberFormat("zh-CN").format(Number(n) || 0);
}

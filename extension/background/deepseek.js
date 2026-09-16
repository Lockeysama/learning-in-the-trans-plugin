import { DEEPSEEK_URL, MODEL } from "../shared/constants.js";
import { readUsage } from "../shared/usage.js";

function extractJson(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("empty_model_content");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("invalid_json");
  }
}

export async function chatJson({ apiKey, system, user, maxTokens = 2048 }) {
  if (!apiKey) throw new Error("missing_api_key");
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false,
  };
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`deepseek_${response.status}`);
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `deepseek_${response.status}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  return {
    json: extractJson(content),
    rawContent: content || "",
    usage: readUsage(data?.usage),
    request: {
      model: MODEL,
      system,
      user,
      maxTokens,
    },
  };
}

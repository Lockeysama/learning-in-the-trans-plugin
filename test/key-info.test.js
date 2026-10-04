import assert from "node:assert/strict";
import test from "node:test";
import { keyInfoRanges, keyInfoSegments, KEY_INFO_MAX_CHARS } from "../extension/shared/key-info.js";
import { chatText, chatJson } from "../extension/background/deepseek.js";

test("key phrases preserve every character and align repeated phrases by position", () => {
  const text = "如果网络断开，请暂停上传；网络恢复后，再继续上传。";
  const marked = "**如果网络断开**，请**暂停上传**；**网络恢复后**，再**继续上传**。";
  const ranges = keyInfoRanges(text, marked);
  assert.deepEqual(ranges.map(range => text.slice(range.start, range.end)), ["如果网络断开", "暂停上传", "网络恢复后", "继续上传"]);
  assert.deepEqual(keyInfoRanges("重点与重点不同。", "重点与**重点**不同。"), [{ start: 3, end: 5 }]);
  assert.deepEqual(keyInfoRanges("保持 ** 原符号和空白。\n", "保持 ** 原符号和空白。\n"), []);
});

test("rewrites, reordered text, changed punctuation, whitespace and extra formats are rejected", () => {
  const text = "请先保存文件，再关闭窗口。\n";
  for (const marked of [
    "请先**保存文档**，再关闭窗口。\n",
    "请先**关闭窗口**，再保存文件。\n",
    "请先**保存文件**,再关闭窗口。\n",
    "请先**保存文件**，再关闭窗口。",
    "标注：请先**保存文件**，再关闭窗口。\n",
    "# 请先**保存文件**，再关闭窗口。\n",
    "请先<strong>保存文件</strong>，再关闭窗口。\n",
    "请先**保存文件，再关闭窗口。\n",
    "请先**保**存文件，再关闭窗口。\n",
    "**请先保存文件，再关闭窗口。**\n",
  ]) assert.throws(() => keyInfoRanges(text, marked));
});

test("bounded segments keep complete sentences and all whitespace", () => {
  const text = "如果条件满足，就执行操作。\n".repeat(500);
  const segments = keyInfoSegments(text);
  assert.equal(segments.map(segment => segment.text).join(""), text);
  for (const segment of segments) {
    assert.ok(segment.text.length <= KEY_INFO_MAX_CHARS);
    assert.equal(text.slice(segment.offset, segment.offset + segment.text.length), segment.text);
  }
  const longSentence = "条件".repeat(2500) + "，则执行任务。";
  assert.deepEqual(keyInfoSegments(longSentence), [{ text: longSentence, offset: 0 }]);
});

test("annotation uses plain model output while existing JSON calls keep JSON mode", async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: body.response_format ? '{"ok":true}' : "请**保存文件**。\n" } }] }), { status: 200 });
  };
  try {
    const args = { apiKey: "stub", system: "instructions", user: "请保存文件。\n" };
    assert.equal((await chatText(args)).rawContent, "请**保存文件**。\n");
    assert.equal(bodies[0].response_format, undefined);
    assert.deepEqual((await chatJson(args)).json, { ok: true });
    assert.deepEqual(bodies[1].response_format, { type: "json_object" });
  } finally { globalThis.fetch = original; }
});

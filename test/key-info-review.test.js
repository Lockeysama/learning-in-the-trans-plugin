import test from "node:test";
import assert from "node:assert/strict";
import { annotateWithReview, keyInfoRequest } from "../extension/background/key-info.js";
import { keyInfoRanges, keyInfoRevisionReason, keyInfoRelationGaps, restoreKeyInfoSource, completeKeyInfoRelations } from "../extension/shared/key-info.js";

const source = "这些事件包含转录文本以及时间戳。保留足够的历史记录有助于理解简短回复、更正，以及之前提供的细节。转录片段不是完整的用户轮次，转录内容可能包含错误。";
const dense = "**这些事件包含转录文本以及时间戳**。**保留足够的历史记录**有助于**理解简短回复、更正，以及之前提供的细节**。**转录片段不是完整的用户轮次**，**转录内容可能包含错误**。";
const selective = "这些事件包含转录文本以及时间戳。保留足够的历史记录有助于理解简短回复、更正，以及之前提供的细节。**转录片段不是完整的用户轮次**，**转录内容可能包含错误**。";

test("near-total highlighting passes format validation but requests one semantic revision", async () => {
  assert.ok(keyInfoRanges(source, dense).length);
  assert.match(keyInfoRevisionReason(source, dense), /65%/);
  const reasons = [];
  const result = await annotateWithReview(source, async reason => { reasons.push(reason); return reason ? selective : dense; });
  assert.equal(result, selective);
  assert.equal(reasons.length, 2);
  assert.equal(reasons[0], "");
  assert.equal(keyInfoRevisionReason(source, result), "");
});

test("normal highlights and short unmarked labels need no additional request", async () => {
  for (const [text, marked] of [[source, selective], ["背景介绍", "背景介绍"]]) {
    let calls = 0;
    assert.equal(await annotateWithReview(text, async () => { calls++; return marked; }), marked);
    assert.equal(calls, 1);
  }
});

test("whole-sentence rejection gets one chance to recover useful emphasis", async () => {
  const text = "每个组织最多可以创建20个语音。";
  assert.throws(() => keyInfoRanges(text, "**每个组织最多可以创建20个语音**。"));
  const result = await annotateWithReview(text, async reason => reason ? "每个组织**最多可以创建20个语音**。" : "**每个组织最多可以创建20个语音**。");
  assert.deepEqual(keyInfoRanges(text, result), [{ start: 4, end: 15 }]);
});

test("revision failure or empty revision never discards valid existing emphasis", async () => {
  for (const revised of [source, "改写的句子", new Error("offline")]) {
    let calls = 0;
    const result = await annotateWithReview(source, async reason => {
      calls++;
      if (!reason) return dense;
      if (revised instanceof Error) throw revised;
      return revised;
    });
    assert.equal(result, dense);
    assert.equal(calls, 2);
  }
});

test("format drift maps highlights onto original characters without another model call", async () => {
  for (const [text, output, expected] of [
    ["请在启动时选择 audio.format 。其他配置保持不变。", "请**在启动时选择 audio.format**。其他配置保持不变。", "请**在启动时选择 audio.format** 。其他配置保持不变。"],
    ["错误可能表现为 404.", "错误**可能表现为 404**。", "错误**可能表现为 404**."],
    ["请保留\n audio.format 字段。", "请**保留 audio.format 字段**。", "请**保留\n audio.format 字段**。"],
  ]) {
    let calls = 0;
    assert.equal(await annotateWithReview(text, async () => { calls++; return output; }), expected);
    assert.equal(calls, 1);
    keyInfoRanges(text, expected);
  }
});

test("alignment rejects semantic changes and ambiguous literal Markdown", () => {
  for (const [text, output] of [
    ["可能返回 404。", "可能**返回 403**。"],
    ["不得重试支付。", "**得重试支付**。"],
    ["阈值为 1.5，继续。", "阈值为 **1。5**，继续。"],
    ["设置 x=-1 后继续。", "设置 **x=1** 后继续。"],
    ["先保存，再关闭。", "先**关闭**，再保存。"],
    ["保留 ** 标记。", "保留 **标记**。"],
    ["请保存文件。", "请**保存文件。"],
  ]) assert.throws(() => restoreKeyInfoSource(text, output));
});

test("repeated substantive highlights request a semantic review, not automatic deletion", () => {
  const repeated = "本次调整不会改变后端配置。还有其他细节需要检查。本次调整不会改变后端配置。";
  assert.match(keyInfoRevisionReason(repeated, "**本次调整不会改变后端配置**。还有其他细节需要检查。**本次调整不会改变后端配置**。"), /重复/);
});

test("semantic rewrites remain rejected and retry count is bounded", async () => {
  let calls = 0;
  await assert.rejects(annotateWithReview("错误可能表现为 404.", async () => { calls++; return "错误可能表现为 **403**。"; }), /改动了译文/);
  assert.equal(calls, 2);
});

test("explicit missing scopes are completed from original text without another model call", async () => {
  for (const [text, partial, complete] of [
    ["对于只读请求，请设置重试次数。其他参数见说明。", "对于只读请求，请**设置重试次数**。其他参数见说明。", "**对于只读请求**，请**设置重试次数**。其他参数见说明。"],
    ["将连接关闭后，会话仍保留记录。更多信息请查看日志。", "将连接关闭后，**会话仍保留记录**。更多信息请查看日志。", "**将连接关闭后**，**会话仍保留记录**。更多信息请查看日志。"],
    ["如果要启用通知，还需\n设置接收地址。示例见下文。", "如果要启用通知，还需\n**设置接收地址**。示例见下文。", "**如果要启用通知**，还需\n**设置接收地址**。示例见下文。"],
    ["If requests fail, retry once. Details are in the manual.", "If requests fail, **retry once**. Details are in the manual.", "**If requests fail**, **retry once**. Details are in the manual."],
  ]) {
    assert.match(keyInfoRevisionReason(text, partial), /条件/);
    let calls = 0;
    const result = await annotateWithReview(text, async () => { calls++; return partial; });
    assert.equal(calls, 1);
    assert.equal(result, complete);
    assert.equal(keyInfoRelationGaps(text, keyInfoRanges(text, result)).length, 0);
  }
});

test("a secondary unmarked condition does not force highlights when its action is also unmarked", () => {
  const text = "对于只读请求，请设置重试次数。部署时请保留完整日志，方便后续排查。";
  const marked = "对于只读请求，请设置重试次数。部署时请**保留完整日志**，方便后续排查。";
  assert.deepEqual(keyInfoRelationGaps(text, keyInfoRanges(text, marked)), []);
});

test("a sparser revision retains the explicit condition even when the model omitted it", async () => {
  const text = "如果任务失败，请保留现场日志，随后联系值班人员处理。界面上还会显示当前任务的状态与执行时间。";
  const first = "**如果任务失败**，请**保留现场日志**，随后**联系值班人员处理**。**界面上还会显示当前任务的状态与执行时间**。";
  const broken = "如果任务失败，请**保留现场日志**，随后联系值班人员处理。界面上还会显示当前任务的状态与执行时间。";
  let calls = 0;
  assert.equal(await annotateWithReview(text, async reason => { calls++; return reason ? broken : first; }), broken.replace("如果任务失败", "**如果任务失败**"));
  assert.equal(calls, 2);
});

test("revision receives the exact original, candidate and issues as data; output stays plain text", () => {
  const args = keyInfoRequest(source, "base rules", "过密", dense);
  const input = JSON.parse(args.user);
  assert.equal(input.text, source);
  assert.equal(input.previousAnnotation, dense);
  assert.equal(input.issues, "过密");
  assert.ok(input.review.coverage > 0.65);
  assert.deepEqual(input.review.missingScopes, []);
  const text = "对于只读请求，请重试一次。其他参数见说明。";
  assert.deepEqual(JSON.parse(keyInfoRequest(text, "rules", "条件", "对于只读请求，请**重试一次**。其他参数见说明。").user).review.missingScopes, ["对于只读请求"]);
  assert.equal(args.format, "text");
  assert.equal(keyInfoRequest(source, "base rules").user, source);
});


test("scope completion preserves whitespace, merges overlaps and leaves unselected relations alone", () => {
  const text = "对于 只读请求，请重试一次。对其他问题另行处理。";
  const partial = "对于 **只读请求**，请**重试一次**。对其他问题另行处理。";
  const result = completeKeyInfoRelations(text, partial);
  assert.equal(result, "**对于 只读请求**，请**重试一次**。对其他问题另行处理。");
  assert.equal(completeKeyInfoRelations(text, result), result);
  assert.equal(completeKeyInfoRelations(text, text), text);
  keyInfoRanges(text, result);
});

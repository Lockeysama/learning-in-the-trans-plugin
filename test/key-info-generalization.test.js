import test from 'node:test';
import assert from 'node:assert/strict';
import { completeKeyInfoRelations, keyInfoRanges } from '../extension/shared/key-info.js';

test('narrative, expository and example openings do not cause automatic expansion', () => {
  const openings = ['若有所思的旅人靠在窗边', '当代建筑外观简洁', '要点已列在附录中', '在场的观众保持安静', 'For example', 'For decades'];
  for (const opening of openings) {
    const text = `${opening}，接下来的文字表达主要信息。其他细节见附录。`;
    const marked = `${opening}，**接下来的文字表达主要信息**。其他细节见附录。`;
    assert.equal(completeKeyInfoRelations(text, marked), marked);
  }
});

test('ambiguous unpunctuated temporal clauses remain a model decision', () => {
  const text = '将按钮移到前面会改变显示顺序。其他布局保持不变。';
  const marked = '将按钮移到前面会**改变显示顺序**。其他布局保持不变。';
  assert.equal(completeKeyInfoRelations(text, marked), marked);
});

test('explicit scope completion transfers across domains without changing the source', () => {
  for (const scope of ['如果馆内湿度超标', '由于河流水位上涨', '针对新入学的学生', '将面团冷藏后', '在闭馆之前']) {
    const text = `${scope}，需要采取相应措施。具体安排另行说明。`;
    const marked = `${scope}，**需要采取相应措施**。具体安排另行说明。`;
    const result = completeKeyInfoRelations(text, marked);
    assert.equal(result, `**${scope}**，**需要采取相应措施**。具体安排另行说明。`);
    keyInfoRanges(text, result);
  }
});


test('explicit English conditions retain their action', () => {
  const text = 'When the soil is dry, water the roots. Keep the leaves dry.';
  assert.equal(completeKeyInfoRelations(text, 'When the soil is dry, **water the roots**. Keep the leaves dry.'), '**When the soil is dry**, **water the roots**. Keep the leaves dry.');
});

test('an unrelated later sentence never completes an earlier condition', () => {
  for (const separator of ['. ', '.\n', '。', '! ', '? ']) {
    const text = `If rain falls, close windows${separator}The museum opens at nine.`;
    const marked = `If rain falls, close windows${separator}The museum **opens at nine**.`;
    assert.equal(completeKeyInfoRelations(text, marked), marked);
  }
});

test('conditions after earlier sentences are found at original UTF-16 offsets', () => {
  for (const opening of ['A short introduction. ', '提示🌧️。', '背景说明.\r\n']) {
    const text = `${opening}If rain falls, close windows. Other details follow.`;
    const marked = `${opening}If rain falls, **close windows**. Other details follow.`;
    const result = completeKeyInfoRelations(text, marked);
    assert.equal(result, `${opening}**If rain falls**, **close windows**. Other details follow.`);
    keyInfoRanges(text, result);
  }
});

test('soft line breaks retain condition/action relationships without altering whitespace', () => {
  for (const wrap of ['\n', '\r\n', '\u2028', '\u2029']) {
    const text = `If rain falls,${wrap}close windows. Other details follow.`;
    const marked = `If rain falls,${wrap}**close windows**. Other details follow.`;
    assert.equal(completeKeyInfoRelations(text, marked), `**If rain falls**,${wrap}**close windows**. Other details follow.`);
  }
});

test('decimal and identifier dots do not separate an action from its condition', () => {
  for (const action of ['wait 2.5 hours before returning', 'check window.location before continuing']) {
    const text = `If the check fails, ${action}. Other details follow.`;
    const marked = `If the check fails, **${action}**. Other details follow.`;
    assert.equal(completeKeyInfoRelations(text, marked), `**If the check fails**, **${action}**. Other details follow.`);
  }
});

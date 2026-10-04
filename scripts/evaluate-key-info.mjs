// Usage: DEEPSEEK_API_KEY=... node scripts/evaluate-key-info.mjs --out /tmp/results.json
// Optional: --split development|heldout, --baseline /path/to/frozen-modules
// Synthetic rubric fields never enter model requests. No browser access or key discovery.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { KEY_INFO_SYSTEM, MODEL } from '../extension/shared/constants.js';
import { chatText } from '../extension/background/deepseek.js';
import * as current from '../extension/background/key-info.js';
import { keyInfoCoverage, keyInfoRanges } from '../extension/shared/key-info.js';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const split = args.includes('--split') ? option('--split') : 'heldout';
const out = args.includes('--out') ? option('--out') : null;
if (!['development', 'heldout'].includes(split) || !out || !process.env.DEEPSEEK_API_KEY) {
  throw new Error('Require DEEPSEEK_API_KEY and --out; --split must be development or heldout');
}
if (fs.existsSync(out)) throw new Error('Refusing to overwrite an existing evaluation; choose a new --out');
const baselineRoot = args.includes('--baseline') ? path.resolve(option('--baseline')) : null;
const baseline = baselineRoot ? await import(pathToFileURL(path.join(baselineRoot, 'background/key-info.js'))) : null;
const datasetBytes = fs.readFileSync(new URL('../evals/key-info/generalization.json', import.meta.url));
const samples = JSON.parse(datasetBytes).cases.filter(row => row.split === split);
const hash = value => createHash('sha256').update(value).digest('hex');
const policyHash = root => hash(['background/key-info.js', 'shared/key-info.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'));
const currentRoot = new URL('../extension/', import.meta.url).pathname;
const report = { currentPolicyHash: policyHash(currentRoot), baselinePolicyHash: baselineRoot ? policyHash(baselineRoot) : null, model: MODEL, split, datasetHash: hash(datasetBytes), promptHash: hash(KEY_INFO_SYSTEM), createdAt: new Date().toISOString(), actualCalls: 0, totalTokens: 0, rows: [] };
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => originalFetch(url, { ...options, signal: AbortSignal.timeout(120000) });
const requests = new Map();
async function evaluate(policy, sample) {
  const attempts = [];
  const start = Date.now();
  try {
    const annotated = await policy.annotateWithReview(sample.text, async (reason, previous) => {
      const request = { ...policy.keyInfoRequest(sample.text, KEY_INFO_SYSTEM, reason, previous), maxTokens: Math.min(8000, 300 + sample.text.length * 2) };
      const key = hash(JSON.stringify(request));
      const reused = requests.has(key);
      if (!reused) requests.set(key, (async () => {
        report.actualCalls++;
        const response = await chatText({ apiKey: process.env.DEEPSEEK_API_KEY, ...request });
        report.totalTokens += response.usage.totalTokens || 0;
        return response.rawContent;
      })());
      const result = await requests.get(key);
      attempts.push({ reason, reused, result });
      return result;
    });
    const ranges = keyInfoRanges(sample.text, annotated);
    return { valid: true, annotated, coverage: keyInfoCoverage(sample.text, ranges), spans: ranges.length, attempts, ms: Date.now() - start };
  } catch (error) {
    return { valid: false, error: error.message, attempts, ms: Date.now() - start };
  }
}
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < samples.length) {
    const sample = samples[next++];
    const before = baseline ? await evaluate(baseline, sample) : null;
    const after = await evaluate(current, sample);
    report.rows.push({ ...sample, baseline: before, current: after });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ id: sample.id, valid: after.valid, baselineCoverage: before?.coverage, coverage: after.coverage }));
  }
}));
console.log(JSON.stringify({ samples: samples.length, valid: report.rows.filter(row => row.current.valid).length, actualCalls: report.actualCalls, totalTokens: report.totalTokens, out }));

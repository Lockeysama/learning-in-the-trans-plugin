import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectLang } from "../extension/shared/detect.js";
import {
  bandsForDifficulty,
  fallbackBands,
  normalizeBands,
} from "../extension/shared/difficulty.js";
import { isKnownWord } from "../extension/shared/lemma.js";
import { indexMwes, tokenize } from "../extension/shared/tokenize.js";

const functionWords = JSON.parse(
  readFileSync(new URL("../extension/lexicon/function-words.json", import.meta.url)),
);
const frequent = JSON.parse(
  readFileSync(new URL("../extension/lexicon/frequent-2000.json", import.meta.url)),
);
const mwes = JSON.parse(
  readFileSync(new URL("../extension/lexicon/mwe.json", import.meta.url)),
);

const known = new Set([...functionWords, ...frequent]);
const mweIndex = indexMwes(mwes);
const sample =
  "I woke up early, made a pot of tea, and watched the rain. The sky was grey, but the air felt refreshingly cool. The rain had eased, so I decided to go out, regardless of the weather. The streets were empty, and the world seemed oddly peaceful. Sometimes, what we need isn't a plan but a pause.";

test("detects English and Chinese samples", () => {
  assert.equal(detectLang(sample), "en");
  assert.equal(
    detectLang("周二傍晚，我关掉电脑，沿着河堤慢慢走。天色渐暗，路灯一盏盏亮起。"),
    "zh",
  );
});

test("keeps this and please as known", () => {
  assert.equal(isKnownWord("this", known), true);
  assert.equal(isKnownWord("This", known), true);
  assert.equal(isKnownWord("please", known), true);
});

test("marks sample hard spans as unknown units", () => {
  const sampleKnown = new Set([
    ...functionWords,
    "woke",
    "early",
    "made",
    "pot",
    "tea",
    "watched",
    "rain",
    "sky",
    "grey",
    "air",
    "felt",
    "decided",
    "go",
    "weather",
    "streets",
    "empty",
    "world",
    "seemed",
    "need",
    "plan",
    "sometimes",
  ]);
  const tokens = tokenize(sample, { known: sampleKnown, mweIndex });
  const unknown = tokens.filter((token) => token.type === "unknown").map((token) => token.span);
  assert.equal(unknown.includes("this"), false);
  assert.ok(unknown.includes("regardless of"));
  assert.ok(unknown.includes("refreshingly cool"));
  assert.ok(unknown.includes("oddly peaceful"));
  assert.ok(unknown.some((span) => span.toLowerCase() === "eased"));
  assert.ok(unknown.some((span) => span.toLowerCase() === "pause"));
});

test("easy difficulty drops selected bands", () => {
  assert.deepEqual(bandsForDifficulty(["primary", "junior", "senior"], "easy"), []);
  assert.deepEqual(bandsForDifficulty(["junior"], "default"), ["junior"]);
  assert.ok(bandsForDifficulty(["cet4"], "hard").includes("cet6"));
});

test("fallback bands use education and do not invent names", () => {
  const bands = fallbackBands({ education: "bachelor", workFrequency: "sometimes" });
  assert.deepEqual(normalizeBands(bands), bands);
  assert.ok(bands.includes("cet4"));
  assert.equal(bands.includes("academic"), false);
});

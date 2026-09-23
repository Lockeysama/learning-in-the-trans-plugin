import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const manifest = JSON.parse(
  readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"),
);

function readExtensionFile(path) {
  return readFileSync(new URL(`../extension/${path}`, import.meta.url), "utf8");
}

// Chrome runs scripts declared in content_scripts as classic scripts, so ESM syntax
// there is a hard SyntaxError that kills the whole content script at parse time.
// `new vm.Script` raises the same "Cannot use import statement outside a module".
test("declared content scripts are classic scripts Chrome can run", () => {
  const entries = manifest.content_scripts || [];
  assert.ok(entries.length > 0, "manifest should declare content scripts");
  for (const [index, entry] of entries.entries()) {
    assert.notEqual(
      entry.type,
      "module",
      `content_scripts[${index}] must not use "type": "module"; Chrome ignores it`,
    );
    for (const file of entry.js || []) {
      const source = readExtensionFile(file);
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: file }),
        `${file} is declared in content_scripts.js and must be valid classic script syntax`,
      );
    }
  }
});

// The classic bootstrap reaches the module graph with a dynamic import(), which the
// page fetches, so the module it names has to be a web-accessible resource.
test("the content bootstrap imports a web-accessible module", () => {
  const bootstrap = manifest.content_scripts.flatMap((entry) => entry.js || [])[0];
  const source = readExtensionFile(bootstrap);
  const match = source.match(/chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/);
  assert.ok(match, `${bootstrap} should resolve its module through chrome.runtime.getURL`);
  const target = match[1];

  const patterns = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);
  const covered = patterns.some((pattern) => {
    const escaped = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${escaped}$`).test(target);
  });
  assert.ok(covered, `${target} must be listed in web_accessible_resources`);
});

// Classic bootstrap for the declared content script.
//
// Chrome executes files listed in manifest `content_scripts.js` as CLASSIC scripts.
// `"type": "module"` is a Firefox-only key there: Chrome ignores it and evaluates the
// file as a classic script, so a top-level `import` throws
// "SyntaxError: Cannot use import statement outside a module" and none of the
// reading-view code runs — no in-page Littp bar, no auto-learn.
//
// This file therefore uses no import/export syntax. It hands off to the ES module
// graph with a dynamic import() of a web-accessible resource — the same mechanism
// shared/inject.js uses for the popup and context-menu paths.
import(chrome.runtime.getURL("content/content.js")).catch((error) => {
  console.error("[Littp] content script failed to load:", error);
});

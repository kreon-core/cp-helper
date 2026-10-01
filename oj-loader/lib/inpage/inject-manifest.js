/**
 * Ordered classic scripts injected into the contest tab before calling
 * `globalThis.__ojLoaderExtractSamplesInPage`. Paths are relative to the
 * extension root (`oj-loader/` - the folder that contains `manifest.json`).
 */
export const OJ_LOADER_INPAGE_SCRIPT_PATHS = [
  "lib/inpage/shared-dom.js",
  "lib/inpage/extract-atcoder.js",
  "lib/inpage/extract-codeforces.js",
  "lib/inpage/extract-leetcode.js",
  "lib/inpage/dispatch.js",
];

/**
 * Ordered classic scripts injected before calling `globalThis.__ojLoaderSubmitInPage` /
 * `__ojLoaderVerdictInPage` in a judge tab.
 */
export const OJ_LOADER_SUBMIT_SCRIPT_PATHS = [
  "lib/inpage/submit-shared.js",
  "lib/inpage/submit-atcoder.js",
  "lib/inpage/submit-codeforces.js",
  "lib/inpage/submit-dispatch.js",
];

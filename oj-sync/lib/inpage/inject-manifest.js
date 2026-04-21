/**
 * Ordered classic scripts injected into the contest tab before calling
 * `globalThis.__ojSyncExtractSamplesInPage`. Paths are relative to the
 * extension root (`oj-sync/` — the folder that contains `manifest.json`).
 */
export const OJ_SYNC_INPAGE_SCRIPT_PATHS = [
  "lib/inpage/shared-dom.js",
  "lib/inpage/extract-atcoder.js",
  "lib/inpage/extract-codeforces.js",
  "lib/inpage/extract-leetcode.js",
  "lib/inpage/dispatch.js",
];

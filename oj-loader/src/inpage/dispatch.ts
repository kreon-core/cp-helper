/**
 * Hostname router: calls `extractAtcoder` / `extractCodeforces` / `extractLeetcode`.
 * Edit here to disable a site without removing its file (guard with `false &&`).
 */
import type { ExtractResult } from "../types";
import { extractAtcoder } from "./extract-atcoder";
import { extractCodeforces } from "./extract-codeforces";
import { extractLeetcode } from "./extract-leetcode";

globalThis.__ojLoaderExtractSamplesInPage = function __ojLoaderExtractSamplesInPage(
  pageUrl: string,
): ExtractResult | Promise<ExtractResult> {
  let hostname = "";
  try {
    hostname = new URL(pageUrl || "").hostname;
  } catch {
    return [];
  }

  const atcoder =
    hostname === "atcoder.jp" || hostname.endsWith(".atcoder.jp");
  const cf =
    hostname === "codeforces.com" || hostname.endsWith(".codeforces.com");
  const lc =
    hostname === "leetcode.com" ||
    hostname.endsWith(".leetcode.com") ||
    hostname === "leetcode.cn" ||
    hostname.endsWith(".leetcode.cn");

  if (atcoder) {
    return extractAtcoder(pageUrl);
  }
  if (cf) {
    return extractCodeforces(pageUrl);
  }
  if (lc) {
    return extractLeetcode(pageUrl);
  }
  return [];
};

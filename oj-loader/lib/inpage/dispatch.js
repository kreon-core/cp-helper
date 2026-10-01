/**
 * Hostname router: calls `__ojLoaderInpage.extractAtcoder` / `extractCodeforces` / `extractLeetcode`.
 * Edit here to disable a site without removing its file (guard with `false &&`).
 */
(function registerOjLoaderDispatch(g) {
  const ns = g.__ojLoaderInpage;
  if (!ns) return;

  /**
   * @param {string} pageUrl
   * @returns {unknown}
   */
  g.__ojLoaderExtractSamplesInPage = function __ojLoaderExtractSamplesInPage(
    pageUrl,
  ) {
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

    if (atcoder && typeof ns.extractAtcoder === "function") {
      return ns.extractAtcoder(pageUrl);
    }
    if (cf && typeof ns.extractCodeforces === "function") {
      return ns.extractCodeforces(pageUrl);
    }
    if (lc && typeof ns.extractLeetcode === "function") {
      return ns.extractLeetcode(pageUrl);
    }
    return [];
  };
})(globalThis);

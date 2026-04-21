/**
 * AtCoder / Codeforces / LeetCode problem id for CP Helper header (e.g. atcoder/abc451_a).
 * LeetCode: numeric labels (`leetcode/3901`) come only from in-page scrape; **no** URL slug here.
 * @param {string | undefined} pageUrl
 * @returns {string}
 */
export function problemLabelFromContestUrl(pageUrl) {
  if (!pageUrl) return "";
  const cfProblemLetter = (s) =>
    /^[a-z]$/iu.test(s) ? s.toUpperCase() : s;
  try {
    const u = new URL(pageUrl);
    const host = u.hostname;
    const path = u.pathname;
    const atcoder = host === "atcoder.jp" || host.endsWith(".atcoder.jp");
    const cf =
      host === "codeforces.com" || host.endsWith(".codeforces.com");
    const lc =
      host === "leetcode.com" ||
      host.endsWith(".leetcode.com") ||
      host === "leetcode.cn" ||
      host.endsWith(".leetcode.cn");
    if (atcoder) {
      const m = path.match(/\/contests\/[^/]+\/tasks\/([^/?#]+)/u);
      return m ? `atcoder/${m[1]}` : "";
    }
    if (cf) {
      let m = path.match(/\/contest\/(\d+)\/problem\/([^/?#]+)/u);
      if (m) {
        return `codeforces/${m[1]}${cfProblemLetter(m[2])}`;
      }
      m = path.match(/\/gym\/(\d+)\/problem\/([^/?#]+)/u);
      if (m) {
        return `codeforces/${m[1]}${cfProblemLetter(m[2])}`;
      }
      m = path.match(/\/problemset\/problem\/(\d+)\/([^/?#]+)/u);
      if (m) {
        return `codeforces/${m[1]}${cfProblemLetter(m[2])}`;
      }
      m = path.match(/\/(?:contest|gym)\/(\d+)\/(?:problems|print)(?:\/|$|\?)/u);
      if (m) {
        return `codeforces/${m[1]}`;
      }
      return "";
    }
    if (lc) {
      return "";
    }
  } catch {
    return "";
  }
  return "";
}

/**
 * @param {string | undefined} url
 * @returns {boolean}
 */
export function isSupportedContestUrl(url) {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    const atcoder = hostname === "atcoder.jp" || hostname.endsWith(".atcoder.jp");
    const cf = hostname === "codeforces.com" || hostname.endsWith(".codeforces.com");
    const lc =
      hostname === "leetcode.com" ||
      hostname.endsWith(".leetcode.com") ||
      hostname === "leetcode.cn" ||
      hostname.endsWith(".leetcode.cn");
    return atcoder || cf || lc;
  } catch {
    return false;
  }
}

/**
 * AtCoder: sample `<pre>` nodes under `span.lang-en`.
 * Delete this file and remove the atcoder branch in `dispatch.js` to drop support.
 */
(function registerAtcoderExtractor(g) {
  const ns = g.__ojSyncInpage;
  if (!ns) return;

  /**
   * Statement header line: "Time Limit: 2 sec / Memory Limit: 1024 MB" (Japanese pages use
   * the same line with a localized label).
   * @returns {number | null}
   */
  function atcoderTimeLimitMs() {
    for (const p of document.querySelectorAll("#main-container p, #main-div p")) {
      const t = (p.textContent ?? "").trim();
      if (!/time limit|\u5B9F\u884C\u6642\u9593\u5236\u9650/iu.test(t)) continue;
      const ms = ns.parseTimeLimitMs(t.split("/")[0]);
      if (ms !== null) return ms;
    }
    return null;
  }

  /**
   * @param {string} pageUrl unused (kept for API symmetry)
   * @returns {{ kind: string; timeLimitMs: number | null; items: { id: string; text: string }[] }}
   */
  ns.extractAtcoder = function extractAtcoder(pageUrl) {
    void pageUrl;
    const prePlainText = ns.prePlainText;
    const preSampleId = /^pre-sample\d*$/;
    /** @type {{ id: string; text: string }[]} */
    const results = [];
    const seen = new Set();
    for (const span of document.querySelectorAll("span.lang-en")) {
      for (const pre of span.querySelectorAll("pre[id]")) {
        const id = pre.getAttribute("id") ?? "";
        if (!preSampleId.test(id) || seen.has(id)) continue;
        seen.add(id);
        results.push({ id, text: prePlainText(pre) });
      }
    }
    results.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
    return {
      kind: "single",
      timeLimitMs: atcoderTimeLimitMs(),
      items: results,
    };
  };
})(globalThis);

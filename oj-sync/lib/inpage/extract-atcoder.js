/**
 * AtCoder: sample `<pre>` nodes under `span.lang-en`.
 * Delete this file and remove the atcoder branch in `dispatch.js` to drop support.
 */
(function registerAtcoderExtractor(g) {
  const ns = g.__ojSyncInpage;
  if (!ns) return;

  /**
   * @param {string} pageUrl unused (kept for API symmetry)
   * @returns {{ id: string; text: string }[]}
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
    return results;
  };
})(globalThis);

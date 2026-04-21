/**
 * Shared DOM helpers for in-page extractors (AtCoder + Codeforces).
 * @param {typeof globalThis} g
 */
(function initOjSyncInpageShared(g) {
  const ns = (g.__ojSyncInpage = g.__ojSyncInpage || {});
  /**
   * Codeforces may wrap each line in <div class="test-example-line">; join with newlines.
   * @param {Element} pre
   * @returns {string}
   */
  ns.prePlainText = function prePlainText(pre) {
    const lines = pre.querySelectorAll(":scope > .test-example-line");
    if (lines.length > 0) {
      return Array.from(lines)
        .map((el) =>
          (el.textContent ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
        )
        .join("\n");
    }
    return (pre.textContent ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  };
})(globalThis);

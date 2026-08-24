/**
 * Shared DOM helpers for in-page extractors (AtCoder + Codeforces).
 * @param {typeof globalThis} g
 */
(function initOjSyncInpageShared(g) {
  const ns = (g.__ojSyncInpage = g.__ojSyncInpage || {});

  const BLOCK_TAGS = new Set([
    "div",
    "p",
    "li",
    "tr",
    "section",
    "article",
    "pre",
  ]);

  /**
   * Codeforces separates sample lines with `<br>` instead of literal newlines, so `textContent`
   * would return every line joined into one ("3" + "1 2" + ... -> "31 2420 421...").
   * @param {Node} node
   * @param {{ text: string }} acc
   */
  function collectTextWithLineBreaks(node, acc) {
    if (node.nodeType === Node.TEXT_NODE) {
      acc.text += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const el = /** @type {Element} */ (node);
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      acc.text += "\n";
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block && acc.text.length > 0 && !acc.text.endsWith("\n")) {
      acc.text += "\n";
    }
    for (const child of el.childNodes) {
      collectTextWithLineBreaks(child, acc);
    }
    if (block && !acc.text.endsWith("\n")) {
      acc.text += "\n";
    }
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function normalizeSampleText(text) {
    return text
      .replace(/\r\n?/gu, "\n")
      .replace(/[ \t]+$/gmu, "")
      .replace(/\n+$/u, "");
  }

  /**
   * Sample block text with one line per source line.
   * @param {Element} pre
   * @returns {string}
   */
  ns.prePlainText = function prePlainText(pre) {
    const lines = pre.querySelectorAll(":scope > .test-example-line");
    if (lines.length > 0) {
      return normalizeSampleText(
        Array.from(lines)
          .map((el) => el.textContent ?? "")
          .join("\n"),
      );
    }
    const acc = { text: "" };
    collectTextWithLineBreaks(pre, acc);
    return normalizeSampleText(acc.text);
  };
})(globalThis);

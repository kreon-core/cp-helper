/**
 * Shared DOM helpers for in-page extractors (AtCoder + Codeforces).
 */

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
 */
function collectTextWithLineBreaks(node: Node, acc: { text: string }): void {
  if (node.nodeType === Node.TEXT_NODE) {
    acc.text += node.nodeValue ?? "";
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const el = node as Element;
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

function normalizeSampleText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n+$/u, "");
}

/**
 * Judge time limit in ms from statement text ("time limit per test2 seconds",
 * "Time Limit: 2 sec", "1500 ms"). Out-of-range values are rejected as a mis-parse.
 */
export function parseTimeLimitMs(text: string): number | null {
  const m = (text || "").match(
    /(\d+(?:\.\d+)?)\s*(milliseconds?|msec|ms|seconds?|secs?|sec|s)\b/iu,
  );
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase();
  const ms = Math.round(unit.charAt(0) === "m" ? value : value * 1000);
  return ms >= 100 && ms <= 60000 ? ms : null;
}

/**
 * Judge memory limit in MB from statement text ("memory limit per test256 megabytes",
 * "Memory Limit: 1024 MB", "1024 MiB"). Out-of-range values are rejected as a mis-parse.
 */
export function parseMemoryLimitMb(text: string): number | null {
  const m = (text || "").match(
    /(\d+(?:\.\d+)?)\s*(gigabytes?|gib|gb|megabytes?|mib|mb|kilobytes?|kib|kb)\b/iu,
  );
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2].toLowerCase().charAt(0);
  const mb = Math.round(
    unit === "g" ? value * 1024 : unit === "k" ? value / 1024 : value,
  );
  return mb >= 1 && mb <= 65536 ? mb : null;
}

/**
 * Sample block text with one line per source line.
 */
export function prePlainText(pre: Element): string {
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
}

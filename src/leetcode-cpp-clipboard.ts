/** Append `main()` + `lc_prelude::dispatch` for C++ LeetCode-style `class … { public: …`. */

/**
 * LeetCode editor snippets use 4-space indentation; normalize each leading run of four
 * spaces to two so pasted code matches a 2-space style.
 */
export function normalizeLeadingIndent4To2(code: string): string {
  const lines = code.split(/\r?\n/);
  return lines
    .map((line) => {
      let s = line;
      while (s.startsWith("    ")) {
        s = "  " + s.slice(4);
      }
      return s;
    })
    .join("\n");
}

function indexOfMatchingCloseParen(s: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\" && i + 1 < s.length) {
        i++;
        continue;
      }
      if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** C++ `public:` access block (not Java `public void`). */
export function isLeetcodeCppAccessStyle(code: string): boolean {
  return /\bclass\s+\w+\b/.test(code) && /\bpublic\s*:/m.test(code);
}

/**
 * True when starter text is treated as C++ for clipboard copy (CP Helper is C++-only).
 */
export function isLikelyCppSource(code: string): boolean {
  const t = code.trim();
  if (!t) return false;
  if (/\bint\s+main\s*\(/u.test(t)) return true;
  if (isLeetcodeCppAccessStyle(t)) return true;
  if (/#\s*include\b/.test(t)) return true;
  return false;
}

/** First `class Name` in the snippet. */
export function extractFirstCppClassName(code: string): string | null {
  const m = code.match(/\bclass\s+(\w+)\b/);
  return m?.[1] ?? null;
}

/**
 * First `identifier(` after `public:` that is not the constructor (`name === className`).
 * @param code
 * @param className
 */
export function extractLeetcodeCppDispatchMethod(
  code: string,
  className: string,
): string | null {
  const pub = code.search(/\bpublic\s*:/);
  if (pub < 0) return null;
  const tail = code.slice(pub);
  let searchFrom = 0;
  while (searchFrom < tail.length) {
    const sub = tail.slice(searchFrom);
    const m = sub.match(/\b([A-Za-z_][\w]*)\s*\(/u);
    if (!m?.[1] || m.index === undefined) return null;
    const name = m[1];
    const open = searchFrom + m.index + m[0].length - 1;
    if (name === className) {
      const close = indexOfMatchingCloseParen(tail, open);
      if (close < 0) return null;
      searchFrom = close + 1;
      continue;
    }
    return name;
  }
  return null;
}

/** @param starterCode */
export function appendLeetcodeCppDispatchMain(starterCode: string): string {
  const code = normalizeLeadingIndent4To2(starterCode);
  const trimmed = code.trim();
  if (trimmed.length === 0) return starterCode;
  if (/\bint\s+main\s*\(/u.test(trimmed)) {
    return code;
  }
  if (!isLeetcodeCppAccessStyle(trimmed)) {
    return code;
  }
  const className = extractFirstCppClassName(trimmed);
  if (!className) return code;
  const method = extractLeetcodeCppDispatchMethod(trimmed, className);
  if (!method) return code;
  const base = code.replace(/\s+$/u, "");
  const sep = base.endsWith("\n") ? "" : "\n";
  return `${base}${sep}\nint main() {\n  ${className} sol;\n  lc_prelude::dispatch<&${className}::${method}>(&sol);\n  return 0;\n}\n`;
}

/**
 * LeetCode: description examples + console testcase fallback; starter from Monaco or CodeMirror 6.
 * Stdin line ordering uses the C++ method parameter list from the editor when possible.
 * Delete this file and remove the lc branch in `dispatch.js` to drop support.
 */
(function registerLeetcodeExtractor(g) {
  const ns = g.__ojSyncInpage;
  if (!ns) return;

  /**
   * Split by commas at depth 0 (respects (), [], <>, strings).
   * @param {string} inner
   * @returns {string[]}
   */
  function splitTopLevelCommas(inner) {
    const s = inner.trim();
    if (!s) return [];
    /** @type {string[]} */
    const parts = [];
    let start = 0;
    let paren = 0;
    let bracket = 0;
    let angle = 0;
    let inString = false;
    let quote = "";
    for (let i = 0; i < s.length; i++) {
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
      if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (c === "[") bracket++;
      else if (c === "]") bracket--;
      else if (c === "<") angle++;
      else if (c === ">") angle = Math.max(0, angle - 1);
      else if (c === "," && paren === 0 && bracket === 0 && angle === 0) {
        parts.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(s.slice(start).trim());
    return parts.filter((p) => p.length > 0);
  }

  /**
   * @param {string} segment
   * @returns {string}
   */
  function stripDefaultAtDepth0(segment) {
    const s = segment;
    let paren = 0;
    let bracket = 0;
    let angle = 0;
    let inString = false;
    let quote = "";
    for (let i = 0; i < s.length; i++) {
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
      if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (c === "[") bracket++;
      else if (c === "]") bracket--;
      else if (c === "<") angle++;
      else if (c === ">") angle = Math.max(0, angle - 1);
      else if (c === "=" && paren === 0 && bracket === 0 && angle === 0) {
        return s.slice(0, i).trim();
      }
    }
    return s.trim();
  }

  /**
   * @param {string} s
   * @param {number} openIdx index of `(`
   * @returns {number}
   */
  function indexOfMatchingCloseParen(s, openIdx) {
    let paren = 0;
    let bracket = 0;
    let angle = 0;
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
      if (c === "(") paren++;
      else if (c === ")") {
        paren--;
        if (paren === 0 && bracket === 0 && angle === 0) return i;
      } else if (c === "[") bracket++;
      else if (c === "]") bracket--;
      else if (c === "<") angle++;
      else if (c === ">") angle = Math.max(0, angle - 1);
    }
    return -1;
  }

  /**
   * @param {string} inputLine
   * @returns {{ map: Record<string, string>; keyOrder: string[] }}
   */
  function leetcodeAssignmentLineToMap(inputLine) {
    const s = (inputLine ?? "").trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    /** @type {Record<string, string>} */
    const map = Object.create(null);
    /** @type {string[]} */
    const keyOrder = [];
    if (!s) return { map, keyOrder };
    let i = 0;
    const n = s.length;
    while (i < n) {
      while (i < n && (s[i] === " " || s[i] === "\t" || s[i] === ",")) i++;
      if (i >= n) break;
      const nameEq = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/u.exec(s.slice(i));
      if (!nameEq) break;
      const pname = nameEq[1];
      i += nameEq[0].length;
      let depth = 0;
      const start = i;
      let inStr = false;
      let q = "";
      for (; i < n; i++) {
        const c = s[i];
        if (inStr) {
          if (c === "\\" && i + 1 < n) {
            i++;
            continue;
          }
          if (c === q) inStr = false;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inStr = true;
          q = c;
          continue;
        }
        if (c === "[" || c === "{" || c === "(") depth++;
        else if (c === "]" || c === "}" || c === ")") depth--;
        else if (c === "," && depth === 0) {
          map[pname] = s.slice(start, i).trim();
          keyOrder.push(pname);
          i++;
          break;
        }
      }
      if (i >= n) {
        map[pname] = s.slice(start).trim();
        keyOrder.push(pname);
      }
    }
    return { map, keyOrder };
  }

  /**
   * @param {string} seg
   * @returns {string}
   */
  function cppParamNameSegment(seg) {
    let p = stripDefaultAtDepth0(seg).trim().replace(/\s+/g, " ");
    if (!p) return "";
    p = p.replace(/\s*&\s*$/u, "").replace(/\s*\[\s*\]\s*$/u, "").trim();
    const parts = p.split(/\s+/);
    const last = (parts[parts.length - 1] ?? "")
      .replace(/^[*&.]+/u, "")
      .replace(/[*&]+$/u, "");
    return /^[a-zA-Z_][\w]*$/u.test(last) ? last : "";
  }

  /**
   * @param {string} code
   * @returns {string[] | null}
   */
  function cppExtractParamNames(code) {
    const pub = code.search(/\bpublic\s*:/);
    if (pub < 0) return null;
    const tail = code.slice(pub);
    let searchFrom = 0;
    while (searchFrom < tail.length) {
      const sub = tail.slice(searchFrom);
      const m = sub.match(/\b([A-Za-z_][\w]*)\s*\(/u);
      if (!m) return null;
      const name = m[1];
      const open = searchFrom + m.index + m[0].length - 1;
      if (name === "Solution") {
        const close = indexOfMatchingCloseParen(tail, open);
        if (close < 0) return null;
        searchFrom = close + 1;
        continue;
      }
      const close = indexOfMatchingCloseParen(tail, open);
      if (close < 0) return null;
      const inner = tail.slice(open + 1, close);
      return splitTopLevelCommas(inner).map(cppParamNameSegment).filter(Boolean);
    }
    return null;
  }

  /**
   * Parameter order from C++ LeetCode starter only (OJ Sync / CP Helper target C++).
   * @param {string} code
   * @returns {string[] | null}
   */
  function extractLeetcodeParamOrderFromCode(code) {
    if (!code || !code.trim()) return null;
    const names = cppExtractParamNames(code);
    return names && names.length > 0 ? names : null;
  }

  /**
   * @param {string} inputLine
   * @param {string} editorCode
   * @returns {string}
   */
  function leetcodeInputLinesOrdered(inputLine, editorCode) {
    const normalized = (inputLine ?? "")
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const { map, keyOrder } = leetcodeAssignmentLineToMap(normalized);
    if (keyOrder.length === 0) {
      if (!normalized) return "";
      /** Design / interactive problems: two JSON lines inside one block, no `name = value`. */
      return normalized
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n");
    }
    const sig = extractLeetcodeParamOrderFromCode(editorCode);
    if (!sig || sig.length === 0) {
      return keyOrder.map((k) => map[k]).join("\n");
    }
    const used = new Set();
    /** @type {string[]} */
    const lines = [];
    for (const name of sig) {
      if (Object.prototype.hasOwnProperty.call(map, name)) {
        lines.push(map[name]);
        used.add(name);
      }
    }
    for (const k of keyOrder) {
      if (!used.has(k)) {
        lines.push(map[k]);
        used.add(k);
      }
    }
    return lines.join("\n");
  }

  /**
   * @param {string} text
   */
  function copyTextToClipboardBestEffort(text) {
    if (!text) return;
    try {
      void navigator.clipboard.writeText(text);
      return;
    } catch {
      /* continue */
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    try {
      document.execCommand("copy");
    } catch {
      /* ignore */
    } finally {
      document.body.removeChild(ta);
    }
  }

  /**
   * Visible starter code: **Monaco** (practice) or **CodeMirror 6** (many contest layouts).
   * @returns {string}
   */
  function extractLeetcodeStarterCode() {
    const normalizeLine = (el) =>
      (el.textContent ?? "").replace(/\u00a0/g, " ");

    /** Practice / classic: Monaco `view-line` under `data-track-load="code_editor"`. */
    const monacoSelectors = [
      "[data-track-load='code_editor'] .monaco-editor .view-lines",
      "[data-track-load=\"code_editor\"] .monaco-editor .view-lines",
      "[data-track-load='code_editor'] .view-lines",
      "div[data-cypress=\"CodeEditor\"] .monaco-editor .view-lines",
      "#editor .monaco-editor .view-lines",
      ".editor-area .monaco-editor .view-lines",
      ".monaco-editor .view-lines",
    ];
    for (const sel of monacoSelectors) {
      const root = document.querySelector(sel);
      if (!root) continue;
      const lines = root.querySelectorAll(".view-line");
      if (lines.length === 0) continue;
      const text = Array.from(lines).map(normalizeLine).join("\n");
      if (text.trim().length > 0) return text;
    }

    /** Contest (and some UIs): CodeMirror 6 `.cm-line` under `#editor` / code panel. */
    const cmContentSelectors = [
      '[data-track-load="code_editor"] .cm-content',
      "#editor .cm-content",
      '[data-track-load="code_editor"] .cm-editor .cm-content',
      "#editor .cm-editor .cm-content",
      ".cm-scroller .cm-content",
    ];
    for (const sel of cmContentSelectors) {
      const root = document.querySelector(sel);
      if (!root) continue;
      let lines = root.querySelectorAll(":scope > .cm-line");
      if (lines.length === 0) {
        lines = root.querySelectorAll(".cm-line");
      }
      if (lines.length === 0) continue;
      const text = Array.from(lines).map(normalizeLine).join("\n");
      if (text.trim().length > 0) return text;
    }

    return "";
  }

  /**
   * @param {string} editorCode
   * @returns {{ id: string; text: string }[]}
   */
  function extractLeetcodeDescriptionExamples(editorCode) {
    const desc =
      document.querySelector('[data-track-load="description_content"]') ??
      document.body;
    /** @type {{ id: string; text: string }[]} */
    const items = [];
    let exNum = 0;
    let pendingInput = "";

    /**
     * LeetCode often puts only **Example 1** inside `div.example-block`; further
     * examples are siblings below with the same `span.example-io` rows but no
     * wrapper. Pair every Input → Output by walking **all** `span.example-io`
     * in the description in document order (not scoped to `.example-block`).
     * @param {Element} ioSpan
     * @returns {string}
     */
    function labelForExampleIoRow(ioSpan) {
      const row =
        ioSpan.closest("p") ??
        ioSpan.closest("li") ??
        ioSpan.closest("[class*='example']") ??
        ioSpan.parentElement;
      if (!row) return "";
      const strong = row.querySelector("strong");
      let label = (strong?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (label) return label;
      const head = (row.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);
      if (/^Input/i.test(head)) return "Input";
      if (/^Output/i.test(head)) return "Output";
      return "";
    }

    for (const ioSpan of desc.querySelectorAll("span.example-io")) {
      const label = labelForExampleIoRow(ioSpan);
      const t = (ioSpan.textContent ?? "").trim();
      if (/^Input/i.test(label)) {
        pendingInput = t;
      } else if (/^Output/i.test(label)) {
        if (pendingInput === "") continue;
        exNum++;
        const stdin = leetcodeInputLinesOrdered(pendingInput, editorCode);
        items.push(
          { id: `lc-ex${exNum}-in`, text: stdin },
          { id: `lc-ex${exNum}-out`, text: t },
        );
        pendingInput = "";
      }
    }
    return items;
  }

  /**
   * @param {Element} el
   * @returns {string}
   */
  function extractLeetcodeConsoleLabelForInput(el) {
    const col =
      el.closest("div.flex-col.space-y-2") ||
      el.closest("div[class*='flex-col']");
    if (col) {
      const labelEl = col.querySelector(":scope > div.text-xs");
      const raw = (labelEl?.textContent ?? "").trim();
      const m = raw.match(/^([a-zA-Z_][\w]*)\s*=/u);
      if (m) return m[1];
    }
    return "";
  }

  /**
   * @param {string} editorCode
   * @returns {{ id: string; text: string }[]}
   */
  function extractLeetcodeConsoleCase(editorCode) {
    const inputs = document.querySelectorAll(
      '[data-e2e-locator="console-testcase-input"]',
    );
    if (inputs.length === 0) return [];
    /** @type {Record<string, string>} */
    const map = Object.create(null);
    /** @type {string[]} */
    const domOrder = [];
    let anon = 0;
    for (const el of inputs) {
      const label = extractLeetcodeConsoleLabelForInput(el);
      const val = (el.textContent ?? "").trim();
      const key = label || `__anon${anon++}`;
      map[key] = val;
      domOrder.push(key);
    }
    const sig = extractLeetcodeParamOrderFromCode(editorCode);
    const used = new Set();
    /** @type {string[]} */
    const lines = [];
    if (sig && sig.length > 0) {
      for (const name of sig) {
        if (Object.prototype.hasOwnProperty.call(map, name)) {
          lines.push(map[name]);
          used.add(name);
        }
      }
    }
    for (const k of domOrder) {
      if (!used.has(k)) {
        lines.push(map[k]);
        used.add(k);
      }
    }
    const text = lines.join("\n");
    if (!text.trim()) return [];
    return [
      { id: "lc-console-in", text },
      { id: "lc-console-out", text: "" },
    ];
  }

  /**
   * LeetCode “frontend” problem number for labels like `leetcode/3901` (not the URL slug).
   * @returns {string | null}
   */
  function extractLeetcodeFrontendId() {
    const tryTitleStrict = (s) => {
      const t = (s ?? "").trim();
      const m = t.match(/^(\d+)\s*[.\u30fb\u3002\uFF0E-]/u);
      return m ? m[1] : null;
    };
    /** `3901 Two Sum` (number then space; no punctuation). */
    const tryTitleDigitsSpace = (s) => {
      const t = (s ?? "").trim();
      const m = t.match(/^(\d{1,5})\s{1,4}[A-Za-z\u4e00\u3040-\u30ff]/u);
      return m ? m[1] : null;
    };
    /** First `1234. Title` / `1234 · Title` inside a short banner string. */
    const tryTitleFindNumberDot = (s) => {
      const t = (s ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 500) return null;
      const m = t.match(
        /(\d{1,5})\s*[.\u30fb\u3002\uFF0E-]\s*[A-Za-z\u4e00\u3040-\u30ff"'`「]/u,
      );
      return m ? m[1] : null;
    };
    const tryAllTitleHeuristics = (s) =>
      tryTitleStrict(s) ??
      tryTitleDigitsSpace(s) ??
      tryTitleFindNumberDot(s);
    /** Problem statement header: `3901. Title` inside `.text-title-large` (current LeetCode UI). */
    const titleLink = document.querySelector(
      'div.text-title-large a[href*="/problems/"]',
    );
    let n = tryAllTitleHeuristics(titleLink?.textContent ?? "");
    if (n) return n;
    const titleBlock = document.querySelector("div.text-title-large");
    n = tryAllTitleHeuristics(titleBlock?.textContent ?? "");
    if (n) return n;
    n = tryAllTitleHeuristics(document.title);
    if (n) return n;
    const og = document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content");
    n = tryAllTitleHeuristics(og);
    if (n) return n;
    const tw = document
      .querySelector('meta[name="twitter:title"]')
      ?.getAttribute("content");
    n = tryAllTitleHeuristics(tw);
    if (n) return n;
    /** Embedded JSON (incl. `__NEXT_DATA__`) often has `frontendQuestionId`. */
    const idPatterns = [
      /"frontendQuestionId"\s*:\s*(\d+)/u,
      /"questionFrontendId"\s*:\s*(\d+)/u,
      /"frontendQuestionId"\s*:\s*"(\d+)"/u,
      /"questionFrontendId"\s*:\s*"(\d+)"/u,
      /'frontendQuestionId'\s*:\s*(\d+)/u,
      /'questionFrontendId'\s*:\s*(\d+)/u,
    ];
    for (const sc of document.querySelectorAll("script")) {
      const txt = sc.textContent ?? "";
      const maxLen = sc.id === "__NEXT_DATA__" ? 6_000_000 : 800_000;
      if (txt.length < 40 || txt.length > maxLen) continue;
      for (const re of idPatterns) {
        const fm = txt.match(re);
        if (fm) return fm[1];
      }
    }
    return null;
  }

  /**
   * @returns {{ kind: "leetcode"; frontendId: string | null; starterCode: string; items: { id: string; text: string }[] }}
   */
  ns.extractLeetcode = function extractLeetcode() {
    const rawStarter = extractLeetcodeStarterCode();
    copyTextToClipboardBestEffort(rawStarter);
    let items = extractLeetcodeDescriptionExamples(rawStarter);
    if (items.length === 0) {
      items = extractLeetcodeConsoleCase(rawStarter);
    }
    return {
      kind: "leetcode",
      frontendId: extractLeetcodeFrontendId(),
      starterCode: rawStarter,
      items,
    };
  };
})(globalThis);

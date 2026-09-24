/**
 * AtCoder: sample `<pre>` nodes under `span.lang-en`; task labels on a contest list page.
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
   * Second half of the same header line: "Memory Limit: 1024 MB".
   * @returns {number | null}
   */
  function atcoderMemoryLimitMb() {
    for (const p of document.querySelectorAll("#main-container p, #main-div p")) {
      const t = (p.textContent ?? "").trim();
      for (const part of t.split("/")) {
        if (!/memory limit|\u30E1\u30E2\u30EA\u5236\u9650/iu.test(part)) continue;
        const mb = ns.parseMemoryLimitMb(part);
        if (mb !== null) return mb;
      }
    }
    return null;
  }

  /**
   * @param {string} urlStr
   * @returns {string}
   */
  function atcoderContestIdFromUrl(urlStr) {
    try {
      const u = new URL(urlStr, "https://atcoder.jp");
      const m = u.pathname.match(/^\/contests\/([^/]+)/u);
      return m ? m[1] : "";
    } catch {
      return "";
    }
  }

  /**
   * Contest top page and its task list; neither carries a statement.
   * @param {string} urlStr
   * @returns {boolean}
   */
  function atcoderIsContestListUrl(urlStr) {
    try {
      const u = new URL(urlStr, "https://atcoder.jp");
      return /^\/contests\/[^/]+(?:\/tasks)?\/?$/u.test(u.pathname);
    } catch {
      return false;
    }
  }

  /**
   * @param {string} text anchor text from the task table ("A", "Ex")
   * @param {string} slug task slug ("abc475_a")
   * @returns {string}
   */
  function atcoderLabel(text, slug) {
    if (/^[A-Za-z]{1,2}\d*$/u.test(text)) {
      return text.length === 1 ? text.toUpperCase() : text;
    }
    const m = slug.match(/_([a-z0-9]+)$/u);
    return m ? m[1].toUpperCase() : "";
  }

  /**
   * First anchor per task wins, which is the label column of the task table.
   * @param {Document} doc
   * @param {string} contestId
   * @returns {string[]}
   */
  function atcoderLabelsFromDoc(doc, contestId) {
    if (!contestId) return [];
    const re = new RegExp(`/contests/${contestId}/tasks/([^/?#]+)$`, "u");
    const seen = new Set();
    /** @type {string[]} */
    const labels = [];
    for (const a of doc.querySelectorAll('a[href*="/tasks/"]')) {
      const m = (a.getAttribute("href") ?? "").match(re);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      const label = atcoderLabel((a.textContent ?? "").trim(), m[1]);
      if (label.length > 0 && !labels.includes(label)) labels.push(label);
    }
    return labels;
  }

  /**
   * @param {string} url
   * @returns {Promise<{ kind: string; contestId: string; labels: string[] }>}
   */
  async function atcoderContestLabels(url) {
    const contestId = atcoderContestIdFromUrl(url);
    let labels = atcoderLabelsFromDoc(document, contestId);
    if (labels.length === 0 && contestId.length > 0) {
      try {
        const res = await fetch(`/contests/${contestId}/tasks`, {
          credentials: "same-origin",
        });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(
            await res.text(),
            "text/html",
          );
          labels = atcoderLabelsFromDoc(doc, contestId);
        }
      } catch {
        /* leave labels empty; the caller reports the failure */
      }
    }
    return { kind: "contest-labels", contestId, labels };
  }

  /**
   * @param {string} pageUrl
   * @returns {{ kind: string; timeLimitMs: number | null; memoryLimitMb: number | null; items: { id: string; text: string }[] } | Promise<{ kind: string; contestId: string; labels: string[] }>}
   */
  ns.extractAtcoder = function extractAtcoder(pageUrl) {
    const url = pageUrl && pageUrl.length > 0 ? pageUrl : window.location.href;
    if (atcoderIsContestListUrl(url)) {
      return atcoderContestLabels(url);
    }
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
      memoryLimitMb: atcoderMemoryLimitMb(),
      items: results,
    };
  };
})(globalThis);

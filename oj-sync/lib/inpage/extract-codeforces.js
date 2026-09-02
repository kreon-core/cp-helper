/**
 * Codeforces: `div.sample-test` input/output `<pre>`; multi-problem gym layout.
 * Delete this file and remove the cf branch in `dispatch.js` to drop support.
 */
(function registerCodeforcesExtractor(g) {
  const ns = g.__ojSyncInpage;
  if (!ns) return;

  const prePlainText = ns.prePlainText;

  /**
   * @param {ParentNode} root problem holder, or the document for a single-problem page
   * @returns {number | null}
   */
  function cfTimeLimitFromRoot(root) {
    const el = root.querySelector("div.time-limit");
    return el ? ns.parseTimeLimitMs(el.textContent ?? "") : null;
  }

  /**
   * @param {Element} root
   * @returns {{ id: string; text: string }[]}
   */
  function cfCollectSamplePresFromRoot(root) {
    /** @type {{ id: string; text: string }[]} */
    const results = [];
    let n = 0;
    for (const block of root.querySelectorAll(":scope div.sample-test")) {
      const pres = block.querySelectorAll(
        ":scope > div.input pre, :scope > div.output pre",
      );
      for (const pre of pres) {
        const id = pre.getAttribute("id") ?? `cf-${n}`;
        results.push({ id, text: prePlainText(pre) });
        n += 1;
      }
    }
    return results;
  }

  /**
   * @param {Element} holder
   * @returns {string}
   */
  function cfProblemLetterFromHolder(holder) {
    for (const a of holder.querySelectorAll('a[href*="/problem/"]')) {
      const href = a.getAttribute("href") ?? "";
      const m =
        href.match(/\/(?:contest|gym)\/\d+\/problem\/([^/?#]+)/u) ??
        href.match(/\/problemset\/problem\/\d+\/([^/?#]+)/u) ??
        href.match(/\/problem\/([^/?#]+)/u);
      if (m) {
        const x = decodeURIComponent(m[1]);
        return /^[a-z]$/iu.test(x) ? x.toUpperCase() : x;
      }
    }
    const header = holder.querySelector(".header");
    if (header) {
      const t = (header.textContent ?? "").trim();
      const m = t.match(/^([A-Za-z0-9]+)\s*[.\uFF0E]/u);
      if (m) return m[1].toUpperCase();
    }
    return "?";
  }

  /**
   * @param {string} urlStr
   * @returns {string}
   */
  function cfContestIdFromUrl(urlStr) {
    try {
      const u = new URL(urlStr, "https://codeforces.com");
      const m = u.pathname.match(/\/(?:contest|gym)\/(\d+)\//u);
      return m ? m[1] : "";
    } catch {
      return "";
    }
  }

  /**
   * @param {string} pageUrl
   * @returns {{ kind: string; items?: unknown[]; timeLimitMs?: number | null; contestId?: string; problems?: unknown[] }}
   */
  ns.extractCodeforces = function extractCodeforces(pageUrl) {
    const contestId = cfContestIdFromUrl(
      pageUrl && pageUrl.length > 0 ? pageUrl : window.location.href,
    );
    const holders = Array.from(
      document.querySelectorAll("div.problemindexholder"),
    ).filter((h) => h.querySelector("div.sample-test"));

    if (holders.length >= 2) {
      /** @type { { letter: string; timeLimitMs: number | null; items: { id: string; text: string }[] }[] } */
      const problems = [];
      for (const holder of holders) {
        const items = cfCollectSamplePresFromRoot(holder);
        if (items.length === 0) continue;
        problems.push({
          letter: cfProblemLetterFromHolder(holder),
          timeLimitMs: cfTimeLimitFromRoot(holder),
          items,
        });
      }
      if (problems.length >= 2) {
        return { kind: "cf-multi", contestId, problems };
      }
      if (problems.length === 1) {
        return {
          kind: "single",
          timeLimitMs: problems[0].timeLimitMs,
          items: problems[0].items,
        };
      }
    }

    if (holders.length === 1) {
      const one = cfCollectSamplePresFromRoot(holders[0]);
      if (one.length > 0) {
        return {
          kind: "single",
          timeLimitMs: cfTimeLimitFromRoot(holders[0]),
          items: one,
        };
      }
    }

    /** @type {{ id: string; text: string }[]} */
    const results = [];
    let n = 0;
    for (const block of document.querySelectorAll("div.sample-test")) {
      const pres = block.querySelectorAll(
        ":scope > div.input pre, :scope > div.output pre",
      );
      for (const pre of pres) {
        const id = pre.getAttribute("id") ?? `cf-${n}`;
        results.push({ id, text: prePlainText(pre) });
        n += 1;
      }
    }
    return {
      kind: "single",
      timeLimitMs: cfTimeLimitFromRoot(document),
      items: results,
    };
  };
})(globalThis);

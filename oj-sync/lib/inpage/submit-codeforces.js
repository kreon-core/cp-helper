/**
 * Codeforces submit + verdict, driven from the contest's own submit page.
 * Delete this file and remove the cf branch in `submit-dispatch.js` to drop support.
 */
(function registerCodeforcesSubmit(g) {
  const ns = g.__ojSyncSubmit;
  if (!ns) return;

  /** How long the anti-bot widget gets to clear the visitor by itself before we ask the user. */
  const ANTI_BOT_WAIT_MS = 10000;

  /** Verdict cells stay in these states while the judge is still running the submission. */
  const PENDING = /in queue|running|judging|pending|waiting/iu;

  /**
   * @returns {HTMLFormElement | null}
   */
  function submitForm() {
    const forms = Array.from(document.querySelectorAll("form"));
    return (
      forms.find((f) => f.querySelector('select[name="programTypeId"]')) ?? null
    );
  }

  /**
   * @param {Element} row
   * @returns {{ id: string; url: string; verdict: string; pending: boolean }}
   */
  function readRow(row) {
    const id = row.getAttribute("data-submission-id") ?? "";
    const cell = row.querySelector(".status-cell");
    const verdict = (cell ? cell.textContent ?? "" : "").trim();
    const waiting =
      (cell && cell.getAttribute("waiting") === "true") ||
      verdict === "" ||
      PENDING.test(verdict);
    const base = location.pathname.split("/").slice(0, 3).join("/");
    return {
      id,
      url: `${location.origin}${base}/submission/${id}`,
      verdict,
      pending: waiting,
    };
  }

  /**
   * Newest row per problem, from one read of the status page.
   * @param {Document} doc
   * @param {string[]} indexes problem letters
   * @returns {Record<string, { id: string; url: string; verdict: string; pending: boolean }>}
   */
  function newestRows(doc, indexes) {
    /** @type {Record<string, { id: string; url: string; verdict: string; pending: boolean }>} */
    const out = {};
    for (const row of doc.querySelectorAll("tr[data-submission-id]")) {
      const link = row.querySelector('a[href*="/problem/"]');
      const href = link ? link.getAttribute("href") ?? "" : "";
      const m = href.match(/\/problem\/([^/?#]+)/u);
      const at = m ? decodeURIComponent(m[1]).toUpperCase() : "";
      for (const index of indexes) {
        // A row with no problem link stands for whichever problem is still unanswered: the
        // single-problem read accepted it the same way.
        if (!out[index] && (at === "" || at === index.toUpperCase())) {
          out[index] = readRow(row);
        }
      }
    }
    return out;
  }

  /**
   * Replays the page's own submit form. Building the body from the live form keeps `csrf_token`,
   * `ftaa` and `bfaa` exactly as Codeforces issued them for this session.
   * @param {{ problemId: string; language: string; source: string }} job
   * @returns {Promise<{ submitted: boolean; error?: string; language?: string }>}
   */
  ns.submitCodeforces = async function submitCodeforces(job) {
    const form = submitForm();
    if (!form) {
      return {
        submitted: false,
        error: "Codeforces submit form not found - log in to Codeforces in this browser first.",
      };
    }
    const lang = ns.pickLanguage(
      form.querySelector('select[name="programTypeId"]'),
      job.language,
    );
    if ("error" in lang) {
      return { submitted: false, error: lang.error };
    }
    const indexSelect = form.querySelector(
      'select[name="submittedProblemIndex"]',
    );
    if (
      indexSelect &&
      !Array.from(indexSelect.options).some(
        (o) => o.value.toUpperCase() === job.problemId.toUpperCase(),
      )
    ) {
      return {
        submitted: false,
        error: `Problem ${job.problemId} is not on this contest's submit page.`,
      };
    }

    const antiBot = await ns.waitForAntiBotToken(ANTI_BOT_WAIT_MS);
    if (antiBot.present && antiBot.value === "") {
      return {
        submitted: false,
        explicit: true,
        needsInteraction: true,
        error:
          "Codeforces wants its anti-bot verification completed. It has been opened in a tab - clear it there, then submit again.",
      };
    }

    /** @type {Record<string, string>} */
    const overrides = {
      submittedProblemIndex: job.problemId.toUpperCase(),
      programTypeId: lang.value,
      source: job.source,
    };
    if (antiBot.present && antiBot.name !== "") {
      // The widget may render outside the <form>, in which case FormData missed its token.
      overrides[antiBot.name] = antiBot.value;
    }
    // An empty file input would otherwise win over the pasted source.
    const { body, headers } = ns.buildFormBody(form, overrides, ["sourceFile"]);

    const res = await fetch(ns.formAction(form), {
      method: "POST",
      body,
      credentials: "include",
      headers,
    });
    const html = await res.text();
    if (/\/(?:my|status)\b/u.test(new URL(res.url).pathname)) {
      return { submitted: true, language: lang.text };
    }
    const doc = ns.parseHtml(html);
    const errors = ns.collectErrors(doc);
    const detail = ns.describeResponse(res, doc);
    if (ns.isGenericError(errors)) {
      const banner = errors.length > 0 ? `"${errors[0]}" ` : "";
      return {
        submitted: false,
        error: `Codeforces did not redirect to the submissions list ${banner}(${detail}).`,
      };
    }
    return {
      submitted: false,
      explicit: true,
      error: `Codeforces rejected the submission: ${errors.join(" | ")}`,
    };
  };

  /**
   * @param {{ problemId: string; statusUrl: string }} job
   * @returns {Promise<{ verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>}
   */
  ns.verdictCodeforces = async function verdictCodeforces(job) {
    const rows = await ns.verdictsCodeforces({
      statusUrl: job.statusUrl,
      problemIds: [job.problemId],
    });
    return rows[job.problemId] ?? { verdict: "", pending: true };
  };

  /**
   * One read of the contest's `/my` page answers every problem on it, so problems submitted
   * together are followed with a single fetch per poll rather than one each.
   * @param {{ statusUrl: string; problemIds: string[] }} opts
   * @returns {Promise<Record<string, { verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>>}
   */
  ns.verdictsCodeforces = async function verdictsCodeforces(opts) {
    const doc = await ns.fetchDocument(opts.statusUrl);
    const rows = newestRows(
      doc,
      Array.isArray(opts.problemIds) ? opts.problemIds : [],
    );
    /** @type {Record<string, { verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>} */
    const out = {};
    for (const index of Object.keys(rows)) {
      out[index] = {
        verdict: rows[index].verdict,
        pending: rows[index].pending,
        submissionId: rows[index].id,
        submissionUrl: rows[index].url,
      };
    }
    return out;
  };
})(globalThis);

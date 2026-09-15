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
   * @param {Document} doc
   * @param {string} index problem letter
   * @returns {{ id: string; url: string; verdict: string; pending: boolean } | null}
   */
  function newestRow(doc, index) {
    const rows = doc.querySelectorAll("tr[data-submission-id]");
    for (const row of rows) {
      const link = row.querySelector('a[href*="/problem/"]');
      const href = link ? link.getAttribute("href") ?? "" : "";
      const m = href.match(/\/problem\/([^/?#]+)/u);
      if (m && decodeURIComponent(m[1]).toUpperCase() !== index.toUpperCase()) {
        continue;
      }
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
    return null;
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
    const doc = await ns.fetchDocument(job.statusUrl);
    const row = newestRow(doc, job.problemId);
    if (!row) {
      return { verdict: "", pending: true };
    }
    return {
      verdict: row.verdict,
      pending: row.pending,
      submissionId: row.id,
      submissionUrl: row.url,
    };
  };
})(globalThis);

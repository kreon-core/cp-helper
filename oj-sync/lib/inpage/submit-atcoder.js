/**
 * AtCoder submit + verdict, driven from the contest's own submit page.
 * Delete this file and remove the atcoder branch in `submit-dispatch.js` to drop support.
 */
(function registerAtcoderSubmit(g) {
  const ns = g.__ojSyncSubmit;
  if (!ns) return;

  /** How long the anti-bot widget gets to clear the visitor by itself before we ask the user. */
  const ANTI_BOT_WAIT_MS = 10000;

  /** Status labels AtCoder shows while a submission is still being judged (incl. "3/10"). */
  const PENDING = /^(?:wj|wr|waiting|judging|\d+\s*\/\s*\d+)$/iu;

  /**
   * AtCoder renders one language `<select>` per task, all named `data.LanguageId`, and hides the
   * ones that do not belong to the selected task - so the form as a whole cannot be replayed.
   * @param {string} task task screen name
   * @returns {HTMLSelectElement | null}
   */
  function languageSelect(task) {
    const scoped = document.querySelector(
      `#select-lang-${CSS.escape(task)} select[name="data.LanguageId"]`,
    );
    return scoped ?? document.querySelector('select[name="data.LanguageId"]');
  }

  /**
   * @returns {HTMLFormElement | null}
   */
  function submitForm() {
    const forms = Array.from(document.querySelectorAll("form"));
    return (
      forms.find((f) => /\/submit$/u.test(new URL(ns.formAction(f)).pathname)) ??
      null
    );
  }

  /**
   * @param {{ problemId: string; language: string; source: string }} job
   * @returns {Promise<{ submitted: boolean; error?: string; language?: string }>}
   */
  ns.submitAtcoder = async function submitAtcoder(job) {
    const form = submitForm();
    if (!form) {
      return {
        submitted: false,
        error: "AtCoder submit form not found - log in to AtCoder in this browser first.",
      };
    }
    const lang = ns.pickLanguage(languageSelect(job.problemId), job.language);
    if ("error" in lang) {
      return { submitted: false, error: lang.error };
    }
    const antiBot = await ns.waitForAntiBotToken(ANTI_BOT_WAIT_MS);
    if (antiBot.present && antiBot.value === "") {
      return {
        submitted: false,
        explicit: true,
        needsInteraction: true,
        error:
          "AtCoder wants its anti-bot verification completed. It has been opened in a tab - clear it there, then submit again.",
      };
    }

    /** @type {Record<string, string>} */
    const overrides = {
      "data.TaskScreenName": job.problemId,
      "data.LanguageId": lang.value,
      sourceCode: job.source,
    };
    if (antiBot.present && antiBot.name !== "") {
      overrides[antiBot.name] = antiBot.value;
    }
    const { body, headers } = ns.buildFormBody(form, overrides);

    const res = await fetch(ns.formAction(form), {
      method: "POST",
      body,
      credentials: "include",
      headers,
    });
    if (/\/submissions\/me/u.test(new URL(res.url).pathname)) {
      return { submitted: true, language: lang.text };
    }
    const doc = ns.parseHtml(await res.text());
    const errors = ns.collectErrors(doc);
    const detail = ns.describeResponse(res, doc);
    if (ns.isGenericError(errors)) {
      const banner = errors.length > 0 ? `"${errors[0]}" ` : "";
      return {
        submitted: false,
        error: `AtCoder refused the submission without saying why ${banner}(${detail}, language "${lang.text}", task ${job.problemId}).`,
      };
    }
    return {
      submitted: false,
      explicit: true,
      error: `AtCoder rejected the submission: ${errors.join(" | ")}`,
    };
  };

  /**
   * One read of `/submissions/me` answers every task on it, so problems submitted together are
   * followed with a single fetch per poll rather than one each.
   * @param {{ statusUrl: string; problemIds: string[] }} opts
   * @returns {Promise<Record<string, { verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>>}
   */
  ns.verdictsAtcoder = async function verdictsAtcoder(opts) {
    const doc = await ns.fetchDocument(opts.statusUrl);
    const want = new Set(Array.isArray(opts.problemIds) ? opts.problemIds : []);
    /** @type {Record<string, { verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>} */
    const out = {};
    for (const row of doc.querySelectorAll("tbody tr")) {
      const taskLink = row.querySelector('a[href*="/tasks/"]');
      const href = taskLink ? taskLink.getAttribute("href") ?? "" : "";
      const m = href.match(/\/tasks\/([^/?#]+)/u);
      // The page lists newest first, so the first row for a task is the one to report.
      if (!m || !want.has(m[1]) || out[m[1]]) {
        continue;
      }
      const label = row.querySelector("td span.label, td.text-center span");
      const verdict = (label ? label.textContent ?? "" : "").trim();
      const subLink = row.querySelector('a[href*="/submissions/"]');
      const subHref = subLink ? subLink.getAttribute("href") ?? "" : "";
      const sid = subHref.match(/\/submissions\/(\d+)/u);
      out[m[1]] = {
        verdict,
        pending: verdict === "" || PENDING.test(verdict),
        submissionId: sid ? sid[1] : undefined,
        submissionUrl: subHref ? new URL(subHref, location.origin).toString() : undefined,
      };
    }
    return out;
  };

  /**
   * @param {{ problemId: string; statusUrl: string }} job
   * @returns {Promise<{ verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>}
   */
  ns.verdictAtcoder = async function verdictAtcoder(job) {
    const rows = await ns.verdictsAtcoder({
      statusUrl: job.statusUrl,
      problemIds: [job.problemId],
    });
    return rows[job.problemId] ?? { verdict: "", pending: true };
  };
})(globalThis);

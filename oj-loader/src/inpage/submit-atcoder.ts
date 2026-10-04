/**
 * AtCoder submit + verdict, driven from the contest's own submit page.
 * Delete this file and remove the atcoder branch in `submit-dispatch.ts` to drop support.
 */
import type { SubmitJob, SubmitResult, VerdictRow, VerdictsQuery } from "../types";
import {
  buildFormBody,
  collectErrors,
  describeResponse,
  fetchDocument,
  formAction,
  isGenericError,
  parseHtml,
  pickLanguage,
  waitForAntiBotToken,
} from "./submit-shared";

/** How long the anti-bot widget gets to clear the visitor by itself before we ask the user. */
const ANTI_BOT_WAIT_MS = 10000;

/** Status labels AtCoder shows while a submission is still being judged (incl. "3/10 WA"). */
const PENDING = /^(?:wj|wr|waiting|judging|\d+\s*\/\s*\d+(?:\s+\S+)?)$/iu;

/**
 * AtCoder renders one language `<select>` per task, all named `data.LanguageId`, and hides the
 * ones that do not belong to the selected task - so the form as a whole cannot be replayed.
 * @param task task screen name
 */
function languageSelect(task: string): HTMLSelectElement | null {
  const scoped = document.querySelector<HTMLSelectElement>(
    `#select-lang-${CSS.escape(task)} select[name="data.LanguageId"]`,
  );
  return (
    scoped ??
    document.querySelector<HTMLSelectElement>('select[name="data.LanguageId"]')
  );
}

function submitForm(): HTMLFormElement | null {
  const forms = Array.from(document.querySelectorAll("form"));
  return (
    forms.find((f) => /\/submit$/u.test(new URL(formAction(f)).pathname)) ??
    null
  );
}

/**
 * `posted` in the result means the POST went out, which spends the page's anti-bot token.
 */
export async function submitAtcoder(job: SubmitJob): Promise<SubmitResult> {
  const form = submitForm();
  if (!form) {
    return {
      submitted: false,
      error: "AtCoder submit form not found - log in to AtCoder first.",
    };
  }
  const lang = pickLanguage(languageSelect(job.problemId), job.language);
  if ("error" in lang) {
    return { submitted: false, error: lang.error };
  }
  const antiBot = await waitForAntiBotToken(ANTI_BOT_WAIT_MS);
  if (antiBot.present && antiBot.value === "") {
    return {
      submitted: false,
      explicit: true,
      needsInteraction: true,
      error:
        "AtCoder needs its anti-bot check - clear it in the open tab, then submit again.",
    };
  }

  const overrides: Record<string, string> = {
    "data.TaskScreenName": job.problemId,
    "data.LanguageId": lang.value,
    sourceCode: job.source,
  };
  if (antiBot.present && antiBot.name !== "") {
    overrides[antiBot.name] = antiBot.value;
  }
  const { body, headers } = buildFormBody(form, overrides);

  const res = await fetch(formAction(form), {
    method: "POST",
    body,
    credentials: "include",
    headers,
  });
  if (/\/submissions\/me/u.test(new URL(res.url).pathname)) {
    return { submitted: true, posted: true, language: lang.text };
  }
  const doc = parseHtml(await res.text());
  const errors = collectErrors(doc);
  const detail = describeResponse(res, doc);
  if (isGenericError(errors)) {
    const banner = errors.length > 0 ? `"${errors[0]}" ` : "";
    return {
      submitted: false,
      posted: true,
      error: `AtCoder did not reach its submissions list ${banner}(${detail}, ${lang.text}).`,
    };
  }
  return {
    submitted: false,
    posted: true,
    explicit: true,
    error: `AtCoder rejected the submission: ${errors.join(" | ")}`,
  };
}

/**
 * One read of `/submissions/me` answers every task on it, so problems submitted together are
 * followed with a single fetch per poll rather than one each.
 */
export async function verdictsAtcoder(
  opts: VerdictsQuery,
): Promise<Record<string, VerdictRow>> {
  const doc = await fetchDocument(opts.statusUrl);
  const want = new Set(Array.isArray(opts.problemIds) ? opts.problemIds : []);
  const pinned = new Set(Array.isArray(opts.submissionIds) ? opts.submissionIds : []);
  const out: Record<string, VerdictRow> = {};
  for (const row of doc.querySelectorAll("tbody tr")) {
    const taskLink = row.querySelector('a[href*="/tasks/"]');
    const href = taskLink ? taskLink.getAttribute("href") ?? "" : "";
    const m = href.match(/\/tasks\/([^/?#]+)/u);
    const subLink = row.querySelector('a[href*="/submissions/"]');
    const subHref = subLink ? subLink.getAttribute("href") ?? "" : "";
    const sid = subHref.match(/\/submissions\/(\d+)/u);
    // The page lists newest first, so the first row for a task is the one to report.
    const newest = m !== null && want.has(m[1]) && !out[m[1]];
    const asPinned = sid !== null && pinned.has(sid[1]);
    if (!newest && !asPinned) {
      continue;
    }
    const label = row.querySelector("td span.label, td.text-center span");
    const verdict = (label ? label.textContent ?? "" : "").trim();
    const entry: VerdictRow = {
      verdict,
      pending: verdict === "" || PENDING.test(verdict),
      submissionId: sid ? sid[1] : undefined,
      submissionUrl: subHref ? new URL(subHref, location.origin).toString() : undefined,
    };
    if (newest && m) {
      out[m[1]] = entry;
    }
    if (asPinned && sid) {
      out[`#${sid[1]}`] = entry;
    }
  }
  return out;
}

export async function verdictAtcoder(
  job: Pick<SubmitJob, "problemId" | "statusUrl">,
): Promise<VerdictRow> {
  const rows = await verdictsAtcoder({
    statusUrl: job.statusUrl,
    problemIds: [job.problemId],
  });
  return rows[job.problemId] ?? { verdict: "", pending: true };
}

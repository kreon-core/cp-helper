/**
 * Codeforces submit + verdict, driven from the contest's own submit page.
 * Delete this file and remove the cf branch in `submit-dispatch.ts` to drop support.
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

/** Verdict cells stay in these states while the judge is still running the submission. */
const PENDING = /in queue|running|judging|pending|waiting/iu;

/** Codeforces takes a source once per problem, so a resubmit of an unchanged file is refused. */
const DUPLICATE = /submitted exactly the same code before/iu;

interface StatusRow {
  id: string;
  url: string;
  verdict: string;
  pending: boolean;
}

function submitForm(): HTMLFormElement | null {
  const forms = Array.from(document.querySelectorAll("form"));
  return (
    forms.find((f) => f.querySelector('select[name="programTypeId"]')) ?? null
  );
}

function readRow(row: Element): StatusRow {
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
 * @param indexes problem letters
 */
function newestRows(doc: Document, indexes: string[]): Record<string, StatusRow> {
  const out: Record<string, StatusRow> = {};
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
 * `posted` in the result means the POST went out, which spends the page's anti-bot token.
 */
export async function submitCodeforces(job: SubmitJob): Promise<SubmitResult> {
  const form = submitForm();
  if (!form) {
    return {
      submitted: false,
      error: "Codeforces submit form not found - log in to Codeforces first.",
    };
  }
  const lang = pickLanguage(
    form.querySelector<HTMLSelectElement>('select[name="programTypeId"]'),
    job.language,
  );
  if ("error" in lang) {
    return { submitted: false, error: lang.error };
  }
  const indexSelect = form.querySelector<HTMLSelectElement>(
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

  const antiBot = await waitForAntiBotToken(ANTI_BOT_WAIT_MS);
  if (antiBot.present && antiBot.value === "") {
    return {
      submitted: false,
      explicit: true,
      needsInteraction: true,
      error:
        "Codeforces needs its anti-bot check - clear it in the open tab, then submit again.",
    };
  }

  const overrides: Record<string, string> = {
    submittedProblemIndex: job.problemId.toUpperCase(),
    programTypeId: lang.value,
    source: job.source,
  };
  if (antiBot.present && antiBot.name !== "") {
    // The widget may render outside the <form>, in which case FormData missed its token.
    overrides[antiBot.name] = antiBot.value;
  }
  // An empty file input would otherwise win over the pasted source.
  const { body, headers } = buildFormBody(form, overrides, ["sourceFile"]);

  const res = await fetch(formAction(form), {
    method: "POST",
    body,
    credentials: "include",
    headers,
  });
  const html = await res.text();
  if (/\/(?:my|status)\b/u.test(new URL(res.url).pathname)) {
    return { submitted: true, posted: true, language: lang.text };
  }
  const doc = parseHtml(html);
  const errors = collectErrors(doc);
  const detail = describeResponse(res, doc);
  if (errors.some((e) => DUPLICATE.test(e))) {
    // The submission this is a duplicate of is already on the judge, and its verdict is what the
    // user is really after - a bare refusal sends them to the browser to look it up.
    const prior = await verdictCodeforces({
      problemId: job.problemId,
      statusUrl: String(job.statusUrl ?? ""),
    }).catch(() => ({ verdict: "" }));
    const verdict = (prior.verdict ?? "").trim();
    return {
      submitted: false,
      posted: true,
      explicit: true,
      error: `Codeforces already has this source for ${job.problemId}${
        verdict === "" ? "" : ` (${verdict})`
      }.`,
    };
  }
  if (isGenericError(errors)) {
    const banner = errors.length > 0 ? `"${errors[0]}" ` : "";
    return {
      submitted: false,
      posted: true,
      error: `Codeforces did not reach its submissions list ${banner}(${detail}, ${lang.text}).`,
    };
  }
  return {
    submitted: false,
    posted: true,
    explicit: true,
    error: `Codeforces rejected the submission: ${errors.join(" | ")}`,
  };
}

export async function verdictCodeforces(
  job: Pick<SubmitJob, "problemId" | "statusUrl">,
): Promise<VerdictRow> {
  const rows = await verdictsCodeforces({
    statusUrl: job.statusUrl,
    problemIds: [job.problemId],
  });
  return rows[job.problemId] ?? { verdict: "", pending: true };
}

/**
 * One read of the contest's `/my` page answers every problem on it, so problems submitted
 * together are followed with a single fetch per poll rather than one each.
 */
export async function verdictsCodeforces(
  opts: VerdictsQuery,
): Promise<Record<string, VerdictRow>> {
  const doc = await fetchDocument(opts.statusUrl);
  const rows = newestRows(
    doc,
    Array.isArray(opts.problemIds) ? opts.problemIds : [],
  );
  const pinned = new Set(Array.isArray(opts.submissionIds) ? opts.submissionIds : []);
  if (pinned.size > 0) {
    for (const row of doc.querySelectorAll("tr[data-submission-id]")) {
      const id = row.getAttribute("data-submission-id") ?? "";
      if (pinned.has(id)) {
        rows[`#${id}`] = readRow(row);
      }
    }
  }
  const out: Record<string, VerdictRow> = {};
  for (const key of Object.keys(rows)) {
    out[key] = {
      verdict: rows[key].verdict,
      pending: rows[key].pending,
      submissionId: rows[key].id,
      submissionUrl: rows[key].url,
    };
  }
  return out;
}

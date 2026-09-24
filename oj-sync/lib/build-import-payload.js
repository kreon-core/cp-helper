import { pairSamples } from "./pair-samples.js";
import { problemLabelFromContestUrl } from "./contest-url.js";

/**
 * Problem page URL per Codeforces problem in a contest-wide dump. CP Helper needs it to know
 * whether a submit goes through `/contest/` or `/gym/`; the contest id alone does not say.
 * @param {string | undefined} tabUrl the `/problems` page the dump came from
 * @param {string} contestId
 * @param {string} letter
 * @returns {string}
 */
function codeforcesProblemUrl(tabUrl, contestId, letter) {
  if (!contestId || letter === "?") return "";
  let kind = "contest";
  try {
    const u = new URL(tabUrl || "");
    kind = /\/gym\//u.test(u.pathname) ? "gym" : "contest";
  } catch {
    /* default to contest */
  }
  return `https://codeforces.com/${kind}/${contestId}/problem/${letter}`;
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function coerceTimeLimitMs(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 60000 ? Math.round(n) : null;
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function coerceMemoryLimitMb(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 65536 ? Math.round(n) : null;
}

/**
 * Turn `executeScript` result from `__ojSyncExtractSamplesInPage` (see `lib/inpage/`) into POST body JSON.
 * @param {string | undefined} tabUrl
 * @param {unknown} raw
 * @returns {{ ok: true; json: string } | { ok: false }}
 */
export function buildImportJsonFromExtractResult(tabUrl, raw) {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    /** @type {{ kind?: string }} */ (raw).kind === "contest-labels"
  ) {
    const list = /** @type {{ contestId?: string; labels?: unknown }} */ (raw);
    const contestId = (list.contestId ?? "").toString();
    const labels = Array.isArray(list.labels)
      ? list.labels.map((x) => String(x)).filter((x) => x.length > 0)
      : [];
    if (contestId.length === 0 || labels.length === 0) {
      return { ok: false };
    }
    const payload = {
      source: "oj-sync",
      clipboardText: `${contestId} ${labels.join(",")}`,
    };
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    /** @type {{ kind?: string; problems?: unknown }} */ (raw).kind === "cf-multi" &&
    Array.isArray(/** @type {{ problems: unknown }} */ (raw).problems)
  ) {
    const multi = /** @type {{ kind: string; contestId?: string; problems: { letter?: string; timeLimitMs?: unknown; memoryLimitMb?: unknown; items?: { id: string; text: string }[] }[] }} */ (
      raw
    );
    /** @type {{ problem: string; timeLimitMs?: number; memoryLimitMb?: number; samples: { sample: number; input: string; output: string }[] }[]} */
    const problemsOut = [];
    for (const pr of multi.problems) {
      const paired = pairSamples(pr.items ?? []);
      if (paired.length === 0) continue;
      const letter = pr.letter && pr.letter !== "?" ? pr.letter : "?";
      const pid =
        multi.contestId && letter !== "?"
          ? `codeforces/${multi.contestId}${letter}`
          : "";
      /** @type {{ problem: string; url?: string; timeLimitMs?: number; memoryLimitMb?: number; samples: { sample: number; input: string; output: string }[] }} */
      const out = {
        problem: pid || `codeforces/${letter}`,
        samples: paired,
      };
      const purl = codeforcesProblemUrl(tabUrl, multi.contestId ?? "", letter);
      if (purl !== "") out.url = purl;
      const tl = coerceTimeLimitMs(pr.timeLimitMs);
      if (tl !== null) out.timeLimitMs = tl;
      const ml = coerceMemoryLimitMb(pr.memoryLimitMb);
      if (ml !== null) out.memoryLimitMb = ml;
      problemsOut.push(out);
    }
    if (problemsOut.length === 0) {
      return { ok: false };
    }
    const letters = problemsOut
      .map((p) => p.problem.replace(/^codeforces\/\d+/u, ""))
      .join("");
    const importProblem =
      multi.contestId && letters.length > 0
        ? `codeforces/${multi.contestId} (${letters})`
        : "codeforces (multi)";
    const payload = {
      source: "oj-sync",
      contestId: multi.contestId || null,
      importProblem,
      problems: problemsOut,
    };
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    /** @type {{ kind?: string }} */ (raw).kind === "leetcode" &&
    Array.isArray(/** @type {{ items?: unknown }} */ (raw).items)
  ) {
    const wrapped = /** @type {{ kind: string; frontendId?: string | null; starterCode?: string; items: { id: string; text: string }[] }} */ (
      raw
    );
    const pairs = pairSamples(wrapped.items);
    if (pairs.length === 0) {
      return { ok: false };
    }
    const idPart = (wrapped.frontendId ?? "").toString().trim();
    /** Never use URL slug (`leetcode/two-sum`); numeric frontend id only. */
    const problem = /^\d+$/u.test(idPart) ? `leetcode/${idPart}` : "";
    const starterRaw = (wrapped.starterCode ?? "").toString().trim();
    /** @type {Record<string, unknown>} */
    const payload =
      problem.length > 0 ? { problem, samples: pairs } : { samples: pairs };
    if (starterRaw.length > 0) {
      payload.starterCode = starterRaw;
    }
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    /** @type {{ kind?: string }} */ (raw).kind === "single" &&
    Array.isArray(/** @type {{ items?: unknown }} */ (raw).items)
  ) {
    const one = /** @type {{ timeLimitMs?: unknown; memoryLimitMb?: unknown; items: { id: string; text: string }[] }} */ (
      raw
    );
    const pairs = pairSamples(one.items);
    if (pairs.length === 0) {
      return { ok: false };
    }
    const problem = problemLabelFromContestUrl(tabUrl);
    /** @type {Record<string, unknown>} */
    const payload = {};
    if (problem.length > 0) payload.problem = problem;
    if (tabUrl) payload.url = tabUrl;
    payload.samples = pairs;
    const tl = coerceTimeLimitMs(one.timeLimitMs);
    if (tl !== null) payload.timeLimitMs = tl;
    const ml = coerceMemoryLimitMb(one.memoryLimitMb);
    if (ml !== null) payload.memoryLimitMb = ml;
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  /** @type {{ id: string; text: string }[]} */
  const items = Array.isArray(raw) ? raw : [];
  const pairs = pairSamples(items);

  if (pairs.length === 0) {
    return { ok: false };
  }

  const problem = problemLabelFromContestUrl(tabUrl);
  const payload =
    problem.length > 0 ? { problem, samples: pairs } : pairs;
  return { ok: true, json: JSON.stringify(payload, null, 2) };
}

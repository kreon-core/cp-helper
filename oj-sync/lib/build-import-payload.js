import { pairSamples } from "./pair-samples.js";
import { problemLabelFromContestUrl } from "./contest-url.js";

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function coerceTimeLimitMs(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 60000 ? Math.round(n) : null;
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
    /** @type {{ kind?: string; problems?: unknown }} */ (raw).kind === "cf-multi" &&
    Array.isArray(/** @type {{ problems: unknown }} */ (raw).problems)
  ) {
    const multi = /** @type {{ kind: string; contestId?: string; problems: { letter?: string; timeLimitMs?: unknown; items?: { id: string; text: string }[] }[] }} */ (
      raw
    );
    /** @type {{ problem: string; timeLimitMs?: number; samples: { sample: number; input: string; output: string }[] }[]} */
    const problemsOut = [];
    for (const pr of multi.problems) {
      const paired = pairSamples(pr.items ?? []);
      if (paired.length === 0) continue;
      const letter = pr.letter && pr.letter !== "?" ? pr.letter : "?";
      const pid =
        multi.contestId && letter !== "?"
          ? `codeforces/${multi.contestId}${letter}`
          : "";
      /** @type {{ problem: string; timeLimitMs?: number; samples: { sample: number; input: string; output: string }[] }} */
      const out = {
        problem: pid || `codeforces/${letter}`,
        samples: paired,
      };
      const tl = coerceTimeLimitMs(pr.timeLimitMs);
      if (tl !== null) out.timeLimitMs = tl;
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
    const one = /** @type {{ timeLimitMs?: unknown; items: { id: string; text: string }[] }} */ (
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
    payload.samples = pairs;
    const tl = coerceTimeLimitMs(one.timeLimitMs);
    if (tl !== null) payload.timeLimitMs = tl;
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

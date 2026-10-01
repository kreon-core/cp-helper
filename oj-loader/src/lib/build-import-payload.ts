import type { Sample, SampleItem } from "../types";
import { pairSamples } from "./pair-samples";
import { problemLabelFromContestUrl } from "./contest-url";

interface ImportProblem {
  problem: string;
  url?: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  samples: Sample[];
}

type BuildResult = { ok: true; json: string } | { ok: false };

/**
 * Problem page URL per Codeforces problem in a contest-wide dump. OJ Runner needs it to know
 * whether a submit goes through `/contest/` or `/gym/`; the contest id alone does not say.
 * @param tabUrl the `/problems` page the dump came from
 */
function codeforcesProblemUrl(
  tabUrl: string | undefined,
  contestId: string,
  letter: string,
): string {
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

function coerceTimeLimitMs(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 60000 ? Math.round(n) : null;
}

function coerceMemoryLimitMb(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 65536 ? Math.round(n) : null;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * Turn `executeScript` result from `__ojLoaderExtractSamplesInPage` (see `inpage/`) into POST body JSON.
 */
export function buildImportJsonFromExtractResult(
  tabUrl: string | undefined,
  raw: unknown,
): BuildResult {
  if (isRecord(raw) && raw.kind === "contest-labels") {
    const list = raw as { contestId?: string; labels?: unknown };
    const contestId = (list.contestId ?? "").toString();
    const labels = Array.isArray(list.labels)
      ? list.labels.map((x) => String(x)).filter((x) => x.length > 0)
      : [];
    if (contestId.length === 0 || labels.length === 0) {
      return { ok: false };
    }
    const payload = {
      source: "oj-loader",
      clipboardText: `${contestId} ${labels.join(",")}`,
    };
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  if (isRecord(raw) && raw.kind === "cf-multi" && Array.isArray(raw.problems)) {
    const multi = raw as {
      kind: string;
      contestId?: string;
      problems: {
        letter?: string;
        timeLimitMs?: unknown;
        memoryLimitMb?: unknown;
        items?: SampleItem[];
      }[];
    };
    const problemsOut: ImportProblem[] = [];
    for (const pr of multi.problems) {
      const paired = pairSamples(pr.items ?? []);
      if (paired.length === 0) continue;
      const letter = pr.letter && pr.letter !== "?" ? pr.letter : "?";
      const pid =
        multi.contestId && letter !== "?"
          ? `codeforces/${multi.contestId}${letter}`
          : "";
      const out: ImportProblem = {
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
      source: "oj-loader",
      contestId: multi.contestId || null,
      importProblem,
      problems: problemsOut,
    };
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  if (isRecord(raw) && raw.kind === "leetcode" && Array.isArray(raw.items)) {
    const wrapped = raw as {
      kind: string;
      frontendId?: string | null;
      starterCode?: string;
      items: SampleItem[];
    };
    const pairs = pairSamples(wrapped.items);
    if (pairs.length === 0) {
      return { ok: false };
    }
    const idPart = (wrapped.frontendId ?? "").toString().trim();
    /** Never use URL slug (`leetcode/two-sum`); numeric frontend id only. */
    const problem = /^\d+$/u.test(idPart) ? `leetcode/${idPart}` : "";
    const starterRaw = (wrapped.starterCode ?? "").toString().trim();
    const payload: Record<string, unknown> =
      problem.length > 0 ? { problem, samples: pairs } : { samples: pairs };
    if (starterRaw.length > 0) {
      payload.starterCode = starterRaw;
    }
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  if (isRecord(raw) && raw.kind === "single" && Array.isArray(raw.items)) {
    const one = raw as {
      timeLimitMs?: unknown;
      memoryLimitMb?: unknown;
      items: SampleItem[];
    };
    const pairs = pairSamples(one.items);
    if (pairs.length === 0) {
      return { ok: false };
    }
    const problem = problemLabelFromContestUrl(tabUrl);
    const payload: Record<string, unknown> = {};
    if (problem.length > 0) payload.problem = problem;
    if (tabUrl) payload.url = tabUrl;
    payload.samples = pairs;
    const tl = coerceTimeLimitMs(one.timeLimitMs);
    if (tl !== null) payload.timeLimitMs = tl;
    const ml = coerceMemoryLimitMb(one.memoryLimitMb);
    if (ml !== null) payload.memoryLimitMb = ml;
    return { ok: true, json: JSON.stringify(payload, null, 2) };
  }

  const items: SampleItem[] = Array.isArray(raw) ? raw : [];
  const pairs = pairSamples(items);

  if (pairs.length === 0) {
    return { ok: false };
  }

  const problem = problemLabelFromContestUrl(tabUrl);
  const payload =
    problem.length > 0 ? { problem, samples: pairs } : pairs;
  return { ok: true, json: JSON.stringify(payload, null, 2) };
}

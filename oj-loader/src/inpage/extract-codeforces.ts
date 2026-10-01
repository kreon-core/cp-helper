/**
 * Codeforces: `div.sample-test` input/output `<pre>`; multi-problem gym layout.
 * Delete this file and remove the cf branch in `dispatch.ts` to drop support.
 */
import type {
  CodeforcesMulti,
  CodeforcesMultiProblem,
  ContestLabels,
  SampleItem,
  SingleProblem,
} from "../types";
import { parseMemoryLimitMb, parseTimeLimitMs, prePlainText } from "./shared-dom";

/**
 * @param root problem holder, or the document for a single-problem page
 */
function cfTimeLimitFromRoot(root: ParentNode): number | null {
  const el = root.querySelector("div.time-limit");
  return el ? parseTimeLimitMs(el.textContent ?? "") : null;
}

/**
 * @param root problem holder, or the document for a single-problem page
 */
function cfMemoryLimitFromRoot(root: ParentNode): number | null {
  const el = root.querySelector("div.memory-limit");
  return el ? parseMemoryLimitMb(el.textContent ?? "") : null;
}

function cfCollectSamplePresFromRoot(root: Element): SampleItem[] {
  const results: SampleItem[] = [];
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

function cfProblemLetterFromHolder(holder: Element): string {
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

function cfContestIdFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr, "https://codeforces.com");
    const m = u.pathname.match(/\/(?:contest|gym)\/(\d+)(?:\/|$)/u);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function cfIsContestListUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr, "https://codeforces.com");
    return /^\/(?:contest|gym)\/\d+\/?$/u.test(u.pathname);
  } catch {
    return false;
  }
}

function cfLabelsFromContestList(contestId: string): string[] {
  if (!contestId) return [];
  const re = new RegExp(
    `/(?:contest|gym)/${contestId}/problem/([^/?#]+)`,
    "u",
  );
  const labels: string[] = [];
  for (const a of document.querySelectorAll(
    'table.problems a[href*="/problem/"]',
  )) {
    const m = (a.getAttribute("href") ?? "").match(re);
    if (!m) continue;
    const raw = decodeURIComponent(m[1]);
    const id = /^[a-z]/u.test(raw) ? raw[0].toUpperCase() + raw.slice(1) : raw;
    if (!labels.includes(id)) labels.push(id);
  }
  return labels;
}

export function extractCodeforces(
  pageUrl: string,
): ContestLabels | CodeforcesMulti | SingleProblem {
  const url = pageUrl && pageUrl.length > 0 ? pageUrl : window.location.href;
  const contestId = cfContestIdFromUrl(url);
  if (cfIsContestListUrl(url)) {
    return {
      kind: "contest-labels",
      contestId,
      labels: cfLabelsFromContestList(contestId),
    };
  }

  const holders = Array.from(
    document.querySelectorAll("div.problemindexholder"),
  ).filter((h) => h.querySelector("div.sample-test"));

  if (holders.length >= 2) {
    const problems: CodeforcesMultiProblem[] = [];
    for (const holder of holders) {
      const items = cfCollectSamplePresFromRoot(holder);
      if (items.length === 0) continue;
      problems.push({
        letter: cfProblemLetterFromHolder(holder),
        timeLimitMs: cfTimeLimitFromRoot(holder),
        memoryLimitMb: cfMemoryLimitFromRoot(holder),
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
        memoryLimitMb: problems[0].memoryLimitMb,
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
        memoryLimitMb: cfMemoryLimitFromRoot(holders[0]),
        items: one,
      };
    }
  }

  const results: SampleItem[] = [];
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
    memoryLimitMb: cfMemoryLimitFromRoot(document),
    items: results,
  };
}

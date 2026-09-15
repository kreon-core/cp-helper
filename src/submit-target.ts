/**
 * Maps an imported problem (its page URL, or the `judge/problem` label OJ Sync stored) onto the
 * judge page a submit has to run on. Nothing here talks to the network.
 */

export type SubmitJudge = "codeforces" | "atcoder";

export interface SubmitTarget {
  judge: SubmitJudge;
  /** Codeforces: contest or gym id. AtCoder: contest slug (`abc451`). */
  contestId: string;
  /** Codeforces: problem index (`G`, `B2`). AtCoder: task screen name (`abc451_a`). */
  problemId: string;
  /** Page the browser tab must be on before the submit form can be read. */
  submitUrl: string;
  /** Page listing the submitter's own results, polled for the verdict. */
  statusUrl: string;
  /** Human-readable target, e.g. `Codeforces 2204G`. */
  title: string;
}

const CF_HOSTS = /^(?:.*\.)?codeforces\.com$/u;
const AT_HOSTS = /^(?:.*\.)?atcoder\.jp$/u;

/** Codeforces ids at or above this belong to the gym, which submits under `/gym/`. */
const CF_GYM_MIN_ID = 100_000;

function codeforcesTarget(contestId: string, problemId: string): SubmitTarget {
  const gym = Number(contestId) >= CF_GYM_MIN_ID;
  const base = `https://codeforces.com/${gym ? "gym" : "contest"}/${contestId}`;
  return {
    judge: "codeforces",
    contestId,
    problemId,
    submitUrl: `${base}/submit`,
    statusUrl: `${base}/my`,
    title: `Codeforces ${contestId}${problemId}`,
  };
}

function atcoderTarget(contestId: string, taskScreenName: string): SubmitTarget {
  const base = `https://atcoder.jp/contests/${contestId}`;
  return {
    judge: "atcoder",
    contestId,
    problemId: taskScreenName,
    submitUrl: `${base}/submit?taskScreenName=${encodeURIComponent(taskScreenName)}`,
    statusUrl: `${base}/submissions/me`,
    title: `AtCoder ${taskScreenName}`,
  };
}

function normalizeCfIndex(raw: string): string {
  const x = decodeURIComponent(raw);
  return /^[a-z]/u.test(x) ? x.charAt(0).toUpperCase() + x.slice(1) : x;
}

function targetFromUrl(url: string): SubmitTarget | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (AT_HOSTS.test(u.hostname)) {
    const m = u.pathname.match(/\/contests\/([^/]+)\/tasks\/([^/?#]+)/u);
    return m ? atcoderTarget(m[1], m[2]) : null;
  }
  if (!CF_HOSTS.test(u.hostname)) {
    return null;
  }
  let m = u.pathname.match(/\/(?:contest|gym)\/(\d+)\/problem\/([^/?#]+)/u);
  if (m) {
    return codeforcesTarget(m[1], normalizeCfIndex(m[2]));
  }
  m = u.pathname.match(/\/problemset\/problem\/(\d+)\/([^/?#]+)/u);
  return m ? codeforcesTarget(m[1], normalizeCfIndex(m[2])) : null;
}

/**
 * AtCoder task screen names follow the contest slug with `_` in place of `-`
 * (`tenka1_2018_a` -> contest `tenka1-2018`), so the last segment can be dropped to recover it.
 */
function atcoderContestFromTask(task: string): string | null {
  const parts = task.split("_");
  if (parts.length < 2) {
    return null;
  }
  const contest = parts.slice(0, -1).join("-");
  return contest.length > 0 ? contest : null;
}

function targetFromLabel(label: string): SubmitTarget | null {
  const slash = label.indexOf("/");
  if (slash < 0) {
    return null;
  }
  const judge = label.slice(0, slash).trim().toLowerCase();
  const rest = label.slice(slash + 1).trim();
  if (judge === "atcoder") {
    const task = rest.split(/\s/u)[0] ?? "";
    const contest = atcoderContestFromTask(task);
    return contest ? atcoderTarget(contest, task) : null;
  }
  if (judge !== "codeforces") {
    return null;
  }
  const m = rest.match(/^(\d+)([A-Za-z]\d*)$/u);
  return m ? codeforcesTarget(m[1], normalizeCfIndex(m[2])) : null;
}

/**
 * @param label group label written at import, e.g. `codeforces/2204G`
 * @param url problem page URL when the import carried one (preferred: it names the contest exactly)
 */
export function resolveSubmitTarget(
  label: string | undefined,
  url?: string | undefined,
): SubmitTarget | null {
  if (url) {
    const fromUrl = targetFromUrl(url);
    if (fromUrl) {
      return fromUrl;
    }
  }
  return label ? targetFromLabel(label.trim()) : null;
}

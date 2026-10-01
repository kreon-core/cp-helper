/**
 * Hostname router for submit jobs: calls `submitCodeforces` / `submitAtcoder` and their verdict
 * counterparts. Edit here to disable a site without removing its file.
 */
import type {
  AntiBotState,
  Judge,
  SubmitJob,
  SubmitResult,
  VerdictRow,
  VerdictsQuery,
} from "../types";
import { submitAtcoder, verdictAtcoder, verdictsAtcoder } from "./submit-atcoder";
import {
  submitCodeforces,
  verdictCodeforces,
  verdictsCodeforces,
} from "./submit-codeforces";
import { waitForAntiBotToken } from "./submit-shared";

function judgeOf(job: { judge?: string }): Judge | "" {
  if (job.judge === "atcoder" || job.judge === "codeforces") {
    return job.judge;
  }
  return "";
}

globalThis.__ojLoaderSubmitInPage = async function __ojLoaderSubmitInPage(
  job: SubmitJob,
): Promise<SubmitResult> {
  const judge = judgeOf(job);
  if (judge === "atcoder") {
    return submitAtcoder(job);
  }
  if (judge === "codeforces") {
    return submitCodeforces(job);
  }
  return { submitted: false, error: `Unsupported judge: ${String(job.judge)}` };
};

/**
 * Judge-agnostic: lets the service worker see whether an anti-bot widget is still holding the
 * page up, so it can put the tab in front before the submit driver gives up on it.
 */
globalThis.__ojLoaderAntiBotInPage = async function __ojLoaderAntiBotInPage(opts: {
  waitMs?: number;
}): Promise<AntiBotState> {
  const waitMs = Number(opts && opts.waitMs);
  return waitForAntiBotToken(Number.isFinite(waitMs) ? waitMs : 0);
};

/**
 * Reads several problems off one status page, for jobs sharing a poller.
 */
globalThis.__ojLoaderVerdictsInPage = async function __ojLoaderVerdictsInPage(
  opts: VerdictsQuery,
): Promise<Record<string, VerdictRow>> {
  const judge = judgeOf(opts);
  if (judge === "atcoder") {
    return verdictsAtcoder(opts);
  }
  if (judge === "codeforces") {
    return verdictsCodeforces(opts);
  }
  return {};
};

globalThis.__ojLoaderVerdictInPage = async function __ojLoaderVerdictInPage(
  job: SubmitJob,
): Promise<VerdictRow> {
  const judge = judgeOf(job);
  if (judge === "atcoder") {
    return verdictAtcoder(job);
  }
  if (judge === "codeforces") {
    return verdictCodeforces(job);
  }
  return { verdict: "", pending: false };
};

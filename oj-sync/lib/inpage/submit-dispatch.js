/**
 * Hostname router for submit jobs: calls `__ojSyncSubmit.submitCodeforces` / `submitAtcoder` and
 * their verdict counterparts. Edit here to disable a site without removing its file.
 */
(function registerOjSyncSubmitDispatch(g) {
  const ns = g.__ojSyncSubmit;
  if (!ns) return;

  /**
   * @param {{ judge: string }} job
   * @returns {"atcoder" | "codeforces" | ""}
   */
  function judgeOf(job) {
    if (job.judge === "atcoder" || job.judge === "codeforces") {
      return job.judge;
    }
    return "";
  }

  /**
   * @param {Record<string, any>} job
   * @returns {Promise<{ submitted: boolean; error?: string; language?: string }>}
   */
  g.__ojSyncSubmitInPage = async function __ojSyncSubmitInPage(job) {
    const judge = judgeOf(job);
    if (judge === "atcoder") {
      return ns.submitAtcoder(job);
    }
    if (judge === "codeforces") {
      return ns.submitCodeforces(job);
    }
    return { submitted: false, error: `Unsupported judge: ${String(job.judge)}` };
  };

  /**
   * Judge-agnostic: lets the service worker see whether an anti-bot widget is still holding the
   * page up, so it can put the tab in front before the submit driver gives up on it.
   * @param {{ waitMs?: number }} opts
   * @returns {Promise<{ present: boolean; name: string; value: string }>}
   */
  g.__ojSyncAntiBotInPage = async function __ojSyncAntiBotInPage(opts) {
    const waitMs = Number(opts && opts.waitMs);
    return ns.waitForAntiBotToken(Number.isFinite(waitMs) ? waitMs : 0);
  };

  /**
   * @param {Record<string, any>} job
   * @returns {Promise<{ verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }>}
   */
  g.__ojSyncVerdictInPage = async function __ojSyncVerdictInPage(job) {
    const judge = judgeOf(job);
    if (judge === "atcoder") {
      return ns.verdictAtcoder(job);
    }
    if (judge === "codeforces") {
      return ns.verdictCodeforces(job);
    }
    return { verdict: "", pending: false };
  };
})(globalThis);

/**
 * Runs one submit job: park a tab on the judge's submit page, replay the form from inside it, then
 * watch the judge's own status page until the verdict settles.
 *
 * Everything that needs the judge's session happens in the tab, never here: an extension `fetch`
 * is cross-site as far as SameSite cookies are concerned, so it would submit as a logged-out user.
 */
import { OJ_SYNC_SUBMIT_SCRIPT_PATHS } from "./inpage/inject-manifest.js";

/** Session-scoped ids of the tabs reused for submits, so repeat submits do not pile up tabs. */
const TAB_KEY = "submitTabIds";

/**
 * Tabs a job is driving right now. Jobs for different problems run at the same time, and a tab
 * being replayed must not be navigated to another problem underneath it.
 */
const busyTabs = new Set();

/** Claims are read-modify-write over the pool, so they are taken one at a time. */
let claimChain = Promise.resolve();

/** Give up waiting for the submit page to load. */
const TAB_LOAD_TIMEOUT_MS = 30000;

/**
 * Ceiling on one `executeScript` round trip. A tab that has stopped answering - wedged on an
 * interstitial, discarded, mid-navigation - would otherwise leave the job parked on whatever
 * stage it reached, with nothing in VS Code but a status chip that never moves.
 */
const IN_PAGE_TIMEOUT_MS = 20000;

/** The submit call carries the driver's own anti-bot wait and the POST, so it gets longer. */
const IN_PAGE_SUBMIT_TIMEOUT_MS = 45000;

/** Claims are serialized, so one that hangs would park every later submit too. */
const CLAIM_TIMEOUT_MS = 15000;

/** Tabs that stopped answering. Never reused: whatever wedged them is still there. */
const wedgedTabs = new Set();

/**
 * How long an anti-bot widget gets to clear itself while its tab is still in the background.
 * After this the tab is brought forward, since a hidden tab may never finish the challenge.
 */
const ANTI_BOT_BACKGROUND_MS = 2500;

/** Gap between status-page reads while the judge is still running the submission. */
const POLL_INTERVAL_MS = 2000;

/** Once a submission has been judging this long its verdict is not imminent, so reads slow down. */
const POLL_SLOW_AFTER_MS = 20000;

/** Gap between status-page reads past `POLL_SLOW_AFTER_MS`. */
const POLL_SLOW_INTERVAL_MS = 5000;

/**
 * One polling loop per status page, keyed by its URL. Both judges list every problem of a contest
 * on a single page, so problems submitted together are followed by one read per cycle instead of
 * one each - which is what keeps a contest's worth of concurrent submits off the judge's rate
 * limiter.
 * @type {Map<string, { subs: Set<any>; running: boolean }>}
 */
const pollers = new Map();

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @template T
 * @param {Promise<T>} work
 * @param {number} ms
 * @param {string} what subject of the error message, e.g. `The judge's tab`
 * @returns {Promise<T>}
 */
function withTimeout(work, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(
        `${what} stopped answering after ${Math.round(ms / 1000)}s. Check the tab it opened on the judge.`,
      );
      e.name = "OjSyncTimeout";
      reject(e);
    }, ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab | null>}
 */
async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @returns {string} origin + path, the part that has to match for the tab to be on the right page
 */
function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Waits for the tab to finish loading `expectedUrl`. The URL has to be checked as well as the
 * status: right after a navigation is requested the tab still reports the previous page as
 * `complete`, which would let the drivers run against the wrong document.
 * @param {number} tabId
 * @param {string} expectedUrl
 * @returns {Promise<void>}
 */
async function waitForLoad(tabId, expectedUrl) {
  const want = pageKey(expectedUrl);
  const deadline = Date.now() + TAB_LOAD_TIMEOUT_MS;
  for (;;) {
    const tab = await getTab(tabId);
    if (!tab) {
      throw new Error("The submit tab was closed.");
    }
    const at = pageKey(tab.url ?? "");
    if (tab.status === "complete" && at === want) {
      return;
    }
    if (tab.status === "complete" && /\/(?:login|enter)\b/u.test(at)) {
      throw new Error(
        "The judge sent us to its login page - sign in to it in this browser, then submit again.",
      );
    }
    if (Date.now() > deadline) {
      throw new Error("The judge's submit page did not finish loading.");
    }
    await delay(200);
  }
}

/**
 * Take a tab out of the pool and point it at `submitUrl`, opening one when every pooled tab is
 * either gone or already carrying another job.
 * @param {string} submitUrl
 * @returns {Promise<number>} id of the claimed tab, marked busy
 */
async function claimTab(submitUrl) {
  const stored = await chrome.storage.session.get({ [TAB_KEY]: [] });
  const pool = (Array.isArray(stored[TAB_KEY]) ? stored[TAB_KEY] : []).filter(
    (id) => typeof id === "number",
  );
  const alive = [];
  for (const id of pool) {
    if (!wedgedTabs.has(id) && (await getTab(id))) {
      alive.push(id);
    }
  }
  let tabId = alive.find((id) => !busyTabs.has(id));
  if (tabId === undefined) {
    const created = await chrome.tabs.create({ url: submitUrl, active: false });
    if (created.id === undefined) {
      throw new Error("Could not open a tab on the judge.");
    }
    tabId = created.id;
    alive.push(tabId);
  } else {
    const tab = await getTab(tabId);
    // Re-navigating a tab that is already on this exact page throws away an anti-bot token the
    // user just cleared by hand, which is what "clear it there, then submit again" asks them to do.
    if (!tab || (tab.url ?? "") !== submitUrl) {
      await chrome.tabs.update(tabId, { url: submitUrl });
    }
  }
  busyTabs.add(tabId);
  await chrome.storage.session.set({ [TAB_KEY]: alive });
  return tabId;
}

/**
 * @param {string} submitUrl
 * @returns {Promise<number>} id of a tab sitting on `submitUrl`
 */
async function acquireTab(submitUrl) {
  const claim = claimChain.then(() =>
    withTimeout(claimTab(submitUrl), CLAIM_TIMEOUT_MS, "The browser"),
  );
  claimChain = claim.then(
    () => undefined,
    () => undefined,
  );
  const tabId = await claim;
  try {
    await waitForLoad(tabId, submitUrl);
  } catch (e) {
    busyTabs.delete(tabId);
    throw e;
  }
  return tabId;
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 * @param {Record<string, unknown>} job
 * @returns {unknown}
 */
function callSubmitInPage(job) {
  const fn = globalThis.__ojSyncSubmitInPage;
  return typeof fn === "function"
    ? fn(job)
    : { submitted: false, error: "Submit driver not injected." };
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 * @param {Record<string, unknown>} opts
 * @returns {unknown}
 */
function callAntiBotInPage(opts) {
  const fn = globalThis.__ojSyncAntiBotInPage;
  return typeof fn === "function"
    ? fn(opts)
    : { present: false, name: "", value: "" };
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 * @param {Record<string, unknown>} job
 * @returns {unknown}
 */
function callVerdictInPage(job) {
  const fn = globalThis.__ojSyncVerdictInPage;
  return typeof fn === "function" ? fn(job) : { verdict: "", pending: false };
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 * @param {Record<string, unknown>} opts
 * @returns {unknown}
 */
function callVerdictsInPage(opts) {
  const fn = globalThis.__ojSyncVerdictsInPage;
  return typeof fn === "function" ? fn(opts) : {};
}

/**
 * Every call into a tab goes through here, so a tab that stops answering is recorded once and
 * kept out of the pool from then on.
 * @template T
 * @param {number} tabId
 * @param {Promise<T>} work
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function inTab(tabId, work, timeoutMs) {
  try {
    const out = await withTimeout(work, timeoutMs, "The judge's tab");
    wedgedTabs.delete(tabId);
    return out;
  } catch (e) {
    if (e instanceof Error && e.name === "OjSyncTimeout") {
      wedgedTabs.add(tabId);
    }
    throw e;
  }
}

/**
 * @param {number} tabId
 * @param {(job: Record<string, unknown>) => unknown} func
 * @param {Record<string, unknown>} job
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
async function callInPage(tabId, func, job, timeoutMs = IN_PAGE_TIMEOUT_MS) {
  const frames = await inTab(
    tabId,
    chrome.scripting.executeScript({ target: { tabId }, func, args: [job] }),
    timeoutMs,
  );
  const first = frames ? frames[0] : undefined;
  return first ? first.result : undefined;
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function focusTab(tabId) {
  try {
    const tab = await inTab(
      tabId,
      chrome.tabs.update(tabId, { active: true }),
      IN_PAGE_TIMEOUT_MS,
    );
    if (tab && tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    /* tab closed while we were submitting */
  }
}

/**
 * Whether a submission newer than `priorId` now exists for this problem.
 * @param {number} tabId
 * @param {Record<string, unknown>} job
 * @param {string} priorId newest submission id seen before the POST
 * @returns {Promise<boolean>}
 */
async function appeared(tabId, job, priorId) {
  for (let i = 0; i < 3; i += 1) {
    await delay(1500);
    try {
      const now = await callInPage(tabId, callVerdictInPage, job);
      const id = now && now.submissionId ? String(now.submissionId) : "";
      if (id !== "" && id !== priorId) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {string} judge
 * @param {string} verdict
 * @returns {boolean}
 */
function isAccepted(judge, verdict) {
  const v = verdict.trim().toLowerCase();
  return judge === "atcoder" ? v === "ac" : v.startsWith("accepted");
}

/**
 * @param {number} elapsed ms this poller has been running
 * @returns {number}
 */
function pollDelay(elapsed) {
  return elapsed >= POLL_SLOW_AFTER_MS ? POLL_SLOW_INTERVAL_MS : POLL_INTERVAL_MS;
}

/**
 * Read the status page once per cycle and hand each waiting job its own row. The read runs in a
 * subscriber's tab, and falls back to the others if that one cannot answer.
 * @param {string} statusUrl
 * @param {{ subs: Set<any>; running: boolean }} poller
 * @returns {Promise<void>}
 */
async function pollLoop(statusUrl, poller) {
  const started = Date.now();
  try {
    while (poller.subs.size > 0) {
      await delay(pollDelay(Date.now() - started));
      const subs = [...poller.subs];
      if (subs.length === 0) {
        break;
      }
      const problemIds = subs.map((s) => s.problemId);
      let rows;
      let failure;
      for (const s of subs) {
        try {
          rows = await callInPage(s.tabId, callVerdictsInPage, {
            judge: s.judge,
            statusUrl,
            problemIds,
          });
          failure = undefined;
          break;
        } catch (e) {
          failure = e;
        }
      }
      for (const s of subs) {
        if (!poller.subs.has(s)) {
          continue;
        }
        s.deliver(rows ? rows[s.problemId] : undefined, failure);
      }
    }
  } finally {
    poller.running = false;
    if (pollers.get(statusUrl) === poller && poller.subs.size === 0) {
      pollers.delete(statusUrl);
    }
  }
}

/**
 * Follow one problem's verdict on the poller shared by everything on the same status page.
 * @param {Record<string, any>} job
 * @param {number} tabId this job's tab, offered to the poller to read the status page in
 * @param {number} pollFor how long to wait for the verdict to settle
 * @param {(stage: string, message?: string) => void} onProgress
 * @returns {Promise<{ verdict?: string; accepted?: boolean; submissionId?: string; submissionUrl?: string; error?: string }>}
 */
function watchVerdict(job, tabId, pollFor, onProgress) {
  const statusUrl = String(job.statusUrl);
  let poller = pollers.get(statusUrl);
  if (!poller) {
    poller = { subs: new Set(), running: false };
    pollers.set(statusUrl, poller);
  }
  const shared = poller;
  return new Promise((resolve) => {
    /** @type {{ verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }} */
    let last = { verdict: "", pending: true };
    /**
     * @param {Record<string, any>} out
     */
    const finish = (out) => {
      clearTimeout(timer);
      shared.subs.delete(sub);
      resolve(out);
    };
    const sub = {
      judge: String(job.judge),
      problemId: String(job.problemId),
      tabId,
      /**
       * @param {{ verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string } | undefined} row
       * @param {unknown} err
       */
      deliver(row, err) {
        if (err) {
          finish({
            error: `Submitted, but the verdict could not be read: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
          return;
        }
        if (!row) {
          return;
        }
        last = row;
        if (row.verdict !== "") {
          onProgress("judging", row.verdict);
        }
        if (!row.pending) {
          finish({
            verdict: row.verdict,
            accepted: isAccepted(String(job.judge), row.verdict),
            submissionId: row.submissionId,
            submissionUrl: row.submissionUrl,
          });
        }
      },
    };
    const timer = setTimeout(() => {
      finish({
        verdict: last.verdict !== "" ? last.verdict : undefined,
        submissionId: last.submissionId,
        submissionUrl: last.submissionUrl,
        error:
          "Submitted, but the judge was still running it when polling timed out.",
      });
    }, pollFor);
    shared.subs.add(sub);
    if (!shared.running) {
      shared.running = true;
      void pollLoop(statusUrl, shared);
    }
  });
}

/**
 * @param {number} tabId tab already sitting on the job's submit page
 * @param {Record<string, any>} job from CP Helper
 * @param {(stage: string, message?: string) => void} onProgress
 * @returns {Promise<{ submitted: boolean; verdict?: string; accepted?: boolean; submissionId?: string; submissionUrl?: string; error?: string }>}
 */
async function submitInTab(tabId, job, onProgress) {
  await inTab(
    tabId,
    chrome.scripting.executeScript({
      target: { tabId },
      files: OJ_SYNC_SUBMIT_SCRIPT_PATHS,
    }),
    IN_PAGE_TIMEOUT_MS,
  );

  // Newest submission before the POST: the judge's answer is not always classifiable, and a new
  // row appearing for this problem is the only unambiguous proof that one was created.
  let priorId = "";
  try {
    const prior = await callInPage(tabId, callVerdictInPage, job);
    priorId = prior && prior.submissionId ? String(prior.submissionId) : "";
  } catch {
    /* status page unreadable; the check below just degrades to reporting the error */
  }

  onProgress("verifying");
  try {
    const gate = await callInPage(tabId, callAntiBotInPage, {
      waitMs: ANTI_BOT_BACKGROUND_MS,
    });
    if (gate && gate.present === true && gate.value === "") {
      await focusTab(tabId);
    }
  } catch {
    /* the submit driver waits for the token again and reports it properly */
  }

  onProgress("sending");
  const sent = await callInPage(
    tabId,
    callSubmitInPage,
    job,
    IN_PAGE_SUBMIT_TIMEOUT_MS,
  );
  if (!sent || sent.submitted !== true) {
    const reason =
      (sent && sent.error) || "The judge did not accept the submission.";
    if (sent && sent.needsInteraction === true) {
      // Nothing can proceed until the user clears the judge's widget, so put that tab in front.
      await focusTab(tabId);
      return { submitted: false, error: reason };
    }
    if (sent && sent.explicit === true) {
      return { submitted: false, error: reason };
    }
    onProgress("checking");
    if (!(await appeared(tabId, job, priorId))) {
      return { submitted: false, error: reason };
    }
  }
  const language = sent && sent.language ? String(sent.language) : undefined;

  const pollFor = Number(job.pollTimeoutMs);
  if (!Number.isFinite(pollFor) || pollFor <= 0) {
    return { submitted: true, language };
  }

  onProgress("judging");
  const watched = await watchVerdict(job, tabId, pollFor, onProgress);
  return { submitted: true, language, ...watched };
}

/**
 * @param {Record<string, any>} job from CP Helper
 * @param {(stage: string, message?: string) => void} onProgress
 * @returns {Promise<{ submitted: boolean; verdict?: string; accepted?: boolean; submissionId?: string; submissionUrl?: string; error?: string }>}
 */
export async function runSubmitJob(job, onProgress) {
  onProgress("opening judge");
  const tabId = await acquireTab(String(job.submitUrl));
  try {
    return await submitInTab(tabId, job, onProgress);
  } finally {
    busyTabs.delete(tabId);
  }
}

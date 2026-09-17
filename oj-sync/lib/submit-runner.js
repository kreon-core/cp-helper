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
 * How long an anti-bot widget gets to clear itself while its tab is still in the background.
 * After this the tab is brought forward, since a hidden tab may never finish the challenge.
 */
const ANTI_BOT_BACKGROUND_MS = 2500;

/** Gap between status-page reads while the judge is still running the submission. */
const POLL_INTERVAL_MS = 2000;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    if (await getTab(id)) {
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
    await chrome.tabs.update(tabId, { url: submitUrl });
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
  const claim = claimChain.then(() => claimTab(submitUrl));
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
 * @param {number} tabId
 * @param {(job: Record<string, unknown>) => unknown} func
 * @param {Record<string, unknown>} job
 * @returns {Promise<any>}
 */
async function callInPage(tabId, func, job) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: [job],
  });
  return result;
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
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
 * @param {number} tabId tab already sitting on the job's submit page
 * @param {Record<string, any>} job from CP Helper
 * @param {(stage: string, message?: string) => void} onProgress
 * @returns {Promise<{ submitted: boolean; verdict?: string; accepted?: boolean; submissionId?: string; submissionUrl?: string; error?: string }>}
 */
async function submitInTab(tabId, job, onProgress) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: OJ_SYNC_SUBMIT_SCRIPT_PATHS,
  });

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
  const sent = await callInPage(tabId, callSubmitInPage, job);
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
  const deadline = Date.now() + pollFor;
  /** @type {{ verdict: string; pending: boolean; submissionId?: string; submissionUrl?: string }} */
  let last = { verdict: "", pending: true };
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    try {
      last = await callInPage(tabId, callVerdictInPage, job);
    } catch (e) {
      return {
        submitted: true,
        error: `Submitted, but the verdict could not be read: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    if (!last) {
      continue;
    }
    if (last.verdict !== "") {
      onProgress("judging", last.verdict);
    }
    if (!last.pending) {
      return {
        submitted: true,
        language,
        verdict: last.verdict,
        accepted: isAccepted(String(job.judge), last.verdict),
        submissionId: last.submissionId,
        submissionUrl: last.submissionUrl,
      };
    }
  }
  return {
    submitted: true,
    language,
    verdict: last && last.verdict !== "" ? last.verdict : undefined,
    submissionId: last ? last.submissionId : undefined,
    submissionUrl: last ? last.submissionUrl : undefined,
    error: "Submitted, but the judge was still running it when polling timed out.",
  };
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

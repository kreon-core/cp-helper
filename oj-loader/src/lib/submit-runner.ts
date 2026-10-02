/**
 * Runs one submit job: park a tab on the judge's submit page, replay the form from inside it, then
 * watch the judge's own status page until the verdict settles.
 *
 * Everything that needs the judge's session happens in the tab, never here: an extension `fetch`
 * is cross-site as far as SameSite cookies are concerned, so it would submit as a logged-out user.
 */
import type {
  AntiBotState,
  ProgressReporter,
  SubmitJob,
  SubmitOutcome,
  SubmitResult,
  VerdictRow,
  VerdictsQuery,
  VerdictWatchJob,
} from "../types";
import { OJ_LOADER_SUBMIT_SCRIPT_PATHS } from "./inject-manifest";
import { getSubmitSettings } from "./settings";

type VerdictOutcome = Omit<SubmitOutcome, "submitted" | "language">;

interface VerdictSubscriber {
  judge: string;
  problemId: string;
  tabId: number;
  deliver(row: VerdictRow | undefined, err: unknown): void;
}

interface Poller {
  subs: Set<VerdictSubscriber>;
  running: boolean;
}

/** Session-scoped ids of the tabs reused for submits, so repeat submits do not pile up tabs. */
const TAB_KEY = "submitTabIds";

/**
 * Tabs a job is driving right now. Jobs for different problems run at the same time, and a tab
 * being replayed must not be navigated to another problem underneath it.
 */
const busyTabs = new Set<number>();

/** Claims are read-modify-write over the pool, so they are taken one at a time. */
let claimChain: Promise<void> = Promise.resolve();

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

/** Tabs that stopped answering. Closed on the spot, and never reused if a claim already had one. */
const wedgedTabs = new Set<number>();

/**
 * Tabs whose anti-bot token has already been spent by a POST. The widget keeps showing the used
 * token, and the judge rejects a second submission carrying it, so such a tab is reloaded before
 * it is replayed again even when it is already on the right page.
 */
const spentTabs = new Set<number>();

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
 */
const pollers = new Map<string, Poller>();

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param what subject of the error message, e.g. `The judge's tab`
 * @param advice what the user should do about it
 */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string,
  advice = "Check the tab it opened on the judge.",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(
        `${what} stopped answering after ${Math.round(ms / 1000)}s. ${advice}`,
      );
      e.name = "OjLoaderTimeout";
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

async function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * @returns origin + path, the part that has to match for the tab to be on the right page
 */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Points a tab at `url` and resolves once it has loaded a document. `tabs.update` resolves as soon
 * as the navigation is requested, and a tab sent to the page it is already on keeps reporting the
 * old document as `complete` until the new one arrives - so polling alone would hand the drivers
 * the page that is about to be replaced. What loaded is still `waitForLoad`'s to check: a judge
 * that answered with its login page has to be reported as that, not as a load that never came.
 */
function navigateTab(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") {
        finish();
      }
    };
    const onRemoved = (id: number) => {
      if (id === tabId) {
        finish(new Error("The submit tab was closed."));
      }
    };
    const timer = setTimeout(
      () => finish(new Error("The judge's submit page did not finish loading.")),
      TAB_LOAD_TIMEOUT_MS,
    );
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url }).catch((e: unknown) => {
      finish(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/**
 * Waits for the tab to finish loading `expectedUrl`. The URL has to be checked as well as the
 * status: right after a navigation is requested the tab still reports the previous page as
 * `complete`, which would let the drivers run against the wrong document.
 */
async function waitForLoad(tabId: number, expectedUrl: string): Promise<void> {
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
        "The judge sent us to its login page - sign in there, then submit again.",
      );
    }
    if (Date.now() > deadline) {
      throw new Error("The judge's submit page did not finish loading.");
    }
    await delay(200);
  }
}

/**
 * Take a tab out of the pool for `openUrl`, opening one when every pooled tab is either gone or
 * already carrying another job. The navigation itself is left to the caller: claims are
 * serialized, so waiting for a page to load in here would park every later submit behind it.
 * @param stays whether a pooled tab can be used where it is, without loading `openUrl`
 * @returns claimed tab, marked busy, and the page it has to finish loading
 */
async function claimTab(
  openUrl: string,
  stays: (tab: chrome.tabs.Tab) => boolean,
): Promise<{ tabId: number; navigate: boolean; loadUrl: string }> {
  const stored = await chrome.storage.session.get({ [TAB_KEY]: [] });
  const pool = (Array.isArray(stored[TAB_KEY]) ? stored[TAB_KEY] : []).filter(
    (id: unknown): id is number => typeof id === "number",
  );
  const alive: number[] = [];
  for (const id of pool) {
    if (!wedgedTabs.has(id) && (await getTab(id))) {
      alive.push(id);
    }
  }
  let tabId = alive.find((id) => !busyTabs.has(id));
  let navigate = false;
  let loadUrl = openUrl;
  if (tabId === undefined) {
    const created = await chrome.tabs.create({ url: openUrl, active: false });
    if (created.id === undefined) {
      throw new Error("Could not open a tab on the judge.");
    }
    tabId = created.id;
    alive.push(tabId);
  } else {
    const tab = await getTab(tabId);
    navigate = !tab || !stays(tab);
    if (tab && !navigate) {
      loadUrl = tab.url ?? openUrl;
    }
  }
  busyTabs.add(tabId);
  await chrome.storage.session.set({ [TAB_KEY]: alive });
  return { tabId, navigate, loadUrl };
}

/**
 * Drop a tab that stopped answering: out of the pool, off the screen. Whatever wedged it is still
 * there, so it is no use to a later submit, and left open it would sit on the judge for the rest
 * of the browser session while every submit after it opens a tab of its own.
 */
async function discardTab(tabId: number): Promise<void> {
  wedgedTabs.add(tabId);
  await closeTab(tabId);
}

/**
 * Take a tab out of the pool and close it. Runs on the claim chain, so a claim never picks up a
 * tab that is on its way out.
 */
async function closeTab(tabId: number): Promise<void> {
  const drop = claimChain.then(async () => {
    const stored = await chrome.storage.session.get({ [TAB_KEY]: [] });
    const pool = Array.isArray(stored[TAB_KEY]) ? stored[TAB_KEY] : [];
    await chrome.storage.session.set({
      [TAB_KEY]: pool.filter((id: unknown) => typeof id === "number" && id !== tabId),
    });
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* already gone */
    }
  });
  claimChain = drop.then(
    () => undefined,
    () => undefined,
  );
  await drop;
}

/**
 * Hand a tab back once its job is over. A job that ended on a settled verdict closes its tab when
 * the user asked for that; anything else leaves it open for the user to look at. The tab stays
 * busy until it is closed, so no other job can claim it in between, and a tab some later job
 * reused is closed or kept by how that job ends.
 */
async function releaseTab(tabId: number, out: SubmitOutcome | undefined): Promise<void> {
  try {
    const settled =
      out !== undefined &&
      out.submitted &&
      out.verdict !== undefined &&
      out.error === undefined;
    if (settled && (await getSubmitSettings()).closeJudgedTabs) {
      await closeTab(tabId);
      spentTabs.delete(tabId);
    }
  } catch {
    /* the tab simply stays open */
  } finally {
    busyTabs.delete(tabId);
  }
}

/**
 * @param stays whether a pooled tab can be used where it is, without loading `openUrl`
 * @returns id of a loaded tab, on `openUrl` unless `stays` kept it where it was
 */
async function acquireTab(
  openUrl: string,
  stays: (tab: chrome.tabs.Tab) => boolean,
): Promise<number> {
  const claim = claimChain.then(() =>
    withTimeout(claimTab(openUrl, stays), CLAIM_TIMEOUT_MS, "The browser"),
  );
  claimChain = claim.then(
    () => undefined,
    () => undefined,
  );
  const { tabId, navigate, loadUrl } = await claim;
  try {
    if (navigate) {
      await navigateTab(tabId, openUrl);
      spentTabs.delete(tabId);
    }
    await waitForLoad(tabId, loadUrl);
  } catch (e) {
    busyTabs.delete(tabId);
    throw e;
  }
  return tabId;
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 */
function callSubmitInPage(job: SubmitJob): SubmitResult | Promise<SubmitResult> {
  const fn = globalThis.__ojLoaderSubmitInPage;
  return typeof fn === "function"
    ? fn(job)
    : { submitted: false, error: "Submit driver not injected." };
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 */
function callAntiBotInPage(opts: {
  waitMs?: number;
}): AntiBotState | Promise<AntiBotState> {
  const fn = globalThis.__ojLoaderAntiBotInPage;
  return typeof fn === "function"
    ? fn(opts)
    : { present: false, name: "", value: "" };
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 */
function callVerdictInPage(job: SubmitJob): VerdictRow | Promise<VerdictRow> {
  const fn = globalThis.__ojLoaderVerdictInPage;
  return typeof fn === "function" ? fn(job) : { verdict: "", pending: false };
}

/**
 * Runs in the **tab** (serialized by `executeScript`).
 */
function callVerdictsInPage(
  opts: VerdictsQuery,
): Record<string, VerdictRow> | null | Promise<Record<string, VerdictRow>> {
  const fn = globalThis.__ojLoaderVerdictsInPage;
  return typeof fn === "function" ? fn(opts) : null;
}

/**
 * Every call into a tab goes through here, so a tab that stops answering is recorded once and
 * kept out of the pool from then on.
 */
async function inTab<T>(tabId: number, work: Promise<T>, timeoutMs: number): Promise<T> {
  try {
    const out = await withTimeout(
      work,
      timeoutMs,
      "The judge's tab",
      "Its tab was closed - submit again.",
    );
    wedgedTabs.delete(tabId);
    return out;
  } catch (e) {
    if (e instanceof Error && e.name === "OjLoaderTimeout") {
      await discardTab(tabId);
    }
    throw e;
  }
}

async function callInPage<A, R>(
  tabId: number,
  func: (arg: A) => R | Promise<R>,
  job: A,
  timeoutMs = IN_PAGE_TIMEOUT_MS,
): Promise<R | undefined> {
  const frames = await inTab(
    tabId,
    chrome.scripting.executeScript({ target: { tabId }, func, args: [job] }),
    timeoutMs,
  );
  const first = frames ? frames[0] : undefined;
  return first ? (first.result as R | undefined) : undefined;
}

async function injectSubmitDriver(tabId: number): Promise<void> {
  await inTab(
    tabId,
    chrome.scripting.executeScript({
      target: { tabId },
      files: OJ_LOADER_SUBMIT_SCRIPT_PATHS,
    }),
    IN_PAGE_TIMEOUT_MS,
  );
}

async function readVerdicts(
  tabId: number,
  query: VerdictsQuery,
): Promise<Record<string, VerdictRow> | undefined> {
  const rows = await callInPage(tabId, callVerdictsInPage, query);
  if (rows !== null) {
    return rows;
  }
  await injectSubmitDriver(tabId);
  return (await callInPage(tabId, callVerdictsInPage, query)) ?? undefined;
}

async function focusTab(tabId: number): Promise<void> {
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
 * @param priorId newest submission id seen before the POST
 */
async function appeared(
  tabId: number,
  job: SubmitJob,
  priorId: string,
): Promise<boolean> {
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

function isAccepted(judge: string, verdict: string): boolean {
  const v = verdict.trim().toLowerCase();
  return judge === "atcoder" ? v === "ac" : v.startsWith("accepted");
}

function isProvisional(judge: string, verdict: string): boolean {
  return judge === "codeforces" && /^pretests passed/iu.test(verdict.trim());
}

/**
 * @param elapsed ms this poller has been running
 */
function pollDelay(elapsed: number): number {
  return elapsed >= POLL_SLOW_AFTER_MS ? POLL_SLOW_INTERVAL_MS : POLL_INTERVAL_MS;
}

/**
 * Read the status page once per cycle and hand each waiting job its own row. The read runs in a
 * subscriber's tab, and falls back to the others if that one cannot answer.
 */
async function pollLoop(statusUrl: string, poller: Poller): Promise<void> {
  const started = Date.now();
  try {
    while (poller.subs.size > 0) {
      await delay(pollDelay(Date.now() - started));
      const subs = [...poller.subs];
      if (subs.length === 0) {
        break;
      }
      const problemIds = subs.map((s) => s.problemId);
      let rows: Record<string, VerdictRow> | undefined;
      let failure: unknown;
      for (const s of subs) {
        try {
          rows = await readVerdicts(s.tabId, {
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
 * @param tabId this job's tab, offered to the poller to read the status page in
 * @param pollFor how long to wait for the verdict to settle
 * @param requireRow end on the first read that lists no submission for the problem, instead of
 * waiting for one to appear
 */
function watchVerdict(
  job: Pick<SubmitJob, "judge" | "problemId" | "statusUrl">,
  tabId: number,
  pollFor: number,
  onProgress: ProgressReporter,
  requireRow = false,
): Promise<VerdictOutcome> {
  const statusUrl = String(job.statusUrl);
  let poller = pollers.get(statusUrl);
  if (!poller) {
    poller = { subs: new Set(), running: false };
    pollers.set(statusUrl, poller);
  }
  const shared = poller;
  return new Promise((resolve) => {
    let last: VerdictRow = { verdict: "", pending: true };
    const finish = (out: VerdictOutcome) => {
      clearTimeout(timer);
      shared.subs.delete(sub);
      resolve(out);
    };
    const sub: VerdictSubscriber = {
      judge: String(job.judge),
      problemId: String(job.problemId),
      tabId,
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
          if (requireRow) {
            finish({
              error: `No submission for ${String(job.problemId)} on the judge's status page.`,
            });
          }
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
            provisional: isProvisional(String(job.judge), row.verdict),
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
 * @param tabId tab already sitting on the job's submit page
 * @param job from OJ Runner
 */
async function submitInTab(
  tabId: number,
  job: SubmitJob,
  onProgress: ProgressReporter,
): Promise<SubmitOutcome> {
  await injectSubmitDriver(tabId);

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
  if (sent && sent.posted === true) {
    spentTabs.add(tabId);
  }
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
 * @param job from OJ Runner
 */
export async function runSubmitJob(
  job: SubmitJob,
  onProgress: ProgressReporter,
): Promise<SubmitOutcome> {
  onProgress("opening judge");
  const submitUrl = String(job.submitUrl);
  // Re-navigating a tab that is already on this exact page throws away an anti-bot token the
  // user just cleared by hand, which is what "clear it there, then submit again" asks them to do.
  // A token this pool has already submitted with is worth nothing, so that tab does reload.
  const tabId = await acquireTab(
    submitUrl,
    (tab) => (tab.url ?? "") === submitUrl && !spentTabs.has(tab.id ?? -1),
  );
  let out: SubmitOutcome | undefined;
  try {
    out = await submitInTab(tabId, job, onProgress);
    return out;
  } finally {
    void releaseTab(tabId, out);
  }
}

/**
 * Follow the newest submission for a problem without submitting anything, for a submit whose
 * verdict was lost along the way.
 * @param job from OJ Runner
 */
export async function runVerdictWatchJob(
  job: VerdictWatchJob,
  onProgress: ProgressReporter,
): Promise<SubmitOutcome> {
  onProgress("opening judge");
  const statusUrl = String(job.statusUrl);
  const origin = new URL(statusUrl).origin;
  const tabId = await acquireTab(statusUrl, (tab) => {
    try {
      return new URL(tab.url ?? "").origin === origin;
    } catch {
      return false;
    }
  });
  let out: SubmitOutcome | undefined;
  try {
    onProgress("checking");
    const pollFor = Number(job.pollTimeoutMs);
    const watched = await watchVerdict(
      job,
      tabId,
      Number.isFinite(pollFor) && pollFor > 0 ? pollFor : POLL_SLOW_AFTER_MS,
      onProgress,
      true,
    );
    out = { submitted: watched.verdict !== undefined, ...watched };
    return out;
  } finally {
    void releaseTab(tabId, out);
  }
}

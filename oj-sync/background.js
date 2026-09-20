/**
 * OJ Sync service worker - wires toolbar click -> page scrape -> POST to CP Helper.
 * Logic lives under `./lib/` for readability.
 */
import { BADGE_OK } from "./lib/constants.js";
import { connectBridge } from "./lib/bridge.js";
import { OJ_SYNC_INPAGE_SCRIPT_PATHS } from "./lib/inpage/inject-manifest.js";
import { buildImportJsonFromExtractResult } from "./lib/build-import-payload.js";
import { isSupportedContestUrl } from "./lib/contest-url.js";
import { flashBadgeSuccess, flashBadgeError } from "./lib/badge.js";
import { getImportSettings } from "./lib/settings.js";
import {
  postSamplesToLocalTester,
  openEditorImportTab,
} from "./lib/cp-helper-client.js";

/**
 * Runs in the **tab** (serialized by `executeScript`); calls the dispatcher
 * registered by `lib/inpage/dispatch.js`.
 * @param {string} pageUrl
 * @returns {unknown}
 */
function runExtractSamplesInPage(pageUrl) {
  const fn = globalThis.__ojSyncExtractSamplesInPage;
  if (typeof fn !== "function") {
    return [];
  }
  return fn(pageUrl);
}

/** Wakes a suspended service worker often enough that the submit bridge reconnects on its own. */
const BRIDGE_KEEPALIVE_ALARM = "oj-sync-bridge-keepalive";

/**
 * Called for user-driven moments, so it forces a reconnect even after the client gave up on a
 * CP Helper that was not listening.
 * @returns {Promise<void>}
 */
function ensureBridge() {
  chrome.alarms.create(BRIDGE_KEEPALIVE_ALARM, { periodInMinutes: 1 });
  return connectBridge({ force: true });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureBridge();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureBridge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BRIDGE_KEEPALIVE_ALARM) {
    void connectBridge();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "sync" &&
    (changes.submitBridgeUrl !== undefined ||
      changes.submitBridgeEnabled !== undefined)
  ) {
    void ensureBridge();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  void ensureBridge();
  if (tab.id === undefined) return;

  const tabId = tab.id;

  if (!isSupportedContestUrl(tab?.url)) {
    await flashBadgeError(tabId, "!");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: OJ_SYNC_INPAGE_SCRIPT_PATHS,
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: runExtractSamplesInPage,
      args: [tab.url ?? ""],
    });

    const built = buildImportJsonFromExtractResult(tab.url, result ?? null);
    if (!built.ok) {
      await flashBadgeError(tabId, "!");
      return;
    }

    const s = await getImportSettings();
    let delivered = false;
    if (s.useLocalHttpImport && s.localImportUrl.length > 0) {
      delivered = await postSamplesToLocalTester(built.json, s.localImportUrl);
    }
    if (delivered) {
      await flashBadgeSuccess(tabId, BADGE_OK);
    } else {
      await flashBadgeError(tabId, "!");
      if (s.fallbackUriIfLocalhostFails && s.focusUri.length > 0) {
        await openEditorImportTab(s.focusUri);
      }
    }
  } catch {
    await flashBadgeError(tabId, "!");
  }
});

chrome.alarms.create(BRIDGE_KEEPALIVE_ALARM, { periodInMinutes: 1 });
void connectBridge();

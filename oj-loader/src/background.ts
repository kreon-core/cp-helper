/**
 * OJ Loader service worker - wires toolbar click -> page scrape -> POST to OJ Runner.
 * Logic lives under `./lib/` for readability.
 */
import { BADGE_OK } from "./lib/constants";
import { connectBridge } from "./lib/bridge";
import { OJ_LOADER_INPAGE_SCRIPT_PATHS } from "./lib/inject-manifest";
import { buildImportJsonFromExtractResult } from "./lib/build-import-payload";
import { isSupportedContestUrl } from "./lib/contest-url";
import { flashBadgeSuccess, flashBadgeError } from "./lib/badge";
import { getImportSettings } from "./lib/settings";
import {
  postSamplesToLocalTester,
  openEditorImportTab,
} from "./lib/oj-runner-client";

/**
 * Runs in the **tab** (serialized by `executeScript`); calls the dispatcher
 * registered by `inpage/dispatch.ts`.
 */
function runExtractSamplesInPage(pageUrl: string): unknown {
  const fn = globalThis.__ojLoaderExtractSamplesInPage;
  if (typeof fn !== "function") {
    return [];
  }
  return fn(pageUrl);
}

/** Wakes a suspended service worker often enough that the submit bridge reconnects on its own. */
const BRIDGE_KEEPALIVE_ALARM = "oj-loader-bridge-keepalive";

/**
 * Called for user-driven moments, so it forces a reconnect even after the client gave up on an
 * OJ Runner that was not listening.
 */
function ensureBridge(): Promise<void> {
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
      files: OJ_LOADER_INPAGE_SCRIPT_PATHS,
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

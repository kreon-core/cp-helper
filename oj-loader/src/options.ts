import { DEFAULT_FOCUS_URI, DEFAULT_LOCAL_IMPORT_URL } from "./lib/constants";

const useLocalEl = document.getElementById("useLocalHttp");
const localUrlEl = document.getElementById("localImportUrl");
const fallbackUriEl = document.getElementById("fallbackUri");
const focusUriEl = document.getElementById("focusUri");
const submitBridgeEnabledEl = document.getElementById("submitBridgeEnabled");
const submitBridgeUrlEl = document.getElementById("submitBridgeUrl");
const closeJudgedTabsEl = document.getElementById("closeJudgedTabs");
const saveEl = document.getElementById("save");
const statusEl = document.getElementById("status");

if (
  !(useLocalEl instanceof HTMLInputElement) ||
  !(localUrlEl instanceof HTMLInputElement) ||
  !(fallbackUriEl instanceof HTMLInputElement) ||
  !(focusUriEl instanceof HTMLInputElement) ||
  !(submitBridgeEnabledEl instanceof HTMLInputElement) ||
  !(submitBridgeUrlEl instanceof HTMLInputElement) ||
  !(closeJudgedTabsEl instanceof HTMLInputElement) ||
  !(saveEl instanceof HTMLButtonElement) ||
  !(statusEl instanceof HTMLElement)
) {
  throw new Error("options: missing elements");
}

const storageDefaults = {
  useLocalHttpImport: true,
  localImportUrl: DEFAULT_LOCAL_IMPORT_URL,
  fallbackUriIfLocalhostFails: false,
  focusUri: "",
  submitBridgeEnabled: true,
  submitBridgeUrl: "",
  closeJudgedTabs: false,
};

chrome.storage.sync.get(storageDefaults, (items) => {
  useLocalEl.checked = items.useLocalHttpImport !== false;
  localUrlEl.value =
    typeof items.localImportUrl === "string" &&
    items.localImportUrl.trim() !== ""
      ? items.localImportUrl
      : DEFAULT_LOCAL_IMPORT_URL;
  fallbackUriEl.checked = items.fallbackUriIfLocalhostFails === true;
  const storedFocus =
    typeof items.focusUri === "string" && items.focusUri.trim() !== ""
      ? items.focusUri.trim()
      : "";
  focusUriEl.value = storedFocus || DEFAULT_FOCUS_URI;
  submitBridgeEnabledEl.checked = items.submitBridgeEnabled !== false;
  submitBridgeUrlEl.value =
    typeof items.submitBridgeUrl === "string" ? items.submitBridgeUrl : "";
  closeJudgedTabsEl.checked = items.closeJudgedTabs === true;
});

saveEl.addEventListener("click", () => {
  const localImportUrl =
    localUrlEl.value.trim() || DEFAULT_LOCAL_IMPORT_URL;
  const focusUri = focusUriEl.value.trim() || DEFAULT_FOCUS_URI;
  chrome.storage.sync.set(
    {
      useLocalHttpImport: useLocalEl.checked,
      localImportUrl,
      fallbackUriIfLocalhostFails: fallbackUriEl.checked,
      focusUri,
      submitBridgeEnabled: submitBridgeEnabledEl.checked,
      submitBridgeUrl: submitBridgeUrlEl.value.trim(),
      closeJudgedTabs: closeJudgedTabsEl.checked,
    },
    () => {
      statusEl.textContent = "Saved.";
      window.setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    },
  );
});

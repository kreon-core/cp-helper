/** @type {string} */
const DEFAULT_FOCUS_URI = "vscode://from-cero.cp-helper/focusSamples";

/** @type {string} */
const DEFAULT_LOCAL_IMPORT_URL = "http://127.0.0.1:17337/import";

const useLocalEl = document.getElementById("useLocalHttp");
const localUrlEl = document.getElementById("localImportUrl");
const fallbackUriEl = document.getElementById("fallbackUri");
const focusUriEl = document.getElementById("focusUri");
const saveEl = document.getElementById("save");
const statusEl = document.getElementById("status");

if (
  !(useLocalEl instanceof HTMLInputElement) ||
  !(localUrlEl instanceof HTMLInputElement) ||
  !(fallbackUriEl instanceof HTMLInputElement) ||
  !(focusUriEl instanceof HTMLInputElement) ||
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
    },
    () => {
      statusEl.textContent = "Saved.";
      window.setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    },
  );
});

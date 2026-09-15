import {
  DEFAULT_FOCUS_URI,
  DEFAULT_LOCAL_IMPORT_URL,
} from "./constants.js";

/**
 * @returns {Promise<{
 *   useLocalHttpImport: boolean;
 *   localImportUrl: string;
 *   fallbackUriIfLocalhostFails: boolean;
 *   focusUri: string;
 * }>}
 */
export async function getImportSettings() {
  const raw = await chrome.storage.sync.get({
    useLocalHttpImport: true,
    localImportUrl: DEFAULT_LOCAL_IMPORT_URL,
    fallbackUriIfLocalhostFails: false,
    focusUri: "",
  });
  const localImportUrl =
    typeof raw.localImportUrl === "string" && raw.localImportUrl.trim() !== ""
      ? raw.localImportUrl.trim()
      : DEFAULT_LOCAL_IMPORT_URL;
  const focus =
    typeof raw.focusUri === "string" && raw.focusUri.trim() !== ""
      ? raw.focusUri.trim()
      : DEFAULT_FOCUS_URI;
  return {
    useLocalHttpImport: raw.useLocalHttpImport !== false,
    localImportUrl,
    fallbackUriIfLocalhostFails: raw.fallbackUriIfLocalhostFails === true,
    focusUri: focus,
  };
}

/**
 * Submit bridge pairing. The URL carries CP Helper's per-installation token, so it is the
 * secret that keeps other pages and local processes off the socket - treat it as one.
 * @returns {Promise<{ submitBridgeEnabled: boolean; submitBridgeUrl: string }>}
 */
export async function getSubmitSettings() {
  const raw = await chrome.storage.sync.get({
    submitBridgeEnabled: true,
    submitBridgeUrl: "",
  });
  const url =
    typeof raw.submitBridgeUrl === "string" ? raw.submitBridgeUrl.trim() : "";
  return {
    submitBridgeEnabled: raw.submitBridgeEnabled !== false,
    submitBridgeUrl: /^wss?:\/\//iu.test(url) ? url : "",
  };
}

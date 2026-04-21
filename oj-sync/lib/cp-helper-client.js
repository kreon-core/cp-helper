/**
 * Push JSON to CP Helper over HTTP; avoids opening vscode:// in a tab.
 * @param {string} json
 * @param {string} localImportUrl POST target (e.g. http://127.0.0.1:17337/import)
 * @returns {Promise<boolean>}
 */
export async function postSamplesToLocalTester(json, localImportUrl) {
  try {
    const r = await fetch(localImportUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: json,
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Open editor via vscode:// (e.g. focus CP Helper only).
 * @param {string} url
 */
export async function openEditorImportTab(url) {
  try {
    await chrome.tabs.create({ url, active: true });
  } catch {
    /* ignore */
  }
}

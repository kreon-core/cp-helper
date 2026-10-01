/**
 * Push JSON to OJ Runner over HTTP; avoids opening vscode:// in a tab.
 * @param localImportUrl POST target (e.g. http://127.0.0.1:17337/import)
 */
export async function postSamplesToLocalTester(
  json: string,
  localImportUrl: string,
): Promise<boolean> {
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
 * Open editor via vscode:// (e.g. focus OJ Runner only).
 */
export async function openEditorImportTab(url: string): Promise<void> {
  try {
    await chrome.tabs.create({ url, active: true });
  } catch {
    /* ignore */
  }
}

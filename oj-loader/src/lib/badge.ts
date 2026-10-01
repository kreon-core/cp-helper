export async function flashBadgeSuccess(
  tabId: number,
  text: string,
  clearMs = 2200,
): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a7f37" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, clearMs);
}

export async function flashBadgeError(
  tabId: number,
  text: string,
  clearMs = 2500,
): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, clearMs);
}

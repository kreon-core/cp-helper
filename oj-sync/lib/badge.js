/**
 * @param {number} tabId
 * @param {string} text
 * @param {number} clearMs
 */
export async function flashBadgeSuccess(tabId, text, clearMs = 2200) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a7f37" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, clearMs);
}

/**
 * @param {number} tabId
 * @param {string} text
 * @param {number} clearMs
 */
export async function flashBadgeError(tabId, text, clearMs = 2500) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, clearMs);
}

import { FLUSH_PORT, isGistDirty, syncWithGist } from "./lib/gist";
import { loadData, saveData } from "./lib/storage";

let queue: Promise<void> = Promise.resolve();

async function flush(): Promise<void> {
  const data = await loadData();
  if (!data.gist || !isGistDirty(data)) return;
  const patch = await syncWithGist(data.gist, loadData);
  if (patch) await saveData(patch);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== FLUSH_PORT) return;
  port.onDisconnect.addListener(() => {
    queue = queue.then(flush).catch((err: unknown) => console.error("Gist sync failed:", err));
  });
});

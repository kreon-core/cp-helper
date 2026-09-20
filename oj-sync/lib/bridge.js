/**
 * Submit bridge client: the socket CP Helper pushes submit jobs down.
 *
 * VS Code cannot reach an MV3 service worker on its own (no inbound socket), so the worker keeps
 * this WebSocket open to `127.0.0.1` instead. Chrome suspends an idle worker after ~30s but
 * WebSocket traffic resets that timer, which is what CP Helper's `ping` frames are for.
 */
import { getSubmitSettings } from "./settings.js";
import { runSubmitJob } from "./submit-runner.js";

/** @type {WebSocket | undefined} */
let socket;

/** Backoff between reconnects, in ms. */
let retryMs = 1000;
const RETRY_MAX_MS = 30000;

/**
 * Chrome logs `ERR_CONNECTION_REFUSED` from the network stack, below anything JS can catch, so an
 * endless retry loop floods the worker console whenever CP Helper is not running. After this many
 * failures in a row the client goes dormant and waits for a forced reconnect.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/** Dormancy outlives the service worker, so it lives in session storage rather than a module var. */
const DORMANT_KEY = "submitBridgeDormant";

let consecutiveFailures = 0;

/**
 * @returns {Promise<boolean>}
 */
async function isDormant() {
  try {
    const got = await chrome.storage.session.get(DORMANT_KEY);
    return got[DORMANT_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * @param {boolean} value
 */
function setDormant(value) {
  void chrome.storage.session.set({ [DORMANT_KEY]: value });
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let retryTimer;

/**
 * @param {Record<string, unknown>} obj
 */
function send(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

/**
 * @param {string} id
 * @param {string} stage
 * @param {string} [message]
 */
function reportProgress(id, stage, message) {
  send({ t: "progress", id, stage, message });
}

/**
 * @param {unknown} raw
 */
async function onJob(raw) {
  const job = /** @type {Record<string, any>} */ (raw);
  const id = String(job.id ?? "");
  if (id === "") return;
  try {
    const result = await runSubmitJob(job, (stage, message) =>
      reportProgress(id, stage, message),
    );
    send({ t: "result", id, ...result });
  } catch (e) {
    send({
      t: "result",
      id,
      submitted: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  consecutiveFailures += 1;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    setDormant(true);
    return;
  }
  retryTimer = setTimeout(() => {
    void connectBridge();
  }, retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

/**
 * Open the socket if it is not already open. Safe to call repeatedly - the keepalive alarm does.
 * @param {{ force?: boolean }} [opts] `force` wakes a dormant client; pass it for user-driven
 * actions (toolbar click, settings change, startup), not for the keepalive alarm.
 * @returns {Promise<void>}
 */
export async function connectBridge(opts) {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  if (opts?.force) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    consecutiveFailures = 0;
    retryMs = 1000;
    setDormant(false);
  } else if (await isDormant()) {
    return;
  }
  const s = await getSubmitSettings();
  if (!s.submitBridgeEnabled || s.submitBridgeUrl === "") {
    return;
  }
  let ws;
  try {
    ws = new WebSocket(s.submitBridgeUrl);
  } catch {
    scheduleRetry();
    return;
  }
  socket = ws;

  ws.addEventListener("open", () => {
    retryMs = 1000;
    consecutiveFailures = 0;
    setDormant(false);
    send({ t: "hello", version: chrome.runtime.getManifest().version });
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.t === "ping") {
      send({ t: "pong" });
      return;
    }
    if (msg.t === "job") {
      void onJob(msg);
    }
  });

  ws.addEventListener("close", () => {
    if (socket === ws) {
      socket = undefined;
    }
    scheduleRetry();
  });

  ws.addEventListener("error", () => {
    // `close` always follows, and carries the retry.
  });
}

/**
 * @returns {boolean}
 */
export function bridgeConnected() {
  return !!socket && socket.readyState === WebSocket.OPEN;
}

import * as http from "http";
import { randomBytes, timingSafeEqual } from "crypto";
import type { Duplex } from "stream";
import * as vscode from "vscode";
import { WebSocketServer, type WebSocket } from "ws";
import {
  SUBMIT_BRIDGE_PATH,
  SUBMIT_BRIDGE_PING_MS,
  SUBMIT_JOB_TIMEOUT_MS,
} from "./constants";
import { createCpLogger } from "./log";
import type { SubmitJudge } from "./submit-target";

const log = createCpLogger("submit");

/** Job the browser executes: fill the judge's own submit form in a logged-in tab. */
export interface SubmitJob {
  judge: SubmitJudge;
  contestId: string;
  problemId: string;
  submitUrl: string;
  statusUrl: string;
  /** Substring matched against the judge's language `<option>` text, case-insensitive. */
  language: string;
  source: string;
  /** How long the browser keeps polling the status page for a verdict. */
  pollTimeoutMs: number;
}

export interface SubmitProgress {
  stage: string;
  message?: string;
}

export interface SubmitOutcome {
  /** True once the judge accepted the submission (not the verdict). */
  submitted: boolean;
  /** Language option the judge's own form offered and the browser selected. */
  language?: string;
  /** Judge verdict text when polling saw one settle, e.g. `Accepted`, `Wrong answer on test 3`. */
  verdict?: string;
  /** True when `verdict` is a passing one. */
  accepted?: boolean;
  submissionId?: string;
  submissionUrl?: string;
  error?: string;
}

type ClientFrame =
  | { t: "hello"; version?: string }
  | { t: "pong" }
  | { t: "progress"; id: string; stage: string; message?: string }
  | ({ t: "result"; id: string } & SubmitOutcome);

interface PendingJob {
  resolve: (outcome: SubmitOutcome) => void;
  onProgress: (p: SubmitProgress) => void;
  timer: ReturnType<typeof setTimeout>;
}

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Loopback WebSocket endpoint OJ Sync connects to, so a Submit click in VS Code can reach the
 * browser session that is already logged in to the judge. VS Code is always the one that starts
 * a job: the browser only answers.
 *
 * WebSocket upgrades bypass CORS, so any page or local process could otherwise open this socket
 * and receive the source we push. Every connection has to present the token below.
 */
export class SubmitBridge {
  private readonly wss: WebSocketServer;

  private client: WebSocket | undefined;

  private clientVersion = "";

  private readonly pending = new Map<string, PendingJob>();

  private pingTimer: ReturnType<typeof setInterval> | undefined;

  private jobSeq = 0;

  private readonly onDidChangeConnection =
    new vscode.EventEmitter<boolean>();

  /** Fires with the new connection state whenever OJ Sync attaches or drops. */
  readonly onDidChangeConnectionState = this.onDidChangeConnection.event;

  constructor(private readonly token: string) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  get connected(): boolean {
    return this.client?.readyState === 1;
  }

  get peerVersion(): string {
    return this.clientVersion;
  }

  /**
   * Answer an HTTP upgrade on the local import server. Rejects anything that is not an
   * authenticated OJ Sync connection.
   */
  handleUpgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      return false;
    }
    if (url.pathname !== SUBMIT_BRIDGE_PATH) {
      return false;
    }
    const origin = req.headers.origin;
    if (typeof origin === "string" && !origin.startsWith("chrome-extension://")) {
      log.warn(`bridge upgrade rejected: unexpected origin ${origin}`);
      socket.destroy();
      return true;
    }
    if (!tokensMatch(url.searchParams.get("token") ?? "", this.token)) {
      log.warn("bridge upgrade rejected: bad or missing token");
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.adopt(ws));
    return true;
  }

  private adopt(ws: WebSocket): void {
    if (this.client) {
      // One browser at a time; the newest connection wins so a reloaded service worker
      // does not have to wait for the stale socket to time out.
      this.client.close(4000, "replaced");
    }
    this.client = ws;
    this.clientVersion = "";
    log.info("OJ Sync connected to the submit bridge");
    this.onDidChangeConnection.fire(true);

    ws.on("message", (raw) => this.onFrame(String(raw)));
    ws.on("close", () => {
      if (this.client !== ws) {
        return;
      }
      this.client = undefined;
      this.clientVersion = "";
      log.info("OJ Sync disconnected from the submit bridge");
      this.failPending("OJ Sync disconnected before the submit finished.");
      this.onDidChangeConnection.fire(false);
    });
    ws.on("error", (e) => log.warn(`bridge socket error: ${e.message}`));

    this.pingTimer ??= setInterval(() => {
      // Traffic on the socket is what keeps Chrome from suspending the service worker.
      this.send({ t: "ping" });
    }, SUBMIT_BRIDGE_PING_MS);
  }

  private onFrame(raw: string): void {
    let msg: ClientFrame;
    try {
      msg = JSON.parse(raw) as ClientFrame;
    } catch {
      log.warn("bridge frame ignored: not JSON");
      return;
    }
    switch (msg.t) {
      case "hello":
        this.clientVersion = typeof msg.version === "string" ? msg.version : "";
        this.onDidChangeConnection.fire(true);
        break;
      case "pong":
        break;
      case "progress": {
        const job = this.pending.get(msg.id);
        job?.onProgress({ stage: msg.stage, message: msg.message });
        break;
      }
      case "result": {
        const job = this.pending.get(msg.id);
        if (!job) {
          return;
        }
        clearTimeout(job.timer);
        this.pending.delete(msg.id);
        job.resolve({
          submitted: msg.submitted === true,
          language: msg.language,
          verdict: msg.verdict,
          accepted: msg.accepted,
          submissionId: msg.submissionId,
          submissionUrl: msg.submissionUrl,
          error: msg.error,
        });
        break;
      }
      default:
        break;
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (this.client?.readyState !== 1) {
      return;
    }
    this.client.send(JSON.stringify(obj));
  }

  private failPending(reason: string): void {
    for (const [, job] of this.pending) {
      clearTimeout(job.timer);
      job.resolve({ submitted: false, error: reason });
    }
    this.pending.clear();
  }

  /**
   * Hand one job to the browser and wait for its reply.
   * @param onProgress called for every stage the browser reports (tab, form, polling)
   */
  submit(
    job: SubmitJob,
    onProgress: (p: SubmitProgress) => void,
  ): Promise<SubmitOutcome> {
    if (!this.connected) {
      return Promise.resolve({
        submitted: false,
        error:
          "OJ Sync is not connected. Open the browser with OJ Sync installed and paired, then try again.",
      });
    }
    const id = `j${++this.jobSeq}`;
    return new Promise<SubmitOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          submitted: false,
          error:
            "OJ Sync did not answer in time. Check the browser - the submission may still have gone through.",
        });
      }, SUBMIT_JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve, onProgress, timer });
      this.send({ t: "job", id, ...job });
    });
  }

  dispose(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    this.failPending("CP Helper shut the submit bridge down.");
    this.client?.close(1001, "shutdown");
    this.client = undefined;
    this.wss.close();
    this.onDidChangeConnection.dispose();
  }
}

/**
 * Read the bridge token, creating it on first use. It is per-installation and never leaves
 * the machine: OJ Sync gets it once, from the user, through the pairing URL.
 */
export async function getOrCreateSubmitToken(
  store: vscode.Memento & { update(key: string, value: unknown): Thenable<void> },
  key: string,
): Promise<string> {
  const existing = store.get<string>(key);
  if (typeof existing === "string" && existing.length >= 32) {
    return existing;
  }
  const token = randomBytes(24).toString("base64url");
  await store.update(key, token);
  return token;
}

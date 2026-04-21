import {
  spawn,
  execFileSync,
  type ChildProcess,
} from "child_process";
import {
  MAX_STDOUT_ACCUMULATE_BYTES,
  MAX_STDERR_ACCUMULATE_BYTES,
} from "./constants";
import type { ActiveShellHandle, ShellRunOutcome } from "./types";

/**
 * Mutable run lifecycle (compile/run subprocess, Stop, Run-all cancel, overlap guard).
 */
export const runState = {
  activeShell: null as ActiveShellHandle | null,
  cancelRequested: false,
  runLocked: false,
};

/**
 * Direct child PIDs of ppid (POSIX `pgrep -P`). Empty if none or unsupported.
 * @param ppid parent pid
 */
function pgrepChildren(ppid: number): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(ppid)], {
      encoding: "utf8",
      maxBuffer: 512 * 1024,
    });
    return out
      .trim()
      .split(/\n/u)
      .filter(Boolean)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/**
 * All descendant PIDs plus root, post-order (leaves before parent) for safe SIGKILL.
 * @param rootPid Node's shell child pid
 */
function listUnixPidTreePostOrder(rootPid: number): number[] {
  const walk = (p: number): number[] => {
    const acc: number[] = [];
    for (const c of pgrepChildren(p)) {
      acc.push(...walk(c));
    }
    acc.push(p);
    return acc;
  };
  return walk(rootPid);
}

/**
 * With `shell: true`, Node's child is usually `sh`/`bash` — killing only that pid can leave the
 * real binary running. Kill descendants first (`pgrep -P`), then the shell; Windows uses `taskkill /T`.
 * Do not use `detached: true` here: it can let the shell close before the program exits, clearing
 * `activeShell` while the program is still running (Stop then reports no subprocess).
 * @param child direct child from spawn(..., { shell: true })
 */
export function forceKillShellChild(child: ChildProcess): void {
  const pid = child.pid;
  if (pid == null) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  for (const p of listUnixPidTreePostOrder(pid)) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      /* ESRCH */
    }
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* not a process-group leader */
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

/**
 * SIGKILL the active compile/run subprocess tree, if any.
 * @returns false only when there is no tracked shell child
 */
export function killActiveShell(): boolean {
  const h = runState.activeShell;
  if (!h) {
    return false;
  }
  h.markUserKill();
  forceKillShellChild(h.child);
  return true;
}

/**
 * Run a shell command; optional stdin.
 * @param command full shell string
 * @param cwd
 * @param stdin optional
 * @param timeoutMs
 */
export function runShell(
  command: string,
  cwd: string,
  stdin: string | undefined,
  timeoutMs: number,
): Promise<ShellRunOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let endReason: "normal" | "timeout" | "user" = "normal";
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    const markUserKill = () => {
      if (endReason === "normal") {
        endReason = "user";
      }
    };
    runState.activeShell = { child, markUserKill };

    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let stderrBytes = 0;
    child.stdout?.on("data", (c: Buffer) => {
      if (stdoutBytes < MAX_STDOUT_ACCUMULATE_BYTES) {
        stdout += c.toString("utf8");
        stdoutBytes += c.length;
      }
    });
    child.stderr?.on("data", (c: Buffer) => {
      if (stderrBytes < MAX_STDERR_ACCUMULATE_BYTES) {
        stderr += c.toString("utf8");
        stderrBytes += c.length;
      }
    });
    const timer = setTimeout(() => {
      if (endReason === "normal") {
        endReason = "timeout";
      }
      forceKillShellChild(child);
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (runState.activeShell?.child === child) {
        runState.activeShell = null;
      }
      resolve({
        stdout,
        stderr,
        code,
        timedOut: endReason === "timeout",
        cancelled: endReason === "user",
      });
    };

    child.on("close", (code) => {
      finish(code);
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (runState.activeShell?.child === child) {
        runState.activeShell = null;
      }
      resolve({
        stdout,
        stderr: String(err),
        code: null,
        timedOut: false,
        cancelled: false,
      });
    });
    if (stdin !== undefined) {
      child.stdin?.write(stdin, "utf8");
    }
    child.stdin?.end();
  });
}

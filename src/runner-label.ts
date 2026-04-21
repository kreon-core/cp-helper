import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { RUNNER_LABEL_MAX } from "./constants";
import {
  expand,
  extractStdFlag,
  firstShellToken,
} from "./compile-expansion";

const execFileAsync = promisify(execFile);

/** Dropped when a newer runner probe starts (editor/config changed). */
let runnerProbeGeneration = 0;

/**
 * @param exe
 */
function exeDisplayBase(exe: string): string {
  const u = exe.replace(/\\/g, "/");
  return path.basename(u).replace(/\.exe$/iu, "");
}

/**
 * Run a short version probe (stdout + stderr). Used only for UI label, not on the hot run path.
 * @param file executable name or path
 * @param args
 * @param cwd
 */
async function execVersionProbe(
  file: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const r = await execFileAsync(file, args, {
      cwd,
      timeout: 3500,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      encoding: "utf8",
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Version string for GCC/G++-like compilers via `-dumpfullversion`.
 * @param exe
 * @param cwd
 */
async function probeGccLikeVersion(
  exe: string,
  cwd: string,
): Promise<string | null> {
  const raw = await execVersionProbe(exe, ["-dumpfullversion"], cwd);
  if (!raw) {
    return null;
  }
  const first = raw.split(/\s+/u)[0] ?? "";
  const parts = first.split(".").filter(Boolean);
  const maj = parts[0] ?? "";
  const min = parts[1] ?? "";
  if (!maj) {
    return null;
  }
  return min ? `${maj}.${min}` : maj;
}

/**
 * Version string for Clang via `--version` first line.
 * @param exe
 * @param cwd
 */
async function probeClangVersion(
  exe: string,
  cwd: string,
): Promise<string | null> {
  const raw = await execVersionProbe(exe, ["--version"], cwd);
  if (!raw) {
    return null;
  }
  const line = raw.split("\n")[0] ?? "";
  const m = /version\s+([\d.]+)/iu.exec(line);
  return m?.[1] ?? null;
}

/**
 * Human-readable label for `compileCommand`’s first executable.
 * @param exe
 * @param cwd
 */
async function probeCompileExecutable(
  exe: string,
  cwd: string,
): Promise<string | null> {
  const base = exeDisplayBase(exe).toLowerCase();
  const gccLike =
    /^(g\+\+|gcc|c\+\+)$/u.test(base) ||
    base.endsWith("g++") ||
    base.endsWith("-gcc") ||
    base.endsWith("gcc");
  if (gccLike) {
    const v = await probeGccLikeVersion(exe, cwd);
    if (v) {
      return `${exeDisplayBase(exe)} ${v}`;
    }
  }
  if (base.includes("clang")) {
    const v = await probeClangVersion(exe, cwd);
    if (v) {
      return `${exeDisplayBase(exe)} ${v}`;
    }
  }
  return null;
}

/**
 * Effective cwd for compile/run (matches `createRunSession` when `file` is the active source).
 * @param filePath absolute source path or null
 */
export function getEffectiveCwdForRunner(filePath: string | null): string {
  const cfg = vscode.workspace.getConfiguration("cp-helper");
  const wdSetting = (cfg.get<string>("workingDirectory") ?? "").trim();
  if (wdSetting.length > 0) {
    return wdSetting;
  }
  if (filePath) {
    return path.dirname(filePath);
  }
  const wf = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return wf ?? os.tmpdir();
}

/**
 * Short line for the webview: C++ compiler (when compileCommand set) or run target label.
 * @param cwd working directory for probes
 */
async function resolveRunnerLabel(cwd: string): Promise<string> {
  const cfg = vscode.workspace.getConfiguration("cp-helper");
  const compileCmd = (cfg.get<string>("compileCommand") ?? "").trim();
  const runCmdTpl = cfg.get<string>("runCommand") ?? '"{{out}}"';
  const stdHint = compileCmd.length > 0 ? extractStdFlag(compileCmd) : null;

  if (compileCmd.length > 0) {
    const tok = firstShellToken(compileCmd);
    if (!tok) {
      return stdHint ? `compile · ${stdHint}` : "compile";
    }
    const probed = await probeCompileExecutable(tok, cwd);
    const base = probed ?? exeDisplayBase(tok);
    if (stdHint && !base.includes(stdHint)) {
      return `${base} · ${stdHint}`;
    }
    return base;
  }

  const dummyFile = path.join(cwd, "__cp_helper__.cpp");
  const dummyOut = path.join(os.tmpdir(), "__cp_helper_probe_out__");
  const expanded = expand(runCmdTpl, dummyFile, dummyOut);
  const tok = firstShellToken(expanded);
  if (!tok) {
    return "run";
  }
  const unquoted = tok.replace(/^["']|["']$/gu, "");
  const normOut = dummyOut.replace(/\\/g, "/");
  const normTok = unquoted.replace(/\\/g, "/");
  const probeMark = "__cp_helper_probe_out__";
  if (
    normTok === normOut ||
    normTok.toLowerCase().includes(probeMark.toLowerCase())
  ) {
    return "binary (compiled output)";
  }
  return exeDisplayBase(unquoted);
}

/**
 * Truncate for narrow sidebar.
 * @param s
 * @param max
 */
function truncateRunnerLabel(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Posts `runner` message after async probe; ignores stale results if a newer probe started.
 * @param webview
 * @param filePath active source path or null (for cwd fallback)
 */
export async function postRunnerLabel(
  webview: vscode.Webview,
  filePath: string | null,
): Promise<void> {
  const gen = ++runnerProbeGeneration;
  const cwd = getEffectiveCwdForRunner(filePath);
  try {
    const raw = await resolveRunnerLabel(cwd);
    if (gen !== runnerProbeGeneration) {
      return;
    }
    const label = truncateRunnerLabel(raw, RUNNER_LABEL_MAX);
    webview.postMessage({ type: "runner", label });
  } catch {
    if (gen !== runnerProbeGeneration) {
      return;
    }
    webview.postMessage({ type: "runner", label: "" });
  }
}

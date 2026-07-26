import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export type CpLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Width of the level column so messages line up. */
const LEVEL_WIDTH = 5;
/** Width of the scope column so messages line up. */
const SCOPE_WIDTH = 8;
/** Indent used by `detail` lines under a parent record. */
const DETAIL_INDENT = "    ";

/**
 * @param ch channel created in `activate`; required before any logging runs.
 */
export function setCpHelperOutputChannel(ch: vscode.OutputChannel | undefined): void {
  outputChannel = ch;
}

export function getCpHelperOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

/**
 * @returns `YYYY-MM-DD HH:MM:SS.mmm` local time
 */
export function cpTimeStamp(): string {
  const d = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

/**
 * Writes one record: `<timestamp> <LEVEL> [<scope>] <message>`.
 * @param level
 * @param scope subsystem the record comes from
 * @param message single line; newlines are split into separate records
 */
function write(level: CpLogLevel, scope: string, message: string): void {
  if (!outputChannel) return;
  const head =
    `${cpTimeStamp()} ${level.padEnd(LEVEL_WIDTH)} ` +
    `[${scope}]${" ".repeat(Math.max(1, SCOPE_WIDTH - scope.length))}`;
  for (const line of message.split("\n")) {
    outputChannel.appendLine(`${head}${line}`);
  }
}

export interface CpLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Continuation line indented under the record above it. */
  detail(message: string, level?: CpLogLevel): void;
}

/**
 * @param scope subsystem name shown in the scope column (keep it short)
 */
export function createCpLogger(scope: string): CpLogger {
  return {
    debug: (m) => write("DEBUG", scope, m),
    info: (m) => write("INFO", scope, m),
    warn: (m) => write("WARN", scope, m),
    error: (m) => write("ERROR", scope, m),
    detail: (m, level = "INFO") => write(level, scope, `${DETAIL_INDENT}${m}`),
  };
}

/**
 * @param s
 * @param max
 */
export function truncateForLog(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

/**
 * Opens Output -> CP Helper without stealing focus (when setting enabled).
 */
export function maybeShowOutputOnRun(): void {
  const on =
    vscode.workspace
      .getConfiguration("cp-helper")
      .get<boolean>("showOutputOnRun") ?? false;
  if (on) {
    outputChannel?.show(true);
  }
}

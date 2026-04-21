import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

/**
 * @param ch channel created in `activate`; required before `cpLog` runs.
 */
export function setCpHelperOutputChannel(ch: vscode.OutputChannel | undefined): void {
  outputChannel = ch;
}

export function getCpHelperOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

/**
 * @param line
 */
export function cpLog(line: string): void {
  outputChannel?.appendLine(`[${cpTimeStamp()}] ${line}`);
}

/**
 * @returns HH:MM:SS local
 */
export function cpTimeStamp(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * @param s
 * @param max
 */
export function truncateForLog(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Opens Output → CP Helper without stealing focus (when setting enabled).
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

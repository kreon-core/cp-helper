import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CPP_EXTENSIONS_HINT } from "./constants";
import { isCppSourcePath } from "./cpp-source";
import { postRunnerLabel } from "./runner-label";

function sameFsPath(a: string, b: string): boolean {
  const x = path.normalize(a);
  const y = path.normalize(b);
  if (process.platform === "win32") {
    return x.toLowerCase() === y.toLowerCase();
  }
  return x === y;
}

/**
 * Save every dirty workspace buffer for this path so compile reads current code from disk.
 * @returns error if the user cancels a save dialog
 */
export async function ensureSourceSavedBeforeRun(
  file: string,
): Promise<{ ok: true } | { error: string }> {
  const docs = vscode.workspace.textDocuments.filter(
    (d) =>
      d.uri.scheme === "file" && sameFsPath(d.uri.fsPath, file) && d.isDirty,
  );
  for (const d of docs) {
    const saved = await d.save();
    if (!saved) {
      return {
        error:
          "Save was cancelled. CP Helper compiles the file on disk - save the source, then run again.",
      };
    }
  }
  return { ok: true };
}

/**
 * Last C++ editor the user was in. A terminal, a settings tab or a testcase file is not a target,
 * so the run target sticks to this until another C++ editor becomes active.
 */
let stickyCppFile: string | null = null;

/**
 * The C++ file a Run targets: the active editor when it is C++, otherwise the last C++ editor the
 * user visited (dropped once it no longer exists on disk).
 */
function runTargetPath(): string | null {
  const u = vscode.window.activeTextEditor?.document.uri;
  const active = u?.scheme === "file" && u.fsPath ? u.fsPath : null;
  if (active !== null && isCppSourcePath(active)) {
    stickyCppFile = active;
    return active;
  }
  if (stickyCppFile !== null && !fs.existsSync(stickyCppFile)) {
    stickyCppFile = null;
  }
  return stickyCppFile;
}

/**
 * File path for a new Run: read once when the user clicks Run.
 * Compile/run use the captured string passed into `runSingleTest` / `runAllTestsSharedCompile`, not a live editor lookup.
 * @returns file path or user-facing error
 */
export function getActiveSourceFilePath():
  | { file: string }
  | { error: string } {
  const file = runTargetPath();
  if (file === null) {
    return {
      error: `CP Helper runs C++ only. Open a ${CPP_EXTENSIONS_HINT} file and run again.`,
    };
  }
  return { file };
}

/**
 * Webview label: the file a Run would target right now.
 * @param webview
 */
export function postActiveSourceHint(webview: vscode.Webview): void {
  const p = runTargetPath();
  webview.postMessage({
    type: "sourceFile",
    path: p,
    running: false,
    cpp: p !== null,
  });
  void postRunnerLabel(webview, p);
}

/**
 * Pin webview label to the file path snapshotted for an in-flight run (tab switches do not change the run).
 * @param webview
 * @param file absolute path
 */
export function postRunSourceSnapshot(
  webview: vscode.Webview,
  file: string,
): void {
  webview.postMessage({
    type: "sourceFile",
    path: file,
    running: true,
    cpp: true,
  });
}

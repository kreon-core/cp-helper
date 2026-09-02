import * as vscode from "vscode";
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
 * File path for a new Run: read once from the active editor when the user clicks Run.
 * Compile/run use the captured string passed into `runSingleTest` / `runAllTestsSharedCompile`, not a live editor lookup.
 * @returns file path or user-facing error
 */
export function getActiveSourceFilePath():
  | { file: string }
  | { error: string } {
  const ed = vscode.window.activeTextEditor;
  const u = ed?.document.uri;
  if (u?.scheme !== "file" || !u.fsPath) {
    return { error: "No active editor with a file path." };
  }
  if (!isCppSourcePath(u.fsPath)) {
    return {
      error: `CP Helper runs C++ only. Open a ${CPP_EXTENSIONS_HINT} file and run again.`,
    };
  }
  return { file: u.fsPath };
}

/**
 * Active editor path regardless of language, so the webview can name the file it is refusing.
 */
function activeEditorPath(): string | null {
  const u = vscode.window.activeTextEditor?.document.uri;
  return u?.scheme === "file" && u.fsPath ? u.fsPath : null;
}

/**
 * Webview label: current active editor (when not running).
 * @param webview
 */
export function postActiveSourceHint(webview: vscode.Webview): void {
  const p = activeEditorPath();
  const cpp = p !== null && isCppSourcePath(p);
  webview.postMessage({
    type: "sourceFile",
    path: p,
    running: false,
    cpp,
  });
  void postRunnerLabel(webview, cpp ? p : null);
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

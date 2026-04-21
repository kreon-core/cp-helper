import * as vscode from "vscode";
import {
  ERR_IMPORT_EMPTY,
  importSamplesFromJsonText,
  type SamplesWebviewSink,
} from "./import-samples";

/**
 * User-facing follow-up when JSON parse/persist fails.
 */
export function reportImportFailure(
  e: unknown,
  emptyContentMessage: string,
): void {
  const message = e instanceof Error ? e.message : String(e);
  if (message === ERR_IMPORT_EMPTY) {
    void vscode.window.showWarningMessage(emptyContentMessage);
    return;
  }
  void vscode.window.showErrorMessage(
    `CP Helper: invalid samples JSON — ${message}`,
  );
}

/**
 * @returns clipboard text, or `null` if read failed (error toast already shown).
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await vscode.env.clipboard.readText();
  } catch {
    void vscode.window.showErrorMessage(
      "CP Helper: could not read the clipboard.",
    );
    return null;
  }
}

/**
 * Read clipboard, import, reveal Samples. Used by URI handler and palette command.
 */
export async function importFromClipboardAndReveal(
  ctx: vscode.ExtensionContext,
  sink: SamplesWebviewSink,
  reveal: () => Promise<void>,
  emptyContentMessage: string,
): Promise<void> {
  const clip = await readClipboardText();
  if (clip === null) {
    return;
  }
  try {
    await importSamplesFromJsonText(ctx, sink, clip);
    await reveal();
  } catch (e) {
    reportImportFailure(e, emptyContentMessage);
  }
}

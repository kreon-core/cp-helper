import * as vscode from "vscode";
import {
  ERR_IMPORT_EMPTY,
  importSamplesFromJsonText,
  type SamplesWebviewSink,
} from "./import-samples";
import { createCpLogger } from "./log";
import { notify } from "./notify";

const log = createCpLogger("import");

/**
 * User-facing follow-up when JSON parse/persist fails.
 */
export function reportImportFailure(
  e: unknown,
  emptyContentMessage: string,
): void {
  const message = e instanceof Error ? e.message : String(e);
  if (message === ERR_IMPORT_EMPTY) {
    log.warn(emptyContentMessage);
    notify("warn", emptyContentMessage);
    return;
  }
  log.error(`invalid samples JSON: ${message}`);
  notify("error", `Invalid samples JSON - ${message}`);
}

/**
 * @returns clipboard text, or `null` if read failed (error toast already shown).
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await vscode.env.clipboard.readText();
  } catch {
    log.error("could not read the clipboard");
    notify("error", "Could not read the clipboard.");
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

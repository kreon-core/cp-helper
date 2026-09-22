/**
 * Every CP Helper notification that nothing waits on goes through here, so one setting decides
 * whether they pile up on screen. Messages that ask the user something are not routed through it:
 * a question has to stay until it is answered.
 */
import * as vscode from "vscode";
import { NOTIFY_TOAST_MS } from "./constants";

/**
 * Longest a notification may be. Anything past this is a detail the judge, VS Code or the compiler
 * appended, and the untrimmed text is in the output log a line earlier.
 */
const MAX_LENGTH = 110;

/** Level a message would be shown at when notifications are left sticky. */
export type NotifyLevel = "error" | "warn" | "info";

/** Setting a notification takes its mode from. */
export type NotifyChannel = "notifications" | "submitNotifications";

export type NotifyMode = "auto" | "sticky" | "off";

/**
 * @returns `text` as one line, cut on a word boundary when it runs long
 */
function condense(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  if (line.length <= MAX_LENGTH) {
    return line;
  }
  const cut = line.slice(0, MAX_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_LENGTH / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:-]+$/u, "")}...`;
}

function modeOf(channel: NotifyChannel): NotifyMode {
  const raw = vscode.workspace
    .getConfiguration("cp-helper")
    .get<string>(channel);
  return raw === "sticky" || raw === "off" ? raw : "auto";
}

/**
 * A notification raised the plain way is VS Code's to drop, on a timer that only runs while the
 * window has focus - so one raised while the judge is in front sits there until VS Code is looked
 * at again, and nothing can close it early. A progress notification instead lives exactly as long
 * as the task behind it, which is the only handle an extension gets on the lifetime of a toast.
 * The handle costs the rest: VS Code's own timer is what reschedules itself while the pointer is
 * over a notification, so one this closes cannot be held open by hovering it, and it is gone from
 * the notification centre with it.
 */
function timedToast(text: string, ms: number): void {
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: text },
    () => new Promise<void>((done) => setTimeout(done, ms)),
  );
}

/**
 * `auto` closes a message with nothing wrong in it after `NOTIFY_TOAST_MS`, and hands a warning or
 * an error to VS Code at information severity: only VS Code's own timer holds a notification open
 * while the pointer is over it and files it in the notification centre afterwards, and information
 * is the shortest that timer goes - 10s, against 12s for a warning and 15s for an error. `sticky`
 * spends those extra seconds on the level's own colour; `off` leaves the message to the log.
 */
export function notify(
  level: NotifyLevel,
  message: string,
  channel: NotifyChannel = "notifications",
): void {
  const mode = modeOf(channel);
  if (mode === "off") {
    return;
  }
  const text = condense(message);
  if (mode === "auto") {
    if (level === "info") {
      timedToast(text, NOTIFY_TOAST_MS);
    } else {
      void vscode.window.showInformationMessage(text);
    }
    return;
  }
  if (level === "error") {
    void vscode.window.showErrorMessage(text);
  } else if (level === "warn") {
    void vscode.window.showWarningMessage(text);
  } else {
    void vscode.window.showInformationMessage(text);
  }
}

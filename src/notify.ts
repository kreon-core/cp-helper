/**
 * Every CP Helper notification that nothing waits on goes through here, so one setting decides
 * whether they pile up on screen. Messages that ask the user something are not routed through it:
 * a question has to stay until it is answered.
 */
import * as vscode from "vscode";

/** Level a message would be shown at when notifications are left sticky. */
export type NotifyLevel = "error" | "warn" | "info";

/** Setting a notification takes its mode from. */
export type NotifyChannel = "notifications" | "submitNotifications";

export type NotifyMode = "auto" | "sticky" | "off";

function modeOf(channel: NotifyChannel): NotifyMode {
  const raw = vscode.workspace
    .getConfiguration("cp-helper")
    .get<string>(channel);
  return raw === "sticky" || raw === "off" ? raw : "auto";
}

/**
 * VS Code dismisses an information toast by itself but keeps a warning or an error until it is
 * clicked away, and no API asks it to do otherwise - so `auto` says everything at information
 * level, `sticky` keeps `level`, and `off` leaves the message to the output log.
 */
export function notify(
  level: NotifyLevel,
  text: string,
  channel: NotifyChannel = "notifications",
): void {
  const mode = modeOf(channel);
  if (mode === "off") {
    return;
  }
  if (mode === "auto" || level === "info") {
    void vscode.window.showInformationMessage(text);
  } else if (level === "error") {
    void vscode.window.showErrorMessage(text);
  } else {
    void vscode.window.showWarningMessage(text);
  }
}

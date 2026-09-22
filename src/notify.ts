/**
 * Every CP Helper notification that nothing waits on goes through here, so one setting decides
 * whether they pile up on screen. Messages that ask the user something are not routed through it:
 * a question has to stay until it is answered.
 */
import * as vscode from "vscode";
import {
  NOTIFY_STATUS_BAR_MS,
  NOTIFY_STATUS_BAR_PROBLEM_MS,
} from "./constants";

/** Level a message would be shown at when notifications are left sticky. */
export type NotifyLevel = "error" | "warn" | "info";

/** Setting a notification takes its mode from. */
export type NotifyChannel = "notifications" | "submitNotifications";

export type NotifyMode = "auto" | "status" | "sticky" | "off";

/** Status bar icon per level, since the status bar carries no severity of its own. */
const STATUS_ICON: Record<NotifyLevel, string> = {
  error: "$(error)",
  warn: "$(warning)",
  info: "$(info)",
};

function modeOf(channel: NotifyChannel): NotifyMode {
  const raw = vscode.workspace
    .getConfiguration("cp-helper")
    .get<string>(channel);
  return raw === "status" || raw === "sticky" || raw === "off" ? raw : "auto";
}

/**
 * A toast is dropped on a timer VS Code owns - 10s for information, 12s for a warning, 15s for an
 * error - and that timer only runs while the window has focus, so one raised while the judge is in
 * front stays until VS Code is looked at again. `auto` therefore picks the shortest of the three,
 * `status` sidesteps the toast for a status bar message on a timer of our own, `sticky`
 * keeps `level`, and `off` leaves the message to the output log.
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
  if (mode === "status") {
    vscode.window.setStatusBarMessage(
      `${STATUS_ICON[level]} ${text}`,
      level === "info" ? NOTIFY_STATUS_BAR_MS : NOTIFY_STATUS_BAR_PROBLEM_MS,
    );
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

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  DEFAULT_SUBMIT_POLL_TIMEOUT_MS,
  SUBMIT_MAX_SOURCE_BYTES,
} from "./constants";
import { createCpLogger } from "./log";
import { ensureSourceSavedBeforeRun } from "./source-hints";
import { resolveSubmitTarget, type SubmitJudge } from "./submit-target";
import type { SubmitBridge, SubmitOutcome, SubmitProgress } from "./submit-bridge";
import type { CaseGroup } from "./types";

const log = createCpLogger("submit");

/** Language `<option>` substring per judge, used when the setting is blank. */
const DEFAULT_LANGUAGE: Record<SubmitJudge, string> = {
  codeforces: "GNU G++23",
  atcoder: "C++23 (GCC",
};

function languageFor(judge: SubmitJudge): string {
  const key =
    judge === "codeforces" ? "submitLanguageCodeforces" : "submitLanguageAtCoder";
  const raw = vscode.workspace
    .getConfiguration("cp-helper")
    .get<string>(key);
  const trimmed = (raw ?? "").trim();
  return trimmed !== "" ? trimmed : DEFAULT_LANGUAGE[judge];
}

function pollTimeoutMs(): number {
  const raw = vscode.workspace
    .getConfiguration("cp-helper")
    .get<number>("submitPollTimeoutMs");
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : DEFAULT_SUBMIT_POLL_TIMEOUT_MS;
}

export interface SubmitRequestResult extends SubmitOutcome {
  /** Set when the request never reached the browser (no target, unsaved file, user cancelled). */
  rejected?: string;
  /** True when the user dismissed the confirmation. */
  cancelled?: boolean;
  /** Target title, e.g. `Codeforces 2204G`, once one was resolved. */
  title?: string;
}

/**
 * Resolve the problem, confirm with the user, and hand the file linked to that problem to OJ Sync.
 * The editor in front does not decide what is sent: a problem submits the file its last Run bound
 * to it, so submitting from a header never uploads another problem's source.
 * @param group the case group whose Submit button was pressed
 * @param onProgress stage updates from the browser, for the Samples view
 */
export async function submitGroupSource(
  bridge: SubmitBridge,
  group: CaseGroup | undefined,
  onProgress: (p: SubmitProgress) => void,
): Promise<SubmitRequestResult> {
  const target = resolveSubmitTarget(group?.label, group?.url);
  if (!target) {
    const label = (group?.label ?? "").trim();
    return {
      submitted: false,
      rejected: label
        ? `Cannot submit "${label}": only Codeforces and AtCoder problems imported by OJ Sync carry a submit target.`
        : "Cannot submit: this group has no imported problem. Import it with OJ Sync first.",
    };
  }
  if (!bridge.connected) {
    return {
      submitted: false,
      title: target.title,
      rejected:
        "OJ Sync is not connected. Run \"CP Helper: Copy Submit Bridge URL\" and paste it into the OJ Sync options page.",
    };
  }

  const file = (group?.source ?? "").trim();
  if (file === "") {
    return {
      submitted: false,
      title: target.title,
      rejected: `${target.title} is not linked to a file - press Run in its header to link the file in the editor.`,
    };
  }
  if (!fs.existsSync(file)) {
    return {
      submitted: false,
      title: target.title,
      rejected: `${path.basename(file)} is linked to ${target.title} but no longer exists - press Run in its header to link the file in the editor.`,
    };
  }
  const saved = await ensureSourceSavedBeforeRun(file);
  if ("error" in saved) {
    return { submitted: false, title: target.title, rejected: saved.error };
  }

  let source: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
    if (bytes.byteLength > SUBMIT_MAX_SOURCE_BYTES) {
      return {
        submitted: false,
        title: target.title,
        rejected: `Source is ${bytes.byteLength} bytes, over the ${SUBMIT_MAX_SOURCE_BYTES} byte submit limit.`,
      };
    }
    source = Buffer.from(bytes).toString("utf8");
  } catch (e) {
    return {
      submitted: false,
      title: target.title,
      rejected: `Could not read ${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (source.trim() === "") {
    return {
      submitted: false,
      title: target.title,
      rejected: `${path.basename(file)} is empty.`,
    };
  }

  const language = languageFor(target.judge);
  const confirm =
    vscode.workspace
      .getConfiguration("cp-helper")
      .get<boolean>("submitConfirm") !== false;
  if (confirm) {
    const choice = await vscode.window.showWarningMessage(
      `Submit ${path.basename(file)} to ${target.title}?`,
      { modal: true, detail: `Language: ${language}\nThis is a real submission on your account.` },
      "Submit",
    );
    if (choice !== "Submit") {
      return { submitted: false, title: target.title, cancelled: true };
    }
  }

  log.info(`submitting ${path.basename(file)} to ${target.title} as "${language}"`);
  const outcome = await bridge.submit(
    {
      judge: target.judge,
      contestId: target.contestId,
      problemId: target.problemId,
      submitUrl: target.submitUrl,
      statusUrl: target.statusUrl,
      language,
      source,
      pollTimeoutMs: pollTimeoutMs(),
    },
    onProgress,
  );
  if (outcome.language && outcome.language !== language) {
    log.info(`${target.title}: judge language selected as "${outcome.language}"`);
  }
  if (outcome.error) {
    log.error(`submit to ${target.title} failed: ${outcome.error}`);
  } else if (outcome.verdict) {
    log.info(`${target.title}: ${outcome.verdict}`);
  } else if (outcome.submitted) {
    log.info(`${target.title}: submitted, verdict not seen yet`);
  }
  return { ...outcome, title: target.title };
}

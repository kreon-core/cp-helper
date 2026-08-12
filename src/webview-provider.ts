import * as vscode from "vscode";
import {
  CONTEXT_SAMPLES_FOCUS,
  RUN_TAKEOVER_POLL_MS,
  RUN_TAKEOVER_TIMEOUT_MS,
  VIEW_TYPE_SAMPLES,
  WORKSPACE_KEY_DEFINE_LOCAL,
  WORKSPACE_KEY_IMPORT_PROBLEM,
} from "./constants";
import {
  loadCaseGroups,
  loadCaseGroupsFromFile,
  normalizeCaseGroups,
  persistCaseGroups,
  persistCaseGroupsToFile,
} from "./case-groups";
import { createCpLogger, maybeShowOutputOnRun } from "./log";
import {
  importSamplesFromJsonText,
  type SamplesWebviewSink,
} from "./import-samples";
import { killActiveShell, runState } from "./run-state";
import { runAllTestsSharedCompile, runSingleTest } from "./run-tests";
import { postRunnerLabel } from "./runner-label";
import {
  ensureSourceSavedBeforeRun,
  getActiveSourceFilePath,
  postActiveSourceHint,
  postOptions,
  postRunSourceSnapshot,
} from "./source-hints";
import type { CaseGroup, TestCase } from "./types";
import { buildSamplesWebviewHtml, getNonce } from "./webview-html";

const log = createCpLogger("webview");

function validateTestCase(v: unknown): TestCase {
  const o = v as Record<string, unknown> | null | undefined;
  return {
    sample: typeof o?.sample === "number" ? o.sample : 0,
    input: typeof o?.input === "string" ? o.input : "",
    output: typeof o?.output === "string" ? o.output : "",
  };
}

export class CpHelperViewProvider
  implements vscode.WebviewViewProvider, SamplesWebviewSink
{
  public static readonly viewType = VIEW_TYPE_SAMPLES;

  private webviewView: vscode.WebviewView | undefined;

  /**
   * Bumped by every Run click. A run whose token is stale has been superseded and must stay
   * silent: its late `runResult` / `runState(false)` / `runAllDone` messages would otherwise
   * clobber the UI of the run that replaced it.
   */
  private runSeq = 0;

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly ctx: vscode.ExtensionContext,
  ) {}

  /**
   * Stop the in-flight run, if any, so a new Run click can take over.
   * Waits for the previous handler to release the run lock, which happens after its `finally`
   * has run - so the superseded run cannot interleave with the new one.
   * @returns false if the previous run did not release the lock in time (new run should abort)
   */
  private async stopActiveRunForTakeover(): Promise<boolean> {
    if (!runState.runLocked) {
      return true;
    }
    runState.cancelRequested = true;
    const killed = killActiveShell();
    log.info(
      killed
        ? "run restarted: previous subprocess tree killed"
        : "run restarted: waiting for previous run to finish",
    );
    const deadline = Date.now() + RUN_TAKEOVER_TIMEOUT_MS;
    while (runState.runLocked) {
      if (Date.now() > deadline) {
        log.error(
          "run restart failed: previous run did not stop in time - try Stop, then Run",
        );
        return false;
      }
      await new Promise((r) => setTimeout(r, RUN_TAKEOVER_POLL_MS));
    }
    return true;
  }

  /**
   * Reveal the Samples webview and move keyboard focus into it (for shortcuts).
   */
  focusSamplesView(): void {
    const v = this.webviewView;
    if (!v) {
      return;
    }
    v.show(false);
    setTimeout(() => {
      void v.webview.postMessage({ type: "syncFocusContext" });
    }, 50);
  }

  /**
   * If Samples is not visible, reveal CP Helper on the secondary sidebar **without moving
   * keyboard focus** when possible (`show(true)`). After a cold open (`workbench.view.extension...`),
   * focus may jump once; we then re-activate the text editor that was active before reveal.
   *
   * @returns `true` if the view was hidden and we opened/showed it - caller should wait briefly
   * before `postMessage` so the webview can attach (see extension shortcut handlers).
   */
  async revealSamplesViewIfHidden(): Promise<boolean> {
    if (this.webviewView?.visible) {
      return false;
    }

    const priorEditor = vscode.window.activeTextEditor;

    const restorePriorEditor = async (): Promise<void> => {
      if (!priorEditor || priorEditor.document.isClosed) {
        return;
      }
      try {
        await vscode.window.showTextDocument(priorEditor.document, {
          viewColumn: priorEditor.viewColumn,
          selection: priorEditor.selection,
          preserveFocus: false,
        });
      } catch {
        /* column closed or document unavailable */
      }
    };

    if (this.webviewView) {
      this.webviewView.show(true);
      await restorePriorEditor();
      return true;
    }

    await vscode.commands.executeCommand(
      "workbench.view.extension.cp-helper",
    );
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      // `resolveWebviewView` assigns this field asynchronously; TS cannot see that after the
      // early `if (this.webviewView) return` branch.
      const v = this.webviewView as vscode.WebviewView | undefined;
      if (v?.webview) {
        v.show(true);
        await restorePriorEditor();
        return true;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

  /**
   * Deliver a shortcut / palette action to the webview (host -> webview).
   * @param msg
   */
  postToWebview(msg: unknown): void {
    void this.webviewView?.webview.postMessage(msg);
  }

  /**
   * Push case groups into the Samples list (IMPORT textarea unchanged - for manual paste + Load only).
   */
  applyGroupsToWebview(
    groups: CaseGroup[],
    importProblem?: string | null,
  ): void {
    const wv = this.webviewView?.webview;
    if (!wv) {
      return;
    }
    const msg: {
      type: "cases";
      groups: CaseGroup[];
      importProblem?: string | null;
    } = { type: "cases", groups };
    if (importProblem !== undefined) {
      msg.importProblem = importProblem;
    }
    wv.postMessage(msg);
  }

  /**
   * Add a stress-test failing case to the first group and update the webview.
   * @param input test input that triggered the bug
   * @param expected expected output (from reference, or empty if only RE/TLE)
   */
  async injectStressCase(input: string, expected: string): Promise<void> {
    const ws = this.ctx.workspaceState;
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const groups = wsFolder
      ? await loadCaseGroupsFromFile(ws, wsFolder)
      : loadCaseGroups(ws);
    const firstGroup = groups[0] ?? { id: "0", label: "", cases: [] };
    const nextSample =
      firstGroup.cases.reduce((m, c) => Math.max(m, c.sample), 0) + 1;
    firstGroup.cases.push({ sample: nextSample, input, output: expected });
    if (groups.length === 0) {
      groups.push(firstGroup);
    } else {
      groups[0] = firstGroup;
    }
    const norm = normalizeCaseGroups(groups);
    await persistCaseGroups(ws, norm);
    if (wsFolder) {
      void persistCaseGroupsToFile(norm, wsFolder).catch(() => undefined);
    }
    this.applyGroupsToWebview(norm);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extUri, "public")],
    };
    const nonce = getNonce();
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "public", "cp-helper-view.js"),
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extUri, "public", "cp-helper-view.css"),
    );
    webviewView.webview.html = buildSamplesWebviewHtml(
      webviewView.webview,
      scriptUri,
      styleUri,
      nonce,
    );

    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        void vscode.commands.executeCommand(
          "setContext",
          CONTEXT_SAMPLES_FOCUS,
          false,
        );
        return;
      }
      setTimeout(() => {
        void webviewView.webview.postMessage({ type: "syncFocusContext" });
      }, 0);
    });

    const editorListener = vscode.window.onDidChangeActiveTextEditor(() => {
      if (runState.runLocked) {
        return;
      }
      postActiveSourceHint(webviewView.webview);
    });
    let runnerProbeTimer: ReturnType<typeof setTimeout> | undefined;
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("cp-helper")) {
        return;
      }
      clearTimeout(runnerProbeTimer);
      runnerProbeTimer = setTimeout(() => {
        const r = getActiveSourceFilePath();
        const p = "error" in r ? null : r.file;
        void postRunnerLabel(webviewView.webview, p);
      }, 500);
    });
    webviewView.onDidDispose(() => {
      clearTimeout(runnerProbeTimer);
      editorListener.dispose();
      configListener.dispose();
      this.webviewView = undefined;
      void vscode.commands.executeCommand(
        "setContext",
        CONTEXT_SAMPLES_FOCUS,
        false,
      );
    });

    const postRunState = (
      running: boolean,
      extra?: Record<string, string | number | boolean | undefined>,
    ) => {
      webviewView.webview.postMessage({
        type: "runState",
        running,
        ...extra,
      });
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "webviewFocus": {
          void vscode.commands.executeCommand(
            "setContext",
            CONTEXT_SAMPLES_FOCUS,
            msg.focused === true,
          );
          break;
        }
        case "focusEditor": {
          void vscode.commands.executeCommand(
            "workbench.action.focusActiveEditorGroup",
          );
          break;
        }
        case "loadJson": {
          try {
            await importSamplesFromJsonText(
              this.ctx,
              this,
              String(msg.text ?? ""),
              "loadJson",
            );
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            maybeShowOutputOnRun();
            log.error(`load json failed: ${message}`);
            webviewView.webview.postMessage({
              type: "error",
              message,
            });
          }
          break;
        }
        case "restore": {
          const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
          const groups = wsFolder
            ? await loadCaseGroupsFromFile(this.ctx.workspaceState, wsFolder)
            : loadCaseGroups(this.ctx.workspaceState);
          const importProblem =
            this.ctx.workspaceState.get<string | null | undefined>(
              WORKSPACE_KEY_IMPORT_PROBLEM,
            ) ?? null;
          webviewView.webview.postMessage({
            type: "cases",
            groups,
            importProblem,
          });
          postActiveSourceHint(webviewView.webview);
          postOptions(webviewView.webview, this.ctx);
          break;
        }
        case "setDefineLocal": {
          const v = msg.value === true;
          await this.ctx.workspaceState.update(WORKSPACE_KEY_DEFINE_LOCAL, v);
          log.info(`option changed: defineLocal=${v ? "on" : "off"}`);
          webviewView.webview.postMessage({ type: "options", defineLocal: v });
          break;
        }
        case "saveCaseGroups": {
          const groupsToSave = (msg.groups as CaseGroup[]) ?? [];
          try {
            await persistCaseGroups(this.ctx.workspaceState, groupsToSave);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`save test cases failed: ${errMsg}`);
            void vscode.window.showErrorMessage(
              `CP Helper: Could not save test cases - ${errMsg}`,
            );
          }
          const wsFolderSave = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (wsFolderSave) {
            void persistCaseGroupsToFile(groupsToSave, wsFolderSave).catch(
              (e) => log.warn(`cases file not written: ${e instanceof Error ? e.message : String(e)}`),
            );
          }
          if (msg.clearImportProblem === true) {
            await this.ctx.workspaceState.update(
              WORKSPACE_KEY_IMPORT_PROBLEM,
              null,
            );
            webviewView.webview.postMessage({
              type: "importProblem",
              label: null,
            });
          }
          break;
        }
        case "exportCases": {
          const exportGroupIdx =
            typeof msg.groupIndex === "number" ? msg.groupIndex : 0;
          const exportCaseList = Array.isArray(msg.cases)
            ? (msg.cases as unknown[]).map(validateTestCase)
            : [];
          if (exportCaseList.length === 0) {
            break;
          }
          const wsForExport = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (!wsForExport) {
            webviewView.webview.postMessage({
              type: "error",
              message: "CP Helper: No workspace folder to export to.",
            });
            break;
          }
          const testcasesDir = vscode.Uri.joinPath(wsForExport, "testcases");
          try {
            try {
              await vscode.workspace.fs.stat(testcasesDir);
            } catch {
              await vscode.workspace.fs.createDirectory(testcasesDir);
            }
            for (const tc of exportCaseList) {
              const n = tc.sample > 0 ? tc.sample : exportCaseList.indexOf(tc) + 1;
              await vscode.workspace.fs.writeFile(
                vscode.Uri.joinPath(testcasesDir, `sample_${n}.in`),
                Buffer.from(tc.input, "utf8"),
              );
              await vscode.workspace.fs.writeFile(
                vscode.Uri.joinPath(testcasesDir, `sample_${n}.out`),
                Buffer.from(tc.output, "utf8"),
              );
            }
            log.info(`exported ${exportCaseList.length} case(s) to testcases/`);
            webviewView.webview.postMessage({
              type: "exportDone",
              groupIndex: exportGroupIdx,
              count: exportCaseList.length,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`export failed: ${errMsg}`);
            webviewView.webview.postMessage({
              type: "error",
              message: `CP Helper: Export failed - ${errMsg}`,
            });
          }
          break;
        }
        case "stopRun": {
          runState.cancelRequested = true;
          const killed = killActiveShell();
          if (killed) {
            log.warn("stop requested: subprocess tree killed");
          } else {
            log.info(
              "stop requested: nothing running; remaining run-all samples skipped",
            );
          }
          break;
        }
        case "runOne": {
          const runToken = ++this.runSeq;
          const isCurrentRun = (): boolean => this.runSeq === runToken;
          const tookOver = await this.stopActiveRunForTakeover();
          if (!isCurrentRun()) {
            break;
          }
          const groupIndex =
            typeof msg.groupIndex === "number" ? msg.groupIndex : 0;
          if (!tookOver) {
            postRunState(false);
            break;
          }
          const resolved = getActiveSourceFilePath();
          if ("error" in resolved) {
            maybeShowOutputOnRun();
            log.error(`run one rejected: ${resolved.error}`);
            postRunState(false);
            webviewView.webview.postMessage({
              type: "runResult",
              groupIndex,
              index: msg.index,
              verdict: "WA",
              error: resolved.error,
            });
            break;
          }
          const file = resolved.file;
          const saveFirst = await ensureSourceSavedBeforeRun(file);
          if (!isCurrentRun()) {
            break;
          }
          if ("error" in saveFirst) {
            maybeShowOutputOnRun();
            log.error(`run one rejected: ${saveFirst.error}`);
            postRunState(false);
            webviewView.webview.postMessage({
              type: "runResult",
              groupIndex,
              index: msg.index,
              verdict: "WA",
              error: saveFirst.error,
            });
            break;
          }
          const tc = validateTestCase(msg.case);
          maybeShowOutputOnRun();
          runState.runLocked = true;
          runState.cancelRequested = false;
          postRunSourceSnapshot(webviewView.webview, file);
          postRunState(true, {
            mode: "one",
            groupIndex,
            index: msg.index as number,
          });
          try {
            const r = await runSingleTest(
              file,
              tc,
              this.ctx.workspaceState.get<boolean>(WORKSPACE_KEY_DEFINE_LOCAL) ===
                true,
            );
            if (isCurrentRun()) {
              webviewView.webview.postMessage({
                type: "runResult",
                groupIndex,
                index: msg.index,
                ...r,
              });
            }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            log.error(`run one failed: ${err}`);
            if (isCurrentRun()) {
              webviewView.webview.postMessage({
                type: "runResult",
                groupIndex,
                index: msg.index,
                verdict: "WA",
                error: err,
              });
            }
          } finally {
            // A superseded run stays silent: the run that replaced it owns the UI now.
            if (isCurrentRun()) {
              postRunState(false);
            }
            runState.runLocked = false;
            if (isCurrentRun()) {
              postActiveSourceHint(webviewView.webview);
            }
          }
          break;
        }
        case "runAll": {
          const runToken = ++this.runSeq;
          const isCurrentRun = (): boolean => this.runSeq === runToken;
          const tookOver = await this.stopActiveRunForTakeover();
          if (!isCurrentRun()) {
            break;
          }
          const groupIndex =
            typeof msg.groupIndex === "number" ? msg.groupIndex : 0;
          if (!tookOver) {
            postRunState(false);
            break;
          }
          const resolvedAll = getActiveSourceFilePath();
          if ("error" in resolvedAll) {
            maybeShowOutputOnRun();
            log.error(`run all rejected: ${resolvedAll.error}`);
            postRunState(false);
            webviewView.webview.postMessage({
              type: "runAllDone",
              groupIndex,
              error: resolvedAll.error,
            });
            break;
          }
          const file = resolvedAll.file;
          const saveAllFirst = await ensureSourceSavedBeforeRun(file);
          if (!isCurrentRun()) {
            break;
          }
          if ("error" in saveAllFirst) {
            maybeShowOutputOnRun();
            log.error(`run all rejected: ${saveAllFirst.error}`);
            postRunState(false);
            webviewView.webview.postMessage({
              type: "runAllDone",
              groupIndex,
              error: saveAllFirst.error,
            });
            break;
          }
          const cases = Array.isArray(msg.cases)
            ? (msg.cases as unknown[]).map(validateTestCase)
            : [];
          maybeShowOutputOnRun();
          runState.runLocked = true;
          runState.cancelRequested = false;
          postRunSourceSnapshot(webviewView.webview, file);
          postRunState(true, {
            mode: "all",
            groupIndex,
            phase: "compile",
            total: cases.length,
          });
          try {
            await runAllTestsSharedCompile(
              file,
              cases,
              (i, r) => {
                if (!isCurrentRun()) {
                  return;
                }
                webviewView.webview.postMessage({
                  type: "runResult",
                  groupIndex,
                  index: i,
                  ...r,
                });
              },
              (i, total) => {
                if (!isCurrentRun()) {
                  return;
                }
                postRunState(true, {
                  mode: "all",
                  groupIndex,
                  phase: "run",
                  index: i,
                  total,
                });
              },
              this.ctx.workspaceState.get<boolean>(WORKSPACE_KEY_DEFINE_LOCAL) ===
                true,
            );
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            log.error(`run all failed: ${err}`);
            for (let i = 0; i < cases.length && isCurrentRun(); i++) {
              webviewView.webview.postMessage({
                type: "runResult",
                groupIndex,
                index: i,
                ok: false,
                verdict: "WA",
                stdout: "",
                stderr: "",
                expected: cases[i]?.output ?? "",
                error: err,
              });
            }
          } finally {
            // A superseded run stays silent: the run that replaced it owns the UI now.
            const current = isCurrentRun();
            if (current) {
              postRunState(false);
            }
            runState.runLocked = false;
            if (current) {
              webviewView.webview.postMessage({
                type: "runAllDone",
                groupIndex,
              });
              postActiveSourceHint(webviewView.webview);
            }
          }
          break;
        }
        default:
          break;
      }
    });
  }
}

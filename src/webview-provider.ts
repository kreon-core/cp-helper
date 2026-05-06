import * as vscode from "vscode";
import {
  CONTEXT_SAMPLES_FOCUS,
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
import { cpLog, maybeShowOutputOnRun } from "./log";
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

function validateTestCase(v: unknown): TestCase {
  const o = v as Record<string, unknown> | null | undefined;
  return {
    sample: typeof o?.sample === "number" ? o.sample : 0,
    input: typeof o?.input === "string" ? o.input : "",
    output: typeof o?.output === "string" ? o.output : "",
  };
}
import { buildSamplesWebviewHtml, getNonce } from "./webview-html";

export class CpHelperViewProvider
  implements vscode.WebviewViewProvider, SamplesWebviewSink
{
  public static readonly viewType = VIEW_TYPE_SAMPLES;

  private webviewView: vscode.WebviewView | undefined;

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly ctx: vscode.ExtensionContext,
  ) {}

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
   * keyboard focus** when possible (`show(true)`). After a cold open (`workbench.view.extension…`),
   * focus may jump once; we then re-activate the text editor that was active before reveal.
   *
   * @returns `true` if the view was hidden and we opened/showed it — caller should wait briefly
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
   * Deliver a shortcut / palette action to the webview (host → webview).
   * @param msg
   */
  postToWebview(msg: unknown): void {
    void this.webviewView?.webview.postMessage(msg);
  }

  /**
   * Push case groups into the Samples list (IMPORT textarea unchanged — for manual paste + Load only).
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
            cpLog(`JSON load error: ${message}`);
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
          cpLog(
            v
              ? "Option: compile with -DLOCAL (on)"
              : "Option: compile with -DLOCAL (off)",
          );
          webviewView.webview.postMessage({ type: "options", defineLocal: v });
          break;
        }
        case "saveCaseGroups": {
          const groupsToSave = (msg.groups as CaseGroup[]) ?? [];
          try {
            await persistCaseGroups(this.ctx.workspaceState, groupsToSave);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            cpLog(`ERROR: Failed to save test cases: ${errMsg}`);
            void vscode.window.showErrorMessage(
              `CP Helper: Could not save test cases — ${errMsg}`,
            );
          }
          const wsFolderSave = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (wsFolderSave) {
            void persistCaseGroupsToFile(groupsToSave, wsFolderSave).catch(
              (e) => cpLog(`Warning: could not write cases file — ${e instanceof Error ? e.message : String(e)}`),
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
            cpLog(`Exported ${exportCaseList.length} case(s) to testcases/`);
            webviewView.webview.postMessage({
              type: "exportDone",
              groupIndex: exportGroupIdx,
              count: exportCaseList.length,
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            cpLog(`Export error: ${errMsg}`);
            webviewView.webview.postMessage({
              type: "error",
              message: `CP Helper: Export failed — ${errMsg}`,
            });
          }
          break;
        }
        case "stopRun": {
          runState.cancelRequested = true;
          const killed = killActiveShell();
          cpLog(
            killed
              ? "Stop: subprocess tree killed"
              : "Stop: nothing running (already finished or not started); Run-all remainder skipped if a batch was active",
          );
          break;
        }
        case "runOne": {
          if (runState.runLocked) {
            break;
          }
          const groupIndex =
            typeof msg.groupIndex === "number" ? msg.groupIndex : 0;
          const resolved = getActiveSourceFilePath();
          if ("error" in resolved) {
            maybeShowOutputOnRun();
            cpLog(`Run one: ${resolved.error}`);
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
          if ("error" in saveFirst) {
            maybeShowOutputOnRun();
            cpLog(`Run one: ${saveFirst.error}`);
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
            webviewView.webview.postMessage({
              type: "runResult",
              groupIndex,
              index: msg.index,
              ...r,
            });
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            cpLog(`Run one error: ${err}`);
            webviewView.webview.postMessage({
              type: "runResult",
              groupIndex,
              index: msg.index,
              verdict: "WA",
              error: err,
            });
          } finally {
            postRunState(false);
            runState.runLocked = false;
            postActiveSourceHint(webviewView.webview);
          }
          break;
        }
        case "runAll": {
          if (runState.runLocked) {
            break;
          }
          const groupIndex =
            typeof msg.groupIndex === "number" ? msg.groupIndex : 0;
          const resolvedAll = getActiveSourceFilePath();
          if ("error" in resolvedAll) {
            maybeShowOutputOnRun();
            cpLog(`Run all: ${resolvedAll.error}`);
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
          if ("error" in saveAllFirst) {
            maybeShowOutputOnRun();
            cpLog(`Run all: ${saveAllFirst.error}`);
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
                webviewView.webview.postMessage({
                  type: "runResult",
                  groupIndex,
                  index: i,
                  ...r,
                });
              },
              (i, total) => {
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
            cpLog(`Run all: fatal error: ${err}`);
            for (let i = 0; i < cases.length; i++) {
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
            postRunState(false);
            runState.runLocked = false;
            cpLog("Run all: finished");
            webviewView.webview.postMessage({ type: "runAllDone", groupIndex });
            postActiveSourceHint(webviewView.webview);
          }
          break;
        }
        default:
          break;
      }
    });
  }
}

import * as vscode from "vscode";
import * as path from "path";
import {
  CMD_EXPORT_CASES,
  CMD_FOCUS_SAMPLES,
  CMD_IMPORT_CLIPBOARD,
  CMD_RUN_ALL_SAMPLES,
  CMD_RUN_FIRST_SAMPLE,
  CMD_SELECT_COMPILE_PRESET,
  CMD_SHOW_OUTPUT,
  CMD_STRESS_TEST,
  CONTEXT_SAMPLES_FOCUS,
  OUTPUT_CHANNEL_NAME,
  WORKSPACE_KEY_DEFINE_LOCAL,
} from "./constants";
import { importFromClipboardAndReveal } from "./clipboard-import";
import { loadCaseGroups, loadCaseGroupsFromFile } from "./case-groups";
import { importSamplesFromJsonText } from "./import-samples";
import { startLocalImportHttpServer } from "./local-import-server";
import {
  cpLog,
  getCpHelperOutputChannel,
  setCpHelperOutputChannel,
} from "./log";
import { runState } from "./run-state";
import { runStressTest } from "./run-tests";
import { getActiveSourceFilePath, ensureSourceSavedBeforeRun } from "./source-hints";
import { CpHelperViewProvider } from "./webview-provider";

export type { CaseGroup, TestCase } from "./types";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  setCpHelperOutputChannel(outputChannel);
  context.subscriptions.push(outputChannel);
  void vscode.commands.executeCommand(
    "setContext",
    CONTEXT_SAMPLES_FOCUS,
    false,
  );
  cpLog(
    "CP Helper log (View → Output → CP Helper, or command “Show Output Log”).",
  );

  const provider = new CpHelperViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CpHelperViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  const revealSamplesAndFocus = async (): Promise<void> => {
    await vscode.commands.executeCommand(
      "workbench.view.extension.cp-helper",
    );
    provider.focusSamplesView();
  };

  /** Let webview apply cases before `shortcutRun*` messages (matches palette shortcuts). */
  const SHORTCUT_POST_DELAY_MS = 120;

  const importAndReveal = async (body: string): Promise<void> => {
    const { groupCount } = await importSamplesFromJsonText(
      context,
      provider,
      body,
    );
    await revealSamplesAndFocus();
    const instantRun =
      vscode.workspace
        .getConfiguration("cp-helper")
        .get<boolean>("instantRunAllOnLocalImport") !== false;
    if (instantRun && groupCount === 1) {
      await new Promise((r) => setTimeout(r, SHORTCUT_POST_DELAY_MS));
      provider.postToWebview({ type: "shortcutRunAll" });
    }
  };

  const localImport = startLocalImportHttpServer(importAndReveal);
  context.subscriptions.push(new vscode.Disposable(() => localImport.dispose()));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("cp-helper.enableLocalImportServer") ||
        e.affectsConfiguration("cp-helper.localImportPort")
      ) {
        localImport.restart();
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        if (uri.authority !== context.extension.id) {
          return;
        }
        const pathPart = uri.path.replace(/^\/+|\/+$/u, "");
        if (pathPart === "focusSamples") {
          void revealSamplesAndFocus();
          return;
        }
        if (pathPart !== "importFromClipboard") {
          return;
        }
        void importFromClipboardAndReveal(
          context,
          provider,
          revealSamplesAndFocus,
          "CP Helper: clipboard is empty. Paste samples JSON into the clipboard, then open this link again or run “Import samples from clipboard”.",
        );
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_FOCUS_SAMPLES, async () => {
      await revealSamplesAndFocus();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_IMPORT_CLIPBOARD, async () => {
      await importFromClipboardAndReveal(
        context,
        provider,
        revealSamplesAndFocus,
        "CP Helper: clipboard is empty.",
      );
    }),
  );
  const runFirstSample = async (): Promise<void> => {
    const revealed = await provider.revealSamplesViewIfHidden();
    if (revealed) {
      await new Promise((r) => setTimeout(r, SHORTCUT_POST_DELAY_MS));
    }
    provider.postToWebview({ type: "shortcutRunFirst" });
  };
  const runAllSamples = async (): Promise<void> => {
    const revealed = await provider.revealSamplesViewIfHidden();
    if (revealed) {
      await new Promise((r) => setTimeout(r, SHORTCUT_POST_DELAY_MS));
    }
    provider.postToWebview({ type: "shortcutRunAll" });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_FIRST_SAMPLE, runFirstSample),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_ALL_SAMPLES, runAllSamples),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_SHOW_OUTPUT, () => {
      getCpHelperOutputChannel()?.show(false);
    }),
  );

  // --- Compiler presets ---
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_SELECT_COMPILE_PRESET, async () => {
      const presets = [
        { label: "g++ C++23 -O2 (recommended)", description: "g++ -std=c++23 -O2 -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++23", description: "g++ -std=c++23 -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++20 -O2", description: "g++ -std=c++20 -O2 -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++20", description: "g++ -std=c++20 -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++17 -O2", description: "g++ -std=c++17 -O2 -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++17", description: "g++ -std=c++17 -o \"{{out}}\" \"{{file}}\"" },
        { label: "clang++ C++23 -O2", description: "clang++ -std=c++23 -O2 -o \"{{out}}\" \"{{file}}\"" },
      ];
      const picked = await vscode.window.showQuickPick(presets, {
        title: "CP Helper: Select Compile Preset",
        placeHolder: "Pick a compiler and standard",
      });
      if (!picked) {
        return;
      }
      const cfg = vscode.workspace.getConfiguration("cp-helper");
      await cfg.update(
        "compileCommand",
        picked.description,
        vscode.workspace.workspaceFolders
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global,
      );
      cpLog(`Compile preset selected: ${picked.label}`);
    }),
  );

  // --- Export cases ---
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_EXPORT_CASES, async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!wsFolder) {
        void vscode.window.showErrorMessage("CP Helper: No workspace folder to export to.");
        return;
      }
      const groups = await loadCaseGroupsFromFile(context.workspaceState, wsFolder);
      const cases = groups.flatMap((g) => g.cases);
      if (cases.length === 0) {
        void vscode.window.showInformationMessage("CP Helper: No test cases to export.");
        return;
      }
      const testcasesDir = vscode.Uri.joinPath(wsFolder, "testcases");
      try {
        try {
          await vscode.workspace.fs.stat(testcasesDir);
        } catch {
          await vscode.workspace.fs.createDirectory(testcasesDir);
        }
        for (const tc of cases) {
          const n = tc.sample > 0 ? tc.sample : cases.indexOf(tc) + 1;
          await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(testcasesDir, `sample_${n}.in`),
            Buffer.from(tc.input, "utf8"),
          );
          await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(testcasesDir, `sample_${n}.out`),
            Buffer.from(tc.output, "utf8"),
          );
        }
        cpLog(`Exported ${cases.length} case(s) to testcases/`);
        void vscode.window.showInformationMessage(
          `CP Helper: Exported ${cases.length} case(s) to testcases/`,
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        cpLog(`Export error: ${errMsg}`);
        void vscode.window.showErrorMessage(`CP Helper: Export failed — ${errMsg}`);
      }
    }),
  );

  // --- Stress test ---
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_STRESS_TEST, async () => {
      if (runState.runLocked) {
        void vscode.window.showWarningMessage("CP Helper: Another run is in progress.");
        return;
      }
      const cfg = vscode.workspace.getConfiguration("cp-helper");
      const generatorCmd = (cfg.get<string>("stressGeneratorCommand") ?? "").trim();
      if (!generatorCmd) {
        void vscode.window.showErrorMessage(
          "CP Helper: Set cp-helper.stressGeneratorCommand first (shell command that writes test input to stdout).",
        );
        return;
      }
      const referenceCmd = (cfg.get<string>("stressReferenceCommand") ?? "").trim();
      const rawMax = cfg.get<number>("stressMaxIterations");
      const maxIterations =
        typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 1
          ? Math.floor(rawMax)
          : 100;
      const defineLocal =
        context.workspaceState.get<boolean>(WORKSPACE_KEY_DEFINE_LOCAL) === true;

      const resolved = getActiveSourceFilePath();
      if ("error" in resolved) {
        cpLog(`Stress test: ${resolved.error}`);
        void vscode.window.showErrorMessage(`CP Helper: ${resolved.error}`);
        return;
      }
      const file = resolved.file;
      const saveFirst = await ensureSourceSavedBeforeRun(file);
      if ("error" in saveFirst) {
        cpLog(`Stress test: ${saveFirst.error}`);
        void vscode.window.showErrorMessage(`CP Helper: ${saveFirst.error}`);
        return;
      }

      runState.runLocked = true;
      runState.cancelRequested = false;
      getCpHelperOutputChannel()?.show(false);
      cpLog(`Stress test: starting (${maxIterations} iterations, generator: ${generatorCmd})`);
      if (referenceCmd) {
        cpLog(`Stress test: reference: ${referenceCmd}`);
      } else {
        cpLog("Stress test: no reference — only checking for RE / TLE");
      }

      try {
        const result = await runStressTest(
          file,
          generatorCmd,
          referenceCmd,
          maxIterations,
          defineLocal,
          (i, max) => {
            if (i === 1 || i % 25 === 0) {
              cpLog(`Stress test: iteration ${i}/${max}`);
            }
          },
        );

        switch (result.status) {
          case "passed":
            void vscode.window.showInformationMessage(
              `CP Helper Stress: all ${result.iterations} iterations passed ✓`,
            );
            break;
          case "stopped":
            cpLog(`Stress test: stopped after ${result.iterations} iterations`);
            break;
          case "compile_error":
            void vscode.window.showErrorMessage("CP Helper Stress: compile failed — check Output log.");
            break;
          case "generator_error":
            void vscode.window.showErrorMessage("CP Helper Stress: generator failed — check Output log.");
            break;
          case "bug": {
            const fc = result.failedCase;
            cpLog("Stress test: BUG FOUND");
            if (fc) {
              cpLog(`  input (${Buffer.byteLength(fc.input, "utf8")} bytes):`);
              for (const ln of fc.input.slice(0, 1000).split("\n")) {
                cpLog(`    ${ln}`);
              }
              if (fc.expected) {
                cpLog(`  expected: ${fc.expected.slice(0, 500)}`);
              }
              cpLog(`  actual: ${fc.actual.slice(0, 500)}`);
            }
            const choice = await vscode.window.showWarningMessage(
              `CP Helper Stress: bug found at iteration ${result.iterations}! Add failing case to samples?`,
              "Add to Samples",
              "Dismiss",
            );
            if (choice === "Add to Samples" && fc) {
              await provider.injectStressCase(fc.input, fc.expected);
              await revealSamplesAndFocus();
            }
            break;
          }
        }
      } finally {
        runState.runLocked = false;
        runState.cancelRequested = false;
      }
    }),
  );
}

export function deactivate(): void {
  setCpHelperOutputChannel(undefined);
}

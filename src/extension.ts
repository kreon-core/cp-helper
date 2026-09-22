import * as vscode from "vscode";
import * as path from "path";
import {
  CMD_COPY_SUBMIT_BRIDGE_URL,
  CMD_EXPORT_CASES,
  CMD_FOCUS_SAMPLES,
  CMD_IMPORT_CLIPBOARD,
  CMD_RUN_ALL_SAMPLES,
  CMD_RUN_ALL_SAMPLES_LOCAL,
  CMD_RUN_FIRST_SAMPLE,
  CMD_RUN_FIRST_SAMPLE_LOCAL,
  CMD_SELECT_COMPILE_PRESET,
  CMD_SHOW_OUTPUT,
  CMD_STRESS_TEST,
  CONTEXT_SAMPLES_FOCUS,
  GLOBAL_KEY_SUBMIT_TOKEN,
  OUTPUT_CHANNEL_NAME,
  SUBMIT_BRIDGE_PATH,
} from "./constants";
import { importFromClipboardAndReveal } from "./clipboard-import";
import { withLocalDefineExpanded } from "./compile-expansion";
import { loadCaseGroupsFromFile } from "./case-groups";
import { exportCasesToTestcasesDir } from "./export-cases";
import {
  importSamplesFromJsonText,
  readClipboardOnlyPayload,
} from "./import-samples";
import { startLocalImportHttpServer } from "./local-import-server";
import {
  getOrCreateSubmitToken,
  SubmitBridge,
} from "./submit-bridge";
import {
  createCpLogger,
  getCpHelperOutputChannel,
  setCpHelperOutputChannel,
} from "./log";
import {
  ensureCacheDir,
  pruneBinaryCache,
  setBinaryCacheDir,
} from "./compile-cache";
import { notify } from "./notify";
import { runState } from "./run-state";
import { runStressTest } from "./run-tests";
import { getActiveSourceFilePath, ensureSourceSavedBeforeRun } from "./source-hints";
import {
  CpHelperViewProvider,
  revealSamplesContainer,
} from "./webview-provider";
import type { RunShortcut } from "./webview-provider";

const log = createCpLogger("core");
const stressLog = createCpLogger("stress");

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
  log.info(`CP Helper activated (${context.extension.packageJSON.version ?? "dev"})`);

  setBinaryCacheDir(path.join(context.globalStorageUri.fsPath, "bin"));
  void ensureCacheDir().then(() => pruneBinaryCache());

  const provider = new CpHelperViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CpHelperViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  const revealSamplesAndFocus = async (): Promise<void> => {
    await revealSamplesContainer();
    provider.focusSamplesView();
  };

  const importAndReveal = async (body: string): Promise<void> => {
    const clipboardOnly = readClipboardOnlyPayload(body);
    if (clipboardOnly !== null) {
      await vscode.env.clipboard.writeText(clipboardOnly);
      log.info(`contest setup copied to the clipboard: ${clipboardOnly}`);
      notify("info", `${clipboardOnly}`);
      return;
    }
    const { imported } = await importSamplesFromJsonText(
      context,
      provider,
      body,
    );
    const instantRun =
      vscode.workspace
        .getConfiguration("cp-helper")
        .get<boolean>("instantRunAllOnLocalImport") !== false;
    if (instantRun && imported.length === 1) {
      provider.requestRunGroup(imported[0], false);
    }
    try {
      await revealSamplesAndFocus();
    } catch (e) {
      // Reveal can fail when the view container was moved (e.g. into the panel); the import itself
      // succeeded, so report it instead of failing the POST.
      log.warn(
        `samples view not revealed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const submitToken = await getOrCreateSubmitToken(
    context.globalState,
    GLOBAL_KEY_SUBMIT_TOKEN,
  );
  const submitBridge = new SubmitBridge(submitToken);
  provider.setSubmitBridge(submitBridge);
  context.subscriptions.push(
    submitBridge.onDidChangeConnectionState(() => {
      provider.postSubmitBridgeState();
    }),
  );
  context.subscriptions.push(new vscode.Disposable(() => submitBridge.dispose()));

  const localImport = startLocalImportHttpServer(
    importAndReveal,
    (req, socket, head) => submitBridge.handleUpgrade(req, socket, head),
  );
  context.subscriptions.push(new vscode.Disposable(() => localImport.dispose()));

  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_COPY_SUBMIT_BRIDGE_URL, async () => {
      const cfg = vscode.workspace.getConfiguration("cp-helper");
      const rawPort = cfg.get<number>("localImportPort");
      const port =
        typeof rawPort === "number" &&
        Number.isFinite(rawPort) &&
        rawPort >= 1 &&
        rawPort <= 65535
          ? Math.floor(rawPort)
          : 17337;
      const url = `ws://127.0.0.1:${port}${SUBMIT_BRIDGE_PATH}?token=${submitToken}`;
      await vscode.env.clipboard.writeText(url);
      log.info("submit bridge URL copied to the clipboard");
      notify(
        "info",
        "Bridge URL copied - paste it into the OJ Sync options page.",
      );
    }),
  );

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
          "Clipboard is empty. Paste samples JSON into the clipboard, then open this link again or run \"Import samples from clipboard\".",
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
        "Clipboard is empty.",
      );
    }),
  );
  const runShortcut = async (type: RunShortcut): Promise<void> => {
    provider.requestRunShortcut(type);
    await provider.revealSamplesViewIfHidden();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_FIRST_SAMPLE, () =>
      runShortcut("shortcutRunFirst"),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_FIRST_SAMPLE_LOCAL, () =>
      runShortcut("shortcutRunFirstLocal"),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_ALL_SAMPLES, () =>
      runShortcut("shortcutRunAll"),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_RUN_ALL_SAMPLES_LOCAL, () =>
      runShortcut("shortcutRunAllLocal"),
    ),
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
        { label: "g++ C++23 -O2 (recommended)", description: "g++ -std=c++23 -O2 -pipe -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++23 fast compile", description: "g++ -std=c++23 -O0 -pipe -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++23 + sanitizers", description: "g++ -std=c++23 -O1 -pipe -g -fsanitize=address,undefined -fno-omit-frame-pointer -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++23 + debug asserts", description: "g++ -std=c++23 -O0 -pipe -g -D_GLIBCXX_DEBUG -D_GLIBCXX_ASSERTIONS -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++20 -O2", description: "g++ -std=c++20 -O2 -pipe -o \"{{out}}\" \"{{file}}\"" },
        { label: "g++ C++17 -O2", description: "g++ -std=c++17 -O2 -pipe -o \"{{out}}\" \"{{file}}\"" },
        { label: "clang++ C++23 -O2", description: "clang++ -std=c++23 -O2 -pipe -o \"{{out}}\" \"{{file}}\"" },
      ];
      const targets = [
        {
          label: "NORMAL build",
          description: "compileCommand - the plain Run buttons",
          key: "compileCommand",
        },
        {
          label: "LOCAL build",
          description: "localCompileCommand - the LOCAL Run buttons",
          key: "localCompileCommand",
        },
        {
          label: "DEBUG build",
          description: "debugCompileCommand - the per-sample Debug button",
          key: "debugCompileCommand",
        },
      ];
      const target = await vscode.window.showQuickPick(targets, {
        title: "Select Compile Preset",
        placeHolder: "Which build does this preset configure?",
      });
      if (!target) {
        return;
      }
      const picked = await vscode.window.showQuickPick(presets, {
        title: target.label,
        placeHolder: "Pick a compiler and standard",
      });
      if (!picked) {
        return;
      }
      let cmd = picked.description;
      if (target.key === "localCompileCommand" && !/(^|\s)-DLOCAL(\s|$)/u.test(cmd)) {
        cmd = withLocalDefineExpanded(cmd);
      }
      const cfg = vscode.workspace.getConfiguration("cp-helper");
      await cfg.update(
        target.key,
        cmd,
        vscode.workspace.workspaceFolders
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global,
      );
      log.info(`compile preset selected: ${target.key} = ${picked.label}`);
    }),
  );

  // --- Export cases ---
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_EXPORT_CASES, async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!wsFolder) {
        log.error("export rejected: no workspace folder");
        notify("error", "No workspace folder to export to.");
        return;
      }
      const groups = await loadCaseGroupsFromFile(context.workspaceState, wsFolder);
      const cases = groups.flatMap((g) => g.cases);
      if (cases.length === 0) {
        notify("info", "No test cases to export.");
        return;
      }
      try {
        await exportCasesToTestcasesDir(wsFolder, cases);
        log.info(`exported ${cases.length} case(s) to testcases/`);
        notify("info", `Exported ${cases.length} case(s) to testcases/`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        log.error(`export failed: ${errMsg}`);
        notify("error", `Export failed - ${errMsg}`);
      }
    }),
  );

  // --- Stress test ---
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_STRESS_TEST, async () => {
      if (runState.runLocked) {
        stressLog.warn("rejected: another run is in progress");
        notify("warn", "Another run is in progress.");
        return;
      }
      const cfg = vscode.workspace.getConfiguration("cp-helper");
      const generatorCmd = (cfg.get<string>("stressGeneratorCommand") ?? "").trim();
      if (!generatorCmd) {
        stressLog.error("rejected: cp-helper.stressGeneratorCommand is not set");
        notify("error", "Set cp-helper.stressGeneratorCommand first.");
        return;
      }
      const referenceCmd = (cfg.get<string>("stressReferenceCommand") ?? "").trim();
      const rawMax = cfg.get<number>("stressMaxIterations");
      const maxIterations =
        typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax >= 1
          ? Math.floor(rawMax)
          : 100;
      const resolved = getActiveSourceFilePath();
      if ("error" in resolved) {
        stressLog.error(`rejected: ${resolved.error}`);
        notify("error", resolved.error);
        return;
      }
      const file = resolved.file;
      const saveFirst = await ensureSourceSavedBeforeRun(file);
      if ("error" in saveFirst) {
        stressLog.error(`rejected: ${saveFirst.error}`);
        notify("error", saveFirst.error);
        return;
      }

      runState.runLocked = true;
      runState.cancelRequested = false;
      getCpHelperOutputChannel()?.show(false);
      stressLog.info(`requested: ${maxIterations} iteration(s), generator: ${generatorCmd}`);
      if (referenceCmd) {
        stressLog.info(`reference: ${referenceCmd}`);
      } else {
        stressLog.info("no reference configured, checking for RE / TLE only");
      }

      try {
        const result = await runStressTest(
          file,
          generatorCmd,
          referenceCmd,
          maxIterations,
          false,
          (i, max) => {
            if (i === 1 || i % 25 === 0) {
              stressLog.info(`iteration ${i}/${max}`);
            }
          },
        );

        switch (result.status) {
          case "passed":
            notify("info", `Stress: ${result.iterations} iterations passed ✓`);
            break;
          case "stopped":
            stressLog.warn(`stopped after ${result.iterations} iteration(s)`);
            break;
          case "compile_error":
            notify("error", "Stress: compile failed - see Output.");
            break;
          case "generator_error":
            notify("error", "Stress: generator failed - see Output.");
            break;
          case "bug": {
            const fc = result.failedCase;
            stressLog.error("bug found");
            if (fc) {
              stressLog.error(`failing input (${Buffer.byteLength(fc.input, "utf8")} bytes):`);
              for (const ln of fc.input.slice(0, 1000).split("\n")) {
                stressLog.detail(ln, "ERROR");
              }
              if (fc.expected) {
                stressLog.detail(`expected: ${fc.expected.slice(0, 500)}`, "ERROR");
              }
              stressLog.detail(`actual: ${fc.actual.slice(0, 500)}`, "ERROR");
            }
            const choice = await vscode.window.showWarningMessage(
              `Stress: bug found at iteration ${result.iterations}! Add failing case to samples?`,
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

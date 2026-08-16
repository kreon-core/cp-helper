import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { randomBytes } from "crypto";
import { DEFAULT_DEBUG_CONFIG_NAME } from "./constants";
import {
  expand,
  withLocalDefineExpanded,
  wrapForLoginShell,
} from "./compile-expansion";
import { createCpLogger } from "./log";
import { runShell } from "./run-state";
import type { TestCase } from "./types";

const log = createCpLogger("debug");

/** Temp stdin files keyed by debug session name, removed when that session ends. */
const pendingStdinFiles = new Map<string, string>();

let terminateHookInstalled = false;

function installTerminateHook(ctx: vscode.ExtensionContext): void {
  if (terminateHookInstalled) {
    return;
  }
  terminateHookInstalled = true;
  ctx.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((s) => {
      const p = pendingStdinFiles.get(s.name);
      if (p === undefined) {
        return;
      }
      pendingStdinFiles.delete(s.name);
      fs.unlink(p).catch(() => {
        /* already gone */
      });
    }),
  );
}

/**
 * Named configuration from the workspace `launch.json` that applies to `file`.
 * @param file absolute source path
 * @param name configuration `name` to match
 */
function findLaunchConfig(
  file: string,
  name: string,
): vscode.DebugConfiguration | null {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
  const configs = vscode.workspace
    .getConfiguration("launch", folder?.uri)
    .get<vscode.DebugConfiguration[]>("configurations");
  if (!Array.isArray(configs)) {
    return null;
  }
  const hit = configs.find((c) => c && c.name === name);
  return hit ? { ...hit } : null;
}

/**
 * Compile a debug binary for the inline fallback config.
 * @param file absolute source path
 * @param defineLocal add `-DLOCAL` after the compiler token
 * @returns binary path, or a user-facing error
 */
async function compileForDebug(
  file: string,
  defineLocal: boolean,
): Promise<{ bin: string; cwd: string } | { error: string }> {
  const cfg = vscode.workspace.getConfiguration("cp-helper");
  const explicit = (cfg.get<string>("debugCompileCommand") ?? "").trim();
  const base = (cfg.get<string>("compileCommand") ?? "").trim();
  let tpl = explicit;
  if (tpl.length === 0) {
    if (base.length === 0) {
      return {
        error:
          "No debug build configured. Set cp-helper.debugCompileCommand, or add a launch.json configuration and point cp-helper.debugConfigName at it.",
      };
    }
    // Debug info is what makes breakpoints and line numbers work; -O0 keeps locals readable.
    const m = /^(\S+)(.*)/su.exec(base);
    tpl = m ? `${m[1]} -g -O0${m[2]}` : `${base} -g -O0`;
  }

  const wdSetting = (cfg.get<string>("workingDirectory") ?? "").trim();
  const cwd = wdSetting || path.dirname(file);
  const ext = process.platform === "win32" ? ".exe" : "";
  const bin = path.join(
    os.tmpdir(),
    `cp-helper-dbg-${randomBytes(8).toString("hex")}${ext}`,
  );

  let cmd = expand(tpl, file, bin);
  if (defineLocal) {
    cmd = withLocalDefineExpanded(cmd);
  }
  const viaLogin =
    cfg.get<boolean>("invokeViaLoginShell") === true &&
    process.platform !== "win32";
  if (viaLogin) {
    cmd = wrapForLoginShell(
      cmd,
      (cfg.get<string>("loginShellInvoke") ?? "bash -l -c").trim(),
    );
  }

  log.info(`compile: ${cmd}`);
  const r = await runShell(cmd, cwd, undefined, 120_000);
  if (r.code !== 0) {
    const errText = (r.stderr || r.stdout || `exit ${r.code}`).trim();
    log.error(`compile failed: exit ${r.code ?? "null"}`);
    return { error: `Debug build failed:\n${errText}` };
  }
  return { bin, cwd };
}

/**
 * Launch the configured debugger on `file` with `tc.input` wired to the debuggee's stdin.
 * Prefers the `launch.json` configuration named by `cp-helper.debugConfigName` (its
 * `preLaunchTask` does the build); falls back to an inline CodeLLDB config when absent.
 * @param ctx
 * @param file absolute source path
 * @param tc testcase whose input feeds stdin
 * @param defineLocal add `-DLOCAL` when the fallback compiles
 */
export async function startDebugCase(
  ctx: vscode.ExtensionContext,
  file: string,
  tc: TestCase,
  defineLocal: boolean,
): Promise<{ ok: true } | { error: string }> {
  installTerminateHook(ctx);

  const stdinPath = path.join(
    os.tmpdir(),
    `cp-helper-stdin-${randomBytes(8).toString("hex")}.txt`,
  );
  try {
    await fs.writeFile(stdinPath, tc.input, "utf8");
  } catch (e) {
    return {
      error: `Could not write debug stdin file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const cfg = vscode.workspace.getConfiguration("cp-helper");
  const configName = (
    cfg.get<string>("debugConfigName") ?? DEFAULT_DEBUG_CONFIG_NAME
  ).trim();

  let launch = configName.length > 0 ? findLaunchConfig(file, configName) : null;
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));

  if (launch) {
    log.info(`sample ${tc.sample}: launch.json config "${configName}"`);
  } else {
    if (!vscode.extensions.getExtension("vadimcn.vscode-lldb")) {
      await fs.unlink(stdinPath).catch(() => {
        /* best effort */
      });
      return {
        error:
          `No launch.json configuration named "${configName}" and the CodeLLDB extension ` +
          "(vadimcn.vscode-lldb) is not installed. Add a debug configuration and set " +
          "cp-helper.debugConfigName, or install CodeLLDB for the built-in fallback.",
      };
    }
    const built = await compileForDebug(file, defineLocal);
    if ("error" in built) {
      await fs.unlink(stdinPath).catch(() => {
        /* best effort */
      });
      return built;
    }
    log.info(`sample ${tc.sample}: inline CodeLLDB config`);
    launch = {
      type: "lldb",
      request: "launch",
      name: "CP Helper Debug",
      program: built.bin,
      args: [],
      cwd: built.cwd,
    };
  }

  // Unique per launch so onDidTerminateDebugSession can match the temp stdin file.
  const sessionName = `${launch.name} (sample ${tc.sample})`;
  const resolved: vscode.DebugConfiguration = {
    ...launch,
    name: sessionName,
    stdio: [stdinPath, null, null],
  };
  pendingStdinFiles.set(sessionName, stdinPath);

  let started = false;
  try {
    started = await vscode.debug.startDebugging(folder, resolved);
  } catch (e) {
    started = false;
    log.error(
      `startDebugging threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!started) {
    pendingStdinFiles.delete(sessionName);
    await fs.unlink(stdinPath).catch(() => {
      /* best effort */
    });
    return {
      error:
        "The debugger did not start. Check the preLaunchTask build output and the Debug Console.",
    };
  }
  return { ok: true };
}

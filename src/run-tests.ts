import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { constants as fsConstants } from "fs";
import { randomBytes } from "crypto";
import {
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_COMPILE_STDERR_WEBVIEW,
  MAX_STDERR_CHARS_WEBVIEW,
  MAX_STDOUT_CHARS_WEBVIEW,
} from "./constants";
import {
  expand,
  expandChecker,
  withLocalDefineExpanded,
  wrapForLoginShell,
} from "./compile-expansion";
import { cpLog, truncateForLog } from "./log";
import {
  coerceFloatAbsEpsilon,
  coerceFloatRelEpsilon,
  normalizeOutput,
  outputsEqualFloatAware,
} from "./output-compare";
import { runShell, runState } from "./run-state";
import type {
  RunSampleResult,
  RunSession,
  RunVerdict,
  TestCase,
} from "./types";

interface CacheEntry {
  mtime: number;
  compileCmd: string;
  defineLocal: boolean;
  binPath: string;
}

// Survives across runs for the lifetime of the extension host process.
const compileCache = new Map<string, CacheEntry>();

/**
 * Shared paths, cwd, and shell exec for one binary path (compile once, run many).
 * @param file source path
 * @param defineLocal add `-DLOCAL` to compile when enabled
 */
export function createRunSession(
  file: string,
  defineLocal: boolean,
): RunSession {
  const cfg = vscode.workspace.getConfiguration("cp-helper");
  const compileCmd = (cfg.get<string>("compileCommand") ?? "").trim();
  const runCmdTpl = cfg.get<string>("runCommand") ?? '"{{out}}"';
  const rawTimeout = cfg.get<number | string>("runTimeoutMs");
  const coerced = Number(rawTimeout);
  const timeoutMs =
    Number.isFinite(coerced) && coerced >= 1
      ? Math.min(Math.floor(coerced), 86_400_000)
      : DEFAULT_RUN_TIMEOUT_MS;
  const trim = cfg.get<boolean>("trimOutput") ?? true;
  const floatAbsEpsilon = coerceFloatAbsEpsilon(
    cfg.get<number>("floatAbsEpsilon"),
  );
  const floatRelEpsilon = coerceFloatRelEpsilon(
    cfg.get<number>("floatRelEpsilon"),
  );
  const checkerCmd = (cfg.get<string>("checkerCommand") ?? "").trim();
  const wdSetting = (cfg.get<string>("workingDirectory") ?? "").trim();
  const cwd = wdSetting || path.dirname(file);
  const viaLogin =
    cfg.get<boolean>("invokeViaLoginShell") === true &&
    process.platform !== "win32";
  const loginPrefix = (
    cfg.get<string>("loginShellInvoke") ?? "bash -l -c"
  ).trim();
  const ext = process.platform === "win32" ? ".exe" : "";
  const outBin = path.join(
    os.tmpdir(),
    `cp-helper-${randomBytes(8).toString("hex")}${ext}`,
  );
  const exec = (cmd: string, stdin: string | undefined) => {
    const finalCmd = viaLogin ? wrapForLoginShell(cmd, loginPrefix) : cmd;
    return runShell(finalCmd, cwd, stdin, timeoutMs);
  };
  return {
    file,
    outBin,
    cleanupBin: outBin,
    cwd,
    compileCmd,
    defineLocal,
    runCmdTpl,
    trim,
    floatAbsEpsilon,
    floatRelEpsilon,
    checkerCmd,
    viaLogin,
    loginPrefix,
    exec,
  };
}

/**
 * Compile into session.outBin if compileCmd is set; otherwise no-op success.
 * On a cache hit (same file mtime, compileCmd, and defineLocal flag) the existing
 * binary is reused and s.cleanupBin is set to null so the finally block won't delete it.
 * @param s
 */
async function compileOnce(
  s: RunSession,
): Promise<
  { ok: true } | { ok: false; verdict: RunVerdict; compileStderr: string }
> {
  if (s.compileCmd.length === 0) {
    return { ok: true };
  }

  // Check mtime-based cache before invoking the compiler.
  try {
    const { mtimeMs } = await fs.stat(s.file);
    const entry = compileCache.get(s.file);
    if (
      entry &&
      entry.mtime === mtimeMs &&
      entry.compileCmd === s.compileCmd &&
      entry.defineLocal === s.defineLocal
    ) {
      // Verify the cached binary is present, executable, and non-empty.
      try {
        await fs.access(entry.binPath, fsConstants.X_OK);
        const { size } = await fs.stat(entry.binPath);
        if (size > 0) {
          s.outBin = entry.binPath;
          s.cleanupBin = null; // don't delete a cached binary
          cpLog("compile: cache hit");
          return { ok: true };
        }
      } catch {
        // fall through
      }
      compileCache.delete(s.file);
      fs.unlink(entry.binPath).catch(() => { /* already gone */ });
    }
  } catch {
    // stat failed — fall through to normal compile
  }

  // Avoid executing a leftover binary at {{out}} if a prior run left the path behind.
  await fs.unlink(s.outBin).catch(() => {
    /* ENOENT */
  });
  let compile = expand(s.compileCmd, s.file, s.outBin);
  if (s.defineLocal) {
    compile = withLocalDefineExpanded(compile);
  }
  const shown = s.viaLogin
    ? wrapForLoginShell(compile, s.loginPrefix)
    : compile;
  cpLog(`compile: ${truncateForLog(shown, 400)}`);
  const c = await s.exec(compile, undefined);
  if (c.cancelled) {
    cpLog("compile: stopped by user");
    return {
      ok: false,
      verdict: "TLE",
      compileStderr: "Stopped by user",
    };
  }
  if (c.timedOut) {
    cpLog("compile: TLE");
    return {
      ok: false,
      verdict: "TLE",
      compileStderr: "Compile exceeded time limit",
    };
  }
  if (c.code !== 0) {
    const errText = c.stderr || c.stdout || `exit ${c.code}`;
    cpLog(`compile failed (code ${c.code})`);
    return {
      ok: false,
      verdict: "WA",
      compileStderr: truncateForLog(errText, MAX_COMPILE_STDERR_WEBVIEW),
    };
  }

  // Store the freshly-compiled binary in the cache.
  try {
    const { mtimeMs } = await fs.stat(s.file);
    // Evict the old cached binary for this file if it differs from the new one.
    const prev = compileCache.get(s.file);
    if (prev && prev.binPath !== s.outBin) {
      fs.unlink(prev.binPath).catch(() => { /* already gone */ });
    }
    compileCache.set(s.file, {
      mtime: mtimeMs,
      compileCmd: s.compileCmd,
      defineLocal: s.defineLocal,
      binPath: s.outBin,
    });
    s.cleanupBin = null; // binary is now owned by the cache
  } catch {
    // stat failed after compile — leave cleanupBin as-is so the binary gets deleted
  }

  cpLog("compile ok");
  return { ok: true };
}

/**
 * Run already-built binary (expanded `runCommand`) for one case.
 * @param s
 * @param tc
 */
async function runProgramForCase(
  s: RunSession,
  tc: TestCase,
): Promise<RunSampleResult> {
  const runCmd = expand(s.runCmdTpl, s.file, s.outBin);
  const runShown = s.viaLogin
    ? wrapForLoginShell(runCmd, s.loginPrefix)
    : runCmd;
  cpLog(`run: ${truncateForLog(runShown, 500)}`);
  cpLog(`stdin: ${Buffer.byteLength(tc.input, "utf8")} bytes`);

  const runStart = Date.now();
  const r = await s.exec(runCmd, tc.input);
  const elapsedMs = Date.now() - runStart;
  if (r.cancelled) {
    cpLog(`exit: ${r.code ?? "null"} (stopped by user)`);
    const stderrOut = truncateForLog(
      r.stderr.trim()
        ? `${r.stderr.trim()}\n\nStopped by user`
        : "Stopped by user",
      MAX_STDERR_CHARS_WEBVIEW,
    );
    return {
      ok: false,
      verdict: "TLE",
      stdout: truncateForLog(r.stdout, MAX_STDOUT_CHARS_WEBVIEW),
      stderr: stderrOut,
      expected: tc.output,
    };
  }

  const got = normalizeOutput(r.stdout, s.trim);
  const exp = normalizeOutput(tc.output, s.trim);
  let verdict: RunVerdict;
  if (r.timedOut) {
    verdict = "TLE";
  } else if (r.code !== 0 || r.code === null) {
    verdict = "RE";
  } else if (
    got === exp ||
    outputsEqualFloatAware(got, exp, s.floatAbsEpsilon, s.floatRelEpsilon)
  ) {
    verdict = "AC";
  } else {
    verdict = "WA";
  }
  let ok = verdict === "AC";

  // Custom checker: run after WA to support problems with multiple correct answers.
  if (verdict === "WA" && s.checkerCmd.length > 0) {
    const hex = randomBytes(8).toString("hex");
    const inTmp = path.join(os.tmpdir(), `cp-checker-in-${hex}.txt`);
    const expTmp = path.join(os.tmpdir(), `cp-checker-exp-${hex}.txt`);
    const actTmp = path.join(os.tmpdir(), `cp-checker-act-${hex}.txt`);
    try {
      await Promise.all([
        fs.writeFile(inTmp, tc.input, "utf8"),
        fs.writeFile(expTmp, tc.output, "utf8"),
        fs.writeFile(actTmp, r.stdout, "utf8"),
      ]);
      const checkerExpanded = expandChecker(
        s.checkerCmd,
        s.file,
        s.outBin,
        inTmp,
        expTmp,
        actTmp,
      );
      cpLog(`checker: ${truncateForLog(checkerExpanded, 400)}`);
      const cr = await s.exec(checkerExpanded, undefined);
      if (cr.code === 0 && !cr.timedOut && !cr.cancelled) {
        verdict = "AC";
        ok = true;
        cpLog("checker: AC");
      } else {
        cpLog(`checker: WA (exit ${cr.code ?? "null"})`);
      }
    } catch (e) {
      cpLog(`checker: error — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await Promise.allSettled([
        fs.unlink(inTmp),
        fs.unlink(expTmp),
        fs.unlink(actTmp),
      ]);
    }
  }

  cpLog(`exit: ${r.code ?? "null"}${r.timedOut ? " (killed, TLE)" : ""}`);
  if (ok) {
    cpLog("result: AC");
  } else {
    cpLog(`result: ${verdict}`);
    cpLog(`expected (${Buffer.byteLength(exp, "utf8")} bytes, normalized):`);
    for (const ln of truncateForLog(exp, 2000).split("\n")) {
      cpLog(`  exp| ${ln}`);
    }
  }

  const stdoutOut = truncateForLog(r.stdout, MAX_STDOUT_CHARS_WEBVIEW);
  let stderrOut = truncateForLog(r.stderr, MAX_STDERR_CHARS_WEBVIEW);
  if (verdict === "RE") {
    const codeLine =
      r.code === null
        ? "Exit code: null (signal or spawn error)"
        : `Exit code: ${r.code}`;
    stderrOut = truncateForLog(
      stderrOut.trim() !== ""
        ? `${stderrOut.trim()}\n\n${codeLine}`
        : codeLine,
      MAX_STDERR_CHARS_WEBVIEW,
    );
  }

  return {
    ok,
    verdict,
    stdout: stdoutOut,
    stderr: stderrOut,
    expected: tc.output,
    elapsedMs,
  };
}

/**
 * @param tc used for expected field on compile failure
 * @param verdict
 * @param compileStderr
 */
function compileFailureSampleResult(
  tc: TestCase,
  verdict: RunVerdict,
  compileStderr: string,
): RunSampleResult {
  return {
    ok: false,
    verdict,
    stdout: "",
    stderr: "",
    expected: tc.output,
    compileStderr,
  };
}

export async function runSingleTest(
  file: string,
  tc: TestCase,
  defineLocal: boolean,
): Promise<RunSampleResult> {
  const s = createRunSession(file, defineLocal);
  try {
    cpLog(`── sample ${tc.sample} ──`);
    cpLog(`source: ${s.file}`);
    cpLog(`cwd: ${s.cwd}`);
    if (s.viaLogin) {
      cpLog(`login shell: ${s.loginPrefix}`);
    }
    if (s.defineLocal && s.compileCmd.length > 0) {
      cpLog("compile: -DLOCAL enabled");
    }
    const built = await compileOnce(s);
    if (!built.ok) {
      return compileFailureSampleResult(tc, built.verdict, built.compileStderr);
    }
    return await runProgramForCase(s, tc);
  } finally {
    if (s.cleanupBin !== null) {
      await fs.unlink(s.cleanupBin).catch(() => { /* ignore */ });
    }
  }
}

/**
 * One compile (if configured), then run every case against the same binary.
 * @param file
 * @param cases
 * @param onResult
 * @param onBeforeSample
 * @param defineLocal
 */
export async function runAllTestsSharedCompile(
  file: string,
  cases: TestCase[],
  onResult: (index: number, result: RunSampleResult) => void,
  onBeforeSample?: (index: number, total: number) => void,
  defineLocal = false,
): Promise<void> {
  const s = createRunSession(file, defineLocal);
  try {
    cpLog(`Run all: ${cases.length} test(s) → ${file}`);
    cpLog(`source: ${s.file}`);
    cpLog(`cwd: ${s.cwd}`);
    if (s.viaLogin) {
      cpLog(`login shell: ${s.loginPrefix}`);
    }
    if (s.defineLocal && s.compileCmd.length > 0) {
      cpLog("compile: -DLOCAL enabled");
    }

    const built = await compileOnce(s);
    if (!built.ok) {
      for (let i = 0; i < cases.length; i++) {
        onResult(
          i,
          compileFailureSampleResult(
            cases[i],
            built.verdict,
            built.compileStderr,
          ),
        );
      }
      return;
    }

    if (s.compileCmd.length > 0) {
      cpLog("Run all: using one shared binary for all samples");
    }

    for (let i = 0; i < cases.length; i++) {
      if (runState.cancelRequested) {
        cpLog("Run all: stopped by user (remaining samples skipped)");
        break;
      }
      onBeforeSample?.(i, cases.length);
      cpLog(`── sample ${cases[i].sample} ──`);
      try {
        const r = await runProgramForCase(s, cases[i]);
        onResult(i, r);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        cpLog(`Run all: sample ${cases[i]?.sample ?? i} threw: ${err}`);
        onResult(i, {
          ok: false,
          verdict: "WA",
          stdout: "",
          stderr: "",
          expected: cases[i].output,
          error: err,
        });
      }
    }
  } finally {
    if (s.cleanupBin !== null) {
      await fs.unlink(s.cleanupBin).catch(() => { /* ignore */ });
    }
  }
}

export interface StressTestResult {
  status: "passed" | "bug" | "stopped" | "generator_error" | "compile_error";
  iterations: number;
  /** Populated when status is "bug". */
  failedCase?: { input: string; expected: string; actual: string };
}

/**
 * Run stress test: compile once, then loop — generate input, optionally get expected from
 * reference solution, run primary solution, compare. Stop on first WA / RE / TLE.
 * @param file primary solution source path
 * @param generatorCmd shell command whose stdout is the raw test input
 * @param referenceCmd shell command whose stdout is the expected output (empty = only check RE/TLE)
 * @param maxIterations stop after this many passed iterations
 * @param defineLocal inject -DLOCAL into compile command
 * @param onProgress called each iteration with (current, max)
 */
export async function runStressTest(
  file: string,
  generatorCmd: string,
  referenceCmd: string,
  maxIterations: number,
  defineLocal: boolean,
  onProgress?: (i: number, max: number) => void,
): Promise<StressTestResult> {
  const s = createRunSession(file, defineLocal);
  try {
    cpLog(`Stress test: ${maxIterations} iterations → ${file}`);
    if (generatorCmd.length === 0) {
      return { status: "generator_error", iterations: 0 };
    }

    if (s.compileCmd.length > 0) {
      const built = await compileOnce(s);
      if (!built.ok) {
        cpLog("Stress: compile failed");
        return { status: "compile_error", iterations: 0 };
      }
    }

    for (let i = 1; i <= maxIterations; i++) {
      if (runState.cancelRequested) {
        cpLog(`Stress: stopped by user at iteration ${i}`);
        return { status: "stopped", iterations: i - 1 };
      }

      onProgress?.(i, maxIterations);

      const genR = await s.exec(generatorCmd, undefined);
      if (genR.timedOut || genR.code !== 0) {
        cpLog(`Stress: generator failed at iteration ${i} (exit ${genR.code ?? "null"})`);
        return { status: "generator_error", iterations: i - 1 };
      }
      const input = genR.stdout;

      let expected = "";
      if (referenceCmd.length > 0) {
        const refR = await s.exec(referenceCmd, input);
        if (refR.code !== 0 || refR.timedOut) {
          cpLog(`Stress: reference failed at iteration ${i} — skipping`);
          continue;
        }
        expected = normalizeOutput(refR.stdout, s.trim);
      }

      const runCmd = expand(s.runCmdTpl, s.file, s.outBin);
      const r = await s.exec(runCmd, input);

      if (r.timedOut) {
        cpLog(`Stress: TLE at iteration ${i}`);
        return { status: "bug", iterations: i, failedCase: { input, expected, actual: r.stdout } };
      }
      if (r.code !== 0) {
        cpLog(`Stress: RE at iteration ${i} (exit ${r.code ?? "null"})`);
        return { status: "bug", iterations: i, failedCase: { input, expected, actual: r.stdout } };
      }

      if (referenceCmd.length > 0) {
        const actual = normalizeOutput(r.stdout, s.trim);
        const match =
          actual === expected ||
          outputsEqualFloatAware(actual, expected, s.floatAbsEpsilon, s.floatRelEpsilon);
        if (!match) {
          cpLog(`Stress: WA at iteration ${i}`);
          return { status: "bug", iterations: i, failedCase: { input, expected, actual: r.stdout } };
        }
      }

      if (i % 10 === 0) {
        cpLog(`Stress: ${i} iterations passed`);
      }
    }

    cpLog(`Stress: all ${maxIterations} iterations passed`);
    return { status: "passed", iterations: maxIterations };
  } finally {
    if (s.cleanupBin !== null) {
      await fs.unlink(s.cleanupBin).catch(() => { /* ignore */ });
    }
  }
}

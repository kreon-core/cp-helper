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
  selectRunCompile,
  withLocalDefineExpanded,
} from "./compile-expansion";
import {
  binaryPathForBuild,
  cachedBinaryUsable,
  commitBinary,
  stagingPathFor,
} from "./compile-cache";
import { createCpLogger, truncateForLog } from "./log";
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

const compileLog = createCpLogger("compile");
const runLog = createCpLogger("runner");
const stressLog = createCpLogger("stress");

/**
 * Concurrency for Run all. Auto leaves a core for the editor and caps at 8 so per-sample
 * elapsed times stay meaningful (they are read as a rough TLE signal).
 * @param caseCount samples about to run
 */
function sampleConcurrency(caseCount: number): number {
  const cfg = vscode.workspace.getConfiguration("cp-helper");
  const raw = Number(cfg.get<number>("maxParallelSamples"));
  const configured = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 0;
  const auto = Math.min(8, Math.max(1, (os.cpus()?.length ?? 2) - 1));
  return Math.max(1, Math.min(caseCount, configured || auto));
}

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
  const selected = selectRunCompile(
    (cfg.get<string>("compileCommand") ?? "").trim(),
    (cfg.get<string>("localCompileCommand") ?? "").trim(),
    defineLocal,
  );
  const compileCmd = selected.tpl;
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
  const ext = process.platform === "win32" ? ".exe" : "";
  const outBin = path.join(
    os.tmpdir(),
    `cp-helper-${randomBytes(8).toString("hex")}${ext}`,
  );
  const exec = (cmd: string, stdin: string | undefined) =>
    runShell(cmd, cwd, stdin, timeoutMs);
  return {
    file,
    outBin,
    cwd,
    compileCmd,
    defineLocal,
    injectLocalDefine: selected.injectLocalDefine,
    runCmdTpl,
    trim,
    floatAbsEpsilon,
    floatRelEpsilon,
    checkerCmd,
    execLogged: false,
    exec,
  };
}

/**
 * @param s
 */
function logBuildMode(s: RunSession): void {
  if (s.compileCmd.length === 0) {
    return;
  }
  const mode = s.defineLocal ? "local" : "normal";
  const injected = s.injectLocalDefine ? " (-DLOCAL injected)" : "";
  compileLog.info(`build: ${mode}${injected}`);
}

/**
 * Build `s.file` into the content-addressed binary cache and point `s.outBin` at it.
 * A hit skips the compiler entirely; a miss compiles to a staging path and renames into place.
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

  let binPath: string;
  try {
    binPath = await binaryPathForBuild(s.file, s.compileCmd, s.defineLocal);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    compileLog.error(`failed to read source: ${err}`);
    return { ok: false, verdict: "RE", compileStderr: err };
  }

  if (await cachedBinaryUsable(binPath)) {
    s.outBin = binPath;
    compileLog.info("cache hit: source unchanged, skipping compile");
    return { ok: true };
  }

  const staging = stagingPathFor(binPath);
  await fs.mkdir(path.dirname(staging), { recursive: true }).catch(() => {
    /* exists */
  });
  let compile = expand(s.compileCmd, s.file, staging);
  if (s.injectLocalDefine) {
    compile = withLocalDefineExpanded(compile);
  }
  compileLog.info(`exec: ${truncateForLog(compile, 400)}`);
  const c = await s.exec(compile, undefined);
  const dropStaging = () =>
    fs.unlink(staging).catch(() => {
      /* never created */
    });
  if (c.cancelled) {
    compileLog.warn("aborted: stopped by user");
    await dropStaging();
    return { ok: false, verdict: "TLE", compileStderr: "Stopped by user" };
  }
  if (c.timedOut) {
    compileLog.error("aborted: time limit exceeded");
    await dropStaging();
    return {
      ok: false,
      verdict: "TLE",
      compileStderr: "Compile exceeded time limit",
    };
  }
  if (c.code !== 0) {
    const errText = c.stderr || c.stdout || `exit ${c.code}`;
    compileLog.error(`failed: exit code ${c.code}`);
    await dropStaging();
    return {
      ok: false,
      verdict: "WA",
      compileStderr: truncateForLog(errText, MAX_COMPILE_STDERR_WEBVIEW),
    };
  }

  try {
    await commitBinary(staging, binPath);
    s.outBin = binPath;
  } catch (e) {
    // Compile template wrote elsewhere (custom -o): run whatever it did produce.
    compileLog.warn(
      `binary not cached: ${e instanceof Error ? e.message : String(e)}`,
    );
    s.outBin = staging;
  }

  compileLog.info("ok");
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
  const runShown = runCmd;
  if (!s.execLogged) {
    runLog.info(`exec: ${truncateForLog(runShown, 500)}`);
    s.execLogged = true;
  }
  const tag = `sample ${tc.sample}`;

  const runStart = Date.now();
  const r = await s.exec(runCmd, tc.input);
  const elapsedMs = Date.now() - runStart;
  const execMs = Math.min(r.execMs, elapsedMs);
  const overheadMs = elapsedMs - execMs;
  if (r.cancelled) {
    runLog.warn(
      `${tag}: aborted - stopped by user (exit=${r.code ?? "null"} time=${elapsedMs}ms)`,
    );
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
      runLog.info(`${tag}: checker ${truncateForLog(checkerExpanded, 400)}`);
      const cr = await s.exec(checkerExpanded, undefined);
      if (cr.code === 0 && !cr.timedOut && !cr.cancelled) {
        verdict = "AC";
        ok = true;
        runLog.info(`${tag}: checker accepted`);
      } else {
        runLog.warn(`${tag}: checker rejected (exit=${cr.code ?? "null"})`);
      }
    } catch (e) {
      runLog.error(
        `${tag}: checker error - ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      await Promise.allSettled([
        fs.unlink(inTmp),
        fs.unlink(expTmp),
        fs.unlink(actTmp),
      ]);
    }
  }

  // One record per sample: fields on the summary line, dumps only when it fails.
  const summary =
    `${tag}: ${verdict} exit=${r.code ?? "null"} ` +
    `time=${elapsedMs}ms (exec=${execMs}ms overhead=${overheadMs}ms) ` +
    `in=${Buffer.byteLength(tc.input, "utf8")}B ` +
    `out=${Buffer.byteLength(r.stdout, "utf8")}B` +
    `${r.timedOut ? " killed=time-limit" : ""}`;
  if (ok) {
    runLog.info(summary);
  } else {
    runLog.warn(summary);
    runLog.detail(
      `expected (${Buffer.byteLength(exp, "utf8")}B, normalized):`,
      "WARN",
    );
    for (const ln of truncateForLog(exp, 2000).split("\n")) {
      runLog.detail(`  exp| ${ln}`, "WARN");
    }
    runLog.detail(`actual (${Buffer.byteLength(got, "utf8")}B, normalized):`, "WARN");
    for (const ln of truncateForLog(got, 2000).split("\n")) {
      runLog.detail(`  got| ${ln}`, "WARN");
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
    execMs,
    overheadMs,
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
  runLog.info(`run one: sample ${tc.sample}`);
  runLog.info(`source: ${s.file}`);
  runLog.info(`cwd: ${s.cwd}`);
  logBuildMode(s);
  const built = await compileOnce(s);
  if (!built.ok) {
    return compileFailureSampleResult(tc, built.verdict, built.compileStderr);
  }
  return await runProgramForCase(s, tc);
}

/**
 * One compile (if configured), then run every case against the same binary. Samples run
 * concurrently, so `onResult` fires out of order and `onProgress` reports a completion count.
 * @param file
 * @param cases
 * @param onResult
 * @param onProgress
 * @param defineLocal
 */
export async function runAllTestsSharedCompile(
  file: string,
  cases: TestCase[],
  onResult: (index: number, result: RunSampleResult) => void,
  onProgress?: (completed: number, total: number) => void,
  defineLocal = false,
  onStart?: (index: number) => void,
): Promise<void> {
  const s = createRunSession(file, defineLocal);
  runLog.info(`run all: ${cases.length} test(s)`);
  runLog.info(`source: ${s.file}`);
  runLog.info(`cwd: ${s.cwd}`);
  logBuildMode(s);

  const built = await compileOnce(s);
  if (!built.ok) {
    for (let i = 0; i < cases.length; i++) {
      onResult(
        i,
        compileFailureSampleResult(cases[i], built.verdict, built.compileStderr),
      );
    }
    return;
  }

  if (s.compileCmd.length > 0) {
    runLog.info("run all: reusing one binary for every sample");
  }

  const workers = sampleConcurrency(cases.length);
  runLog.info(`run all: ${workers} sample(s) at a time`);

  let passed = 0;
  let ran = 0;
  let started = 0;
  let finished = 0;
  const batchStart = Date.now();

  const runNext = async (): Promise<void> => {
    for (;;) {
      if (runState.cancelRequested) {
        return;
      }
      const i = started++;
      if (i >= cases.length) {
        return;
      }
      ran++;
      onStart?.(i);
      try {
        const r = await runProgramForCase(s, cases[i]);
        if (r.ok) passed++;
        onResult(i, r);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        runLog.error(`sample ${cases[i]?.sample ?? i} threw: ${err}`);
        onResult(i, {
          ok: false,
          verdict: "WA",
          stdout: "",
          stderr: "",
          expected: cases[i].output,
          error: err,
        });
      }
      // Progress is completion count, not position: samples finish out of order.
      onProgress?.(finished++, cases.length);
    }
  };

  await Promise.all(
    Array.from({ length: workers }, () => runNext()),
  );

  if (runState.cancelRequested) {
    runLog.warn("run all: stopped by user, remaining samples skipped");
  }
  const batchMs = Date.now() - batchStart;
  const done = `run all: ${passed}/${ran} passed in ${batchMs}ms`;
  if (passed === ran) {
    runLog.info(done);
  } else {
    runLog.warn(done);
  }
}

export interface StressTestResult {
  status: "passed" | "bug" | "stopped" | "generator_error" | "compile_error";
  iterations: number;
  /** Populated when status is "bug". */
  failedCase?: { input: string; expected: string; actual: string };
}

/**
 * Run stress test: compile once, then loop - generate input, optionally get expected from
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
  stressLog.info(`start: ${maxIterations} iteration(s)`);
  if (generatorCmd.length === 0) {
    return { status: "generator_error", iterations: 0 };
  }

  if (s.compileCmd.length > 0) {
    const built = await compileOnce(s);
    if (!built.ok) {
      stressLog.error("aborted: compile failed");
      return { status: "compile_error", iterations: 0 };
    }
  }

  for (let i = 1; i <= maxIterations; i++) {
    if (runState.cancelRequested) {
      stressLog.warn(`stopped by user at iteration ${i}`);
      return { status: "stopped", iterations: i - 1 };
    }

    onProgress?.(i, maxIterations);

    const genR = await s.exec(generatorCmd, undefined);
    if (genR.timedOut || genR.code !== 0) {
      stressLog.error(`generator failed at iteration ${i} (exit ${genR.code ?? "null"})`);
      return { status: "generator_error", iterations: i - 1 };
    }
    const input = genR.stdout;

    let expected = "";
    if (referenceCmd.length > 0) {
      const refR = await s.exec(referenceCmd, input);
      if (refR.code !== 0 || refR.timedOut) {
        stressLog.warn(`reference failed at iteration ${i}, skipping`);
        continue;
      }
      expected = normalizeOutput(refR.stdout, s.trim);
    }

    const runCmd = expand(s.runCmdTpl, s.file, s.outBin);
    const r = await s.exec(runCmd, input);

    if (r.timedOut) {
      stressLog.error(`TLE at iteration ${i}`);
      return { status: "bug", iterations: i, failedCase: { input, expected, actual: r.stdout } };
    }
    if (r.code !== 0) {
      stressLog.error(`RE at iteration ${i} (exit ${r.code ?? "null"})`);
      return { status: "bug", iterations: i, failedCase: { input, expected, actual: r.stdout } };
    }

    if (referenceCmd.length > 0) {
      const actual = normalizeOutput(r.stdout, s.trim);
      const match =
        actual === expected ||
        outputsEqualFloatAware(actual, expected, s.floatAbsEpsilon, s.floatRelEpsilon);
      if (!match) {
        stressLog.error(`WA at iteration ${i}`);
        return { status: "bug", iterations: i, failedCase: { input, expected, actual: r.stdout } };
      }
    }

    if (i % 10 === 0) {
      stressLog.info(`progress: ${i} iteration(s) passed`);
    }
  }

  stressLog.info(`done: all ${maxIterations} iteration(s) passed`);
  return { status: "passed", iterations: maxIterations };
}

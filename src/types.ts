import type { ChildProcess } from "child_process";

/** Tracks the shell child so Stop can SIGKILL it (compile or run). */
export interface ActiveShellHandle {
  child: ChildProcess;
  markUserKill: () => void;
}

/** Shape produced by OJ Sync / extractor JSON. */
export interface TestCase {
  sample: number;
  input: string;
  output: string;
}

/** One problem / sample bucket (e.g. Codeforces 2204A, 2204B, …). */
export interface CaseGroup {
  /** Stable id for persistence (single group often `"0"`; multi-problem uses `p0`, `p1`, … after normalize). */
  id: string;
  /** Shown in UI; e.g. `codeforces/2204G`. */
  label: string;
  cases: TestCase[];
}

export interface ShellRunOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  cancelled: boolean;
}

/** Verdict for UI: stderr alone never changes AC vs WA; RE = non-zero exit or abnormal end (not TLE). */
export type RunVerdict = "AC" | "WA" | "TLE" | "RE";

export interface RunSampleResult {
  ok: boolean;
  verdict: RunVerdict;
  stdout: string;
  stderr: string;
  expected: string;
  compileStderr?: string;
  /** Set when an unexpected exception occurred during run */
  error?: string;
  /** Wall-clock ms from stdin write to process close (undefined on compile failure or stop). */
  elapsedMs?: number;
}

export interface RunSession {
  file: string;
  outBin: string;
  cwd: string;
  compileCmd: string;
  /** When true and compileCmd is non-empty, `-DLOCAL` is injected after the compiler token. */
  defineLocal: boolean;
  runCmdTpl: string;
  trim: boolean;
  /** Max absolute error for numeric output tokens (e.g. 1e-9 vs 1e-12). */
  floatAbsEpsilon: number;
  /** Max relative error for numeric tokens (0 = disabled). Checked after absolute fails. */
  floatRelEpsilon: number;
  /** Optional checker command (empty = disabled). Runs after WA to allow multiple-correct-answer problems. */
  checkerCmd: string;
  viaLogin: boolean;
  loginPrefix: string;
  exec: (
    cmd: string,
    stdin: string | undefined,
  ) => Promise<ShellRunOutcome>;
}

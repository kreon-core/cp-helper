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

/** One problem / sample bucket (e.g. Codeforces 2204A, 2204B, ...). */
export interface CaseGroup {
  /** Stable id for persistence (single group often `"0"`; multi-problem uses `p0`, `p1`, ... after normalize). */
  id: string;
  /** Shown in UI; e.g. `codeforces/2204G`. */
  label: string;
  cases: TestCase[];
  /** Judge time limit scraped at import (ms). Unset when the judge publishes none (e.g. LeetCode). */
  timeLimitMs?: number;
}

export interface ShellRunOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  cancelled: boolean;
  /** Ms between the child's `spawn` and `exit` events: the program alone, without spawn setup or pipe drain. */
  execMs: number;
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
  /** Portion of `elapsedMs` the program itself was alive. */
  execMs?: number;
  /** `elapsedMs` minus `execMs`: process spawn setup and post-exit pipe drain. */
  overheadMs?: number;
  /** Judge time limit the verdict was measured against (ms), when the group carries one. */
  timeLimitMs?: number;
}

export interface RunSession {
  file: string;
  /** Cached binary the run executes; resolved by `compileOnce`. */
  outBin: string;
  cwd: string;
  compileCmd: string;
  /** -DLOCAL option state: selects the LOCAL compile command over the NORMAL one. */
  defineLocal: boolean;
  /** Set when the LOCAL command is empty and `-DLOCAL` has to be injected into the NORMAL one. */
  injectLocalDefine: boolean;
  runCmdTpl: string;
  trim: boolean;
  /** Max absolute error for numeric output tokens (e.g. 1e-9 vs 1e-12). */
  floatAbsEpsilon: number;
  /** Max relative error for numeric tokens (0 = disabled). Checked after absolute fails. */
  floatRelEpsilon: number;
  /** Optional checker command (empty = disabled). Runs after WA to allow multiple-correct-answer problems. */
  checkerCmd: string;
  /** Set once the run command has been logged, so a batch logs it a single time. */
  execLogged: boolean;
  /** Judge time limit for this group (ms), or 0 when the import carried none. */
  judgeTimeLimitMs: number;
  /** Kill timeout for a sample: `judgeTimeLimitMs * timeLimitFactor`, or 0 when unlimited. */
  judgeKillMs: number;
  exec: (
    cmd: string,
    stdin: string | undefined,
    timeoutMsOverride?: number,
  ) => Promise<ShellRunOutcome>;
}

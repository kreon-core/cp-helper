/**
 * Shared string and numeric constants for CP Helper (keep in sync with `package.json` where noted).
 */

export const WORKSPACE_KEY_CASES = "cp-helper.cases";
/** Grouped samples (multi-problem imports). When set, preferred over flat `CASES`. */
export const WORKSPACE_KEY_CASE_GROUPS = "cp-helper.caseGroups";
/** Label from OJ Sync (e.g. atcoder/abc451_a) — shown next to IMPORT. */
export const WORKSPACE_KEY_IMPORT_PROBLEM = "cp-helper.importProblem";
export const WORKSPACE_KEY_DEFINE_LOCAL = "cp-helper.defineLocal";

/** `when` clause: Samples webview has keyboard focus (for user keybindings). */
export const CONTEXT_SAMPLES_FOCUS = "cp-helper.samplesFocus";

/** Contributed webview view id — must match `package.json` `views` entry. */
export const VIEW_TYPE_SAMPLES = "cp-helper.webview";

/** Command palette ids — must match `package.json` `contributes.commands`. */
export const CMD_FOCUS_SAMPLES = "cpHelper.focusSamples";
export const CMD_RUN_FIRST_SAMPLE = "cpHelper.runFirstSample";
export const CMD_RUN_ALL_SAMPLES = "cpHelper.runAllSamples";
export const CMD_SHOW_OUTPUT = "cpHelper.showOutput";
export const CMD_IMPORT_CLIPBOARD = "cpHelper.importFromClipboard";
export const CMD_SELECT_COMPILE_PRESET = "cpHelper.selectCompilePreset";
export const CMD_EXPORT_CASES = "cpHelper.exportCases";
export const CMD_STRESS_TEST = "cpHelper.stressTest";

/** File (relative to workspace root) where case groups are also written for git tracking. */
export const CASES_FILE_RELATIVE_PATH = ".vscode/.cp-helper-cases.json";

export const OUTPUT_CHANNEL_NAME = "CP Helper";

/**
 * Cap stdout/stderr in every runResult postMessage. Large payloads + webview layout
 * (textarea scrollHeight) can freeze the host; stderr is capped tighter than stdout.
 */
export const MAX_STDOUT_CHARS_WEBVIEW = 16_384;
export const MAX_STDERR_CHARS_WEBVIEW = 4_096;
/** Compile error text sent to the webview (often shorter than full compiler spew). */
export const MAX_COMPILE_STDERR_WEBVIEW = 8_192;

/** Fallback when `runTimeoutMs` is missing or invalid (keep in sync with package.json default). */
export const DEFAULT_RUN_TIMEOUT_MS = 5000;

/** Default for `cp-helper.floatAbsEpsilon` when missing or invalid. */
export const DEFAULT_FLOAT_ABS_EPSILON = 1e-9;

/** Default for `cp-helper.floatRelEpsilon` when missing or invalid (0 = disabled). */
export const DEFAULT_FLOAT_REL_EPSILON = 0;

export const RUNNER_LABEL_MAX = 64;

/** POST /import body limit (local HTTP server). */
export const LOCAL_IMPORT_MAX_BODY = 32 * 1024 * 1024;

/** Raw accumulation caps inside runShell to prevent OOM on runaway output. */
export const MAX_STDOUT_ACCUMULATE_BYTES = 4 * 1024 * 1024;
export const MAX_STDERR_ACCUMULATE_BYTES = 1 * 1024 * 1024;

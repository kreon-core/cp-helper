/**
 * Shared string and numeric constants for CP Helper (keep in sync with `package.json` where noted).
 */

export const WORKSPACE_KEY_CASES = "cp-helper.cases";
/** Grouped samples (multi-problem imports). When set, preferred over flat `CASES`. */
export const WORKSPACE_KEY_CASE_GROUPS = "cp-helper.caseGroups";

/**
 * Last run's results per problem (verdicts, timings, captured output), keyed by group id so the
 * Samples view can paint them again after a reload. Results, unlike samples, are not worth a file
 * in the workspace, so they stay in workspace state.
 */
export const WORKSPACE_KEY_RUN_RESULTS = "cp-helper.runResults";
/** Ceiling on the stored results blob; past it the save is dropped rather than bloating the state db. */
export const RUN_RESULTS_MAX_BYTES = 4_000_000;

/** `when` clause: Samples webview has keyboard focus (for user keybindings). */
export const CONTEXT_SAMPLES_FOCUS = "cp-helper.samplesFocus";

/** Contributed webview view id - must match `package.json` `views` entry. */
export const VIEW_TYPE_SAMPLES = "cp-helper.webview";

/** Command palette ids - must match `package.json` `contributes.commands`. */
export const CMD_FOCUS_SAMPLES = "cpHelper.focusSamples";
export const CMD_RUN_FIRST_SAMPLE = "cpHelper.runFirstSample";
export const CMD_RUN_FIRST_SAMPLE_LOCAL = "cpHelper.runFirstSampleLocal";
export const CMD_RUN_ALL_SAMPLES = "cpHelper.runAllSamples";
export const CMD_RUN_ALL_SAMPLES_LOCAL = "cpHelper.runAllSamplesLocal";
export const CMD_SHOW_OUTPUT = "cpHelper.showOutput";
export const CMD_IMPORT_CLIPBOARD = "cpHelper.importFromClipboard";
export const CMD_SELECT_COMPILE_PRESET = "cpHelper.selectCompilePreset";
export const CMD_EXPORT_CASES = "cpHelper.exportCases";
export const CMD_STRESS_TEST = "cpHelper.stressTest";
export const CMD_COPY_SUBMIT_BRIDGE_URL = "cpHelper.copySubmitBridgeUrl";

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

/** Fallback for `debugConfigName` (keep in sync with package.json default). */
export const DEFAULT_DEBUG_CONFIG_NAME = "LLDB Debug";

/** Fallback when `runTimeoutMs` is missing or invalid (keep in sync with package.json default). */
export const DEFAULT_RUN_TIMEOUT_MS = 5000;

/** Local runs get this much slack over the judge's limit before the process is killed. */
export const DEFAULT_TIME_LIMIT_FACTOR = 2;

/** Default for `cp-helper.floatAbsEpsilon` when missing or invalid. */
export const DEFAULT_FLOAT_ABS_EPSILON = 1e-9;

/** Default for `cp-helper.floatRelEpsilon` when missing or invalid (0 = disabled). */
export const DEFAULT_FLOAT_REL_EPSILON = 0;

export const RUNNER_LABEL_MAX = 64;

/**
 * Run takes over from the run already in flight: how long to wait for the previous handler
 * to release the run lock after its subprocess tree is killed, and the poll step.
 */
export const RUN_TAKEOVER_TIMEOUT_MS = 5000;
export const RUN_TAKEOVER_POLL_MS = 10;

/** POST /import body limit (local HTTP server). */
export const LOCAL_IMPORT_MAX_BODY = 32 * 1024 * 1024;

/** Raw accumulation caps inside runShell to prevent OOM on runaway output. */
export const MAX_STDOUT_ACCUMULATE_BYTES = 4 * 1024 * 1024;
export const MAX_STDERR_ACCUMULATE_BYTES = 1 * 1024 * 1024;

/** Extensions CP Helper accepts as a solution source. C++ only, by design. */
export const CPP_SOURCE_EXTENSIONS = [
  ".cpp",
  ".cc",
  ".cxx",
  ".c++",
  ".cp",
  ".ixx",
] as const;

/** Human-readable list for error messages. */
export const CPP_EXTENSIONS_HINT = CPP_SOURCE_EXTENSIONS.join(", ");

/** Compiled binaries kept in the on-disk cache before the oldest are pruned. */
export const BINARY_CACHE_MAX_ENTRIES = 64;

/** WebSocket path OJ Sync connects to on the local import server (submit bridge). */
export const SUBMIT_BRIDGE_PATH = "/submit";

/** Global state key holding the shared secret OJ Sync must present to open the bridge. */
export const GLOBAL_KEY_SUBMIT_TOKEN = "cp-helper.submitToken";

/** Application-level keepalive: Chrome suspends an idle MV3 service worker after ~30s. */
export const SUBMIT_BRIDGE_PING_MS = 20_000;

/** A job with no reply in this long is reported as a timeout (the browser may still have sent it). */
export const SUBMIT_JOB_TIMEOUT_MS = 180_000;

/** Fallback for `submitPollTimeoutMs` (keep in sync with package.json default). */
export const DEFAULT_SUBMIT_POLL_TIMEOUT_MS = 90_000;

/** Largest source file the bridge will hand to the browser. */
export const SUBMIT_MAX_SOURCE_BYTES = 512 * 1024;

/** How long a notification with nothing wrong in it stays up before CP Helper closes it. */
export const NOTIFY_TOAST_MS = 1_000;


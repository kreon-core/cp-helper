import * as vscode from "vscode";
import {
  coerceTimeLimitMs,
  loadCaseGroups,
  loadCaseGroupsFromFile,
  mergeCaseGroups,
  persistCaseGroups,
  persistCaseGroupsToFile,
} from "./case-groups";
import {
  appendLeetcodeCppDispatchMain,
  isLikelyCppSource,
} from "./leetcode-cpp-clipboard";
import { createCpLogger } from "./log";
import type { CaseGroup, TestCase } from "./types";

const log = createCpLogger("import");

/** Thrown when trimmed import text has length 0 (clipboard, URI, or Load). */
export const ERR_IMPORT_EMPTY = "Import is empty";

/** Minimal surface needed to push imported cases into the UI. */
export interface SamplesWebviewSink {
  applyGroupsToWebview(groups: CaseGroup[]): void;
}

function parseCasesArray(data: unknown[]): TestCase[] {
  return data.map((item, i) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid item at index ${i}`);
    }
    const o = item as Record<string, unknown>;
    const sample = typeof o.sample === "number" ? o.sample : i + 1;
    const input = typeof o.input === "string" ? o.input : "";
    const output = typeof o.output === "string" ? o.output : "";
    return { sample, input, output };
  });
}

function renumberCases(cases: TestCase[]): TestCase[] {
  return cases.map((c, i) => ({ ...c, sample: i + 1 }));
}

function readProblemUrlField(o: Record<string, unknown>): string | null {
  const u = o.url;
  if (typeof u !== "string" || u.trim() === "") {
    return null;
  }
  const trimmed = u.trim();
  return /^https?:\/\//iu.test(trimmed) ? trimmed : null;
}

function readStarterCodeField(o: Record<string, unknown>): string | null {
  const sc = o.starterCode;
  if (typeof sc === "string" && sc.trim() !== "") {
    return sc.trim();
  }
  return null;
}

/**
 * OJ Sync contest-list payload: `{ clipboardText }` with no samples, carrying the `contest.sh`
 * arguments for a Codeforces contest.
 * @returns the text to put on the clipboard, or `null` when this is a normal samples payload.
 */
export function readClipboardOnlyPayload(text: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const o = data as Record<string, unknown>;
  if (
    o.samples !== undefined ||
    o.cases !== undefined ||
    o.problems !== undefined
  ) {
    return null;
  }
  const t = o.clipboardText;
  return typeof t === "string" && t.trim() !== "" ? t.trim() : null;
}

/**
 * OJ Sync: plain array, `{ problem, samples }`, or `{ problems: [...] }` (Codeforces multi).
 */
export function parseImportPayload(text: string): {
  groups: CaseGroup[];
  starterCode: string | null;
} {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) {
    return {
      groups: [{ id: "0", label: "", cases: parseCasesArray(data) }],
      starterCode: null,
    };
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const rawProb = o.problem ?? o.importProblem;
    const problemLabel =
      typeof rawProb === "string" && rawProb.trim() !== ""
        ? rawProb.trim()
        : null;
    const problems = o.problems;
    if (Array.isArray(problems) && problems.length > 0) {
      /** @type {CaseGroup[]} */
      const groups = [];
      for (let pi = 0; pi < problems.length; pi++) {
        const block = problems[pi];
        if (!block || typeof block !== "object") {
          continue;
        }
        const bo = block as Record<string, unknown>;
        const arr = bo.samples ?? bo.cases;
        if (!Array.isArray(arr) || arr.length === 0) {
          continue;
        }
        const probLabel =
          typeof bo.problem === "string" && bo.problem.trim() !== ""
            ? bo.problem.trim()
            : "";
        const group: CaseGroup = {
          id: String(pi),
          label: probLabel,
          cases: renumberCases(parseCasesArray(arr)),
        };
        const tl = coerceTimeLimitMs(bo.timeLimitMs);
        if (tl !== null) {
          group.timeLimitMs = tl;
        }
        const purl = readProblemUrlField(bo);
        if (purl !== null) {
          group.url = purl;
        }
        groups.push(group);
      }
      if (groups.length === 0) {
        throw new Error(
          "Object `problems` must contain non-empty `samples` arrays",
        );
      }
      return {
        groups,
        starterCode: readStarterCodeField(o),
      };
    }
    const samples = o.samples ?? o.cases;
    if (Array.isArray(samples)) {
      const group: CaseGroup = {
        id: "0",
        label: problemLabel ?? "",
        cases: parseCasesArray(samples),
      };
      const tl = coerceTimeLimitMs(o.timeLimitMs);
      if (tl !== null) {
        group.timeLimitMs = tl;
      }
      const purl = readProblemUrlField(o);
      if (purl !== null) {
        group.url = purl;
      }
      return {
        groups: [group],
        starterCode: readStarterCodeField(o),
      };
    }
  }
  throw new Error(
    "JSON must be a testcase array, { samples: [...], problem?: string, timeLimitMs?: number, starterCode?: string }, or { problems: [{ samples, problem?, timeLimitMs? }, ...] }",
  );
}

export type ImportLogSource = "import" | "loadJson";

/**
 * Parse JSON, fold it into the groups already imported, and refresh the webview (used by URI
 * handler, palette, local HTTP, Load button).
 * @returns `imported`, the index each payload problem ended up at (for the instant-run heuristic).
 */
export async function importSamplesFromJsonText(
  ctx: vscode.ExtensionContext,
  provider: SamplesWebviewSink,
  text: string,
  logSource: ImportLogSource = "import",
): Promise<{ groupCount: number; imported: number[] }> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(ERR_IMPORT_EMPTY);
  }
  const { groups, starterCode } = parseImportPayload(trimmed);
  const total = groups.reduce((n, g) => n + g.cases.length, 0);
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const existing = wsFolder
    ? await loadCaseGroupsFromFile(ctx.workspaceState, wsFolder)
    : loadCaseGroups(ctx.workspaceState);
  const { groups: merged, imported } = mergeCaseGroups(existing, groups);
  await persistCaseGroups(ctx.workspaceState, merged);
  const stored = loadCaseGroups(ctx.workspaceState);
  // The cases file wins over workspace state on `restore` (see loadCaseGroupsFromFile), and a
  // cold webview answers the reveal below with `restore`. Write it here - awaited, before the
  // view is revealed - or the previous problem's file replies to this import.
  if (wsFolder) {
    try {
      await persistCaseGroupsToFile(stored, wsFolder);
    } catch (e) {
      log.warn(
        `cases file not written: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  log.info(
    `loaded ${total} sample(s) in ${groups.length} problem(s) from ${logSource}; list now holds ${stored.length} group(s)`,
  );
  provider.applyGroupsToWebview(stored);
  if (starterCode !== null) {
    if (!isLikelyCppSource(starterCode)) {
      log.warn(
        "starter code skipped: CP Helper supports C++ only (no C++-style starter detected)",
      );
    } else {
      try {
        const toPaste = appendLeetcodeCppDispatchMain(starterCode);
        await vscode.env.clipboard.writeText(toPaste);
        log.info(
          "starter code copied to clipboard (LeetCode import) - paste it into your solution file",
        );
      } catch (e) {
        log.error(
          `clipboard write failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return { groupCount: stored.length, imported };
}

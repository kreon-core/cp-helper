import * as vscode from "vscode";
import { WORKSPACE_KEY_IMPORT_PROBLEM } from "./constants";
import { loadCaseGroups, persistCaseGroups } from "./case-groups";
import {
  appendLeetcodeCppDispatchMain,
  isLikelyCppSource,
} from "./leetcode-cpp-clipboard";
import { cpLog } from "./log";
import type { CaseGroup, TestCase } from "./types";

/** Thrown when trimmed import text has length 0 (clipboard, URI, or Load). */
export const ERR_IMPORT_EMPTY = "Import is empty";

/** Minimal surface needed to push imported cases into the UI. */
export interface SamplesWebviewSink {
  applyGroupsToWebview(
    groups: CaseGroup[],
    importProblem?: string | null,
  ): void;
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

function readStarterCodeField(o: Record<string, unknown>): string | null {
  const sc = o.starterCode;
  if (typeof sc === "string" && sc.trim() !== "") {
    return sc.trim();
  }
  return null;
}

/**
 * OJ Sync: plain array, `{ problem, samples }`, or `{ problems: [...] }` (Codeforces multi).
 */
export function parseImportPayload(text: string): {
  groups: CaseGroup[];
  importProblem: string | null;
  starterCode: string | null;
} {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) {
    return {
      groups: [{ id: "0", label: "", cases: parseCasesArray(data) }],
      importProblem: null,
      starterCode: null,
    };
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const rawProb = o.problem ?? o.importProblem;
    let importProblem: string | null = null;
    if (typeof rawProb === "string" && rawProb.trim() !== "") {
      importProblem = rawProb.trim();
    }
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
        groups.push({
          id: String(pi),
          label: probLabel,
          cases: renumberCases(parseCasesArray(arr)),
        });
      }
      if (groups.length === 0) {
        throw new Error(
          "Object `problems` must contain non-empty `samples` arrays",
        );
      }
      const label =
        typeof o.importProblem === "string" && o.importProblem.trim() !== ""
          ? o.importProblem.trim()
          : typeof o.contestId === "string" && o.contestId.trim() !== ""
            ? `codeforces/${o.contestId.trim()}`
            : importProblem;
      return {
        groups,
        importProblem: label,
        starterCode: readStarterCodeField(o),
      };
    }
    const samples = o.samples ?? o.cases;
    if (Array.isArray(samples)) {
      return {
        groups: [
          {
            id: "0",
            label: importProblem ?? "",
            cases: parseCasesArray(samples),
          },
        ],
        importProblem,
        starterCode: readStarterCodeField(o),
      };
    }
  }
  throw new Error(
    "JSON must be a testcase array, { samples: [...], problem?: string, starterCode?: string }, or { problems: [{ samples, problem? }, ...] }",
  );
}

export type ImportLogSource = "import" | "loadJson";

/**
 * Parse JSON, persist, and refresh the webview (used by URI handler, palette, local HTTP, Load button).
 * @returns `groupCount` after normalize (for local HTTP import instant-run heuristics).
 */
export async function importSamplesFromJsonText(
  ctx: vscode.ExtensionContext,
  provider: SamplesWebviewSink,
  text: string,
  logSource: ImportLogSource = "import",
): Promise<{ groupCount: number }> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(ERR_IMPORT_EMPTY);
  }
  const { groups, importProblem, starterCode } = parseImportPayload(trimmed);
  const total = groups.reduce((n, g) => n + g.cases.length, 0);
  await persistCaseGroups(ctx.workspaceState, groups);
  await ctx.workspaceState.update(WORKSPACE_KEY_IMPORT_PROBLEM, importProblem);
  const stored = loadCaseGroups(ctx.workspaceState);
  cpLog(
    `Loaded ${total} sample(s) in ${stored.length} group(s) from ${logSource}`,
  );
  provider.applyGroupsToWebview(stored, importProblem);
  if (starterCode !== null) {
    if (!isLikelyCppSource(starterCode)) {
      cpLog(
        "starterCode not copied: CP Helper supports C++ only (no C++-style starter detected).",
      );
    } else {
      try {
        const toPaste = appendLeetcodeCppDispatchMain(starterCode);
        await vscode.env.clipboard.writeText(toPaste);
        cpLog(
          "Copied C++ starter code to the clipboard (OJ Sync LeetCode import). Paste into your solution file.",
        );
      } catch (e) {
        cpLog(
          `Could not copy starter code to the clipboard: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return { groupCount: stored.length };
}

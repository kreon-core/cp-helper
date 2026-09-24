import * as vscode from "vscode";
import { CASES_FILE_RELATIVE_PATH, WORKSPACE_KEY_CASE_GROUPS, WORKSPACE_KEY_CASES } from "./constants";
import type { CaseGroup, TestCase } from "./types";

/** Pure decimal id (e.g. Codeforces multi import used "0","1",... - collides with single-group "0" in webview collapse state). */
const DIGIT_ID = /^\d+$/u;

/**
 * Judge limits outside 100ms..60s are treated as a scrape error and dropped.
 * @param v raw `timeLimitMs` from storage or import
 */
export function coerceTimeLimitMs(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 60_000 ? Math.round(n) : null;
}

/**
 * Judge limits outside 1MB..64GB are treated as a scrape error and dropped.
 * @param v raw `memoryLimitMb` from storage or import
 */
export function coerceMemoryLimitMb(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 65_536 ? Math.round(n) : null;
}

function multiGroupsAllDigitIds(groups: CaseGroup[]): boolean {
  return (
    groups.length > 1 &&
    groups.every(
      (g) => typeof g.id === "string" && g.id.length > 0 && DIGIT_ID.test(g.id),
    )
  );
}

/**
 * Normalize groups from storage or import (stable ids, valid cases arrays).
 * Multi-group rows that only use numeric ids are rewritten to `p0`, `p1`, ... so they do not share
 * id `"0"` with the default single-group bucket (fixes first problem always collapsed in the webview).
 */
export function normalizeCaseGroups(groups: CaseGroup[]): CaseGroup[] {
  const remapMultiDigitIds = multiGroupsAllDigitIds(groups);
  return groups.map((g, i) => {
    let id: string;
    if (remapMultiDigitIds) {
      id = `p${i}`;
    } else if (typeof g.id === "string" && g.id.length > 0) {
      id = g.id;
    } else {
      id = `g${i}`;
    }
    const out: CaseGroup = {
      id,
      label: typeof g.label === "string" ? g.label : "",
      cases: Array.isArray(g.cases) ? g.cases : [],
    };
    const tl = coerceTimeLimitMs(g.timeLimitMs);
    if (tl !== null) {
      out.timeLimitMs = tl;
    }
    const ml = coerceMemoryLimitMb(g.memoryLimitMb);
    if (ml !== null) {
      out.memoryLimitMb = ml;
    }
    if (typeof g.url === "string" && g.url.trim() !== "") {
      out.url = g.url.trim();
    }
    if (typeof g.source === "string" && g.source.trim() !== "") {
      out.source = g.source.trim();
    }
    return out;
  });
}

/**
 * Prefer `caseGroups`; if empty, fall back to flat `cp-helper.cases` as one unnamed group.
 */
export function loadCaseGroups(ws: vscode.Memento): CaseGroup[] {
  const raw = ws.get<CaseGroup[]>(WORKSPACE_KEY_CASE_GROUPS);
  if (Array.isArray(raw) && raw.length > 0) {
    return normalizeCaseGroups(raw);
  }
  const flat = ws.get<TestCase[]>(WORKSPACE_KEY_CASES);
  if (Array.isArray(flat) && flat.length > 0) {
    return [{ id: "0", label: "", cases: [...flat] }];
  }
  return [];
}

export async function persistCaseGroups(
  ws: vscode.Memento,
  groups: CaseGroup[],
): Promise<void> {
  const norm = normalizeCaseGroups(groups);
  await ws.update(WORKSPACE_KEY_CASE_GROUPS, norm);
  await ws.update(WORKSPACE_KEY_CASES, []);
}

/**
 * Also write groups to `.vscode/.cp-helper-cases.json` for git tracking.
 * Errors are logged but not thrown (workspace state remains the source of truth).
 * @param groups normalized case groups
 * @param wsFolderUri workspace root URI
 */
export async function persistCaseGroupsToFile(
  groups: CaseGroup[],
  wsFolderUri: vscode.Uri,
): Promise<void> {
  const norm = normalizeCaseGroups(groups);
  const fileUri = vscode.Uri.joinPath(wsFolderUri, CASES_FILE_RELATIVE_PATH);
  const payload = JSON.stringify({ v: 1, groups: norm }, null, 2);
  await vscode.workspace.fs.writeFile(
    fileUri,
    Buffer.from(payload, "utf8"),
  );
}

/**
 * Load case groups from `.vscode/.cp-helper-cases.json` if it exists and is non-empty;
 * fall back to workspace state memento.
 * @param ws workspace state memento (fallback)
 * @param wsFolderUri workspace root URI
 */
export async function loadCaseGroupsFromFile(
  ws: vscode.Memento,
  wsFolderUri: vscode.Uri,
): Promise<CaseGroup[]> {
  try {
    const fileUri = vscode.Uri.joinPath(wsFolderUri, CASES_FILE_RELATIVE_PATH);
    const raw = await vscode.workspace.fs.readFile(fileUri);
    const data = JSON.parse(Buffer.from(raw).toString("utf8")) as {
      v?: number;
      groups?: unknown;
    };
    if (Array.isArray(data.groups) && data.groups.length > 0) {
      return normalizeCaseGroups(data.groups as CaseGroup[]);
    }
  } catch {
    /* file not found or malformed - fall through to workspace state */
  }
  return loadCaseGroups(ws);
}

/** Import identity of a group: the problem URL when one was scraped, else the label. */
function groupMatchKey(g: CaseGroup): string {
  const url = (g.url ?? "").trim().toLowerCase();
  if (url !== "") {
    return `u:${url}`;
  }
  const label = (g.label ?? "").trim().toLowerCase();
  return label !== "" ? `l:${label}` : "";
}

/** The unnamed empty bucket `ensureDefaultGroup` keeps around; an import overwrites it. */
function isEmptyPlaceholder(g: CaseGroup): boolean {
  return (g.label ?? "").trim() === "" && (g.cases?.length ?? 0) === 0;
}

export interface MergeCaseGroupsResult {
  groups: CaseGroup[];
  /** Index in `groups` of each incoming group, in payload order. */
  imported: number[];
}

/**
 * Fold an import into the list already on screen. A problem that is present is refreshed where it
 * stands and everything else is appended, so the first group - the one the run shortcuts and the
 * view title follow - only changes when the user deletes it.
 * @param existing groups currently persisted
 * @param incoming groups parsed out of the import payload
 */
export function mergeCaseGroups(
  existing: CaseGroup[],
  incoming: CaseGroup[],
): MergeCaseGroupsResult {
  const out = existing.filter((g) => !isEmptyPlaceholder(g));
  const imported: number[] = [];
  const stamp = Date.now().toString(36);
  incoming.forEach((inc, i) => {
    const key = groupMatchKey(inc);
    const at =
      key === "" ? -1 : out.findIndex((g) => groupMatchKey(g) === key);
    if (at >= 0) {
      // A re-import refreshes the samples; which file the problem is being solved in is the
      // user's, not the payload's, so it survives.
      const kept = out[at];
      out[at] = { ...inc, id: kept.id };
      if (kept.source !== undefined) {
        out[at].source = kept.source;
      }
      imported.push(at);
      return;
    }
    out.push({ ...inc, id: `imp-${stamp}-${i}` });
    imported.push(out.length - 1);
  });
  return { groups: out, imported };
}

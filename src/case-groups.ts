import * as vscode from "vscode";
import { CASES_FILE_RELATIVE_PATH, WORKSPACE_KEY_CASE_GROUPS, WORKSPACE_KEY_CASES } from "./constants";
import type { CaseGroup, TestCase } from "./types";

/** Pure decimal id (e.g. Codeforces multi import used "0","1",… — collides with single-group "0" in webview collapse state). */
const DIGIT_ID = /^\d+$/u;

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
 * Multi-group rows that only use numeric ids are rewritten to `p0`, `p1`, … so they do not share
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
    return {
      id,
      label: typeof g.label === "string" ? g.label : "",
      cases: Array.isArray(g.cases) ? g.cases : [],
    };
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
    /* file not found or malformed — fall through to workspace state */
  }
  return loadCaseGroups(ws);
}

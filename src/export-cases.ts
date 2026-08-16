import * as vscode from "vscode";
import type { TestCase } from "./types";

const EXPORTED_FILE = /^sample_\d+\.(in|out)(\.txt)?$/u;

/**
 * Write cases as testcases/sample_N.in.txt + sample_N.out.txt, removing previously
 * exported sample files first so a shorter export does not leave stale ones behind.
 * Returns the number of cases written.
 */
export async function exportCasesToTestcasesDir(
  workspaceFolder: vscode.Uri,
  cases: TestCase[],
): Promise<number> {
  const testcasesDir = vscode.Uri.joinPath(workspaceFolder, "testcases");
  let existing: [string, vscode.FileType][] = [];
  try {
    existing = await vscode.workspace.fs.readDirectory(testcasesDir);
  } catch {
    await vscode.workspace.fs.createDirectory(testcasesDir);
  }
  for (const [name, type] of existing) {
    if (type === vscode.FileType.File && EXPORTED_FILE.test(name)) {
      await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(testcasesDir, name),
      );
    }
  }
  for (const [i, tc] of cases.entries()) {
    const n = tc.sample > 0 ? tc.sample : i + 1;
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(testcasesDir, `sample_${n}.in.txt`),
      Buffer.from(tc.input, "utf8"),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(testcasesDir, `sample_${n}.out.txt`),
      Buffer.from(tc.output, "utf8"),
    );
  }
  return cases.length;
}

import * as path from "path";

/**
 * @param tpl
 * @param file absolute source path
 * @param out temp binary path
 */
export function expand(tpl: string, file: string, out: string): string {
  const dir = path.dirname(file);
  return tpl
    .replace(/\{\{file\}\}/g, file)
    .replace(/\{\{dir\}\}/g, dir)
    .replace(/\{\{out\}\}/g, out);
}

/**
 * First shell token of a command line (respects one leading quoted segment).
 * @param s
 */
export function firstShellToken(s: string): string | null {
  const t = s.trim();
  if (!t) {
    return null;
  }
  if (t[0] === '"' || t[0] === "'") {
    const q = t[0];
    let i = 1;
    while (i < t.length) {
      if (t[i] === "\\") {
        i += 2;
        continue;
      }
      if (t[i] === q) {
        return t.slice(1, i);
      }
      i += 1;
    }
    return t.slice(1);
  }
  const m = /^(\S+)/u.exec(t);
  return m ? m[1] : null;
}

/**
 * `-std=…` from a compile command, if present.
 * @param compileCmd
 */
export function extractStdFlag(compileCmd: string): string | null {
  const m = /-std=([^\s"'`]+)/u.exec(compileCmd);
  return m ? m[1] : null;
}

/**
 * Inserts `-DLOCAL` immediately after the first token (compiler), e.g. `g++ -std=c++20 …` → `g++ -DLOCAL -std=c++20 …`.
 * If your `compileCommand` starts with a shell wrapper, add `-DLOCAL` in settings instead.
 * @param compileExpanded already-expanded compile line
 */
export function withLocalDefineExpanded(compileExpanded: string): string {
  const t = compileExpanded.trimStart();
  const m = /^(\S+)(.*)/su.exec(t);
  if (!m) {
    return `${t} -DLOCAL`;
  }
  return `${m[1]} -DLOCAL${m[2]}`;
}

/**
 * Wrap so login rc files load (aliases/functions like `run`).
 * @param inner full shell command
 * @param prefix e.g. bash -l -c
 */
export function wrapForLoginShell(inner: string, prefix: string): string {
  const p = prefix.trim();
  if (!p) return inner;
  return `${p} ${JSON.stringify(inner)}`;
}

/**
 * Expand a checker command template with standard placeholders plus checker-specific ones.
 * Placeholders: {{file}}, {{dir}}, {{out}}, {{input}}, {{expected}}, {{actual}}.
 * @param tpl checker command template
 * @param file source file path
 * @param outBin compiled binary path
 * @param inputPath temp file containing test input
 * @param expectedPath temp file containing expected output
 * @param actualPath temp file containing actual program output
 */
export function expandChecker(
  tpl: string,
  file: string,
  outBin: string,
  inputPath: string,
  expectedPath: string,
  actualPath: string,
): string {
  return expand(tpl, file, outBin)
    .replace(/\{\{input\}\}/g, inputPath)
    .replace(/\{\{expected\}\}/g, expectedPath)
    .replace(/\{\{actual\}\}/g, actualPath);
}

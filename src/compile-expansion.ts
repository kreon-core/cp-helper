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
 * `-std=...` from a compile command, if present.
 * @param compileCmd
 */
export function extractStdFlag(compileCmd: string): string | null {
  const m = /-std=([^\s"'`]+)/u.exec(compileCmd);
  return m ? m[1] : null;
}

/**
 * Inserts `-DLOCAL` immediately after the first token (compiler), e.g. `g++ -std=c++20 ...` -> `g++ -DLOCAL -std=c++20 ...`.
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

/** Optimisation levels a derived debug build has to drop, or a later -O2 would win over -O0. */
const OPT_LEVEL_FLAG = /\s-O(?:fast|[0-3sgz])?(?=\s|$)/gu;

/** A compile template plus whether `-DLOCAL` still has to be injected into it. */
export interface SelectedCompile {
  tpl: string;
  injectLocalDefine: boolean;
}

/**
 * Pick the compile line for a run: the LOCAL command while the -DLOCAL option is on, the NORMAL
 * one otherwise. An empty LOCAL command falls back to the NORMAL one with `-DLOCAL` injected.
 * @param normalCmd `cp-helper.compileCommand`
 * @param localCmd `cp-helper.localCompileCommand`
 * @param defineLocal -DLOCAL option state
 */
export function selectRunCompile(
  normalCmd: string,
  localCmd: string,
  defineLocal: boolean,
): SelectedCompile {
  if (!defineLocal) {
    return { tpl: normalCmd, injectLocalDefine: false };
  }
  if (localCmd.length > 0) {
    return { tpl: localCmd, injectLocalDefine: false };
  }
  return { tpl: normalCmd, injectLocalDefine: true };
}

/**
 * Pick the compile line for the debug button. An empty DEBUG command derives one from whichever
 * run command is active by adding `-g -O0`.
 * @param debugCmd `cp-helper.debugCompileCommand`
 * @param run command the run buttons would use
 */
export function selectDebugCompile(
  debugCmd: string,
  run: SelectedCompile,
): SelectedCompile {
  if (debugCmd.length > 0) {
    return { tpl: debugCmd, injectLocalDefine: false };
  }
  const base = run.tpl.trimStart().replace(OPT_LEVEL_FLAG, "");
  const m = /^(\S+)(.*)/su.exec(base);
  return {
    tpl: m ? `${m[1]} -g -O0${m[2]}` : `${base} -g -O0`,
    injectLocalDefine: run.injectLocalDefine,
  };
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

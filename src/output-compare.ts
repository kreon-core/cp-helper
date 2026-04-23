import { DEFAULT_FLOAT_ABS_EPSILON, DEFAULT_FLOAT_REL_EPSILON } from "./constants";

/**
 * @param s
 * @param trimTrailing
 */
export function normalizeOutput(s: string, trimTrailing: boolean): string {
  let t = s.replace(/\r\n/g, "\n");
  if (trimTrailing) {
    t = t.replace(/\s+$/u, "");
  }
  return t;
}

/**
 * @param raw workspace setting value
 */
export function coerceFloatAbsEpsilon(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_FLOAT_ABS_EPSILON;
  }
  return Math.min(Math.max(n, 1e-18), 1);
}

/**
 * @param raw workspace setting value (0 or missing disables relative epsilon)
 */
export function coerceFloatRelEpsilon(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_FLOAT_REL_EPSILON;
  }
  return Math.min(n, 1);
}

/**
 * Token is a finite decimal/scientific literal (competitive programming style), whole string only.
 * @param t non-empty token
 */
function isNumericOutputToken(t: string): boolean {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/u.test(t);
}

/**
 * Token is a plain integer literal (no dot, no exponent).
 * @param t non-empty token
 */
function isIntegerToken(t: string): boolean {
  return /^[-+]?\d+$/u.test(t);
}

/**
 * @param a
 * @param b
 * @param absEpsilon max |a-b|
 * @param relEpsilon max |a-b|/max(|a|,|b|); checked only when absEpsilon fails and relEpsilon > 0
 */
function nearlyEqualDoubles(
  a: number,
  b: number,
  absEpsilon: number,
  relEpsilon: number,
): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  const diff = Math.abs(a - b);
  if (diff <= absEpsilon) {
    return true;
  }
  if (relEpsilon > 0) {
    const scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale > 0 && diff / scale <= relEpsilon) {
      return true;
    }
  }
  return false;
}

/**
 * @param x
 * @param y
 * @param absEpsilon
 * @param relEpsilon
 */
function numericTokensAlmostEqual(
  x: string,
  y: string,
  absEpsilon: number,
  relEpsilon: number,
): boolean {
  if (x === y) {
    return true;
  }
  if (!isNumericOutputToken(x) || !isNumericOutputToken(y)) {
    return false;
  }
  // Integer tokens must match exactly — epsilon tolerance only applies to floats.
  if (isIntegerToken(x) || isIntegerToken(y)) {
    return false;
  }
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return false;
  }
  return nearlyEqualDoubles(nx, ny, absEpsilon, relEpsilon);
}

/**
 * Split on newlines and drop trailing empty segments so `a\\n` and `a` align.
 * @param s normalized output
 */
function splitLinesStripTrailingEmpties(s: string): string[] {
  const lines = s.split(/\n/u);
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end--;
  }
  return lines.slice(0, end);
}

/**
 * Line-wise, whitespace-token-wise compare: non-numeric tokens must match exactly;
 * numeric tokens may differ in formatting (e.g. 0.612 vs 0.612000000) within epsilon.
 * @param a one line
 * @param b other line
 * @param absEpsilon from settings (e.g. 1e-9 or 1e-12)
 * @param relEpsilon relative epsilon (0 = disabled)
 */
function outputLinesEqualWithDoubleTokens(
  a: string,
  b: string,
  absEpsilon: number,
  relEpsilon: number,
): boolean {
  if (a === b) {
    return true;
  }
  const aw = a.trim();
  const bw = b.trim();
  if (aw === bw) {
    return true;
  }
  const at = aw.split(/\s+/u).filter(Boolean);
  const bt = bw.split(/\s+/u).filter(Boolean);
  if (at.length !== bt.length) {
    return false;
  }
  for (let i = 0; i < at.length; i++) {
    const x = at[i];
    const y = bt[i];
    if (x === y) {
      continue;
    }
    if (numericTokensAlmostEqual(x, y, absEpsilon, relEpsilon)) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * True if full stdout matches expected after strict string compare fails but every line/token
 * agrees when numeric tokens match as doubles within absEpsilon or relEpsilon.
 * @param got normalized program output
 * @param exp normalized expected output
 * @param absEpsilon max |got-exp| per numeric token
 * @param relEpsilon max relative error per numeric token (0 = disabled)
 */
export function outputsEqualFloatAware(
  got: string,
  exp: string,
  absEpsilon: number,
  relEpsilon = 0,
): boolean {
  const ga = splitLinesStripTrailingEmpties(got);
  const ea = splitLinesStripTrailingEmpties(exp);
  if (ga.length !== ea.length) {
    return false;
  }
  for (let i = 0; i < ga.length; i++) {
    if (!outputLinesEqualWithDoubleTokens(ga[i], ea[i], absEpsilon, relEpsilon)) {
      return false;
    }
  }
  return true;
}

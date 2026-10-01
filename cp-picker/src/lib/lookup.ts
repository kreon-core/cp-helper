import type { ProblemLink } from "./links";
import { isRecord } from "./guards";

export interface ProblemInfo {
  title?: string;
  rating?: number;
}

export interface LookupResult {
  info: Map<string, ProblemInfo>;
  failed: string[];
}

const CF_API = "https://codeforces.com/api/problemset.problems";
const AC_PROBLEMS = "https://kenkoooo.com/atcoder/resources/problems.json";
const AC_MODELS = "https://kenkoooo.com/atcoder/resources/problem-models.json";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function clipAtcoderDifficulty(difficulty: number): number {
  return Math.round(difficulty >= 400 ? difficulty : 400 / Math.exp((400 - difficulty) / 400));
}

async function lookupCodeforces(keys: ReadonlySet<string>, out: Map<string, ProblemInfo>) {
  const body = await getJson(CF_API);
  if (!isRecord(body) || body.status !== "OK" || !isRecord(body.result) || !Array.isArray(body.result.problems)) {
    throw new Error("unexpected response");
  }
  for (const p of body.result.problems) {
    if (!isRecord(p)) continue;
    const key = `${String(p.contestId)}${String(p.index)}`;
    if (!keys.has(key)) continue;
    out.set(`cf:${key}`, {
      ...(typeof p.name === "string" ? { title: p.name } : {}),
      ...(typeof p.rating === "number" ? { rating: p.rating } : {}),
    });
  }
}

async function lookupAtcoder(keys: ReadonlySet<string>, out: Map<string, ProblemInfo>) {
  const [problems, models] = await Promise.all([getJson(AC_PROBLEMS), getJson(AC_MODELS)]);
  if (!Array.isArray(problems) || !isRecord(models)) throw new Error("unexpected response");
  for (const p of problems) {
    if (!isRecord(p) || typeof p.id !== "string" || !keys.has(p.id)) continue;
    const model = models[p.id];
    const difficulty = isRecord(model) && typeof model.difficulty === "number" ? model.difficulty : undefined;
    out.set(`ac:${p.id}`, {
      ...(typeof p.name === "string" ? { title: p.name } : {}),
      ...(difficulty !== undefined ? { rating: clipAtcoderDifficulty(difficulty) } : {}),
    });
  }
}

export async function lookupProblems(links: readonly ProblemLink[]): Promise<LookupResult> {
  const info = new Map<string, ProblemInfo>();
  const failed: string[] = [];
  const cfKeys = new Set(links.filter((l) => l.platform === "Codeforces").map((l) => l.key));
  const acKeys = new Set(links.filter((l) => l.platform === "AtCoder").map((l) => l.key));
  const jobs: Promise<void>[] = [];
  if (cfKeys.size > 0) {
    jobs.push(lookupCodeforces(cfKeys, info).catch(() => void failed.push("Codeforces")));
  }
  if (acKeys.size > 0) {
    jobs.push(lookupAtcoder(acKeys, info).catch(() => void failed.push("AtCoder")));
  }
  await Promise.all(jobs);
  return { info, failed };
}

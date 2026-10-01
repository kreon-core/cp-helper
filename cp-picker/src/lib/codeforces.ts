import { RATING_BOUNDS, type AppData, type Filters, type Profile } from "../types";
import { isRecord } from "./guards";

const API = "https://codeforces.com/api";
const MAX_CF_CONTEST = 100000;
const RECENT_COUNT = 200;
export const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export interface CodeforcesSync {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  solved: string[];
  lastSubmissionId?: number;
}

async function call(method: string, params: Record<string, string | number>): Promise<unknown> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${API}/${method}?${query}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Codeforces API returned HTTP ${res.status}`);
  }
  if (!isRecord(body) || body.status !== "OK") {
    const comment = isRecord(body) && typeof body.comment === "string" ? body.comment : `HTTP ${res.status}`;
    throw new Error(comment.replace(/^handles?: /, ""));
  }
  return body.result;
}

interface Submissions {
  solved: string[];
  ids: number[];
}

function readSubmissions(result: unknown): Submissions {
  const solved: string[] = [];
  const ids: number[] = [];
  if (!Array.isArray(result)) return { solved, ids };
  for (const s of result) {
    if (!isRecord(s) || typeof s.id !== "number") continue;
    ids.push(s.id);
    if (s.verdict !== "OK" || !isRecord(s.problem)) continue;
    const { contestId, index } = s.problem;
    if (typeof contestId !== "number" || contestId >= MAX_CF_CONTEST || typeof index !== "string") continue;
    solved.push(`cf:${contestId}${index.toUpperCase()}`);
  }
  return { solved, ids };
}

async function fetchSubmissions(handle: string, sinceId: number | undefined): Promise<Submissions> {
  if (sinceId !== undefined) {
    const recent = readSubmissions(await call("user.status", { handle, from: 1, count: RECENT_COUNT }));
    const coversGap = recent.ids.length < RECENT_COUNT || recent.ids.some((id) => id <= sinceId);
    if (coversGap) return recent;
  }
  return readSubmissions(await call("user.status", { handle }));
}

export async function fetchCodeforces(handle: string, sinceId?: number): Promise<CodeforcesSync> {
  const users = await call("user.info", { handles: handle });
  const user = Array.isArray(users) ? users[0] : undefined;
  if (!isRecord(user) || typeof user.handle !== "string") throw new Error(`User ${handle} not found`);
  const submissions = await fetchSubmissions(user.handle, sinceId);
  const latest = submissions.ids.length > 0 ? Math.max(...submissions.ids) : sinceId;
  return {
    handle: user.handle,
    ...(typeof user.rating === "number" ? { rating: user.rating } : {}),
    ...(typeof user.maxRating === "number" ? { maxRating: user.maxRating } : {}),
    ...(typeof user.rank === "string" ? { rank: user.rank } : {}),
    solved: [...new Set(submissions.solved)],
    ...(latest !== undefined ? { lastSubmissionId: latest } : {}),
  };
}

export function rangeForRating(rating: number): Pick<Filters, "minRating" | "maxRating"> {
  const clamp = (r: number) => Math.max(RATING_BOUNDS.min, Math.min(RATING_BOUNDS.max, r));
  const minRating = clamp(Math.round(rating / 100) * 100 + 100);
  return { minRating, maxRating: clamp(minRating + 400) };
}

export function isSyncDue(profile: Profile | null, now: number): boolean {
  if (!profile) return false;
  const last = Date.parse(profile.syncedAt);
  return !Number.isFinite(last) || now - last >= SYNC_INTERVAL_MS;
}

export function applySync(data: AppData, sync: CodeforcesSync, now: Date): Partial<AppData> {
  const profile: Profile = {
    handle: sync.handle,
    syncedAt: now.toISOString(),
    ...(sync.rating !== undefined ? { rating: sync.rating } : {}),
    ...(sync.maxRating !== undefined ? { maxRating: sync.maxRating } : {}),
    ...(sync.rank !== undefined ? { rank: sync.rank } : {}),
    ...(sync.lastSubmissionId !== undefined ? { lastSubmissionId: sync.lastSubmissionId } : {}),
  };
  const patch: Partial<AppData> = { profile };
  const solvedSet = new Set(data.solved);
  const newlySolved = sync.solved.filter((id) => !solvedSet.has(id));
  if (newlySolved.length > 0) patch.solved = [...data.solved, ...newlySolved];
  if (data.settings.followRating && sync.rating !== undefined) {
    patch.filters = { ...data.filters, ...rangeForRating(sync.rating) };
  }
  return patch;
}

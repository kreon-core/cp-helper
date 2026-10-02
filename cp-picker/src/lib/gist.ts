import type { AppData, BackupData, GistSync } from "../types";
import { isRecord } from "./guards";
import { parseBackup, serializeBackup } from "./storage";

const API = "https://api.github.com/gists";
const FILE = "cp-picker.json";
const EMPTY: BackupData = { custom: { categories: [], types: [], problems: [] }, solved: [], history: [], importance: {} };

export function parseGistId(input: string): string {
  const path = input.trim().split(/[?#]/)[0] ?? "";
  return path.split("/").filter(Boolean).pop() ?? "";
}

async function request(gist: GistSync, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}/${encodeURIComponent(gist.gistId)}`, {
    method: body === undefined ? "GET" : "PATCH",
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${gist.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = isRecord(json) && typeof json.message === "string" ? json.message : `HTTP ${res.status}`;
    throw new Error(`GitHub: ${message}`);
  }
  return json;
}

async function fileContent(file: unknown): Promise<string | null> {
  if (!isRecord(file)) return null;
  if (file.truncated !== true && typeof file.content === "string") return file.content;
  if (typeof file.raw_url !== "string") return null;
  const res = await fetch(file.raw_url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not download ${FILE}: HTTP ${res.status}`);
  return res.text();
}

export async function pullGist(gist: GistSync): Promise<BackupData | null> {
  const body = await request(gist);
  const files = isRecord(body) && isRecord(body.files) ? body.files : {};
  const content = (await fileContent(files[FILE]))?.trim();
  if (!content || content === "{}") return null;
  const result = parseBackup(content);
  if (!result.ok) throw new Error(`${FILE} in the gist: ${result.error}`);
  return result.backup;
}

export async function pushGist(gist: GistSync, data: BackupData): Promise<void> {
  await request(gist, { files: { [FILE]: { content: serializeBackup(data, new Date().toISOString()) } } });
}

function mergeKeyed<T>(base: readonly T[], local: readonly T[], remote: readonly T[], key: (item: T) => string): T[] {
  const encode = (item: T | undefined) => (item === undefined ? undefined : JSON.stringify(item));
  const was = new Map(base.map((item) => [key(item), encode(item)]));
  const mine = new Map(local.map((item) => [key(item), item]));
  const theirs = new Map(remote.map((item) => [key(item), item]));
  const out: T[] = [];
  for (const k of new Set([...mine.keys(), ...theirs.keys()])) {
    const l = mine.get(k);
    const r = theirs.get(k);
    const value = encode(l) === was.get(k) ? r : encode(r) === was.get(k) ? l : (r ?? l);
    if (value !== undefined) out.push(value);
  }
  return out;
}

export function mergeData(base: BackupData | null, local: BackupData, remote: BackupData): BackupData {
  const b = base ?? EMPTY;
  const byId = <T extends { id: string }>(item: T) => item.id;
  const entry = <T,>(item: [string, T]) => item[0];
  return {
    custom: {
      categories: mergeKeyed(b.custom.categories, local.custom.categories, remote.custom.categories, byId),
      types: mergeKeyed(b.custom.types, local.custom.types, remote.custom.types, byId),
      problems: mergeKeyed(b.custom.problems, local.custom.problems, remote.custom.problems, byId),
    },
    solved: mergeKeyed(b.solved, local.solved, remote.solved, (id) => id),
    history: mergeKeyed(b.history, local.history, remote.history, (r) => r.date).sort((x, y) =>
      y.date.localeCompare(x.date),
    ),
    importance: Object.fromEntries(
      mergeKeyed(Object.entries(b.importance), Object.entries(local.importance), Object.entries(remote.importance), entry),
    ),
  };
}

export function syncedPart(data: BackupData): BackupData {
  return { custom: data.custom, solved: data.solved, history: data.history, importance: data.importance };
}

export function sameData(a: BackupData | undefined, b: BackupData | undefined): boolean {
  return a !== undefined && b !== undefined && serializeBackup(a) === serializeBackup(b);
}

export function isGistDirty(data: AppData): boolean {
  return data.gist ? !sameData(syncedPart(data), data.gist.base) : false;
}

export const FLUSH_PORT = "gist-flush";

export async function syncWithGist(
  gist: GistSync,
  read: () => AppData | null | Promise<AppData | null>,
): Promise<Partial<AppData> | null> {
  const remote = await pullGist(gist);
  const before = await read();
  if (!before || before.gist?.gistId !== gist.gistId) return null;
  const local = syncedPart(before);
  const merged = remote ? mergeData(gist.base ?? null, local, remote) : local;
  if (!sameData(merged, remote ?? undefined)) await pushGist(gist, merged);
  const after = await read();
  if (!after?.gist || after.gist.gistId !== gist.gistId) return null;
  const current = mergeData(local, syncedPart(after), merged);
  return { ...current, gist: { ...after.gist, syncedAt: new Date().toISOString(), base: merged } };
}

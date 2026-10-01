import {
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  EMPTY_CATALOG,
  RATING_BOUNDS,
  type AppData,
  type Filters,
  type PickRecord,
  type Profile,
  type Settings,
} from "../types";
import { readCatalog } from "./custom";
import { isDateString } from "./date";
import { asPlatform, asString, asStringList, isRecord } from "./guards";

type StorageKey = keyof AppData;
const KEYS: StorageKey[] = ["custom", "solved", "history", "settings", "filters", "profile"];
const LEGACY_KEYS = ["topics"];

interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

const chromeArea: StorageArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
  clear: () => chrome.storage.local.clear(),
};

const LOCAL_PREFIX = "cp-picker:";

const localArea: StorageArea = {
  async get(keys) {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const raw = localStorage.getItem(LOCAL_PREFIX + key);
      if (raw !== null) out[key] = JSON.parse(raw);
    }
    return out;
  },
  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
    }
  },
  async remove(keys) {
    for (const key of keys) localStorage.removeItem(LOCAL_PREFIX + key);
  },
  async clear() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(LOCAL_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  },
};

function area(): StorageArea {
  return typeof chrome !== "undefined" && chrome.storage?.local ? chromeArea : localArea;
}

export function readHistory(value: unknown): PickRecord[] {
  if (!Array.isArray(value)) return [];
  const records: PickRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const date = asString(item.date);
    const fields = {
      categoryId: asString(item.categoryId),
      categoryName: asString(item.categoryName),
      typeId: asString(item.typeId),
      typeName: asString(item.typeName),
      problemId: asString(item.problemId),
      problemTitle: asString(item.problemTitle),
      problemUrl: asString(item.problemUrl),
    };
    if (!date || !isDateString(date) || Object.values(fields).some((v) => v === undefined)) continue;
    if (records.some((r) => r.date === date)) continue;
    records.push({ date, ...(fields as Omit<PickRecord, "date">) });
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

function readSettings(value: unknown): Settings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  const days = value.historyWindowDays;
  return {
    historyWindowDays:
      typeof days === "number" && Number.isFinite(days) && days >= 0
        ? Math.floor(days)
        : DEFAULT_SETTINGS.historyWindowDays,
    followRating: typeof value.followRating === "boolean" ? value.followRating : DEFAULT_SETTINGS.followRating,
  };
}

function readProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null;
  const handle = asString(value.handle);
  const syncedAt = asString(value.syncedAt);
  if (!handle || !syncedAt) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const rating = num(value.rating);
  const maxRating = num(value.maxRating);
  const rank = asString(value.rank);
  const lastSubmissionId = num(value.lastSubmissionId);
  return {
    handle,
    syncedAt,
    ...(rating !== undefined ? { rating } : {}),
    ...(maxRating !== undefined ? { maxRating } : {}),
    ...(rank ? { rank } : {}),
    ...(lastSubmissionId !== undefined ? { lastSubmissionId } : {}),
  };
}

export function clampRating(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(RATING_BOUNDS.min, Math.min(RATING_BOUNDS.max, Math.round(value)));
}

function readFilters(value: unknown): Filters {
  if (!isRecord(value)) return { ...DEFAULT_FILTERS };
  return {
    categories: asStringList(value.categories),
    platforms: asStringList(value.platforms).flatMap((p) => asPlatform(p) ?? []),
    minRating: clampRating(value.minRating, DEFAULT_FILTERS.minRating),
    maxRating: clampRating(value.maxRating, DEFAULT_FILTERS.maxRating),
  };
}

export async function loadData(): Promise<AppData> {
  const stored = await area().get([...KEYS, ...LEGACY_KEYS]);
  if (LEGACY_KEYS.some((key) => key in stored)) await area().remove(LEGACY_KEYS);
  return {
    custom: stored.custom === undefined ? EMPTY_CATALOG : readCatalog(stored.custom),
    solved: asStringList(stored.solved),
    history: readHistory(stored.history),
    settings: readSettings(stored.settings),
    filters: readFilters(stored.filters),
    profile: readProfile(stored.profile),
  };
}

export async function saveData(patch: Partial<AppData>): Promise<void> {
  await area().set(patch);
}

export async function resetData(): Promise<AppData> {
  await area().clear();
  return loadData();
}

export interface Backup {
  custom: AppData["custom"];
  solved: string[];
  history: PickRecord[];
}

export function serializeBackup(data: AppData): string {
  const backup: Backup & { app: string; version: number } = {
    app: "cp-picker",
    version: 2,
    custom: data.custom,
    solved: data.solved,
    history: data.history,
  };
  return JSON.stringify(backup, null, 2);
}

export type BackupResult = { ok: true; backup: Backup } | { ok: false; error: string };

export function parseBackup(text: string): BackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `File is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isRecord(parsed) || parsed.app !== "cp-picker") {
    return { ok: false, error: "Not a CP Picker backup file." };
  }
  return {
    ok: true,
    backup: {
      custom: readCatalog(parsed.custom),
      solved: asStringList(parsed.solved),
      history: readHistory(parsed.history),
    },
  };
}

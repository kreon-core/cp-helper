import seedTopics from "../data/topics.json";
import {
  DEFAULT_SETTINGS,
  filtersFromSettings,
  type AppData,
  type Filters,
  type PracticeRecord,
  type Settings,
  type Topic,
} from "../types";
import { isDateString } from "./date";
import { asDifficulty, asStatus, asStringList, isRecord } from "./guards";
import { newId } from "./id";
import { normalizeTopic, parseTopicsJson } from "./topics";

type StorageKey = keyof AppData;
const KEYS: StorageKey[] = ["topics", "history", "settings", "filters"];

interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  clear(): Promise<void>;
}

const chromeArea: StorageArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  clear: () => chrome.storage.local.clear(),
};

const LOCAL_PREFIX = "cp-topic-picker:";

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
  async clear() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(LOCAL_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  },
};

function area(): StorageArea {
  return typeof chrome !== "undefined" && chrome.storage?.local ? chromeArea : localArea;
}

export function seedData(): Topic[] {
  const result = parseTopicsJson(JSON.stringify(seedTopics), newId);
  return result.ok ? result.topics : [];
}

function readTopics(value: unknown): Topic[] {
  if (!Array.isArray(value)) return seedData();
  const topics: Topic[] = [];
  for (const item of value) {
    const result = normalizeTopic(item, newId);
    if (result.ok) topics.push(result.topic);
  }
  return topics;
}

function readHistory(value: unknown): PracticeRecord[] {
  if (!Array.isArray(value)) return [];
  const records: PracticeRecord[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { date, topicId, topicName, category } = item;
    const difficulty = asDifficulty(item.difficulty);
    if (
      typeof date === "string" &&
      isDateString(date) &&
      typeof topicId === "string" &&
      typeof topicName === "string" &&
      typeof category === "string" &&
      difficulty
    ) {
      records.push({ date, topicId, topicName, category, difficulty });
    }
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
    allowMastered:
      typeof value.allowMastered === "boolean" ? value.allowMastered : DEFAULT_SETTINGS.allowMastered,
    defaultCategories: asStringList(value.defaultCategories),
    defaultDifficulties: asStringList(value.defaultDifficulties).flatMap((d) => asDifficulty(d) ?? []),
  };
}

function readFilters(value: unknown, settings: Settings): Filters {
  if (!isRecord(value)) return filtersFromSettings(settings);
  return {
    categories: asStringList(value.categories),
    difficulties: asStringList(value.difficulties).flatMap((d) => asDifficulty(d) ?? []),
    tags: asStringList(value.tags),
    statuses: asStringList(value.statuses).flatMap((s) => asStatus(s) ?? []),
  };
}

export async function loadData(): Promise<AppData> {
  const stored = await area().get(KEYS);
  const settings = readSettings(stored.settings);
  const data: AppData = {
    topics: readTopics(stored.topics),
    history: readHistory(stored.history),
    settings,
    filters: readFilters(stored.filters, settings),
  };
  if (!Array.isArray(stored.topics)) await saveData({ topics: data.topics });
  return data;
}

export async function saveData(patch: Partial<AppData>): Promise<void> {
  await area().set(patch);
}

export async function resetData(): Promise<AppData> {
  await area().clear();
  return loadData();
}

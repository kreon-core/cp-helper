import type { Filters, Settings, Topic, PracticeRecord } from "../types";
import { daysBetween } from "./date";

export type Rng = () => number;

export type SelectionResult =
  | { ok: true; topic: Topic; usedFallback: boolean }
  | { ok: false; reason: string };

export interface SelectionInput {
  topics: readonly Topic[];
  history: readonly PracticeRecord[];
  filters: Filters;
  settings: Settings;
  today: string;
  excludeIds?: ReadonlySet<string>;
}

export function matchesFilters(topic: Topic, filters: Filters, settings: Settings): boolean {
  if (!settings.allowMastered && topic.status === "Mastered") return false;
  if (filters.categories.length > 0 && !filters.categories.includes(topic.category)) return false;
  if (filters.difficulties.length > 0 && !filters.difficulties.includes(topic.difficulty)) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(topic.status)) return false;
  if (filters.tags.length > 0 && !topic.tags.some((tag) => filters.tags.includes(tag))) return false;
  return true;
}

export function applyFilters(topics: readonly Topic[], filters: Filters, settings: Settings): Topic[] {
  return topics.filter((topic) => matchesFilters(topic, filters, settings));
}

export function recentTopicIds(
  history: readonly PracticeRecord[],
  today: string,
  windowDays: number,
): Set<string> {
  const ids = new Set<string>();
  for (const record of history) {
    const age = daysBetween(record.date, today);
    if (age >= 0 && age <= windowDays) ids.add(record.topicId);
  }
  return ids;
}

export function pickRandom<T>(items: readonly T[], rng: Rng = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}

export function selectionBlocker(
  topics: readonly Topic[],
  filters: Filters,
  settings: Settings,
): string | null {
  if (topics.length === 0) {
    return "No topics yet. Add some in the Topics tab or import a JSON file.";
  }
  if (applyFilters(topics, filters, settings).length === 0) {
    const hint = settings.allowMastered ? "" : " Mastered topics are excluded in Settings.";
    return `No topics match the current filters. Loosen the filters to get a pick.${hint}`;
  }
  return null;
}

export function selectTopic(input: SelectionInput, rng: Rng = Math.random): SelectionResult {
  const { topics, history, filters, settings, today } = input;
  const blocker = selectionBlocker(topics, filters, settings);
  if (blocker) return { ok: false, reason: blocker };

  const filtered = applyFilters(topics, filters, settings);
  const exclude = input.excludeIds ?? new Set<string>();
  const recent = recentTopicIds(history, today, settings.historyWindowDays);

  let pool = filtered.filter((t) => !recent.has(t.id) && !exclude.has(t.id));
  let usedFallback = false;
  if (pool.length === 0) {
    usedFallback = true;
    pool = filtered.filter((t) => !exclude.has(t.id));
  }
  if (pool.length === 0) pool = filtered;

  const topic = pickRandom(pool, rng);
  if (!topic) return { ok: false, reason: "No eligible topic found." };
  return { ok: true, topic, usedFallback };
}

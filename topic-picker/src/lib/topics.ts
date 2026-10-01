import type { Topic } from "../types";
import { asDifficulty, asStatus, asStringList, isRecord } from "./guards";

export type ParseResult = { ok: true; topics: Topic[] } | { ok: false; error: string };

export type NormalizeResult = { ok: true; topic: Topic } | { ok: false; error: string };

const MAX_REPORTED_ERRORS = 5;

export function normalizeTopic(raw: unknown, makeId: () => string): NormalizeResult {
  if (!isRecord(raw)) return { ok: false, error: "expected an object" };

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: 'missing or empty "name"' };

  const category = typeof raw.category === "string" ? raw.category.trim() : "";
  if (!category) return { ok: false, error: `"${name}": missing or empty "category"` };

  const difficulty = asDifficulty(raw.difficulty);
  if (!difficulty) {
    return { ok: false, error: `"${name}": "difficulty" must be Easy, Medium or Hard` };
  }

  if (raw.status !== undefined && !asStatus(raw.status)) {
    return {
      ok: false,
      error: `"${name}": "status" must be Not practiced, Practicing or Mastered`,
    };
  }

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeId();
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : undefined;

  return {
    ok: true,
    topic: {
      id,
      name,
      category,
      difficulty,
      tags: asStringList(raw.tags),
      ...(note ? { note } : {}),
      status: asStatus(raw.status) ?? "Not practiced",
    },
  };
}

export function parseTopicsJson(text: string, makeId: () => string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `File is not valid JSON: ${detail}` };
  }

  const list = isRecord(parsed) && Array.isArray(parsed.topics) ? parsed.topics : parsed;
  if (!Array.isArray(list)) {
    return { ok: false, error: 'Expected a JSON array of topics or an object with a "topics" array.' };
  }
  if (list.length === 0) return { ok: false, error: "The file contains no topics." };

  const topics: Topic[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();
  list.forEach((item, index) => {
    const result = normalizeTopic(item, makeId);
    if (!result.ok) {
      errors.push(`Item ${index + 1}: ${result.error}`);
      return;
    }
    let topic = result.topic;
    if (seenIds.has(topic.id)) topic = { ...topic, id: makeId() };
    seenIds.add(topic.id);
    topics.push(topic);
  });

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS).join("\n");
    const more = errors.length > MAX_REPORTED_ERRORS ? `\n...and ${errors.length - MAX_REPORTED_ERRORS} more` : "";
    return { ok: false, error: `Import failed (${errors.length} invalid item(s)):\n${shown}${more}` };
  }
  return { ok: true, topics };
}

export interface MergeResult {
  topics: Topic[];
  added: number;
  updated: number;
}

export function mergeTopics(existing: readonly Topic[], incoming: readonly Topic[]): MergeResult {
  const topics = [...existing];
  let added = 0;
  let updated = 0;
  for (const topic of incoming) {
    const index = topics.findIndex(
      (t) => t.id === topic.id || t.name.toLowerCase() === topic.name.toLowerCase(),
    );
    if (index >= 0) {
      const current = topics[index];
      topics[index] = { ...topic, id: current ? current.id : topic.id };
      updated++;
    } else {
      topics.push(topic);
      added++;
    }
  }
  return { topics, added, updated };
}

export function serializeTopics(topics: readonly Topic[]): string {
  return JSON.stringify({ topics }, null, 2);
}

export function collectCategories(topics: readonly Topic[], extra: readonly string[] = []): string[] {
  return [...new Set([...extra, ...topics.map((t) => t.category)])].sort((a, b) => a.localeCompare(b));
}

export function collectTags(topics: readonly Topic[]): string[] {
  return [...new Set(topics.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
}

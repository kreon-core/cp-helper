import { DIFFICULTIES, STATUSES, type Difficulty, type TopicStatus } from "../types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asDifficulty(value: unknown): Difficulty | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  return DIFFICULTIES.find((d) => d.toLowerCase() === lower);
}

export function asStatus(value: unknown): TopicStatus | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  return STATUSES.find((s) => s.toLowerCase() === lower);
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

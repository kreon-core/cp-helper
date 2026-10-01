import { LEVELS, PLATFORMS, type Level, type Platform } from "../types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asLevel(value: unknown): Level | undefined {
  return LEVELS.find((l) => l === value);
}

export function asPlatform(value: unknown): Platform | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  return PLATFORMS.find((p) => p.toLowerCase() === lower);
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
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

import type { Filters } from "../types";

export function formatFilterSummary(filters: Filters): string {
  const parts: string[] = [];
  if (filters.categories.length > 0) parts.push(filters.categories.join("/"));
  if (filters.difficulties.length > 0) parts.push(filters.difficulties.join("/"));
  if (filters.statuses.length > 0) parts.push(filters.statuses.join("/"));
  if (filters.tags.length > 0) parts.push(filters.tags.map((t) => `#${t}`).join(" "));
  return parts.length > 0 ? parts.join(" + ") : "All topics";
}

export function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

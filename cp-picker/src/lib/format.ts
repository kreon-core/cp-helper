import type { Filters } from "../types";
import type { Library } from "./library";

export function formatFilterSummary(filters: Filters, library: Library): string {
  const parts: string[] = [];
  if (filters.categories.length > 0) {
    parts.push(filters.categories.map((id) => library.categoryById.get(id)?.name ?? id).join("/"));
  }
  if (filters.platforms.length > 0) parts.push(filters.platforms.join("/"));
  parts.push(`${filters.minRating}-${filters.maxRating}`);
  return parts.join(" + ");
}

export function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function downloadJson(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

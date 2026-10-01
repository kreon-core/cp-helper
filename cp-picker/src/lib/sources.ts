import type { Catalog } from "../types";

export interface SourceCatalog extends Catalog {
  source: string;
  url: string;
  fetchedAt: string;
}

const modules = import.meta.glob<SourceCatalog>("../data/sources/*.json", { eager: true, import: "default" });

export const SOURCES: SourceCatalog[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path] ?? [])
  .sort((a, b) => b.categories.length - a.categories.length);

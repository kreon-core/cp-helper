import type { Catalog } from "../types";
import assignmentData from "../data/assignments.json";
import type { Assignments } from "./library";

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

export const ASSIGNMENTS: Assignments = assignmentData;

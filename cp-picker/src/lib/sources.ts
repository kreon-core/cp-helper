import assignmentData from "../data/assignments.json";
import categoryData from "../data/categories.json";
import groupData from "../data/groups.json";
import researchData from "../data/research.json";
import tagData from "../data/tags.json";
import type { SharedData, SourceData } from "./library";

export interface SourceCatalog extends SourceData {
  source: string;
  url: string;
  fetchedAt: string;
}

const modules = import.meta.glob<SourceCatalog>("../data/sources/*.json", { eager: true, import: "default" });

export const SOURCES: SourceCatalog[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path] ?? [])
  .sort((a, b) => b.types.length - a.types.length);

export const SHARED: SharedData = {
  categories: categoryData,
  groups: groupData,
  assignments: assignmentData,
  research: researchData,
  tags: tagData,
};

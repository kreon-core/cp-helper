import type { Catalog, Category, Level, Problem, ProblemType } from "../types";
import { asImportance, asLevel, asPlatform, asString, isRecord } from "./guards";
import { findByName, levelFromRating, type Library } from "./library";
import type { ProblemLink } from "./links";
import type { ProblemInfo } from "./lookup";

export interface AddTarget {
  categoryName: string;
  typeName: string;
  level?: Level;
}

export interface AddResult {
  custom: Catalog;
  categoryId: string;
  typeId: string;
  added: number;
  alreadyThere: number;
  moved: number;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueId(base: string, taken: (id: string) => boolean): string {
  let id = base || "custom";
  for (let n = 2; taken(id); n++) id = `${base}_${n}`;
  return id;
}

function resolveCategory(custom: Catalog, library: Library, name: string): { custom: Catalog; category: Category } {
  const found = findByName(library.categoryById.values(), name);
  if (found) return { custom, category: found };
  const id = uniqueId(`custom_${slug(name)}`, (x) => library.categoryById.has(x));
  const category = { id, name: name.trim() };
  return { custom: { ...custom, categories: [...custom.categories, category] }, category };
}

function resolveType(
  custom: Catalog,
  library: Library,
  categoryId: string,
  name: string,
): { custom: Catalog; type: ProblemType } {
  const found = findByName(library.typesByCategory.get(categoryId) ?? [], name);
  if (found) return { custom, type: found };
  const id = uniqueId(`custom_${slug(name)}`, (x) => library.typeById.has(x));
  const type = { id, name: name.trim(), categoryId };
  return { custom: { ...custom, types: [...custom.types, type] }, type };
}

export function addProblems(
  custom: Catalog,
  library: Library,
  target: AddTarget,
  links: readonly ProblemLink[],
  info: ReadonlyMap<string, ProblemInfo>,
): AddResult {
  const withCategory = resolveCategory(custom, library, target.categoryName);
  const withType = resolveType(withCategory.custom, library, withCategory.category.id, target.typeName);
  const typeId = withType.type.id;
  const categoryId = withCategory.category.id;
  const categoryOf = (id: string) =>
    library.typeById.get(id)?.categoryId ?? withType.custom.types.find((t) => t.id === id)?.categoryId;
  const problems = [...withType.custom.problems];
  let added = 0;
  let alreadyThere = 0;
  let moved = 0;

  for (const link of links) {
    const known = library.problemById.get(link.id);
    if (known && known.types[typeId] !== undefined) {
      alreadyThere++;
      continue;
    }
    const meta = info.get(link.id);
    const rating = meta?.rating ?? known?.rating;
    const ratingEstimated = meta?.rating === undefined && known?.ratingEstimated === true;
    const level = target.level ?? levelFromRating(rating) ?? 2;
    if (known && Object.keys(known.types).some((t) => categoryOf(t) !== categoryId)) moved++;
    const index = problems.findIndex((p) => p.id === link.id);
    const current = index >= 0 ? problems[index] : undefined;
    const sameCategory = current
      ? Object.fromEntries(Object.entries(current.types).filter(([t]) => categoryOf(t) === categoryId))
      : {};
    const next: Problem = current
      ? { ...current, types: { ...sameCategory, [typeId]: level } }
      : {
          id: link.id,
          url: link.url,
          title: meta?.title ?? known?.title ?? link.key,
          platform: link.platform,
          ...(rating !== undefined ? { rating } : {}),
          ...(ratingEstimated ? { ratingEstimated } : {}),
          types: { [typeId]: level },
        };
    if (index >= 0) problems[index] = next;
    else problems.push(next);
    added++;
  }

  return {
    custom: pruneCatalog({ ...withType.custom, problems }),
    categoryId,
    typeId,
    added,
    alreadyThere,
    moved,
  };
}

export function isCustomAssignment(custom: Catalog, problemId: string, typeId: string): boolean {
  return custom.problems.some((p) => p.id === problemId && p.types[typeId] !== undefined);
}

export function removeAssignment(custom: Catalog, problemId: string, typeId: string): Catalog {
  const problems = custom.problems.flatMap((p) => {
    if (p.id !== problemId) return [p];
    const types = { ...p.types };
    delete types[typeId];
    return Object.keys(types).length > 0 ? [{ ...p, types }] : [];
  });
  return pruneCatalog({ ...custom, problems });
}

function pruneCatalog(custom: Catalog): Catalog {
  const usedTypes = new Set(custom.problems.flatMap((p) => Object.keys(p.types)));
  const types = custom.types.filter((t) => usedTypes.has(t.id));
  const usedCategories = new Set(types.map((t) => t.categoryId));
  const categories = custom.categories.filter((c) => usedCategories.has(c.id));
  return { categories, types, problems: custom.problems };
}

function readCategory(value: unknown): Category | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const name = asString(value.name);
  return id && name ? { id, name } : undefined;
}

function readType(value: unknown): ProblemType | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const name = asString(value.name);
  const categoryId = asString(value.categoryId);
  const groupId = asString(value.groupId);
  const importance = asImportance(value.importance);
  if (!id || !name || !categoryId) return undefined;
  return { id, name, categoryId, ...(groupId ? { groupId } : {}), ...(importance !== undefined ? { importance } : {}) };
}

function readProblem(value: unknown): Problem | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const url = asString(value.url);
  const title = asString(value.title);
  const platform = asPlatform(value.platform);
  if (!id || !url || !title || !platform || !isRecord(value.types)) return undefined;
  const types: Record<string, Level> = {};
  for (const [typeId, raw] of Object.entries(value.types)) {
    const level = asLevel(raw);
    if (level) types[typeId] = level;
  }
  if (Object.keys(types).length === 0) return undefined;
  const rating = typeof value.rating === "number" && Number.isFinite(value.rating) ? value.rating : undefined;
  return {
    id,
    url,
    title,
    platform,
    ...(rating !== undefined ? { rating } : {}),
    ...(rating !== undefined && value.ratingEstimated === true ? { ratingEstimated: true } : {}),
    types,
  };
}

export function readCatalog(value: unknown): Catalog {
  if (!isRecord(value)) return { categories: [], types: [], problems: [] };
  const list = <T>(raw: unknown, read: (v: unknown) => T | undefined): T[] =>
    Array.isArray(raw) ? raw.flatMap((v) => read(v) ?? []) : [];
  return {
    categories: list(value.categories, readCategory),
    types: list(value.types, readType),
    problems: list(value.problems, readProblem),
  };
}

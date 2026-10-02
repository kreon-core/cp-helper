import { RESEARCH_CATEGORY, type Catalog, type Category, type Level, type Problem, type ProblemType } from "../types";

export interface TypeProblem {
  problem: Problem;
  level: Level;
}

export interface Library {
  categories: Category[];
  categoryById: Map<string, Category>;
  groupByType: Map<string, string>;
  typeById: Map<string, ProblemType>;
  typesByCategory: Map<string, ProblemType[]>;
  problemById: Map<string, Problem>;
  problemsByType: Map<string, TypeProblem[]>;
}

const LEVEL_RATING: Record<Level, number> = { 1: 1200, 2: 1700, 3: 2200, 4: 2700 };

export function levelFromRating(rating: number | undefined): Level | undefined {
  if (rating === undefined) return undefined;
  if (rating < 1400) return 1;
  if (rating < 1900) return 2;
  if (rating < 2400) return 3;
  return 4;
}

export function estimatedRating(entry: TypeProblem): number {
  return entry.problem.rating ?? LEVEL_RATING[entry.level];
}

export function compareTypeProblems(a: TypeProblem, b: TypeProblem): number {
  return (
    estimatedRating(a) - estimatedRating(b) ||
    a.level - b.level ||
    a.problem.id.localeCompare(b.problem.id, "en", { numeric: true })
  );
}

function mergeProblem(current: Problem | undefined, next: Problem): Problem {
  if (!current) return { ...next, types: { ...next.types } };
  const rated = current.rating !== undefined ? current : next;
  const merged: Problem = { ...current, title: current.title || next.title, types: { ...current.types, ...next.types } };
  delete merged.rating;
  delete merged.ratingEstimated;
  return {
    ...merged,
    ...(rated.rating !== undefined ? { rating: rated.rating } : {}),
    ...(rated.ratingEstimated ? { ratingEstimated: true } : {}),
  };
}

export type Assignments = Readonly<Record<string, string>>;
export type Names = Readonly<Record<string, string>>;
export type SourceData = Omit<Catalog, "categories">;

export interface SharedData {
  categories?: Names;
  groups?: Readonly<Record<string, Names>>;
  assignments?: Assignments;
  research?: readonly string[];
  tags?: Readonly<Record<string, readonly string[]>>;
}

function chooseCategory(
  problem: Problem,
  typeById: ReadonlyMap<string, ProblemType>,
  categoryOrder: readonly string[],
  preferred: string | undefined,
): string | undefined {
  const weight = new Map<string, number>();
  for (const [typeId, level] of Object.entries(problem.types)) {
    const categoryId = typeById.get(typeId)?.categoryId;
    if (categoryId) weight.set(categoryId, (weight.get(categoryId) ?? 0) + (5 - level));
  }
  if (weight.size <= 1) return undefined;
  if (preferred && weight.has(preferred)) return preferred;
  weight.delete(RESEARCH_CATEGORY);
  let best: string | undefined;
  for (const categoryId of categoryOrder) {
    const w = weight.get(categoryId);
    if (w !== undefined && (best === undefined || w > (weight.get(best) ?? 0))) best = categoryId;
  }
  return best;
}

export function buildLibrary(
  sources: readonly SourceData[],
  custom: Catalog = { categories: [], types: [], problems: [] },
  { categories = {}, groups = {}, assignments = {}, research = [], tags = {} }: SharedData = {},
): Library {
  const categoryById = new Map<string, Category>(Object.entries(categories).map(([id, name]) => [id, { id, name }]));
  for (const c of custom.categories) if (!categoryById.has(c.id)) categoryById.set(c.id, c);
  const typeById = new Map<string, ProblemType>();
  const researchIds = new Set(research);
  const groupByType = new Map<string, string>();
  const typeRank = new Map<string, [number, number]>();
  const categoryRank = new Map(Object.keys(categories).map((id, i) => [id, i]));
  const problemById = new Map<string, Problem>();
  for (const source of [...sources, custom]) {
    for (const t of source.types) {
      if (typeById.has(t.id)) continue;
      const groupName = t.groupId ? groups[t.categoryId]?.[t.groupId] : undefined;
      if (groupName) groupByType.set(t.id, groupName);
      const groupIndex = t.groupId ? Object.keys(groups[t.categoryId] ?? {}).indexOf(t.groupId) : -1;
      typeRank.set(t.id, [
        categoryRank.get(t.categoryId) ?? categoryRank.size,
        groupIndex < 0 ? Number.MAX_SAFE_INTEGER : groupIndex,
      ]);
      typeById.set(t.id, researchIds.has(t.id) ? { ...t, categoryId: RESEARCH_CATEGORY } : t);
    }
    for (const p of source.problems) problemById.set(p.id, mergeProblem(problemById.get(p.id), p));
  }
  for (const [id, typeIds] of Object.entries(tags)) {
    const problem = problemById.get(id);
    if (!problem) continue;
    const level = levelFromRating(problem.rating) ?? 2;
    const types = { ...problem.types };
    for (const typeId of typeIds) types[typeId] ??= level;
    problemById.set(id, { ...problem, types });
  }

  const customCategory = new Map<string, string>();
  for (const p of custom.problems) {
    const last = Object.keys(p.types).at(-1);
    const categoryId = last ? typeById.get(last)?.categoryId : undefined;
    if (categoryId) customCategory.set(p.id, categoryId);
  }
  const categoryOrder = [...categoryById.keys()];
  for (const [id, problem] of problemById) {
    const chosen = chooseCategory(problem, typeById, categoryOrder, customCategory.get(id) ?? assignments[id]);
    if (!chosen) continue;
    const types = Object.fromEntries(
      Object.entries(problem.types).filter(([typeId]) => typeById.get(typeId)?.categoryId === chosen),
    );
    problemById.set(id, { ...problem, types });
  }

  const typesByCategory = new Map<string, ProblemType[]>();
  for (const t of typeById.values()) {
    if (!categoryById.has(t.categoryId)) continue;
    const list = typesByCategory.get(t.categoryId) ?? [];
    list.push(t);
    typesByCategory.set(t.categoryId, list);
  }
  const problemsByType = new Map<string, TypeProblem[]>();
  for (const problem of problemById.values()) {
    for (const [typeId, level] of Object.entries(problem.types)) {
      if (!typeById.has(typeId)) continue;
      const list = problemsByType.get(typeId) ?? [];
      list.push({ problem, level });
      problemsByType.set(typeId, list);
    }
  }
  for (const list of problemsByType.values()) list.sort(compareTypeProblems);

  const rankOf = (t: ProblemType) => typeRank.get(t.id) ?? [categoryRank.size, Number.MAX_SAFE_INTEGER];
  const countOf = (t: ProblemType) => problemsByType.get(t.id)?.length ?? 0;
  for (const list of typesByCategory.values()) {
    list.sort((a, b) => rankOf(a)[0] - rankOf(b)[0] || rankOf(a)[1] - rankOf(b)[1] || countOf(b) - countOf(a));
  }

  return {
    categories: [...categoryById.values()],
    categoryById,
    groupByType,
    typeById,
    typesByCategory,
    problemById,
    problemsByType,
  };
}

export function findByName<T extends { name: string }>(items: Iterable<T>, name: string): T | undefined {
  const lower = name.trim().toLowerCase();
  for (const item of items) if (item.name.toLowerCase() === lower) return item;
  return undefined;
}

import type { Catalog, Category, Level, Problem, ProblemType } from "../types";

export interface TypeProblem {
  problem: Problem;
  level: Level;
}

export interface Library {
  categories: Category[];
  categoryById: Map<string, Category>;
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

export function buildLibrary(sources: readonly Catalog[]): Library {
  const categoryById = new Map<string, Category>();
  const typeById = new Map<string, ProblemType>();
  const problemById = new Map<string, Problem>();
  for (const source of sources) {
    for (const c of source.categories) if (!categoryById.has(c.id)) categoryById.set(c.id, c);
    for (const t of source.types) if (!typeById.has(t.id)) typeById.set(t.id, t);
    for (const p of source.problems) problemById.set(p.id, mergeProblem(problemById.get(p.id), p));
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

  return {
    categories: [...categoryById.values()],
    categoryById,
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

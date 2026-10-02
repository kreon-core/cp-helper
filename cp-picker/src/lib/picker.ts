import { RESEARCH_CATEGORY, type Category, type Filters, type PickRecord, type ProblemType, type Settings } from "../types";
import { daysBetween } from "./date";
import { IMPORTANCE_WEIGHT, typeImportance, type ImportanceOverrides } from "./importance";
import { estimatedRating, type Library, type TypeProblem } from "./library";

export type Rng = () => number;

export interface Pick {
  category: Category;
  type: ProblemType;
  entry: TypeProblem;
}

export type SelectionResult = { ok: true; pick: Pick; usedFallback: boolean } | { ok: false; reason: string };

export interface SelectionInput {
  library: Library;
  solved: ReadonlySet<string>;
  history: readonly PickRecord[];
  filters: Filters;
  settings: Settings;
  importance: ImportanceOverrides;
  today: string;
  excludeTypeId?: string;
}

export function inRange(entry: TypeProblem, filters: Filters): boolean {
  const rating = estimatedRating(entry);
  return rating >= filters.minRating && rating <= filters.maxRating;
}

export function matchesFilters(entry: TypeProblem, filters: Filters): boolean {
  if (filters.platforms.length > 0 && !filters.platforms.includes(entry.problem.platform)) return false;
  return inRange(entry, filters);
}

export function typeProblems(library: Library, typeId: string, filters: Filters): TypeProblem[] {
  return (library.problemsByType.get(typeId) ?? []).filter((e) => matchesFilters(e, filters));
}

export function nextUnsolved(entries: readonly TypeProblem[], solved: ReadonlySet<string>): TypeProblem | undefined {
  return entries.find((e) => !solved.has(e.problem.id));
}

function filteredCategories(library: Library, filters: Filters): Category[] {
  if (filters.categories.length === 0) return library.categories.filter((c) => c.id !== RESEARCH_CATEGORY);
  return library.categories.filter((c) => filters.categories.includes(c.id));
}

export function recentTypeIds(history: readonly PickRecord[], today: string, windowDays: number): Set<string> {
  const ids = new Set<string>();
  for (const record of history) {
    const age = daysBetween(record.date, today);
    if (age >= 0 && age <= windowDays) ids.add(record.typeId);
  }
  return ids;
}

export function pickRandom<T>(items: readonly T[], rng: Rng = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}

export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: Rng = Math.random): T | undefined {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const item of items) {
    r -= weight(item);
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

interface Candidate {
  category: Category;
  type: ProblemType;
  entry: TypeProblem;
  weight: number;
}

function candidates(
  library: Library,
  solved: ReadonlySet<string>,
  filters: Filters,
  importance: ImportanceOverrides,
): Candidate[] {
  const out: Candidate[] = [];
  for (const category of filteredCategories(library, filters)) {
    for (const type of library.typesByCategory.get(category.id) ?? []) {
      const weight = IMPORTANCE_WEIGHT[typeImportance(type, importance)];
      if (weight === 0) continue;
      const entry = nextUnsolved(typeProblems(library, type.id, filters), solved);
      if (entry) out.push({ category, type, entry, weight });
    }
  }
  return out;
}

export function selectionBlocker(
  library: Library,
  solved: ReadonlySet<string>,
  filters: Filters,
  importance: ImportanceOverrides,
): string | null {
  if (library.problemById.size === 0) return "No problems yet. Add some links in the Add tab.";
  const scoped = filteredCategories(library, filters).some((c) =>
    (library.typesByCategory.get(c.id) ?? []).some((t) => typeProblems(library, t.id, filters).length > 0),
  );
  if (!scoped) return "No problems match the current filters. Loosen the filters or the rating range to get a pick.";
  if (candidates(library, solved, filters, {}).length === 0) {
    return "Every problem that matches the current filters is solved.";
  }
  if (candidates(library, solved, filters, importance).length === 0) {
    return "Every type with unsolved problems is set to Never pick. Change a type's importance in Browse.";
  }
  return null;
}

function pickFrom(pool: readonly Candidate[], rng: Rng): Candidate | undefined {
  const categoryIds = [...new Set(pool.map((c) => c.category.id))];
  const categoryId = pickRandom(categoryIds, rng);
  return pickWeighted(
    pool.filter((c) => c.category.id === categoryId),
    (c) => c.weight,
    rng,
  );
}

export function selectPick(input: SelectionInput, rng: Rng = Math.random): SelectionResult {
  const { library, solved, history, filters, settings, importance, today, excludeTypeId } = input;
  const blocker = selectionBlocker(library, solved, filters, importance);
  if (blocker) return { ok: false, reason: blocker };

  const all = candidates(library, solved, filters, importance);
  const recent = recentTypeIds(history, today, settings.historyWindowDays);
  const others = all.filter((c) => c.type.id !== excludeTypeId);

  let pool = others.filter((c) => !recent.has(c.type.id));
  let usedFallback = false;
  if (pool.length === 0) {
    usedFallback = true;
    pool = others;
  }
  if (pool.length === 0) pool = all;

  const pick = pickFrom(pool, rng);
  if (!pick) return { ok: false, reason: "No eligible problem found." };
  return { ok: true, pick, usedFallback };
}

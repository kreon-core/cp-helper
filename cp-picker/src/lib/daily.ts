import type { AppData, Category, PickRecord, Problem, ProblemType } from "../types";
import type { Library } from "./library";
import { nextUnsolved, selectPick, typeProblems, type Rng } from "./picker";

export type DailyInput = Pick<AppData, "solved" | "history" | "filters" | "settings">;

export type DailyResult =
  | { kind: "existing"; record: PickRecord }
  | { kind: "picked"; record: PickRecord; history: PickRecord[]; usedFallback: boolean }
  | { kind: "empty"; reason: string };

export function findRecord(history: readonly PickRecord[], date: string): PickRecord | undefined {
  return history.find((r) => r.date === date);
}

export function makeRecord(category: Category, type: ProblemType, problem: Problem, date: string): PickRecord {
  return {
    date,
    categoryId: category.id,
    categoryName: category.name,
    typeId: type.id,
    typeName: type.name,
    problemId: problem.id,
    problemTitle: problem.title,
    problemUrl: problem.url,
  };
}

export function upsertRecord(history: readonly PickRecord[], record: PickRecord): PickRecord[] {
  return [record, ...history.filter((r) => r.date !== record.date)].sort((a, b) => b.date.localeCompare(a.date));
}

function pickForToday(
  data: DailyInput,
  library: Library,
  today: string,
  rng: Rng,
  excludeTypeId?: string,
): DailyResult {
  const result = selectPick(
    { ...data, library, solved: new Set(data.solved), today, ...(excludeTypeId ? { excludeTypeId } : {}) },
    rng,
  );
  if (!result.ok) return { kind: "empty", reason: result.reason };
  const { category, type, entry } = result.pick;
  const record = makeRecord(category, type, entry.problem, today);
  return { kind: "picked", record, history: upsertRecord(data.history, record), usedFallback: result.usedFallback };
}

export function resolveDailyPick(
  data: DailyInput,
  library: Library,
  today: string,
  rng: Rng = Math.random,
): DailyResult {
  const existing = findRecord(data.history, today);
  if (existing) return { kind: "existing", record: existing };
  return pickForToday(data, library, today, rng);
}

export function pickInType(
  data: DailyInput,
  library: Library,
  today: string,
  typeId: string,
): DailyResult {
  const type = library.typeById.get(typeId);
  const category = type ? library.categoryById.get(type.categoryId) : undefined;
  if (!type || !category) return { kind: "empty", reason: "This problem type no longer exists." };
  const entry = nextUnsolved(typeProblems(library, typeId, data.filters), new Set(data.solved));
  if (!entry) return { kind: "empty", reason: `Every problem in ${type.name} is solved. Shuffle for a new type.` };
  const record = makeRecord(category, type, entry.problem, today);
  return { kind: "picked", record, history: upsertRecord(data.history, record), usedFallback: false };
}

export function shuffleDailyPick(
  data: DailyInput,
  library: Library,
  today: string,
  rng: Rng = Math.random,
): DailyResult {
  return pickForToday(data, library, today, rng, findRecord(data.history, today)?.typeId);
}

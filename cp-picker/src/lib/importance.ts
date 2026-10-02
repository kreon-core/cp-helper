import { DEFAULT_IMPORTANCE, type Importance, type ProblemType } from "../types";

export type ImportanceOverrides = Readonly<Record<string, Importance>>;

export const IMPORTANCE_WEIGHT: Record<Importance, number> = { 3: 9, 2: 3, 1: 1, 0: 0 };

export function typeImportance(type: ProblemType, overrides: ImportanceOverrides): Importance {
  return overrides[type.id] ?? type.importance ?? DEFAULT_IMPORTANCE;
}

export function stars(importance: Importance): string {
  return importance === 0 ? "-" : "\u2605".repeat(importance) + "\u2606".repeat(3 - importance);
}

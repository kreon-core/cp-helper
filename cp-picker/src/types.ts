export const PLATFORMS = ["Codeforces", "AtCoder", "CSES"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const LEVELS = [1, 2, 3, 4] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_NAMES: Record<Level, string> = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
  4: "Very Hard",
};

export const IMPORTANCES = [3, 2, 1, 0] as const;
export type Importance = (typeof IMPORTANCES)[number];

export const IMPORTANCE_NAMES: Record<Importance, string> = {
  3: "Core",
  2: "Useful",
  1: "Rare",
  0: "Never pick",
};

export const DEFAULT_IMPORTANCE: Importance = 2;

export interface Category {
  id: string;
  name: string;
}

export interface ProblemType {
  id: string;
  name: string;
  categoryId: string;
  group?: string;
  importance?: Importance;
}

export interface Problem {
  id: string;
  url: string;
  title: string;
  platform: Platform;
  rating?: number;
  ratingEstimated?: boolean;
  types: Record<string, Level>;
}

export interface Catalog {
  categories: Category[];
  types: ProblemType[];
  problems: Problem[];
}

export interface PickRecord {
  date: string;
  categoryId: string;
  categoryName: string;
  typeId: string;
  typeName: string;
  problemId: string;
  problemTitle: string;
  problemUrl: string;
}

export const RATING_BOUNDS = { min: 800, max: 3500 } as const;

export interface Filters {
  categories: string[];
  platforms: Platform[];
  minRating: number;
  maxRating: number;
}

export interface Settings {
  historyWindowDays: number;
  followRating: boolean;
}

export interface Profile {
  handle: string;
  syncedAt: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  lastSubmissionId?: number;
}

export interface AppData {
  custom: Catalog;
  solved: string[];
  history: PickRecord[];
  settings: Settings;
  filters: Filters;
  profile: Profile | null;
  importance: Record<string, Importance>;
}

export const DEFAULT_SETTINGS: Settings = {
  historyWindowDays: 7,
  followRating: true,
};

export const DEFAULT_FILTERS: Filters = {
  categories: [],
  platforms: [],
  minRating: 1600,
  maxRating: RATING_BOUNDS.max,
};

export const EMPTY_CATALOG: Catalog = {
  categories: [],
  types: [],
  problems: [],
};

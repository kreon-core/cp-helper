export const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const STATUSES = ["Not practiced", "Practicing", "Mastered"] as const;
export type TopicStatus = (typeof STATUSES)[number];

export const DEFAULT_CATEGORIES = ["String", "Graph", "DP", "Geometry", "Data Structure", "Math"];

export interface Topic {
  id: string;
  name: string;
  category: string;
  difficulty: Difficulty;
  tags: string[];
  note?: string;
  status: TopicStatus;
}

export interface PracticeRecord {
  date: string;
  topicId: string;
  topicName: string;
  category: string;
  difficulty: Difficulty;
}

export interface Filters {
  categories: string[];
  difficulties: Difficulty[];
  tags: string[];
  statuses: TopicStatus[];
}

export interface Settings {
  historyWindowDays: number;
  allowMastered: boolean;
  defaultCategories: string[];
  defaultDifficulties: Difficulty[];
}

export interface AppData {
  topics: Topic[];
  history: PracticeRecord[];
  settings: Settings;
  filters: Filters;
}

export const DEFAULT_SETTINGS: Settings = {
  historyWindowDays: 7,
  allowMastered: false,
  defaultCategories: [],
  defaultDifficulties: [],
};

export function filtersFromSettings(settings: Settings): Filters {
  return {
    categories: [...settings.defaultCategories],
    difficulties: [...settings.defaultDifficulties],
    tags: [],
    statuses: [],
  };
}

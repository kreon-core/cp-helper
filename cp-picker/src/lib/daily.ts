import type { AppData, PracticeRecord, Topic } from "../types";
import { selectTopic, type Rng } from "./picker";

export type DailyInput = Pick<AppData, "topics" | "history" | "filters" | "settings">;

export type DailyResult =
  | { kind: "existing"; record: PracticeRecord }
  | { kind: "picked"; record: PracticeRecord; history: PracticeRecord[]; usedFallback: boolean }
  | { kind: "empty"; reason: string };

export function findRecord(history: readonly PracticeRecord[], date: string): PracticeRecord | undefined {
  return history.find((r) => r.date === date);
}

export function makeRecord(topic: Topic, date: string): PracticeRecord {
  return {
    date,
    topicId: topic.id,
    topicName: topic.name,
    category: topic.category,
    difficulty: topic.difficulty,
  };
}

export function upsertRecord(history: readonly PracticeRecord[], record: PracticeRecord): PracticeRecord[] {
  return [record, ...history.filter((r) => r.date !== record.date)].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}

export function resolveDailyTopic(data: DailyInput, today: string, rng: Rng = Math.random): DailyResult {
  const existing = findRecord(data.history, today);
  if (existing) return { kind: "existing", record: existing };
  return pickForToday(data, today, rng, new Set());
}

export function shuffleDailyTopic(data: DailyInput, today: string, rng: Rng = Math.random): DailyResult {
  const current = findRecord(data.history, today);
  return pickForToday(data, today, rng, new Set(current ? [current.topicId] : []));
}

function pickForToday(
  data: DailyInput,
  today: string,
  rng: Rng,
  excludeIds: ReadonlySet<string>,
): DailyResult {
  const result = selectTopic({ ...data, today, excludeIds }, rng);
  if (!result.ok) return { kind: "empty", reason: result.reason };
  const record = makeRecord(result.topic, today);
  return {
    kind: "picked",
    record,
    history: upsertRecord(data.history, record),
    usedFallback: result.usedFallback,
  };
}

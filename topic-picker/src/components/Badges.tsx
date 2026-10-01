import type { Difficulty, TopicStatus } from "../types";

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`badge diff-${difficulty.toLowerCase()}`}>{difficulty}</span>;
}

const STATUS_CLASS: Record<TopicStatus, string> = {
  "Not practiced": "status-new",
  Practicing: "status-practicing",
  Mastered: "status-mastered",
};

export function StatusBadge({ status }: { status: TopicStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{status}</span>;
}

export function Dot() {
  return <span className="dot">&middot;</span>;
}

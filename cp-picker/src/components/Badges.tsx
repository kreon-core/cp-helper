import { LEVEL_NAMES, type Level, type Problem } from "../types";

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`badge level-${level}`}>{LEVEL_NAMES[level]}</span>;
}

export function ProblemMeta({ problem }: { problem: Problem }) {
  return (
    <span className="muted">
      {problem.platform}
      {problem.rating !== undefined && (
        <>
          <Dot />
          <span className="mono" title={problem.ratingEstimated ? "Estimated from solver count" : "Rating"}>
            {problem.ratingEstimated ? "~" : ""}
            {problem.rating}
          </span>
        </>
      )}
    </span>
  );
}

export function Dot() {
  return <span className="dot">&middot;</span>;
}

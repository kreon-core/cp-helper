import type { TypeProblem } from "../lib/library";
import { LevelBadge, ProblemMeta } from "./Badges";

interface ProblemListProps {
  entries: readonly TypeProblem[];
  solved: ReadonlySet<string>;
  currentId?: string;
  isDimmed: (entry: TypeProblem) => boolean;
  onToggleSolved: (problemId: string) => void;
  canRemove: (problemId: string) => boolean;
  onRemove: (problemId: string) => void;
}

export function ProblemList({
  entries,
  solved,
  currentId,
  isDimmed,
  onToggleSolved,
  canRemove,
  onRemove,
}: ProblemListProps) {
  return (
    <ol className="problems">
      {entries.map((entry) => {
        const { problem, level } = entry;
        const done = solved.has(problem.id);
        const classes = [
          "problem-row",
          done ? "problem-done" : "",
          problem.id === currentId ? "problem-current" : "",
          isDimmed(entry) ? "problem-dim" : "",
        ];
        return (
          <li key={problem.id} className={classes.filter(Boolean).join(" ")}>
            <input
              type="checkbox"
              checked={done}
              title={done ? "Mark unsolved" : "Mark solved"}
              onChange={() => onToggleSolved(problem.id)}
            />
            <span className="list-main">
              <a className="list-title" href={problem.url} target="_blank" rel="noreferrer" title={problem.title}>
                {problem.title}
              </a>
              <span className="list-sub">
                <ProblemMeta problem={problem} />
              </span>
            </span>
            <LevelBadge level={level} />
            {canRemove(problem.id) ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${problem.title} from this type`}
                onClick={() => onRemove(problem.id)}
              >
                &times;
              </button>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ol>
  );
}

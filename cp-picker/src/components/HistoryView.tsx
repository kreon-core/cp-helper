import type { ViewProps } from "../useAppData";
import { Dot } from "./Badges";
import { EmptyState } from "./EmptyState";

export function HistoryView({ data, update, today }: ViewProps & { today: string }) {
  const remove = (date: string) => update({ history: data.history.filter((r) => r.date !== date) });
  const solved = new Set(data.solved);
  const markSolved = (problemId: string) => {
    if (!solved.has(problemId)) update({ solved: [...data.solved, problemId] });
  };

  if (data.history.length === 0) {
    return (
      <div className="view">
        <EmptyState title="No history yet">
          <p className="hint">Each day's pick is recorded here.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="view">
      <ul className="history">
        {data.history.map((r) => (
          <li key={r.date} className="history-row">
            <span className="mono muted">{r.date}</span>
            <span className="list-main">
              <span className="history-name" title={r.typeName}>
                {r.typeName}
              </span>
              <span className="list-sub history-sub">
                {r.categoryName}
                <Dot />
                <a href={r.problemUrl} target="_blank" rel="noreferrer" title={r.problemTitle}>
                  {r.problemTitle}
                </a>
              </span>
            </span>
            {solved.has(r.problemId) ? (
              <span className="solved-mark" title="Solved">
                {"\u2713"}
              </span>
            ) : r.date < today ? (
              <button
                type="button"
                className="mark-solved-btn"
                title="Mark solved"
                aria-label={`Mark ${r.problemTitle} solved`}
                onClick={() => markSolved(r.problemId)}
              >
                {"\u2713"}
              </button>
            ) : (
              <span className="solved-mark" title="Not solved" />
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete entry for ${r.date}`}
              onClick={() => remove(r.date)}
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
      <p className="hint center">{data.history.length} day(s) recorded</p>
    </div>
  );
}

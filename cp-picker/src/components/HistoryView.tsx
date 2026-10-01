import type { AppData } from "../types";
import type { UpdateData } from "../useAppData";
import { DifficultyBadge } from "./Badges";
import { EmptyState } from "./EmptyState";

export function HistoryView({ data, update }: { data: AppData; update: UpdateData }) {
  const remove = (date: string) => update({ history: data.history.filter((r) => r.date !== date) });

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
            <span className="history-name" title={r.topicName}>
              {r.topicName}
            </span>
            <span className="muted history-cat">{r.category}</span>
            <DifficultyBadge difficulty={r.difficulty} />
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

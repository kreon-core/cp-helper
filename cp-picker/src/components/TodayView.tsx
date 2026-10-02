import { useState } from "react";
import { IMPORTANCE_NAMES } from "../types";
import { findRecord, shuffleDailyPick } from "../lib/daily";
import { toggleItem } from "../lib/format";
import { stars, typeImportance } from "../lib/importance";
import { selectionBlocker, typeProblems } from "../lib/picker";
import type { ViewProps } from "../useAppData";
import { Dot, LevelBadge, ProblemMeta } from "./Badges";
import { EmptyState } from "./EmptyState";
import { FilterPanel } from "./FilterPanel";
import { Notice, type NoticeState } from "./Notice";

const RECENT_COUNT = 5;

export function TodayView({ data, library, today, update }: ViewProps & { today: string }) {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const solved = new Set(data.solved);
  const record = findRecord(data.history, today);
  const type = record ? library.typeById.get(record.typeId) : undefined;
  const entries = record ? typeProblems(library, record.typeId, data.filters) : [];
  const entry = record ? (library.problemsByType.get(record.typeId) ?? []).find((e) => e.problem.id === record.problemId) : undefined;
  const solvedCount = entries.filter((e) => solved.has(e.problem.id)).length;
  const isSolved = record ? solved.has(record.problemId) : false;
  const recent = data.history.filter((r) => r.date < today).slice(0, RECENT_COUNT);

  const shuffle = () => {
    const result = shuffleDailyPick(data, library, today);
    if (result.kind === "empty") {
      setNotice({ tone: "error", text: result.reason });
      return;
    }
    if (result.kind !== "picked") return;
    update({ history: result.history });
    if (record && result.record.typeId === record.typeId) {
      setNotice({ tone: "info", text: "This is the only type with unsolved problems that matches the filters." });
    } else if (result.usedFallback) {
      setNotice({
        tone: "info",
        text: "Every matching type was picked recently, so this pick ignores the history window.",
      });
    } else {
      setNotice(null);
    }
  };

  const toggleSolved = () => {
    if (record) update({ solved: toggleItem(data.solved, record.problemId) });
  };

  return (
    <div className="view">
      <section className="panel today-card">
        <p className="eyebrow">Today's Pick</p>
        {record ? (
          <>
            <p className="topic-meta">{record.categoryName}</p>
            <h2 className="topic-name">{record.typeName}</h2>
            {type && (
              <p className="hint">
                {type.group && (
                  <>
                    {type.group}
                    <Dot />
                  </>
                )}
                <span className="stars" title={IMPORTANCE_NAMES[typeImportance(type, data.importance)]}>
                  {stars(typeImportance(type, data.importance))}
                </span>
              </p>
            )}
            <a
              className={isSolved ? "problem-card problem-done" : "problem-card"}
              href={record.problemUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span className="problem-title">{record.problemTitle}</span>
              {entry && (
                <span className="problem-sub">
                  <ProblemMeta problem={entry.problem} />
                  <Dot />
                  <LevelBadge level={entry.level} />
                </span>
              )}
            </a>
            {entries.length > 0 && (
              <p className="hint">
                {solvedCount} / {entries.length} solved in this type
              </p>
            )}
            <button type="button" className={isSolved ? "btn btn-success" : "btn"} onClick={toggleSolved}>
              {isSolved ? "Solved \u2713" : "Mark solved"}
            </button>
          </>
        ) : (
          <EmptyState title="No problem picked yet">
            <p className="hint">{selectionBlocker(library, solved, data.filters, data.importance) ?? "Press the button to pick one."}</p>
          </EmptyState>
        )}
        <button type="button" className="btn btn-primary btn-wide" onClick={shuffle}>
          {record ? "Shuffle" : "Pick a problem"}
        </button>
        <Notice notice={notice} onClose={() => setNotice(null)} />
      </section>

      <FilterPanel data={data} library={library} update={update} />

      <section className="recent">
        <p className="eyebrow">Recently practiced</p>
        {recent.length > 0 ? (
          <p className="recent-list">
            {recent.map((r, i) => (
              <span key={r.date} title={`${r.date}: ${r.problemTitle}`}>
                {i > 0 && <Dot />}
                {r.typeName}
              </span>
            ))}
          </p>
        ) : (
          <p className="hint">Nothing yet.</p>
        )}
      </section>
    </div>
  );
}

import { useState } from "react";
import { IMPORTANCE_NAMES } from "../types";
import { findRecord, pickInType, shuffleDailyPick } from "../lib/daily";
import { toggleItem } from "../lib/format";
import { stars, typeImportance } from "../lib/importance";
import { selectionBlocker, typeProblems } from "../lib/picker";
import type { ViewProps } from "../useAppData";
import { Dot, LevelBadge, ProblemMeta } from "./Badges";
import { EmptyState } from "./EmptyState";
import { FilterPanel } from "./FilterPanel";
import { Notice, type NoticeState } from "./Notice";

const RECENT_COUNT = 5;

function ShuffleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
      <path d="m18 2 4 4-4 4" />
      <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
      <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
      <path d="m18 14 4 4-4 4" />
    </svg>
  );
}

export function TodayView({ data, library, today, update }: ViewProps & { today: string }) {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const solved = new Set(data.solved);
  const record = findRecord(data.history, today);
  const type = record ? library.typeById.get(record.typeId) : undefined;
  const groupName = type ? library.groupByType.get(type.id) : undefined;
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
    if (!record) return;
    const nextSolved = toggleItem(data.solved, record.problemId);
    if (isSolved) {
      update({ solved: nextSolved });
      return;
    }
    const result = pickInType({ ...data, solved: nextSolved }, library, today, record.typeId);
    if (result.kind === "picked") {
      update({ solved: nextSolved, history: result.history });
      setNotice(null);
    } else {
      update({ solved: nextSolved });
      if (result.kind === "empty") setNotice({ tone: "info", text: result.reason });
    }
  };

  return (
    <div className="view">
      <section className="panel today-card">
        {record ? (
          <>
            <p className="topic-meta">{record.categoryName}</p>
            <h2 className="topic-name" title={record.typeName}>
              <span>{record.typeName}</span>
            </h2>
            <p className="hint">
              {type ? (
                <>
                  {groupName && (
                    <>
                      {groupName}
                      <Dot />
                    </>
                  )}
                  <span className="stars" title={IMPORTANCE_NAMES[typeImportance(type, data.importance)]}>
                    {stars(typeImportance(type, data.importance))}
                  </span>
                </>
              ) : (
                "\u00a0"
              )}
            </p>
            <a
              className={isSolved ? "problem-card problem-done" : "problem-card"}
              href={record.problemUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span className="problem-title" title={record.problemTitle}>
                {record.problemTitle}
              </span>
              {entry && (
                <span className="problem-sub">
                  <ProblemMeta problem={entry.problem} />
                  <Dot />
                  <LevelBadge level={entry.level} />
                </span>
              )}
            </a>
            <p className="hint">
              {entries.length > 0 ? `${solvedCount} / ${entries.length} solved in this type` : "\u00a0"}
            </p>
            <div className="pick-actions">
              <button type="button" className={isSolved ? "btn btn-success" : "btn"} onClick={toggleSolved}>
                {isSolved ? "Solved \u2713" : "Mark solved"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-icon"
                onClick={shuffle}
                title="Shuffle"
                aria-label="Shuffle"
              >
                <ShuffleIcon />
              </button>
            </div>
          </>
        ) : (
          <>
            <EmptyState title="No problem picked yet">
              <p className="hint">{selectionBlocker(library, solved, data.filters, data.importance) ?? "Press the button to pick one."}</p>
            </EmptyState>
            <button type="button" className="btn btn-primary btn-wide" onClick={shuffle}>
              Pick a problem
            </button>
          </>
        )}
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

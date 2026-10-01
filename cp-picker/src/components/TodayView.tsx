import { useState } from "react";
import { STATUSES, type AppData, type TopicStatus } from "../types";
import { findRecord, shuffleDailyTopic } from "../lib/daily";
import { selectionBlocker } from "../lib/picker";
import type { UpdateData } from "../useAppData";
import { DifficultyBadge, Dot } from "./Badges";
import { EmptyState } from "./EmptyState";
import { FilterPanel } from "./FilterPanel";
import { Notice, type NoticeState } from "./Notice";

const RECENT_COUNT = 5;

interface TodayViewProps {
  data: AppData;
  today: string;
  update: UpdateData;
}

export function TodayView({ data, today, update }: TodayViewProps) {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const record = findRecord(data.history, today);
  const topic = record ? data.topics.find((t) => t.id === record.topicId) : undefined;
  const recent = data.history.filter((r) => r.date < today).slice(0, RECENT_COUNT);

  const shuffle = () => {
    const result = shuffleDailyTopic(data, today);
    if (result.kind === "empty") {
      setNotice({ tone: "error", text: result.reason });
      return;
    }
    if (result.kind !== "picked") return;
    update({ history: result.history });
    if (record && result.record.topicId === record.topicId) {
      setNotice({ tone: "info", text: "This is the only topic that matches the current filters." });
    } else if (result.usedFallback) {
      setNotice({
        tone: "info",
        text: "Every matching topic was practiced recently, so this pick ignores the history window.",
      });
    } else {
      setNotice(null);
    }
  };

  const setStatus = (status: TopicStatus) => {
    if (!topic) return;
    update({ topics: data.topics.map((t) => (t.id === topic.id ? { ...t, status } : t)) });
  };

  return (
    <div className="view">
      <section className="panel today-card">
        <p className="eyebrow">Today's Topic</p>
        {record ? (
          <>
            <h2 className="topic-name">{record.topicName}</h2>
            <p className="topic-meta">
              {record.category} <Dot /> <DifficultyBadge difficulty={record.difficulty} />
            </p>
            {topic && topic.tags.length > 0 && (
              <p className="tags">
                {topic.tags.map((tag) => (
                  <span key={tag} className="tag">
                    #{tag}
                  </span>
                ))}
              </p>
            )}
            {topic?.note && <p className="note">{topic.note}</p>}
            {topic ? (
              <label className="status-select">
                <span className="muted">Status</span>
                <select value={topic.status} onChange={(e) => setStatus(e.target.value as TopicStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="hint">This topic was deleted from your list.</p>
            )}
          </>
        ) : (
          <EmptyState title="No topic picked yet">
            <p className="hint">
              {selectionBlocker(data.topics, data.filters, data.settings) ?? "Press the button to pick one."}
            </p>
          </EmptyState>
        )}
        <button type="button" className="btn btn-primary btn-wide" onClick={shuffle}>
          {record ? "Shuffle" : "Pick a topic"}
        </button>
        <Notice notice={notice} onClose={() => setNotice(null)} />
      </section>

      <FilterPanel data={data} update={update} />

      <section className="recent">
        <p className="eyebrow">Recently practiced</p>
        {recent.length > 0 ? (
          <p className="recent-list">
            {recent.map((r, i) => (
              <span key={r.date} title={r.date}>
                {i > 0 && <Dot />}
                {r.topicName}
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

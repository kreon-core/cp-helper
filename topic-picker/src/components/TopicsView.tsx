import { useRef, useState, type ChangeEvent } from "react";
import { DEFAULT_CATEGORIES, STATUSES, type AppData, type Topic, type TopicStatus } from "../types";
import { errorMessage } from "../lib/format";
import { newId } from "../lib/id";
import { collectCategories, mergeTopics, parseTopicsJson, serializeTopics } from "../lib/topics";
import type { UpdateData } from "../useAppData";
import { DifficultyBadge, Dot, StatusBadge } from "./Badges";
import { ChipGroup } from "./ChipGroup";
import { EmptyState } from "./EmptyState";
import { Notice, type NoticeState } from "./Notice";
import { TopicForm } from "./TopicForm";

type Editing = { mode: "new" } | { mode: "edit"; topic: Topic } | null;

function downloadJson(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TopicsView({ data, update }: { data: AppData; update: UpdateData }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [statuses, setStatuses] = useState<TopicStatus[]>([]);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const categories = collectCategories(data.topics, DEFAULT_CATEGORIES);
  const query = search.trim().toLowerCase();
  const visible = data.topics
    .filter((t) => !category || t.category === category)
    .filter((t) => statuses.length === 0 || statuses.includes(t.status))
    .filter(
      (t) =>
        !query ||
        t.name.toLowerCase().includes(query) ||
        t.tags.some((tag) => tag.toLowerCase().includes(query)),
    )
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const save = (fields: Omit<Topic, "id">) => {
    if (editing?.mode === "edit") {
      const id = editing.topic.id;
      update({ topics: data.topics.map((t) => (t.id === id ? { id, ...fields } : t)) });
    } else {
      update({ topics: [...data.topics, { id: newId(), ...fields }] });
    }
    setEditing(null);
  };

  const remove = (topic: Topic) => {
    if (!confirm(`Delete "${topic.name}"? History entries are kept.`)) return;
    update({ topics: data.topics.filter((t) => t.id !== topic.id) });
    setEditing(null);
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const result = parseTopicsJson(await file.text(), newId);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error });
        return;
      }
      const merged = mergeTopics(data.topics, result.topics);
      update({ topics: merged.topics });
      setNotice({
        tone: "success",
        text: `Imported ${merged.added} new and updated ${merged.updated} existing topic(s).`,
      });
    } catch (err) {
      setNotice({ tone: "error", text: `Could not read file: ${errorMessage(err)}` });
    }
  };

  if (editing) {
    return (
      <div className="view">
        <TopicForm
          key={editing.mode === "edit" ? editing.topic.id : "new"}
          initial={editing.mode === "edit" ? editing.topic : null}
          categories={categories}
          existing={data.topics}
          onSave={save}
          onDelete={editing.mode === "edit" ? () => remove(editing.topic) : undefined}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="view">
      <div className="toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ mode: "new" })}>
          + Add
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <button
          type="button"
          className="btn"
          disabled={data.topics.length === 0}
          onClick={() => downloadJson("cp-topics.json", serializeTopics(data.topics))}
        >
          Export
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
      </div>
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="row">
        <input
          className="grow"
          placeholder="Search name or tag"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <ChipGroup label="Status" options={STATUSES} selected={statuses} onChange={setStatuses} />

      {data.topics.length === 0 ? (
        <EmptyState title="No topics yet">
          <p className="hint">Add a topic or import a JSON file.</p>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="No topics match" />
      ) : (
        <ul className="list">
          {visible.map((topic) => (
            <li key={topic.id}>
              <button type="button" className="list-item" onClick={() => setEditing({ mode: "edit", topic })}>
                <span className="list-main">
                  <span className="list-title">{topic.name}</span>
                  <span className="list-sub">
                    {topic.category} <Dot /> <DifficultyBadge difficulty={topic.difficulty} />
                  </span>
                </span>
                <StatusBadge status={topic.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint center">
        {visible.length} of {data.topics.length} topic(s)
      </p>
    </div>
  );
}

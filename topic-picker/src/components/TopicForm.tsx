import { useState, type FormEvent } from "react";
import { DIFFICULTIES, STATUSES, type Difficulty, type Topic, type TopicStatus } from "../types";

interface TopicFormProps {
  initial: Topic | null;
  categories: string[];
  existing: readonly Topic[];
  onSave: (topic: Omit<Topic, "id">) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
}

export function TopicForm({ initial, categories, existing, onSave, onDelete, onCancel }: TopicFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? "Medium");
  const [status, setStatus] = useState<TopicStatus>(initial?.status ?? "Not practiced");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    if (!trimmedName) return setError("Name is required.");
    if (!trimmedCategory) return setError("Category is required.");
    const duplicate = existing.some(
      (t) => t.id !== initial?.id && t.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (duplicate) return setError(`A topic named "${trimmedName}" already exists.`);
    const trimmedNote = note.trim();
    onSave({
      name: trimmedName,
      category: trimmedCategory,
      difficulty,
      status,
      tags: parseTags(tags),
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>{initial ? "Edit topic" : "New topic"}</h3>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label>
        Category
        <input value={category} onChange={(e) => setCategory(e.target.value)} list="category-options" />
        <datalist id="category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="form-row">
        <label>
          Difficulty
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as TopicStatus)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Tags <span className="hint">(comma separated)</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <label>
        Note
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="row-between">
        {onDelete ? (
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

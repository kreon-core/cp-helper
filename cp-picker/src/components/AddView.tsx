import { useState, type FormEvent } from "react";
import { LEVELS, LEVEL_NAMES, type Level } from "../types";
import { addProblems } from "../lib/custom";
import { errorMessage } from "../lib/format";
import { findByName } from "../lib/library";
import { parseProblemLinks } from "../lib/links";
import { lookupProblems } from "../lib/lookup";
import type { ViewProps } from "../useAppData";
import { Notice, type NoticeState } from "./Notice";

export interface AddPreset {
  categoryName: string;
  typeName: string;
}

const MAX_SHOWN_INVALID = 5;

export function AddView({ data, library, update, preset }: ViewProps & { preset: AddPreset | null }) {
  const [text, setText] = useState("");
  const [categoryName, setCategoryName] = useState(preset?.categoryName ?? "");
  const [typeName, setTypeName] = useState(preset?.typeName ?? "");
  const [level, setLevel] = useState<Level | 0>(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const parsed = parseProblemLinks(text);
  const category = findByName(library.categoryById.values(), categoryName);
  const typeOptions = category ? (library.typesByCategory.get(category.id) ?? []) : [];
  const isNewCategory = categoryName.trim() !== "" && !category;
  const isNewType = typeName.trim() !== "" && !findByName(typeOptions, typeName);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsed.links.length === 0) {
      return setNotice({ tone: "error", text: "Paste at least one Codeforces, AtCoder or CSES problem link." });
    }
    if (!categoryName.trim()) return setNotice({ tone: "error", text: "Category is required." });
    if (!typeName.trim()) return setNotice({ tone: "error", text: "Problem type is required." });

    setBusy(true);
    setNotice({ tone: "info", text: "Looking up titles and ratings..." });
    try {
      const lookup = await lookupProblems(parsed.links);
      const result = addProblems(
        data.custom,
        library,
        { categoryName, typeName, ...(level ? { level } : {}) },
        parsed.links,
        lookup.info,
      );
      update({ custom: result.custom });
      const lines = [`Added ${result.added} problem(s) to ${categoryName.trim()} / ${typeName.trim()}.`];
      if (result.alreadyThere > 0) lines.push(`${result.alreadyThere} were already in this type.`);
      if (lookup.failed.length > 0) {
        lines.push(`Could not reach ${lookup.failed.join(" and ")}; some titles and ratings are missing.`);
      }
      if (parsed.invalid.length > 0) {
        const shown = parsed.invalid.slice(0, MAX_SHOWN_INVALID).join("\n  ");
        const more = parsed.invalid.length > MAX_SHOWN_INVALID ? `\n  ...and ${parsed.invalid.length - MAX_SHOWN_INVALID} more` : "";
        lines.push(`Skipped ${parsed.invalid.length} unsupported link(s):\n  ${shown}${more}`);
      }
      setNotice({ tone: parsed.invalid.length > 0 ? "info" : "success", text: lines.join("\n") });
      setText("");
    } catch (err) {
      setNotice({ tone: "error", text: `Could not add problems: ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view">
      <form className="panel form" onSubmit={submit}>
        <h3>Add problems</h3>
        <label>
          Links <span className="hint">(one per line; Codeforces contest/problemset, AtCoder or CSES tasks)</span>
          <textarea
            rows={6}
            value={text}
            placeholder={"https://codeforces.com/contest/1000/problem/F\nhttps://atcoder.jp/contests/abc123/tasks/abc123_d"}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </label>
        <p className="hint">
          {parsed.links.length} valid link(s)
          {parsed.invalid.length > 0 && `, ${parsed.invalid.length} unsupported`}
          {parsed.duplicates > 0 && `, ${parsed.duplicates} duplicate(s)`}
        </p>
        <label>
          Category {isNewCategory && <span className="hint">(new)</span>}
          <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} list="add-categories" />
          <datalist id="add-categories">
            {library.categories.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </label>
        <label>
          Problem type {isNewType && <span className="hint">(new)</span>}
          <input value={typeName} onChange={(e) => setTypeName(e.target.value)} list="add-types" />
          <datalist id="add-types">
            {typeOptions.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </label>
        <label>
          Difficulty
          <select value={level} onChange={(e) => setLevel(Number(e.target.value) as Level | 0)}>
            <option value={0}>Auto (from rating)</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <div className="row-between">
          <span className="hint">{data.custom.problems.length} problem(s) added by you</span>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Adding..." : "Add"}
          </button>
        </div>
      </form>
      <Notice notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}

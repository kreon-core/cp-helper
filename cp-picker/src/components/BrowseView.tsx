import { useState } from "react";
import { DEFAULT_IMPORTANCE, IMPORTANCES, IMPORTANCE_NAMES, type Importance, type ProblemType } from "../types";
import { isCustomAssignment, removeAssignment } from "../lib/custom";
import { findRecord, pickInType } from "../lib/daily";
import { toggleItem } from "../lib/format";
import { stars, typeImportance } from "../lib/importance";
import { matchesFilters, typeProblems } from "../lib/picker";
import type { ViewProps } from "../useAppData";
import { EmptyState } from "./EmptyState";
import { FilterPanel } from "./FilterPanel";
import { Notice, type NoticeState } from "./Notice";
import { ProblemList } from "./ProblemList";

interface BrowseViewProps extends ViewProps {
  today: string;
  onPracticed: () => void;
  onAddLinks: (categoryName: string, typeName: string) => void;
}

interface Group {
  title: string;
  types: ProblemType[];
}

function groupTypes(types: readonly ProblemType[], titleOf: (t: ProblemType) => string): Group[] {
  const groups: Group[] = [];
  for (const type of types) {
    const title = titleOf(type);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.types.push(type);
    else groups.push({ title, types: [type] });
  }
  return groups;
}

export function BrowseView({ data, library, update, today, onPracticed, onAddLinks }: BrowseViewProps) {
  const [categoryId, setCategoryId] = useState(() => library.categories[0]?.id ?? "");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const solved = new Set(data.solved);

  const setImportance = (t: ProblemType, value: Importance) => {
    const next = { ...data.importance };
    if (value === (t.importance ?? DEFAULT_IMPORTANCE)) delete next[t.id];
    else next[t.id] = value;
    update({ importance: next });
  };

  const type = typeId ? library.typeById.get(typeId) : undefined;
  if (type) {
    const category = library.categoryById.get(type.categoryId);
    const groupName = library.groupByType.get(type.id);
    const entries = library.problemsByType.get(type.id) ?? [];
    const practiceSet = entries.filter((e) => matchesFilters(e, data.filters));
    const solvedCount = practiceSet.filter((e) => solved.has(e.problem.id)).length;
    const current = findRecord(data.history, today);

    const practice = () => {
      const result = pickInType(data, library, today, type.id);
      if (result.kind === "picked") {
        update({ history: result.history });
        onPracticed();
      } else if (result.kind === "empty") {
        setNotice({ tone: "info", text: result.reason });
      }
    };

    return (
      <div className="view">
        <div className="row-between">
          <button type="button" className="link-btn" onClick={() => setTypeId(null)}>
            &larr; {category?.name ?? "Back"}
          </button>
          <span className="hint">
            {solvedCount} / {practiceSet.length} solved in range
          </span>
        </div>
        <div>
          <h2 className="type-title">{type.name}</h2>
          {groupName && <p className="hint">{groupName}</p>}
        </div>
        <label className="row hint">
          Importance
          <select
            value={typeImportance(type, data.importance)}
            onChange={(e) => setImportance(type, Number(e.target.value) as Importance)}
          >
            {IMPORTANCES.map((i) => (
              <option key={i} value={i}>
                {i === 0 ? IMPORTANCE_NAMES[i] : `${stars(i)} ${IMPORTANCE_NAMES[i]}`}
                {i === (type.importance ?? DEFAULT_IMPORTANCE) ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar">
          <button type="button" className="btn btn-primary" disabled={practiceSet.length === 0} onClick={practice}>
            Practice today
          </button>
          <button type="button" className="btn" onClick={() => onAddLinks(category?.name ?? "", type.name)}>
            + Add links
          </button>
        </div>
        <Notice notice={notice} onClose={() => setNotice(null)} />
        {entries.length === 0 ? (
          <EmptyState title="No problems yet">
            <p className="hint">Add Codeforces, AtCoder or CSES links for this type.</p>
          </EmptyState>
        ) : (
          <ProblemList
            entries={entries}
            solved={solved}
            isDimmed={(entry) => !matchesFilters(entry, data.filters)}
            {...(current?.typeId === type.id ? { currentId: current.problemId } : {})}
            onToggleSolved={(id) => update({ solved: toggleItem(data.solved, id) })}
            canRemove={(id) => isCustomAssignment(data.custom, id, type.id)}
            onRemove={(id) => update({ custom: removeAssignment(data.custom, id, type.id) })}
          />
        )}
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const scope = categoryId ? library.categories.filter((c) => c.id === categoryId) : library.categories;
  const groupOf = (t: ProblemType) => library.groupByType.get(t.id);
  const types = scope
    .flatMap((c) => library.typesByCategory.get(c.id) ?? [])
    .filter((t) => showEmpty || typeProblems(library, t.id, data.filters).length > 0)
    .filter((t) => !query || t.name.toLowerCase().includes(query) || groupOf(t)?.toLowerCase().includes(query));
  const groups = groupTypes(types, (t) =>
    categoryId ? (groupOf(t) ?? "Other") : (library.categoryById.get(t.categoryId)?.name ?? ""),
  );

  return (
    <div className="view">
      <div className="row">
        <input
          className="grow"
          placeholder="Search problem types"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {library.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <FilterPanel data={data} library={library} update={update} />
      <label className="row hint">
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
        Show types without problems in range
      </label>

      {types.length === 0 ? (
        <EmptyState title="No problem types match" />
      ) : (
        groups.map((group, i) => (
          <section key={`${group.title}-${i}`} className="type-group">
            <p className="eyebrow">{group.title}</p>
            <ul className="list">
              {group.types.map((t) => {
                const entries = typeProblems(library, t.id, data.filters);
                const done = entries.filter((e) => solved.has(e.problem.id)).length;
                return (
                  <li key={t.id}>
                    <button type="button" className="list-item" onClick={() => setTypeId(t.id)}>
                      <span className="list-title">{t.name}</span>
                      <span className="stars" title={IMPORTANCE_NAMES[typeImportance(t, data.importance)]}>
                        {stars(typeImportance(t, data.importance))}
                      </span>
                      <span className={entries.length > 0 && done === entries.length ? "count count-done" : "count"}>
                        {done} / {entries.length}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <p className="hint center">{types.length} problem type(s)</p>
    </div>
  );
}

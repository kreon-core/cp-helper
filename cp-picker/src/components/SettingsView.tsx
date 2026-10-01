import { useRef, useState, type ChangeEvent } from "react";
import type { Settings } from "../types";
import { downloadJson, errorMessage } from "../lib/format";
import { SOURCES } from "../lib/sources";
import { parseBackup, serializeBackup } from "../lib/storage";
import type { SyncState, ViewProps } from "../useAppData";
import { CodeforcesPanel } from "./CodeforcesPanel";
import { Notice, type NoticeState } from "./Notice";

const MAX_WINDOW_DAYS = 365;

interface SettingsViewProps extends ViewProps {
  sync: SyncState;
  onSync: (handle: string) => Promise<boolean>;
  onReset: () => void;
}

export function SettingsView({ data, library, update, sync, onSync, onReset }: SettingsViewProps) {
  const { settings } = data;
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const setSettings = (patch: Partial<Settings>) => update({ settings: { ...settings, ...patch } });

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const result = parseBackup(await file.text());
      if (!result.ok) return setNotice({ tone: "error", text: result.error });
      if (!confirm("Replace your added problems, solved list and history with this backup?")) return;
      update(result.backup);
      setNotice({
        tone: "success",
        text: `Restored ${result.backup.custom.problems.length} added problem(s), ${result.backup.solved.length} solved, ${result.backup.history.length} history entries.`,
      });
    } catch (err) {
      setNotice({ tone: "error", text: `Could not read file: ${errorMessage(err)}` });
    }
  };

  const resetProgress = () => {
    if (confirm("Clear the solved list and history? Added problems are kept.")) update({ solved: [], history: [] });
  };

  const resetAll = () => {
    if (confirm("Delete added problems, solved list, history, settings and the Codeforces account?")) onReset();
  };

  return (
    <div className="view">
      <CodeforcesPanel data={data} library={library} update={update} sync={sync} onSync={onSync} />

      <section className="panel settings">
        <label className="setting">
          <span>
            Recent-history window
            <span className="hint block">Skip problem types picked within this many days.</span>
          </span>
          <input
            type="number"
            min={0}
            max={MAX_WINDOW_DAYS}
            className="num"
            value={settings.historyWindowDays}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) {
                setSettings({ historyWindowDays: Math.max(0, Math.min(MAX_WINDOW_DAYS, Math.floor(value))) });
              }
            }}
          />
        </label>
      </section>

      <section className="panel">
        <p className="eyebrow">Problem sources</p>
        <ul className="sources">
          {SOURCES.map((s) => (
            <li key={s.source}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.source}
              </a>
              <span className="hint">
                {" "}
                {s.problems.length} problems, fetched {s.fetchedAt}
              </span>
            </li>
          ))}
          <li>
            Added by you<span className="hint"> {data.custom.problems.length} problems</span>
          </li>
        </ul>
        <p className="hint">
          {library.categories.length} categories, {data.solved.length} problem(s) solved.
        </p>
      </section>

      <section className="panel">
        <div className="row-between">
          <span>
            Backup
            <span className="hint block">Added problems, solved list and history.</span>
          </span>
          <div className="row">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              Import
            </button>
            <button type="button" className="btn" onClick={() => downloadJson("cp-picker-backup.json", serializeBackup(data))}>
              Export
            </button>
          </div>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
        <Notice notice={notice} onClose={() => setNotice(null)} />
      </section>

      <section className="panel danger-zone settings">
        <div className="row-between">
          <span>
            Reset progress
            <span className="hint block">Clears solved problems and history.</span>
          </span>
          <button type="button" className="btn btn-danger" onClick={resetProgress}>
            Reset
          </button>
        </div>
        <div className="row-between">
          <span>
            Reset all data
            <span className="hint block">Also removes the problems you added.</span>
          </span>
          <button type="button" className="btn btn-danger" onClick={resetAll}>
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}

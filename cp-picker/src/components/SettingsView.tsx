import { DIFFICULTIES, DEFAULT_CATEGORIES, filtersFromSettings, type AppData, type Settings } from "../types";
import { collectCategories } from "../lib/topics";
import type { UpdateData } from "../useAppData";
import { ChipGroup } from "./ChipGroup";

const MAX_WINDOW_DAYS = 365;

interface SettingsViewProps {
  data: AppData;
  update: UpdateData;
  onReset: () => void;
}

export function SettingsView({ data, update, onReset }: SettingsViewProps) {
  const { settings } = data;
  const setSettings = (patch: Partial<Settings>) => update({ settings: { ...settings, ...patch } });
  const setDefaults = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    update({ settings: next, filters: filtersFromSettings(next) });
  };

  const reset = () => {
    if (confirm("Delete all topics, history and settings? The sample topics will be restored.")) onReset();
  };

  return (
    <div className="view">
      <section className="panel settings">
        <label className="setting">
          <span>
            Recent-history window
            <span className="hint block">Skip topics practiced within this many days.</span>
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
        <label className="setting">
          <span>
            Allow Mastered topics
            <span className="hint block">Include mastered topics in random picks.</span>
          </span>
          <input
            type="checkbox"
            checked={settings.allowMastered}
            onChange={(e) => setSettings({ allowMastered: e.target.checked })}
          />
        </label>
      </section>

      <section className="panel">
        <p className="eyebrow">Default filters</p>
        <ChipGroup
          label="Category"
          options={collectCategories(data.topics, DEFAULT_CATEGORIES)}
          selected={settings.defaultCategories}
          onChange={(defaultCategories) => setDefaults({ defaultCategories })}
        />
        <ChipGroup
          label="Difficulty"
          options={DIFFICULTIES}
          selected={settings.defaultDifficulties}
          onChange={(defaultDifficulties) => setDefaults({ defaultDifficulties })}
        />
        <p className="hint">Changing defaults also resets the active filters.</p>
      </section>

      <section className="panel danger-zone">
        <div className="row-between">
          <span>
            Reset all data
            <span className="hint block">Restores the sample topics.</span>
          </span>
          <button type="button" className="btn btn-danger" onClick={reset}>
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}

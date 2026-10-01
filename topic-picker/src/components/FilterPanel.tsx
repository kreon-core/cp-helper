import { DIFFICULTIES, STATUSES, filtersFromSettings, type AppData } from "../types";
import { formatFilterSummary } from "../lib/format";
import { collectCategories, collectTags } from "../lib/topics";
import type { UpdateData } from "../useAppData";
import { ChipGroup } from "./ChipGroup";

export function FilterPanel({ data, update }: { data: AppData; update: UpdateData }) {
  const { filters, settings, topics } = data;
  const setFilters = (patch: Partial<AppData["filters"]>) => update({ filters: { ...filters, ...patch } });

  return (
    <details className="panel filters">
      <summary>
        <span className="muted">Filters:</span> {formatFilterSummary(filters)}
      </summary>
      <ChipGroup
        label="Category"
        options={collectCategories(topics)}
        selected={filters.categories}
        onChange={(categories) => setFilters({ categories })}
      />
      <ChipGroup
        label="Difficulty"
        options={DIFFICULTIES}
        selected={filters.difficulties}
        onChange={(difficulties) => setFilters({ difficulties })}
      />
      <ChipGroup
        label="Status"
        options={STATUSES}
        selected={filters.statuses}
        onChange={(statuses) => setFilters({ statuses })}
      />
      <ChipGroup
        label="Tags"
        options={collectTags(topics)}
        selected={filters.tags}
        onChange={(tags) => setFilters({ tags })}
      />
      <div className="row-between">
        <span className="hint">Filters apply to the next pick.</span>
        <button type="button" className="link-btn" onClick={() => update({ filters: filtersFromSettings(settings) })}>
          Reset to defaults
        </button>
      </div>
    </details>
  );
}

import { DEFAULT_FILTERS, PLATFORMS, RATING_BOUNDS, type Filters } from "../types";
import { formatFilterSummary } from "../lib/format";
import type { ViewProps } from "../useAppData";
import { ChipGroup } from "./ChipGroup";

const RATING_STEP = 100;
const RATINGS = Array.from(
  { length: (RATING_BOUNDS.max - RATING_BOUNDS.min) / RATING_STEP + 1 },
  (_, i) => RATING_BOUNDS.min + i * RATING_STEP,
);

export function FilterPanel({ data, library, update }: ViewProps) {
  const { filters } = data;
  const setFilters = (patch: Partial<Filters>) => update({ filters: { ...filters, ...patch } });
  const nameOf = (id: string) => library.categoryById.get(id)?.name ?? id;
  const following = data.settings.followRating && data.profile?.rating !== undefined;

  return (
    <details className="panel filters">
      <summary>
        <span className="muted">Filters:</span> {formatFilterSummary(filters, library)}
      </summary>
      <div className="chip-group">
        <span className="chip-group-label">
          Rating{following && " (following your Codeforces rating; change in Settings)"}
        </span>
        <div className="row">
          <select
            disabled={following}
            value={filters.minRating}
            onChange={(e) => {
              const minRating = Number(e.target.value);
              setFilters({ minRating, maxRating: Math.max(minRating, filters.maxRating) });
            }}
          >
            {RATINGS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <span className="muted">to</span>
          <select
            disabled={following}
            value={filters.maxRating}
            onChange={(e) => {
              const maxRating = Number(e.target.value);
              setFilters({ maxRating, minRating: Math.min(maxRating, filters.minRating) });
            }}
          >
            {RATINGS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <ChipGroup
        label="Category"
        options={library.categories.map((c) => c.id)}
        selected={filters.categories}
        onChange={(categories) => setFilters({ categories })}
        format={nameOf}
      />
      <ChipGroup
        label="Platform"
        options={PLATFORMS}
        selected={filters.platforms}
        onChange={(platforms) => setFilters({ platforms })}
      />
      <div className="row-between">
        <span className="hint">Unrated problems use their level: 1200 / 1700 / 2200 / 2700.</span>
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            update({
              filters: following
                ? { ...DEFAULT_FILTERS, minRating: filters.minRating, maxRating: filters.maxRating }
                : DEFAULT_FILTERS,
            })
          }
        >
          Reset
        </button>
      </div>
    </details>
  );
}

import { toggleItem } from "../lib/format";

interface ChipGroupProps<T extends string> {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  format?: (option: T) => string;
}

export function ChipGroup<T extends string>({ label, options, selected, onChange, format }: ChipGroupProps<T>) {
  if (options.length === 0) return null;
  return (
    <div className="chip-group">
      <span className="chip-group-label">{label}</span>
      <div className="chips">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={selected.includes(option) ? "chip chip-on" : "chip"}
            onClick={() => onChange(toggleItem(selected, option))}
          >
            {format ? format(option) : option}
          </button>
        ))}
      </div>
    </div>
  );
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toUtcDay(value: string): number | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const check = new Date(ms);
  if (check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) return null;
  return ms / MS_PER_DAY;
}

export function isDateString(value: string): boolean {
  return toUtcDay(value) !== null;
}

export function daysBetween(from: string, to: string): number {
  const a = toUtcDay(from);
  const b = toUtcDay(to);
  if (a === null || b === null) return Number.NaN;
  return b - a;
}

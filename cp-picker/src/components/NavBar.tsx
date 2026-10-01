export const TABS = ["Today", "Browse", "Add", "History", "Settings"] as const;
export type Tab = (typeof TABS)[number];

export function NavBar({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="nav">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          className={tab === active ? "nav-btn nav-active" : "nav-btn"}
          onClick={() => onSelect(tab)}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}

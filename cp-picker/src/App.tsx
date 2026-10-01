import { useState } from "react";
import { AddView, type AddPreset } from "./components/AddView";
import { BrowseView } from "./components/BrowseView";
import { HistoryView } from "./components/HistoryView";
import { NavBar, type Tab } from "./components/NavBar";
import { SettingsView } from "./components/SettingsView";
import { TodayView } from "./components/TodayView";
import { useAppData } from "./useAppData";

const IN_TAB = new URLSearchParams(location.search).has("tab");

function openInTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html?tab=1") });
  window.close();
}

export function App() {
  const { today, data, library, error, sync, update, reset, syncCodeforces } = useAppData();
  const [tab, setTab] = useState<Tab>("Today");
  const [addPreset, setAddPreset] = useState<AddPreset | null>(null);
  const canPopOut = !IN_TAB && typeof chrome !== "undefined" && Boolean(chrome.tabs);

  const selectTab = (next: Tab) => {
    if (next === "Add") setAddPreset(null);
    setTab(next);
  };

  const addLinks = (categoryName: string, typeName: string) => {
    setAddPreset({ categoryName, typeName });
    setTab("Add");
  };

  return (
    <div className={IN_TAB ? "app app-tab" : "app"}>
      <header className="header">
        <h1>CP Picker</h1>
        <div className="row">
          <span className="mono muted">{today}</span>
          {canPopOut && (
            <button type="button" className="icon-btn" title="Open in a tab" onClick={openInTab}>
              &#8599;
            </button>
          )}
        </div>
      </header>
      <NavBar active={tab} onSelect={selectTab} />
      <main className="main">
        {error && <p className="notice notice-error">{error}</p>}
        {!data || !library ? (
          !error && <p className="hint center">Loading...</p>
        ) : tab === "Today" ? (
          <TodayView data={data} library={library} today={today} update={update} />
        ) : tab === "Browse" ? (
          <BrowseView
            data={data}
            library={library}
            update={update}
            today={today}
            onPracticed={() => setTab("Today")}
            onAddLinks={addLinks}
          />
        ) : tab === "Add" ? (
          <AddView
            key={addPreset ? `${addPreset.categoryName}/${addPreset.typeName}` : "blank"}
            data={data}
            library={library}
            update={update}
            preset={addPreset}
          />
        ) : tab === "History" ? (
          <HistoryView data={data} library={library} update={update} />
        ) : (
          <SettingsView
            data={data}
            library={library}
            update={update}
            sync={sync}
            onSync={syncCodeforces}
            onReset={() => void reset()}
          />
        )}
      </main>
    </div>
  );
}

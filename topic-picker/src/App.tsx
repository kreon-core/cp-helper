import { useState } from "react";
import { HistoryView } from "./components/HistoryView";
import { NavBar, type Tab } from "./components/NavBar";
import { SettingsView } from "./components/SettingsView";
import { TodayView } from "./components/TodayView";
import { TopicsView } from "./components/TopicsView";
import { useAppData } from "./useAppData";

const IN_TAB = new URLSearchParams(location.search).has("tab");

function openInTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html?tab=1") });
  window.close();
}

export function App() {
  const { today, data, error, update, reset } = useAppData();
  const [tab, setTab] = useState<Tab>("Today");
  const canPopOut = !IN_TAB && typeof chrome !== "undefined" && Boolean(chrome.tabs);

  return (
    <div className={IN_TAB ? "app app-tab" : "app"}>
      <header className="header">
        <h1>CP Topic Picker</h1>
        <div className="row">
          <span className="mono muted">{today}</span>
          {canPopOut && (
            <button type="button" className="icon-btn" title="Open in a tab" onClick={openInTab}>
              &#8599;
            </button>
          )}
        </div>
      </header>
      <NavBar active={tab} onSelect={setTab} />
      <main className="main">
        {error && <p className="notice notice-error">{error}</p>}
        {!data ? (
          !error && <p className="hint center">Loading...</p>
        ) : tab === "Today" ? (
          <TodayView data={data} today={today} update={update} />
        ) : tab === "Topics" ? (
          <TopicsView data={data} update={update} />
        ) : tab === "History" ? (
          <HistoryView data={data} update={update} />
        ) : (
          <SettingsView data={data} update={update} onReset={() => void reset()} />
        )}
      </main>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { parseGistId } from "../lib/gist";
import type { SyncState, UpdateData } from "../useAppData";
import type { GistSync } from "../types";

interface GistPanelProps {
  gist: GistSync | null;
  update: UpdateData;
  sync: SyncState;
  onSync: () => Promise<boolean>;
  onConnect: (gistId: string, token: string) => Promise<boolean>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function GistPanel({ gist, update, sync, onSync, onConnect }: GistPanelProps) {
  const [gistInput, setGistInput] = useState("");
  const [token, setToken] = useState("");
  const busy = sync.status === "syncing";
  const gistId = parseGistId(gistInput);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (gistId && token.trim()) void onConnect(gistId, token.trim()).then((ok) => ok && setToken(""));
  };

  return (
    <section className="panel settings">
      <p className="eyebrow">GitHub Gist sync</p>
      {gist ? (
        <div>
          <p className="profile-line">
            <a href={`https://gist.github.com/${gist.gistId}`} target="_blank" rel="noreferrer" className="mono">
              {gist.gistId.slice(0, 12)}
            </a>
          </p>
          <p className="hint">
            {gist.syncedAt ? `Synced ${formatTime(gist.syncedAt)}` : "Not synced yet"}; syncs when the popup opens and
            after every change.
          </p>
          <div className="row-between">
            <button type="button" className="btn" disabled={busy} onClick={() => void onSync()}>
              {busy ? "Syncing..." : "Sync now"}
            </button>
            <button type="button" className="link-btn" onClick={() => update({ gist: null })}>
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form className="settings" onSubmit={submit}>
          <span className="hint">
            Keeps added problems, the solved list, history and type importance in a secret gist shared by your
            machines. Use a fine-grained token with only the Gists (read and write) account permission.
          </span>
          <input
            placeholder="Gist URL or ID"
            value={gistInput}
            onChange={(e) => setGistInput(e.target.value)}
            spellCheck={false}
          />
          <div className="row">
            <input
              className="grow"
              type="password"
              placeholder="GitHub token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !gistId || !token.trim()}>
              {busy ? "Syncing..." : "Connect"}
            </button>
          </div>
        </form>
      )}
      {gist && sync.status === "error" && <p className="form-error">Sync failed: {sync.message}</p>}
    </section>
  );
}

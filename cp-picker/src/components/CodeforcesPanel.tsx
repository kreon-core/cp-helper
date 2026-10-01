import { useState, type FormEvent } from "react";
import { rangeForRating } from "../lib/codeforces";
import type { SyncState, ViewProps } from "../useAppData";
import { Dot } from "./Badges";

interface CodeforcesPanelProps extends ViewProps {
  sync: SyncState;
  onSync: (handle: string) => Promise<boolean>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function CodeforcesPanel({ data, library, update, sync, onSync }: CodeforcesPanelProps) {
  const { profile, settings } = data;
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const busy = sync.status === "syncing";
  const solvedInCatalog = data.solved.filter((id) => id.startsWith("cf:") && library.problemById.has(id)).length;
  const range = profile?.rating !== undefined ? rangeForRating(profile.rating) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (handle.trim()) void onSync(handle);
  };

  const setFollow = (followRating: boolean) => {
    update({
      settings: { ...settings, followRating },
      ...(followRating && range ? { filters: { ...data.filters, ...range } } : {}),
    });
  };

  return (
    <section className="panel settings">
      <p className="eyebrow">Codeforces account</p>
      <form className="row" onSubmit={submit}>
        <input
          className="grow"
          placeholder="Handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !handle.trim()}>
          {busy ? "Syncing..." : profile ? "Sync now" : "Connect"}
        </button>
      </form>
      {sync.status === "error" && <p className="form-error">Sync failed: {sync.message}</p>}
      {profile && (
        <div>
          <p className="profile-line">
            <a href={`https://codeforces.com/profile/${profile.handle}`} target="_blank" rel="noreferrer">
              {profile.handle}
            </a>
            {profile.rating !== undefined ? (
              <>
                <Dot />
                <span className="mono">{profile.rating}</span>
                {profile.rank && <span className="muted"> {profile.rank}</span>}
                {profile.maxRating !== undefined && <span className="muted"> (max {profile.maxRating})</span>}
              </>
            ) : (
              <span className="muted"> unrated</span>
            )}
          </p>
          <p className="hint">
            {solvedInCatalog} catalog problem(s) solved. Synced {formatTime(profile.syncedAt)}; syncs again when the
            popup opens after 10 minutes.
          </p>
          <div className="row-between">
            <span />
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                update({ profile: null });
                setHandle("");
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
      <label className="setting">
        <span>
          Rating range from my rating
          <span className="hint block">
            {range
              ? `Practice ${range.minRating} to ${range.maxRating} (your rating +100 to +500), updated on every sync.`
              : "Practice your rating +100 to +500. Needs a rated, connected account."}
          </span>
        </span>
        <input type="checkbox" checked={settings.followRating} onChange={(e) => setFollow(e.target.checked)} />
      </label>
    </section>
  );
}

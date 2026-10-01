import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Catalog } from "./types";
import { applySync, fetchCodeforces, isSyncDue } from "./lib/codeforces";
import { resolveDailyPick } from "./lib/daily";
import { toLocalDateString } from "./lib/date";
import { errorMessage } from "./lib/format";
import { buildLibrary, type Library } from "./lib/library";
import { SOURCES } from "./lib/sources";
import { loadData, resetData, saveData } from "./lib/storage";

function libraryFor(custom: Catalog): Library {
  return buildLibrary([...SOURCES, custom]);
}

async function withDailyPick(data: AppData, today: string): Promise<AppData> {
  const daily = resolveDailyPick(data, libraryFor(data.custom), today);
  if (daily.kind !== "picked") return data;
  await saveData({ history: daily.history });
  return { ...data, history: daily.history };
}

export type SyncState = { status: "idle" } | { status: "syncing" } | { status: "error"; message: string };

export function useAppData() {
  const [today] = useState(() => toLocalDateString());
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>({ status: "idle" });
  const dataRef = useRef<AppData | null>(null);
  const syncing = useRef(false);
  const custom = data?.custom;
  const library = useMemo(() => (custom ? libraryFor(custom) : null), [custom]);
  dataRef.current = data;

  const update = useCallback((patch: Partial<AppData>) => {
    dataRef.current = dataRef.current ? { ...dataRef.current, ...patch } : dataRef.current;
    setData((prev) => (prev ? { ...prev, ...patch } : prev));
    saveData(patch).catch((err: unknown) => setError(`Could not save: ${errorMessage(err)}`));
  }, []);

  const syncCodeforces = useCallback(
    async (handle: string): Promise<boolean> => {
      const current = dataRef.current;
      if (!current || syncing.current) return false;
      syncing.current = true;
      setSync({ status: "syncing" });
      try {
        const same = current.profile?.handle.toLowerCase() === handle.trim().toLowerCase();
        const result = await fetchCodeforces(handle.trim(), same ? current.profile?.lastSubmissionId : undefined);
        const latest = dataRef.current;
        if (latest) update(applySync(latest, result, new Date()));
        setSync({ status: "idle" });
        return true;
      } catch (err) {
        setSync({ status: "error", message: errorMessage(err) });
        return false;
      } finally {
        syncing.current = false;
      }
    },
    [update],
  );

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((loaded) => withDailyPick(loaded, today))
      .then((loaded) => {
        if (cancelled) return;
        dataRef.current = loaded;
        setData(loaded);
        if (loaded.profile && isSyncDue(loaded.profile, Date.now())) void syncCodeforces(loaded.profile.handle);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`Could not load data: ${errorMessage(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [today, syncCodeforces]);

  const reset = useCallback(async () => {
    try {
      setData(await withDailyPick(await resetData(), today));
      setError(null);
    } catch (err) {
      setError(`Could not reset data: ${errorMessage(err)}`);
    }
  }, [today]);

  return { today, data, library, error, sync, update, reset, syncCodeforces };
}

export type UpdateData = (patch: Partial<AppData>) => void;

export interface ViewProps {
  data: AppData;
  library: Library;
  update: UpdateData;
}

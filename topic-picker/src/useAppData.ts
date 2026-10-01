import { useCallback, useEffect, useState } from "react";
import type { AppData } from "./types";
import { resolveDailyTopic } from "./lib/daily";
import { toLocalDateString } from "./lib/date";
import { errorMessage } from "./lib/format";
import { loadData, resetData, saveData } from "./lib/storage";

async function withDailyTopic(data: AppData, today: string): Promise<AppData> {
  const daily = resolveDailyTopic(data, today);
  if (daily.kind !== "picked") return data;
  await saveData({ history: daily.history });
  return { ...data, history: daily.history };
}

export function useAppData() {
  const [today] = useState(() => toLocalDateString());
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((loaded) => withDailyTopic(loaded, today))
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`Could not load data: ${errorMessage(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const update = useCallback((patch: Partial<AppData>) => {
    setData((prev) => (prev ? { ...prev, ...patch } : prev));
    saveData(patch).catch((err: unknown) => setError(`Could not save: ${errorMessage(err)}`));
  }, []);

  const reset = useCallback(async () => {
    try {
      setData(await withDailyTopic(await resetData(), today));
      setError(null);
    } catch (err) {
      setError(`Could not reset data: ${errorMessage(err)}`);
    }
  }, [today]);

  return { today, data, error, update, reset };
}

export type UpdateData = (patch: Partial<AppData>) => void;

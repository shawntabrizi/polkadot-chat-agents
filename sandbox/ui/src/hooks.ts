import { useCallback, useEffect, useRef, useState } from 'react';

import { errorText } from './api';

/**
 * Load `fn()` when `deps` change and whenever `reload()` is called; a
 * stale result never overwrites a newer one. Screens call reload from an
 * event subscription, so the data follows the daemon without polling.
 */
export function useLoader<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(fn);
  latest.current = fn;
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    latest
      .current()
      .then(result => {
        if (mine !== seq.current) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (mine === seq.current) setError(errorText(cause, 'Could not load.'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, reload };
}

/** A value kept in localStorage; a missing or unreadable store falls back to `initial`. */
export function useStored<T extends string | number>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      return (typeof initial === 'number' ? Number(raw) : raw) as T;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* storage unavailable: the choice lives for this page only */
      }
    },
    [key],
  );
  return [value, set];
}

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/** Current time, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Eases a number towards its new value. */
export function useAnimatedNumber(target: number, duration = 500) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      current.current = from + (target - from) * eased;
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return Math.round(value);
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload(): void;
  setData(updater: (prev: T | null) => T | null): void;
}

/** Runs an abortable async loader whenever `deps` change. */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    loader(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) {
          setDataState(d);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted || e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((u: (prev: T | null) => T | null) => setDataState(u), []);
  return { data, loading, error, reload, setData };
}

/** True while `until` (epoch ms) is in the future; re-renders when it expires. */
export function useUntil(until: number) {
  const [, force] = useState(0);
  const active = until > Date.now();
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => force((n) => n + 1), until - Date.now() + 20);
    return () => clearTimeout(id);
  }, [until, active]);
  return active;
}

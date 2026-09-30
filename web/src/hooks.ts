import { useCallback, useEffect, useRef, useState } from "react";

// Root font size relative to 16px (0.8 on desktop, see "Density" in app.scss). JS-drawn pieces that take
// pixel sizes (chart heights, the nav tree) multiply by this so they scale with the rest of the app.
const remScale = () => (typeof window === "undefined" ? 1 : parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1);
export function useRemScale() {
  const [s, setS] = useState(remScale);
  useEffect(() => {
    const on = () => setS(remScale());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

export function useData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const req = useRef(0);
  const load = useCallback(() => {
    const n = ++req.current;
    setLoading(true);
    fn().then((d) => { if (n === req.current) { setData(d); setError(null); } })
      .catch((e) => { if (n === req.current) setError(String(e)); })
      .finally(() => { if (n === req.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  // New inputs (another entity, another finding): drop the old result so it is never shown under the new
  // URL, and ignore any response that arrives after a newer request. reload() keeps the current data.
  useEffect(() => { setData(null); setError(null); load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

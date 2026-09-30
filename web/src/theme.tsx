import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// One source of truth for colours that live outside CSS (ECharts, SVG, WebGL). Mirrors styles/tokens.scss.
export type Mode = "dark" | "light";
export type Palette = {
  bg: string; layer: string; layer2: string; border: string; borderStrong: string;
  text: string; text2: string; helper: string; accent: string;
  ok: string; review: string; confirmed: string; ai: string; neutral1: string; neutral2: string;
  quiet: string; covered: string; hatchA: string; hatchB: string; na: string; onColor: string;
};
export const PALETTES: Record<Mode, Palette> = {
  dark: {
    bg: "#070b14", layer: "#0e1626", layer2: "#142036", border: "#1c2a44", borderStrong: "#34476b",
    text: "#e8edf5", text2: "#a9b5c9", helper: "#8390a6", accent: "#5b96ff",
    ok: "#2dd4bf", review: "#f2b84b", confirmed: "#f87171", ai: "#a78bfa", neutral1: "#5b6b88", neutral2: "#34476b",
    quiet: "#8a6420", covered: "#136b61", hatchA: "#8a2f35", hatchB: "#2b151a", na: "#101a2c", onColor: "#f4f7fb",
  },
  light: {
    bg: "#f4f6fa", layer: "#ffffff", layer2: "#eef2f7", border: "#dfe5ee", borderStrong: "#aab5c6",
    text: "#0d1422", text2: "#445066", helper: "#5d6a80", accent: "#1f5fd6",
    ok: "#0f766e", review: "#9a6a0b", confirmed: "#c2383e", ai: "#6d4fc4", neutral1: "#8391a7", neutral2: "#b7c2d3",
    quiet: "#efd9a2", covered: "#b4e2db", hatchA: "#e3a6a9", hatchB: "#f8e4e5", na: "#eef2f7", onColor: "#ffffff",
  },
};

const KEY = "satsa-theme";
const readMode = (): Mode => {
  try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
};

export function applyMode(mode: Mode) {
  const root = document.documentElement;
  root.classList.toggle("cds--g100", mode === "dark");
  root.classList.toggle("cds--g10", mode === "light");
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

type Ctx = { mode: Mode; p: Palette; toggle: () => void; reduceMotion: boolean };
const ThemeCtx = createContext<Ctx>({ mode: "dark", p: PALETTES.dark, toggle: () => {}, reduceMotion: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(readMode);
  const [reduceMotion, setReduce] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    applyMode(mode);
    try { localStorage.setItem(KEY, mode); } catch { /* storage may be blocked; theme still applies */ }
  }, [mode]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    // Paper is light: print in the light theme, then restore.
    const before = () => applyMode("light");
    const after = () => applyMode(readMode());
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { mq.removeEventListener("change", on); window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  const toggle = useCallback(() => setMode((m) => (m === "dark" ? "light" : "dark")), []);
  const value = useMemo(() => ({ mode, p: PALETTES[mode], toggle, reduceMotion }), [mode, toggle, reduceMotion]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

// Animate a state change with the View Transitions API when available and motion is allowed.
export function withTransition(update: () => void, reduceMotion: boolean) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (reduceMotion || !d.startViewTransition) { update(); return; }
  d.startViewTransition(update);
}

// WCAG relative luminance, used to pick a readable label colour on data-coloured cells.
function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
export const readableOn = (bg: string, p: Palette) => (contrast(p.text, bg) >= contrast(p.bg, bg) ? p.text : p.bg);

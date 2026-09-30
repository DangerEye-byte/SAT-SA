// App-wide toasts built on SwipeToast (inline mode, stacked bottom-right). Swipe down, Escape or wait to dismiss.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckmarkFilled, ErrorFilled, InformationFilled, WarningAltFilled } from "@carbon/icons-react";
import SwipeToast from "./SwipeToast";
import { useTheme } from "../../theme";

export type ToastKind = "ok" | "error" | "info" | "warn";
type Toast = { id: number; kind: ToastKind; title: ReactNode; description?: ReactNode; duration?: number };
type Ctx = { push: (t: Omit<Toast, "id">) => void };
const ToastCtx = createContext<Ctx>({ push: () => {} });

let seq = 0;
const ICON: Record<ToastKind, ReactNode> = {
  ok: <CheckmarkFilled className="sa-ok" />, error: <ErrorFilled className="sa-confirmed" />,
  info: <InformationFilled className="sa-accent" />, warn: <WarningAltFilled className="sa-review" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const { p } = useTheme();
  const push = useCallback((t: Omit<Toast, "id">) => setList((l) => [...l.slice(-3), { ...t, id: ++seq }]), []);
  const value = useMemo(() => ({ push }), [push]);
  const fuse = (k: ToastKind) => (k === "ok" ? p.ok : k === "error" ? p.confirmed : k === "warn" ? p.review : p.accent);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="sa-toasts" aria-label="Notifications">
        {list.map((t) => (
          <SwipeToast key={t.id} inline title={t.title} description={t.description} icon={ICON[t.kind]} closeButton
            duration={t.duration ?? 5200} background={p.layer2} color={p.text} fuseColor={fuse(t.kind)} width={380}
            onClose={() => setList((l) => l.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx).push;

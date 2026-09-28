import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { msg: string; ok: boolean } | null;
const Ctx = createContext<(msg: string, ok?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {/* Live region: announced by screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {toast?.msg}
      </div>
      {toast && (
        <div className={`toast ${toast.ok ? "" : "bad"}`} aria-hidden="true">
          {toast.ok ? "✓" : "✕"} {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

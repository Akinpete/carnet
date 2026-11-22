import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import s from "./primitives.module.css";

type Toast = { id: number; message: string };
type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast | null>(null);
const DISMISS_AFTER_MS = 4000;

/** Short, polite announcements. Never the only place an error is shown. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((message) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), DISMISS_AFTER_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={s.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} className={s.toast}>
            {t.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <ToastProvider> above it");
  return show;
}

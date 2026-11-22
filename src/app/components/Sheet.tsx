import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import s from "./primitives.module.css";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * A modal sheet on the native <dialog>, which traps focus, closes on Escape
 * and returns focus to the opener for free.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={s.sheet} aria-label={title} onClose={onClose}>
      <div className={s.sheetBody}>
        <div className={s.sheetHeader}>
          <h2 className={s.sheetTitle}>{title}</h2>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

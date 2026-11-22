import { useId, type InputHTMLAttributes } from "react";
import s from "./primitives.module.css";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
};

/** Label, input, and its hint or error, wired together for assistive tech. */
export function Field({ label, hint, error, id, className, ...input }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const note = error ?? hint;
  return (
    <div className={[s.field, className ?? ""].join(" ")}>
      <label htmlFor={inputId} className={s.label}>
        {label}
      </label>
      <input
        id={inputId}
        className={s.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        {...input}
      />
      {note ? (
        <p id={noteId} className={error ? s.error : s.hint} role={error ? "alert" : undefined}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

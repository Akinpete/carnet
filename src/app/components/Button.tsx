import type { ButtonHTMLAttributes } from "react";
import s from "./primitives.module.css";

type Variant = "primary" | "secondary" | "ink" | "quiet";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  block?: boolean;
};

export function Button({ variant = "secondary", block, className, type = "button", ...rest }: ButtonProps) {
  const classes = [s.button, s[variant], block ? s.block : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}

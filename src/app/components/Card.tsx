import type { HTMLAttributes } from "react";
import s from "./primitives.module.css";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.card, className ?? ""].join(" ")} {...rest} />;
}

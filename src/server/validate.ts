import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { AppError } from "./errors.ts";

/** Zod at the edge; failures become the standard `invalid_input` envelope. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (result.success) return;
    const issue = result.error.issues[0];
    const field = issue?.path[0];
    throw new AppError(
      400,
      "invalid_input",
      issue?.message ?? "Some of what you sent isn't valid.",
      typeof field === "string" ? field : undefined,
    );
  });
}

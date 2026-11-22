import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ErrorBody } from "../../shared/types.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";

const body = (code: string, message: string, field?: string): ErrorBody => ({
  error: field ? { code, message, field } : { code, message },
});

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) return c.json(body(err.code, err.message, err.field), err.status);
  // Hono raises these itself, e.g. for a malformed JSON body.
  if (err instanceof HTTPException && err.status < 500) {
    return c.json(body("invalid_input", err.message || "The request could not be read."), err.status);
  }
  console.error("unhandled error", err);
  return c.json(body("internal", "Something went wrong on our side."), 500);
};

export const notFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(body("not_found", "There is no such endpoint."), 404);

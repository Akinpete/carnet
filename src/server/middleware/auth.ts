import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { getSessionToken, readSession, setSessionCookie } from "../lib/session.ts";

/** Resolves the session cookie into `c.var.user`, or rejects with 401. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getSessionToken(c);
  const session = token ? await readSession(c.var.ctx.kv, token) : null;
  if (!token || !session) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  if (session.renewed) setSessionCookie(c, token);
  c.set("user", { id: session.userId });
  await next();
});

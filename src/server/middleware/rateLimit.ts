import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";

/**
 * Fixed-window counter in KV. KV isn't atomic, so concurrent requests can
 * slip a few over the limit. That's fine for a blunt backstop.
 */
function rateLimit(name: string, limit: number, windowSeconds: number, who: (c: Context<AppEnv>) => string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { kv } = c.var.ctx;
    const window = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:${name}:${who(c)}:${window}`;
    const count = Number((await kv.get(key)) ?? "0");
    if (count >= limit) {
      throw new AppError(429, "rate_limited", "Too many attempts. Try again in a while.");
    }
    await kv.put(key, String(count + 1), { ttlSeconds: Math.max(60, windowSeconds) });
    await next();
  });
}

/** Per caller IP. For public endpoints such as auth. */
export const rateLimitByIp = (name: string, limit: number, windowSeconds: number) =>
  rateLimit(name, limit, windowSeconds, (c) => c.var.ctx.clientIp(c.req.raw) ?? "unknown");

/** Per signed-in user. Must run after `requireAuth`. */
export const rateLimitByUser = (name: string, limit: number, windowSeconds: number) =>
  rateLimit(name, limit, windowSeconds, (c) => c.var.user.id);

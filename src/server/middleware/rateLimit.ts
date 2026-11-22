import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";

/**
 * Fixed-window limit per IP, counted in KV. KV isn't atomic, so concurrent
 * requests can slip a few over the limit. That's fine for a blunt backstop.
 */
export function rateLimitByIp(name: string, limit: number, windowSeconds: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { kv, clientIp } = c.var.ctx;
    const ip = clientIp(c.req.raw) ?? "unknown";
    const window = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:${name}:${ip}:${window}`;
    const count = Number((await kv.get(key)) ?? "0");
    if (count >= limit) {
      throw new AppError(429, "rate_limited", "Too many attempts. Try again in a while.");
    }
    await kv.put(key, String(count + 1), { ttlSeconds: Math.max(60, windowSeconds) });
    await next();
  });
}

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";

const TTL_SECONDS = 24 * 60 * 60;

type Stored = { status: number; body: string; contentType: string | null };

/**
 * Replays the stored response when an `Idempotency-Key` repeats, so a retried
 * mutation (flaky network, double tap) never applies twice. Keys are scoped
 * per user and kept for 24 hours. Requests without the header pass through.
 * Must run after `requireAuth`.
 */
export const idempotency = createMiddleware<AppEnv>(async (c, next) => {
  const key = c.req.header("idempotency-key");
  if (!key || c.req.method === "GET") return next();
  const kvKey = `idem:${c.var.user.id}:${c.req.method}:${c.req.path}:${key.slice(0, 128)}`;
  const { kv } = c.var.ctx;

  const hit = await kv.get(kvKey);
  if (hit) {
    const stored = JSON.parse(hit) as Stored;
    return new Response(stored.body, {
      status: stored.status,
      headers: { ...(stored.contentType ? { "content-type": stored.contentType } : {}), "idempotent-replay": "true" },
    });
  }

  await next();

  // Server errors aren't stored: a retry should get a fresh attempt.
  if (c.res.status < 500) {
    const body = await c.res.clone().text();
    const stored: Stored = { status: c.res.status, body, contentType: c.res.headers.get("content-type") };
    await kv.put(kvKey, JSON.stringify(stored), { ttlSeconds: TTL_SECONDS });
  }
});

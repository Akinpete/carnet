import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { users } from "../../db/schema.sqlite.ts";
import type { Me } from "../../shared/types.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { requireAuth } from "../middleware/auth.ts";

export const me = new Hono<AppEnv>().use(requireAuth).get("/", async (c) => {
  const user = await c.var.ctx.db
    .select({ id: users.id, email: users.email, timezone: users.timezone, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, c.var.user.id))
    .get();
  if (!user) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  return c.json({ user: user satisfies Me }, 200);
});

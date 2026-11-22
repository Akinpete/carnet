import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { users } from "../../db/schema.sqlite.ts";
import type { Me } from "../../shared/types.ts";
import type { AppEnv } from "../env.ts";
import { AppError } from "../errors.ts";
import { newId } from "../ids.ts";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password.ts";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionToken,
  setSessionCookie,
} from "../lib/session.ts";
import { rateLimitByIp } from "../middleware/rateLimit.ts";
import { validate } from "../validate.ts";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(254));

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const signupBody = z.object({
  email,
  password: z
    .string()
    .min(8, { error: "Use at least 8 characters." })
    .max(256, { error: "Use at most 256 characters." }),
  timezone: z.string().max(64).refine(isTimeZone).optional(),
});

const loginBody = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }).max(256),
});

const toMe = (u: typeof users.$inferSelect): Me => ({
  id: u.id,
  email: u.email,
  timezone: u.timezone,
  createdAt: u.createdAt,
});

export const auth = new Hono<AppEnv>()
  .use("/signup", rateLimitByIp("auth", 10, 3600))
  .use("/login", rateLimitByIp("auth", 10, 3600))
  .post("/signup", validate("json", signupBody), async (c) => {
    const { db, kv, config } = c.var.ctx;
    const { email, password, timezone } = c.req.valid("json");
    const row = {
      id: newId("usr"),
      email,
      passwordHash: await hashPassword(password, config.passwordCost),
      timezone: timezone ?? "UTC",
      createdAt: Date.now(),
    };
    const inserted = await db
      .insert(users)
      .values(row)
      .onConflictDoNothing({ target: users.email })
      .returning();
    const user = inserted[0];
    if (!user) throw new AppError(409, "email_taken", "There's already an account with this email.", "email");
    setSessionCookie(c, await createSession(kv, user.id));
    return c.json({ user: toMe(user) }, 201);
  })
  .post("/login", validate("json", loginBody), async (c) => {
    const { db, kv, config } = c.var.ctx;
    const { email, password } = c.req.valid("json");
    const user = await db.select().from(users).where(eq(users.email, email)).get();
    // Hash anyway when the user is unknown, so timing doesn't reveal which emails exist.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : (await hashPassword(password, config.passwordCost), false);
    if (!user || !ok) throw new AppError(401, "invalid_credentials", "That email and password don't match.");
    // The cost was raised since this hash was made: upgrade it now that we have the password.
    if (needsRehash(user.passwordHash, config.passwordCost)) {
      const passwordHash = await hashPassword(password, config.passwordCost);
      await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    }
    setSessionCookie(c, await createSession(kv, user.id));
    return c.json({ user: toMe(user) }, 200);
  })
  .post("/logout", async (c) => {
    const token = getSessionToken(c);
    if (token) await destroySession(c.var.ctx.kv, token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

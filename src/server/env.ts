import type { Ctx } from "./ctx.ts";

/** Hono environment shared by every route and middleware. */
export type AppEnv = {
  Bindings: { ctx: Ctx };
  Variables: {
    ctx: Ctx;
    /** Set by `requireAuth`. */
    user: { id: string };
  };
};

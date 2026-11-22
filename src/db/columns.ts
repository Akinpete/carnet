// The dialect-divergent column types live here, so table definitions stay
// identical across targets. SQLite (D1) only until the Postgres target lands
// in M6; `schema.pg.ts` will define the same helpers with pg-core types.
import { integer } from "drizzle-orm/sqlite-core";

/** Epoch milliseconds. Becomes `timestamp` on Postgres. */
export const timestampMs = (name: string) => integer(name);

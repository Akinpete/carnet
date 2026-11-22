import { defineConfig } from "drizzle-kit";

// SQLite (D1) only until M6, when a second config generates migrations/pg/.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.sqlite.ts",
  out: "./migrations/sqlite",
});

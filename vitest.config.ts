import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside the real Workers runtime, with a local D1 and KV built
// from cloudflare.config.ts. Migrations are read here, in Node, and applied
// inside the runtime by test/setup.ts.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      config: true,
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations/sqlite") },
      },
    })),
  ],
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});

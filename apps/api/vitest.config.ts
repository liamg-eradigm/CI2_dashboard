import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Integration tests run inside the Workers runtime (workerd) with local D1, R2
// and queue bindings from wrangler.jsonc (dev environment).
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.jsonc", environment: "dev" },
        miniflare: {
          bindings: { ENVIRONMENT: "test", LLM_PROVIDER: "mock", TEST_MIGRATIONS: migrations },
          // The isolated capture worker is not started in tests; the API falls
          // back to the same capture library inline (dev/test only).
          serviceBindings: { CAPTURE: () => new Response("capture worker not running in tests", { status: 503 }) },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
      testTimeout: 30_000,
    },
  };
});

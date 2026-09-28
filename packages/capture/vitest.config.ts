import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs inside workerd: page parsing uses the Workers-native HTMLRewriter.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-08-15", compatibilityFlags: ["nodejs_compat"] } })],
});

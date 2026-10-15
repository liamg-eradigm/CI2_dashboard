/** The Epilepsy project (request 61): its routes and the workbook's every-minute check. */
import type { ProjectModule } from "../types.js";
import { epilepsyRoutes } from "./routes.js";
import { runEpilepsyCron } from "./services/workbook.js";

/** The every-minute trigger (wrangler.jsonc). */
const EVERY_MINUTE = "* * * * *";

export const epilepsy: ProjectModule = {
  kind: "epilepsy",
  routes: epilepsyRoutes,
  prefixes: ["/api/epilepsy/"],
  // Sync only reads the workbook; anything it changes bumps the data version itself.
  readOnlyPosts: new Set(["POST /api/epilepsy/sync", "POST /api/epilepsy/upload"]),
  scheduled(cron, env, ctx) {
    if (cron === EVERY_MINUTE) ctx.waitUntil(runEpilepsyCron(env));
  },
};

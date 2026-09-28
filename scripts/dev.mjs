#!/usr/bin/env node
/**
 * Local development: migrates + seeds the local D1 database on first run, then
 * starts the API worker (:8787), the isolated capture worker (:8789) and the
 * dashboard (:5173). Sign in with the "Dev sign-in" selector in the sidebar.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const state = ".wrangler/state";
if (!existsSync(`${state}/v3/d1`)) {
  console.log("First run: applying migrations and non-confidential seed data…");
  spawnSync("npm", ["run", "db:migrate:local", "-w", "apps/api"], { stdio: "inherit" });
  spawnSync("npm", ["run", "db:seed:local", "-w", "apps/api"], { stdio: "inherit" });
}
const procs = [
  spawn("npx", ["wrangler", "dev", "-c", "apps/api/wrangler.jsonc", "-c", "apps/capture/wrangler.jsonc", "--env", "dev", "--port", "8787", "--persist-to", state], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "apps/web"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

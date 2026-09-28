#!/usr/bin/env node
/**
 * Dashboard-query load test (6_QC_&_Compliance: "dashboard-query load tests").
 *
 *   BASE_URL=http://127.0.0.1:8787 DEV_USER=client@example.com node scripts/load-test.mjs
 *   BASE_URL=https://ci-staging.eradigm.com ACCESS_JWT=<CF_Authorization cookie> node scripts/load-test.mjs
 *
 * Options (env): CONCURRENCY (default 20), DURATION_S (30), P95_MS (800), MAX_ERROR_RATE (0.01).
 * Exits non-zero when the p95 latency or error-rate budget is exceeded.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION = Number(process.env.DURATION_S ?? 30) * 1000;
const P95 = Number(process.env.P95_MS ?? 800);
const MAX_ERR = Number(process.env.MAX_ERROR_RATE ?? 0.01);
const headers = {};
if (process.env.DEV_USER) headers["x-dev-user"] = process.env.DEV_USER;
if (process.env.ACCESS_JWT) headers["cf-access-jwt-assertion"] = process.env.ACCESS_JWT;

const MACROS = ["All", "AI Investment in R&D", "Direct-to-Patient (DTP) Strategy", "Portfolio Restructuring", "Geopolitics"];
const COMPS = ["All", "Pfizer", "Novartis", "Roche", "Sanofi", "AstraZeneca"];
const IMPACT = ["All", "Low", "Medium", "High"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function randomQuery() {
  const p = new URLSearchParams({ from: "2026-01-01", to: "2026-12-31" });
  const m = pick(MACROS), c = pick(COMPS), i = pick(IMPACT);
  if (m !== "All") p.set("f.macrotrend", m);
  if (c !== "All") p.set("f.competitors", c);
  if (i !== "All") p.set("f.impact", i);
  if (Math.random() < 0.2) p.set("q", "AI");
  return p.toString();
}
const routes = [
  () => `/api/dashboard?${randomQuery()}`,
  () => `/api/tracker?${randomQuery()}&page=${Math.floor(Math.random() * 3)}&sort=${pick(["date", "impact", "competitors"])}`,
];

const lat = { dashboard: [], tracker: [] };
let errors = 0, total = 0;
const end = Date.now() + DURATION;
async function worker() {
  while (Date.now() < end) {
    const r = pick(routes)();
    const kind = r.startsWith("/api/dashboard") ? "dashboard" : "tracker";
    const t0 = performance.now();
    try {
      const res = await fetch(BASE + r, { headers });
      await res.arrayBuffer();
      if (!res.ok) errors++;
    } catch {
      errors++;
    }
    lat[kind].push(performance.now() - t0);
    total++;
  }
}
const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
console.log(`Load test ${BASE} · ${CONCURRENCY} concurrent · ${DURATION / 1000}s`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
let failed = false;
for (const [k, a] of Object.entries(lat)) {
  const p95 = q(a, 0.95);
  console.log(`${k.padEnd(10)} n=${a.length} p50=${q(a, 0.5).toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${q(a, 0.99).toFixed(0)}ms`);
  if (p95 > P95) failed = true;
}
const rate = total ? errors / total : 1;
console.log(`requests=${total} rps=${(total / (DURATION / 1000)).toFixed(1)} errors=${errors} (${(rate * 100).toFixed(2)}%)`);
if (rate > MAX_ERR) failed = true;
console.log(failed ? `FAIL · budget p95<=${P95}ms, errors<=${MAX_ERR * 100}%` : "PASS");
process.exit(failed ? 1 : 0);

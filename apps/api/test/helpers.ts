import { env, exports } from "cloudflare:workers";
import { newId, nowIso } from "../src/lib/ids";
import { drainTestQueue } from "../src/pipeline/process";
import { tenantBootstrapStatements } from "../src/services/schema";

export { env };

export interface World {
  a: { id: string; admin: string; analyst: string; client: string };
  b: { id: string; admin: string; analyst: string };
  both: string;
}

async function user(email: string, name: string, tenantId: string, role: string) {
  const id = newId("usr");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4)").bind(id, email, name, nowIso()),
    env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(newId("rol"), tenantId, id, role, nowIso()),
  ]);
  return id;
}

/** Two isolated tenants with admin/analyst/client users plus one user in both. */
export async function seedWorld(): Promise<World> {
  const r = Math.random().toString(36).slice(2, 8);
  const ta = `ta_${r}`;
  const tb = `tb_${r}`;
  await env.DB.batch([
    ...tenantBootstrapStatements(env, { id: ta, name: `Tenant A ${r}`, slug: `a-${r}` }),
    ...tenantBootstrapStatements(env, { id: tb, name: `Tenant B ${r}`, slug: `b-${r}` }),
  ]);
  const w: World = {
    a: { id: ta, admin: `admin.${r}@a.test`, analyst: `analyst.${r}@a.test`, client: `client.${r}@a.test` },
    b: { id: tb, admin: `admin.${r}@b.test`, analyst: `analyst.${r}@b.test` },
    both: `both.${r}@ab.test`,
  };
  await user(w.a.admin, "A Admin", ta, "admin");
  await user(w.a.analyst, "A Analyst", ta, "analyst");
  await user(w.a.client, "A Client", ta, "client");
  await user(w.b.admin, "B Admin", tb, "admin");
  await user(w.b.analyst, "B Analyst", tb, "analyst");
  const both = await user(w.both, "Both Analyst", ta, "analyst");
  await env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at) VALUES (?1, ?2, ?3, 'analyst', ?4)").bind(newId("rol"), tb, both, nowIso()).run();
  return w;
}

export interface CallOpts {
  body?: unknown;
  tenant?: string;
  headers?: Record<string, string>;
  form?: FormData;
}

export async function call(userEmail: string | null, method: string, path: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (userEmail) headers["x-dev-user"] = userEmail;
  if (opts.tenant) headers["x-tenant-id"] = opts.tenant;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const worker = (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default;
  return worker.fetch(new Request(`https://api.test${path}`, { method, headers, body }));
}

export async function json<T = any>(res: Response | Promise<Response>): Promise<T> {
  const r = await res;
  return (await r.json()) as T;
}

export const drain = () => drainTestQueue(env);

export function articleHtml(opts: { url?: string; title: string; body: string; date?: string }) {
  const sf = opts.url ? `<!--\n Page saved with SingleFile \n url: ${opts.url} \n saved date: Wed Sep 24 2026\n-->` : "";
  return `<!DOCTYPE html><html>${sf}<head><title>${opts.title}</title>
<meta property="og:title" content="${opts.title}"><meta property="article:published_time" content="${opts.date ?? "2026-09-20"}">
<script>evil()</script></head><body><article><h1>${opts.title}</h1>${opts.body
    .split("\n")
    .map((p) => `<p>${p}</p>`)
    .join("")}</article></body></html>`;
}

export async function upload(userEmail: string, html: string, name = "page.html", headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([html], name, { type: "text/html" }));
  return call(userEmail, "POST", "/api/submissions", { form, headers });
}

/** Upload an article, run the pipeline and return the Needs-review item. */
export async function ingest(userEmail: string, title: string, body: string, url?: string) {
  const res = await upload(userEmail, articleHtml({ title, body, url }), `${title.slice(0, 20).replace(/\W+/g, "-")}.html`);
  if (res.status !== 201) throw new Error(`upload failed ${res.status}: ${await res.text()}`);
  const { item } = await res.json<{ item: { id: string } }>();
  await drain();
  const detail = await json(call(userEmail, "GET", `/api/items/${item.id}`));
  return detail;
}

export const COMPLETE = {
  date: "2026-09-20",
  competitors: ["Roche"],
  macrotrend: "Robotics and Open-source Models for Pharma",
  subtrend: "Robotics-enabled Labs",
  title: "Roche opens robotics-enabled lab",
  growth: "Strong Increase",
  impact: "High",
  source: "PR",
  action: "Not Actioned",
};

export async function approveWith(userEmail: string, item: { id: string; version: number; draft: Record<string, unknown> }, values: Record<string, unknown> = {}) {
  return call(userEmail, "POST", `/api/items/${item.id}/approve`, { body: { values: { ...item.draft, ...COMPLETE, ...values }, version: item.version } });
}

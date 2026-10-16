/**
 * Request 64: earnings calls. Submitted on the Input page (the report .docx
 * and its text fields); the Markdown is written once, from the fields, when it
 * is submitted. The report is kept in D1 in chunks (a value is at most 2 MB).
 */
import { EARNINGS_CALL_KEYS, MAX_EARNINGS_REPORT_BYTES, earningsCallFileName, earningsCallMarkdown, type EarningsCall, type EarningsCallValues } from "@eradigm/shared";
import type { Principal } from "../../../auth/context.js";
import type { Env } from "../../../env.js";
import { ApiError, badRequest, notFound } from "../../../lib/errors.js";
import { newId, nowIso } from "../../../lib/ids.js";
import { audit } from "../../../services/audit.js";

const CHUNK_BYTES = 1_000_000;
/** A .docx is a ZIP archive: it starts “PK\x03\x04”. */
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

interface Row {
  id: string;
  quarter: string;
  company: string;
  tagline: string;
  loe: string;
  ai_tools: string;
  dtp: string;
  ira: string;
  investment: string;
  trends: string;
  report_name: string;
  report_size: number;
  submitted_at: string;
  submitted_by: string | null;
}

const SELECT = `SELECT e.id, e.quarter, e.company, e.tagline, e.loe, e.ai_tools, e.dtp, e.ira, e.investment, e.trends, e.report_name, e.report_size, e.submitted_at,
  (SELECT u.name FROM users u WHERE u.id = e.submitted_by) AS submitted_by FROM earnings_calls e WHERE e.tenant_id = ?1`;

const toCall = (r: Row): EarningsCall => ({
  id: r.id,
  quarter: r.quarter,
  company: r.company,
  tagline: r.tagline,
  loe: r.loe,
  aiTools: r.ai_tools,
  dtp: r.dtp,
  ira: r.ira,
  investment: r.investment,
  trends: r.trends,
  reportName: r.report_name,
  reportSize: r.report_size,
  submittedAt: r.submitted_at,
  submittedBy: r.submitted_by,
});

export async function listEarningsCalls(env: Env, tenantId: string): Promise<EarningsCall[]> {
  const res = await env.DB.prepare(`${SELECT} ORDER BY e.submitted_at DESC`).bind(tenantId).all<Row>();
  return (res.results ?? []).map(toCall);
}

async function getRow(env: Env, tenantId: string, id: string): Promise<Row & { markdown: string }> {
  const r = await env.DB.prepare(`${SELECT.replace("e.submitted_at,", "e.submitted_at, e.markdown,")} AND e.id = ?2`).bind(tenantId, id).first<Row & { markdown: string }>();
  if (!r) throw notFound("Earnings call");
  return r;
}

export async function createEarningsCall(env: Env, p: Principal, values: EarningsCallValues, report: { name: string; bytes: Uint8Array }): Promise<EarningsCall> {
  if (!/\.docx$/i.test(report.name)) throw badRequest("The report must be a Word document (.docx)");
  if (report.bytes.byteLength > MAX_EARNINGS_REPORT_BYTES) throw new ApiError("VALIDATION", `The report is larger than ${MAX_EARNINGS_REPORT_BYTES / 1048576} MB`);
  if (!isZip(report.bytes)) throw badRequest("The report could not be read as a Word document (.docx)");
  const id = newId("ern");
  const now = nowIso();
  const v = Object.fromEntries(EARNINGS_CALL_KEYS.map((k) => [k, (values[k] ?? "").trim()])) as EarningsCallValues;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO earnings_calls (id, tenant_id, quarter, company, tagline, loe, ai_tools, dtp, ira, investment, trends, markdown, report_name, report_size, submitted_at, submitted_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).bind(id, p.tenantId, v.quarter, v.company, v.tagline, v.loe, v.aiTools, v.dtp, v.ira, v.investment, v.trends, earningsCallMarkdown(v), report.name, report.bytes.byteLength, now, p.userId),
  ];
  for (let at = 0, seq = 0; at < report.bytes.byteLength; at += CHUNK_BYTES, seq++) {
    stmts.push(env.DB.prepare("INSERT INTO earnings_call_files (call_id, tenant_id, seq, data) VALUES (?1, ?2, ?3, ?4)").bind(id, p.tenantId, seq, report.bytes.slice(at, at + CHUNK_BYTES)));
  }
  await env.DB.batch(stmts);
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "earnings_call.created", targetType: "earnings_call", targetId: id, details: { company: v.company, quarter: v.quarter, report: report.name } });
  return toCall(await getRow(env, p.tenantId, id));
}

export async function earningsCallReport(env: Env, tenantId: string, id: string): Promise<{ name: string; bytes: Uint8Array }> {
  const r = await getRow(env, tenantId, id);
  const res = await env.DB.prepare("SELECT data FROM earnings_call_files WHERE tenant_id = ?1 AND call_id = ?2 ORDER BY seq").bind(tenantId, id).all<{ data: ArrayBuffer | number[] }>();
  const parts = (res.results ?? []).map((c) => (c.data instanceof ArrayBuffer ? new Uint8Array(c.data) : new Uint8Array(c.data)));
  const bytes = new Uint8Array(parts.reduce((n, b) => n + b.byteLength, 0));
  let at = 0;
  for (const b of parts) {
    bytes.set(b, at);
    at += b.byteLength;
  }
  return { name: r.report_name, bytes };
}

export async function earningsCallMarkdownFile(env: Env, tenantId: string, id: string): Promise<{ fileName: string; text: string }> {
  const r = await getRow(env, tenantId, id);
  return { fileName: earningsCallFileName(r), text: r.markdown };
}

export async function deleteEarningsCall(env: Env, p: Principal, id: string): Promise<void> {
  const r = await getRow(env, p.tenantId, id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM earnings_call_files WHERE tenant_id = ?1 AND call_id = ?2").bind(p.tenantId, id),
    env.DB.prepare("DELETE FROM earnings_calls WHERE tenant_id = ?1 AND id = ?2").bind(p.tenantId, id),
  ]);
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "earnings_call.deleted", targetType: "earnings_call", targetId: id, details: { company: r.company, quarter: r.quarter } });
}

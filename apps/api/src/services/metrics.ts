/**
 * Extraction quality metrics from real review decisions (6_QC_&_Compliance:
 * completion of required fields, correct categories, evidence support,
 * duplicates and how often analysts need to make corrections).
 */
import type { QualityMetrics, TrackerSchema } from "@eradigm/shared";
import type { Env } from "../env.js";

export async function qualityMetrics(env: Env, schema: TrackerSchema, tenantId: string): Promise<QualityMetrics> {
  const [decisions, drafts, dups, failed] = await env.DB.batch([
    env.DB.prepare("SELECT decision, corrected_keys FROM review_decisions WHERE tenant_id = ?1 AND decision IN ('approve', 'reject')").bind(tenantId),
    env.DB.prepare("SELECT extraction_json FROM intelligence_items WHERE tenant_id = ?1 AND extraction_json IS NOT NULL AND status <> 'deleted' LIMIT 5000").bind(tenantId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE chain = ?1 AND action = 'submission.duplicate'").bind(tenantId),
    env.DB.prepare("SELECT SUM(CASE WHEN quarantined = 1 THEN 0 ELSE 1 END) AS failed, SUM(quarantined) AS quarantined FROM intelligence_items WHERE tenant_id = ?1 AND status = 'failed'").bind(tenantId),
  ]);
  const ds = (decisions?.results ?? []) as { decision: string; corrected_keys: string }[];
  const approvedList = ds.filter((d) => d.decision === "approve");
  const corrections = new Map<string, number>();
  let withCorrections = 0;
  for (const d of approvedList) {
    const keys = JSON.parse(d.corrected_keys || "[]") as string[];
    if (keys.length) withCorrections++;
    for (const k of keys) corrections.set(k, (corrections.get(k) ?? 0) + 1);
  }
  const required = schema.columns.filter((c) => c.required && c.aiAssist).map((c) => c.key);
  let reqFilled = 0;
  let reqTotal = 0;
  let evidenced = 0;
  let proposed = 0;
  for (const row of (drafts?.results ?? []) as { extraction_json: string }[]) {
    const ex = JSON.parse(row.extraction_json) as Record<string, { value: unknown; warnings: string[] }>;
    for (const k of required) {
      reqTotal++;
      if (ex[k]?.value != null) reqFilled++;
    }
    for (const f of Object.values(ex)) {
      if (f.value == null) continue;
      proposed++;
      if (!f.warnings.some((w) => w.startsWith("Evidence excerpt not found"))) evidenced++;
    }
  }
  const n = approvedList.length;
  const f = (failed?.results ?? [])[0] as { failed: number | null; quarantined: number | null } | undefined;
  return {
    reviewed: ds.length,
    approved: n,
    rejected: ds.length - n,
    approvedWithCorrections: withCorrections,
    correctionRate: n ? withCorrections / n : null,
    fieldCorrectionRates: schema.columns.map((c) => ({ key: c.key, label: c.label, corrected: corrections.get(c.key) ?? 0, rate: n ? (corrections.get(c.key) ?? 0) / n : null })),
    requiredFieldCompletion: reqTotal ? reqFilled / reqTotal : null,
    evidenceCoverage: proposed ? evidenced / proposed : null,
    duplicatesDetected: ((dups?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
    failed: f?.failed ?? 0,
    quarantined: f?.quarantined ?? 0,
  };
}

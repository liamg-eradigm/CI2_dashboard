/**
 * Request 70: competitors' logos (the Dashboard's Competitor Profile icons).
 * Admins upload one image per competitor. Only raster images are accepted,
 * recognised by their first bytes rather than the name or the browser's type
 * (an SVG could carry script), and each is served back with its own type and
 * nosniff.
 */
import { COMPETITOR_LOGO_MAX_BYTES, type CompetitorLogo } from "@eradigm/shared";
import type { Env } from "../../../env.js";
import { ApiError, badRequest, notFound } from "../../../lib/errors.js";
import type { Principal } from "../../../auth/context.js";
import { nowIso } from "../../../lib/ids.js";
import { audit } from "../../../services/audit.js";

/** The image type from its first bytes, or null when it is not a PNG, JPEG, WebP or GIF. */
export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export async function listLogos(env: Env, tenantId: string): Promise<CompetitorLogo[]> {
  const res = await env.DB.prepare("SELECT name, updated_at FROM competitor_logos WHERE tenant_id = ?1 ORDER BY name").bind(tenantId).all<{ name: string; updated_at: string }>();
  return (res.results ?? []).map((r) => ({ name: r.name, updatedAt: r.updated_at }));
}

export async function readLogo(env: Env, tenantId: string, name: string): Promise<{ mime: string; bytes: Uint8Array }> {
  const r = await env.DB.prepare("SELECT mime, data FROM competitor_logos WHERE tenant_id = ?1 AND name = ?2").bind(tenantId, name).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!r) throw notFound("Logo");
  return { mime: r.mime, bytes: new Uint8Array(r.data instanceof ArrayBuffer ? r.data : r.data) };
}

export async function saveLogo(env: Env, p: Principal, name: string, bytes: Uint8Array): Promise<CompetitorLogo[]> {
  const n = name.trim();
  if (!n || n.length > 200) throw badRequest("Name the competitor (?name=)");
  if (!bytes.length) throw badRequest("The image is empty");
  if (bytes.length > COMPETITOR_LOGO_MAX_BYTES) throw new ApiError("VALIDATION", `The logo is too large: at most ${Math.round(COMPETITOR_LOGO_MAX_BYTES / 1024)} KB`);
  const mime = sniffImage(bytes);
  if (!mime) throw new ApiError("VALIDATION", "The logo must be a PNG, JPEG, WebP or GIF image");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO competitor_logos (tenant_id, name, mime, size, data, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (tenant_id, name) DO UPDATE SET mime = excluded.mime, size = excluded.size, data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(p.tenantId, n, mime, bytes.length, bytes, now, p.userId)
    .run();
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "settings.changed", targetType: "settings", details: { sections: ["competitorLogos"], competitor: n, size: bytes.length } });
  return listLogos(env, p.tenantId);
}

export async function deleteLogo(env: Env, p: Principal, name: string): Promise<CompetitorLogo[]> {
  await env.DB.prepare("DELETE FROM competitor_logos WHERE tenant_id = ?1 AND name = ?2").bind(p.tenantId, name.trim()).run();
  await audit(env, { tenantId: p.tenantId, actorId: p.userId, actorEmail: p.email, action: "settings.changed", targetType: "settings", details: { sections: ["competitorLogos"], competitor: name.trim(), removed: true } });
  return listLogos(env, p.tenantId);
}

/** Workspace-wide facts the platform reads whatever the project (request 61). */
import type { Env } from "../env.js";

const DEFAULT_TIMEZONE = "Europe/London";

/** The workspace's time zone (its settings; the default until an admin sets one). */
export async function tenantTimezone(env: Env, tenantId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT json_extract(settings_json, '$.timezone') AS tz FROM tenant_settings WHERE tenant_id = ?1").bind(tenantId).first<{ tz: string | null }>();
  return row?.tz || DEFAULT_TIMEZONE;
}

/** Bindings and configuration for the API worker (see wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  /** Optional R2 bucket for snapshots. When absent, snapshots are stored in D1 (Workers Free plan default). */
  SNAPSHOTS?: R2Bucket;
  JOBS?: Queue<JobMessage>;
  /** Service binding to the isolated capture worker (apps/capture). */
  CAPTURE?: Fetcher;
  RATE_LIMITER?: RateLimit;
  SUBMIT_LIMITER?: RateLimit;
  METRICS?: AnalyticsEngineDataset;

  ENVIRONMENT: "dev" | "test" | "staging" | "production";
  AUTH_MODE: "access" | "dev";
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** "none" (manual entry, default) or an LLM adapter name such as "anthropic". See docs/ENABLING-AUTOFILL.md. */
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  LLM_EFFORT: string;
  /** Used only by the dev/test inline capture fallback. */
  CAPTURE_USER_AGENT: string;
  DNS_RESOLVER_URL: string;

  // Secrets
  /** Only needed when LLM_PROVIDER = "anthropic". */
  ANTHROPIC_API_KEY?: string;
  SNAPSHOT_ENCRYPTION_KEY?: string;
  AUDIT_HMAC_KEY?: string;
  ALERT_WEBHOOK_URL?: string;
  /** Optional: lets "end sessions" also revoke the user's Cloudflare Access sessions. */
  CF_ACCOUNT_ID?: string;
  CF_ACCESS_API_TOKEN?: string;
}

export interface JobMessage {
  kind: "process";
  tenantId: string;
  itemId: string;
  attempt: number;
  requestId?: string;
}

export function isProductionLike(env: Env): boolean {
  return env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging";
}

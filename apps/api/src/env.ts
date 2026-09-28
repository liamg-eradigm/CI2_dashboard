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
  /** Per-IP limit on the sign-in endpoints. */
  AUTH_LIMITER?: RateLimit;
  METRICS?: AnalyticsEngineDataset;

  ENVIRONMENT: "dev" | "test" | "staging" | "production";
  /** "entra" (Sign in with Microsoft, staging/production) or "dev" (local only). */
  AUTH_MODE: "entra" | "dev";
  /** Public address of the dashboard, e.g. https://ci.eradigm.com (no trailing slash). Used for the Microsoft redirect URI. */
  APP_ORIGIN: string;
  /** Idle and absolute session limits (defaults 480 minutes / 24 hours). */
  SESSION_IDLE_MINUTES?: string;
  SESSION_MAX_HOURS?: string;
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
  /** Microsoft Entra ID app registration — set with `wrangler secret put` (docs/SIGN-IN-ENTRA.md). */
  ENTRA_CLIENT_ID?: string;
  ENTRA_CLIENT_SECRET?: string;
  /** Optional: comma-separated Directory (tenant) IDs allowed to sign in. Empty = any organisation. */
  ENTRA_ALLOWED_TENANTS?: string;
  /** Random string (≥ 32 characters) that signs the short-lived sign-in state cookie. */
  SESSION_SECRET?: string;
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

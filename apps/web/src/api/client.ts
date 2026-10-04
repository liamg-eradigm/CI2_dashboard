/**
 * The dashboard's only way to reach data: the processing service's /api.
 * It never talks to the database, storage or the LLM directly.
 */
import { CONTRACT_VERSION, isContractCompatible, type ApiError as ApiErrorBody } from "@eradigm/shared";

/** Whether version `a` is older than `b` (major.minor.patch). */
function contractOlder(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

const TENANT_KEY = "eradigm.tenant";
const DEV_USER_KEY = "eradigm.devUser";

export class ApiError extends Error {
  status: number;
  code: string;
  fields: NonNullable<ApiErrorBody["error"]["fields"]>;
  details: Record<string, unknown>;
  requestId?: string;
  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code ?? "HTTP_" + status;
    this.fields = body?.error?.fields ?? [];
    this.details = body?.error?.details ?? {};
    this.requestId = body?.error?.requestId;
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export const tenantStore = { get: () => safeGet(TENANT_KEY), set: (v: string | null) => safeSet(TENANT_KEY, v) };

/** Development sign-in only (the API ignores this header outside dev/test). */
export const DEV_AUTH = import.meta.env.DEV || import.meta.env.VITE_DEV_AUTH === "1";
export const devUserStore = {
  get: () => (DEV_AUTH ? (safeGet(DEV_USER_KEY) ?? "l.griffith@example.com") : null),
  set: (v: string) => safeSet(DEV_USER_KEY, v),
};

let contractWarning: string | null = null;
export const getContractWarning = () => contractWarning;

export async function request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // Required by the API on every state-changing request (cross-site request forgery protection).
  headers.set("x-eci-request", "1");
  const t = tenantStore.get();
  if (t) headers.set("x-tenant-id", t);
  const dev = devUserStore.get();
  if (dev) headers.set("x-dev-user", dev);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  const v = res.headers.get("x-contract-version");
  if (v && !isContractCompatible(v, CONTRACT_VERSION)) {
    contractWarning = `This dashboard (contract ${CONTRACT_VERSION}) is out of date with the service (${v}). Please reload.`;
  } else if (v && contractOlder(v, CONTRACT_VERSION)) {
    // Same major version, but the API is behind the web app (e.g. the API deploy step was skipped).
    contractWarning = `The API service (contract ${v}) is older than this dashboard (${CONTRACT_VERSION}), so newer features may not work. Deploy the API (and apply any new migrations), then reload.`;
  }
  if (res.status === 401 && !DEV_AUTH && path !== "/api/me") {
    // Session missing or ended: go to the sign-in page and come back here afterwards.
    window.location.assign(signInUrl());
  }
  if (!res.ok) {
    let parsed: Partial<ApiErrorBody> | null = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    throw new ApiError(res.status, parsed);
  }
  return res;
}

/** The dashboard's sign-in page, returning to the current page afterwards. */
export function signInUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `/signin?returnTo=${encodeURIComponent(here.startsWith("/signin") ? "/dashboard" : here)}`;
}

/** Ends the session here and at Microsoft. */
export async function signOut(): Promise<void> {
  try {
    const r = await api<{ redirect: string }>("/api/auth/logout", { method: "POST" });
    window.location.assign(r.redirect);
  } catch {
    window.location.assign("/signin?signed_out=1");
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await request(path, init);
  return (await res.json()) as T;
}

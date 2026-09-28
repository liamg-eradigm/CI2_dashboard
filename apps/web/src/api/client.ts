/**
 * The dashboard's only way to reach data: the processing service's /api.
 * It never talks to the database, storage or the LLM directly.
 */
import { CONTRACT_VERSION, isContractCompatible, type ApiError as ApiErrorBody } from "@eradigm/shared";

const TENANT_KEY = "eradigm.tenant";
const DEV_USER_KEY = "eradigm.devUser";

export class ApiError extends Error {
  status: number;
  code: string;
  fields: NonNullable<ApiErrorBody["error"]["fields"]>;
  requestId?: string;
  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code ?? "HTTP_" + status;
    this.fields = body?.error?.fields ?? [];
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
  }
  if (res.status === 401 && !DEV_AUTH) {
    // Cloudflare Access session missing or ended: reload to re-authenticate.
    window.location.reload();
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

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await request(path, init);
  return (await res.json()) as T;
}

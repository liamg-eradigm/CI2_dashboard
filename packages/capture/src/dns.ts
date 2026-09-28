/**
 * DNS resolution over HTTPS so every resolved address can be checked against
 * the blocked ranges before (and after every redirect of) a fetch.
 */
import { blockedIpReason, isIpLiteral } from "@eradigm/shared";

export interface ResolveResult {
  ok: boolean;
  addresses: string[];
  reason: string | null;
}

interface DohAnswer {
  type: number;
  data: string;
}

export async function resolvePublic(host: string, opts: { resolverUrl: string; fetcher: typeof fetch; timeoutMs?: number }): Promise<ResolveResult> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIpLiteral(bare)) {
    const r = blockedIpReason(bare);
    return { ok: !r, addresses: [bare], reason: r };
  }
  const query = async (type: "A" | "AAAA") => {
    const u = new URL(opts.resolverUrl);
    u.searchParams.set("name", host);
    u.searchParams.set("type", type);
    const res = await opts.fetcher(u.toString(), {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) throw new Error(`resolver HTTP ${res.status}`);
    const body = (await res.json()) as { Status: number; Answer?: DohAnswer[] };
    if (body.Status !== 0 && body.Status !== 3) throw new Error(`resolver status ${body.Status}`);
    return (body.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  };
  let addresses: string[];
  try {
    const [a, aaaa] = await Promise.all([query("A"), query("AAAA")]);
    addresses = [...a, ...aaaa];
  } catch (err) {
    return { ok: false, addresses: [], reason: `DNS lookup failed (${(err as Error).message})` };
  }
  if (!addresses.length) return { ok: false, addresses, reason: "Host does not resolve" };
  for (const ip of addresses) {
    const r = blockedIpReason(ip);
    if (r) return { ok: false, addresses, reason: `resolves to a ${r} (${ip})` };
  }
  return { ok: true, addresses, reason: null };
}

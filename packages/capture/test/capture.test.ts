import { describe, expect, it } from "vitest";
import { captureUrl, detectSingleFile, extractArticle, isAllowed, parseUpload, sanitizeHtml, toIsoDate } from "../src/index.js";

const ARTICLE = `<!doctype html><html><head>
<title>Roche opens autonomous lab | Roche newsroom</title>
<meta property="og:title" content="Roche opens robotics-enabled autonomous lab for early discovery">
<meta property="og:site_name" content="Roche newsroom">
<meta property="article:published_time" content="2026-09-24T08:00:00+02:00">
<script>window.track('x')</script>
<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-09-23"}</script>
<link rel="preload" href="https://cdn.example.com/a.js">
</head><body onload="steal()">
<nav>Home | About</nav>
<article><h1>Roche opens robotics-enabled autonomous lab</h1>
<p>Basel, 24 September 2026 – Roche has opened an autonomous laboratory in Basel where robotic systems run design-make-test cycles for small molecules around the clock.</p>
<p>The company said the lab will double experimental throughput for its early discovery teams by 2027, and that it plans to extend the approach to biologics.</p>
<p>Scientists will supervise experiments remotely while the robotic platform schedules and executes assays. <a href="javascript:alert(1)">More</a></p>
</article>
<form action="/subscribe"><input name="email"><button>Go</button></form>
<iframe src="https://ads.example.com"></iframe>
<img src="https://www.google-analytics.com/collect?x=1" width="1" height="1">
</body></html>`;

describe("sanitisation and content scan", () => {
  it("strips scripts, forms, frames, handlers and javascript: URLs", () => {
    const { html, scan } = sanitizeHtml(ARTICLE);
    expect(html).not.toMatch(/<script|<form|<iframe|onload=|javascript:|google-analytics|<link/i);
    expect(html).toContain("autonomous laboratory");
    expect(scan.malicious).toBe(false);
    expect(scan.scriptsRemoved).toBeGreaterThanOrEqual(2);
    expect(scan.formsRemoved).toBeGreaterThanOrEqual(1);
  });

  it("flags malware markers", () => {
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    expect(sanitizeHtml(`<p>${eicar}</p>`).scan.malicious).toBe(true);
    expect(sanitizeHtml('<a href="data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA">x</a>').scan.malicious).toBe(true);
  });
});

describe("article extraction", () => {
  it("extracts headline, body, publication date and outlet, dropping navigation noise", () => {
    const a = extractArticle(ARTICLE, "https://www.roche.com/news/lab");
    expect(a.headline).toBe("Roche opens robotics-enabled autonomous lab for early discovery");
    expect(a.publicationDate).toBe("2026-09-24");
    expect(a.siteName).toBe("Roche newsroom");
    expect(a.bodyText).toContain("double experimental throughput");
    expect(a.bodyText).not.toContain("Home | About");
    expect(a.wordCount).toBeGreaterThan(40);
  });

  it("normalises dates", () => {
    expect(toIsoDate("2026-09-24T23:30:00-05:00")).toBe("2026-09-24");
    expect(toIsoDate("Wed, 23 Sep 2026 10:00:00 GMT")).toBe("2026-09-23");
    expect(toIsoDate("not a date")).toBeNull();
  });

  it("detects SingleFile metadata", () => {
    const sf = detectSingleFile("<!DOCTYPE html> <html><!--\n Page saved with SingleFile \n url: https://news.example.com/sanofi-dte \n saved date: Wed Sep 24 2026 15:20:00 GMT+0100\n--><head></head></html>");
    expect(sf).toEqual({ detected: true, sourceUrl: "https://news.example.com/sanofi-dte", savedAt: "Wed Sep 24 2026 15:20:00 GMT+0100" });
  });
});

describe("robots.txt", () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/press\n\nUser-agent: EradigmCI-Capture\nDisallow: /members/";
  it("applies the most specific group and the longest match", () => {
    expect(isAllowed(txt, "EradigmCI-Capture/1.0", "/members/x")).toBe(false);
    expect(isAllowed(txt, "EradigmCI-Capture/1.0", "/private")).toBe(true);
    expect(isAllowed(txt, "OtherBot/1.0", "/private/x")).toBe(false);
    expect(isAllowed(txt, "OtherBot/1.0", "/private/press/1")).toBe(true);
    expect(isAllowed("", "x", "/")).toBe(true);
  });
});

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function fakeNet(routes: Record<string, Route>, dns: Record<string, string[]>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    if (url.hostname === "dns.test") {
      const name = url.searchParams.get("name") ?? "";
      const type = url.searchParams.get("type");
      const ips = (dns[name] ?? []).filter((ip) => (type === "AAAA" ? ip.includes(":") : !ip.includes(":")));
      return Response.json({ Status: dns[name] ? 0 : 3, Answer: ips.map((data) => ({ type: type === "AAAA" ? 28 : 1, data })) });
    }
    const key = `${url.origin}${url.pathname}`;
    const route = routes[key];
    if (!route) return new Response("not found", { status: 404 });
    return route(url, init);
  }) as typeof fetch;
  return { fetcher, calls };
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const opts = (fetcher: typeof fetch) => ({ fetcher, resolverUrl: "https://dns.test/dns-query", userAgent: "EradigmCI-Capture/1.0" });

describe("captureUrl", () => {
  it("captures a public article through a redirect and records every step", async () => {
    const { fetcher } = fakeNet(
      {
        "https://news.example.com/a": () => new Response(null, { status: 301, headers: { location: "https://news.example.com/b" } }),
        "https://news.example.com/b": () => html(ARTICLE),
      },
      { "news.example.com": ["93.184.216.34"] },
    );
    const r = await captureUrl("news.example.com/a?utm_source=x#top", opts(fetcher));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finalUrl).toBe("https://news.example.com/b");
    expect(r.redirects).toBe(1);
    expect(r.steps.map((s) => s.label)).toEqual(["Validate and normalise", "Destination check", "Isolated capture worker", "Access restrictions", "Content scan before storage"]);
    expect(r.steps[0]?.detail).toContain("tracking parameter");
    expect(r.html).not.toContain("<script");
    expect(r.article.publicationDate).toBe("2026-09-24");
  });

  it("blocks hosts that resolve to private addresses (DNS rebinding) and redirects to metadata IPs", async () => {
    const a = fakeNet({}, { "evil.example.com": ["10.0.0.5"] });
    const r1 = await captureUrl("https://evil.example.com/", opts(a.fetcher));
    expect(r1).toMatchObject({ ok: false, code: "DESTINATION_BLOCKED", stepIndex: 1 });

    const b = fakeNet(
      { "https://news.example.com/x": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }) },
      { "news.example.com": ["93.184.216.34"] },
    );
    const r2 = await captureUrl("https://news.example.com/x", opts(b.fetcher));
    expect(r2).toMatchObject({ ok: false, code: "DESTINATION_BLOCKED" });
    expect(b.calls.some((c) => c.includes("169.254"))).toBe(false);
  });

  it("stops at login walls and never bypasses them", async () => {
    const { fetcher } = fakeNet({ "https://news.example.com/login": () => html("<html><body><form><input type=password></form></body></html>", 200) }, { "news.example.com": ["93.184.216.34"] });
    const r = await captureUrl("https://news.example.com/login", opts(fetcher));
    expect(r).toMatchObject({ ok: false, code: "ACCESS_RESTRICTED", stepIndex: 3 });
    const f2 = fakeNet({ "https://news.example.com/p": () => html("denied", 403) }, { "news.example.com": ["93.184.216.34"] });
    expect(await captureUrl("https://news.example.com/p", opts(f2.fetcher))).toMatchObject({ ok: false, code: "ACCESS_RESTRICTED" });
  });

  it("respects robots.txt", async () => {
    const { fetcher, calls } = fakeNet(
      { "https://news.example.com/robots.txt": () => new Response("User-agent: *\nDisallow: /members", { status: 200 }), "https://news.example.com/members/x": () => html(ARTICLE) },
      { "news.example.com": ["93.184.216.34"] },
    );
    const r = await captureUrl("https://news.example.com/members/x", opts(fetcher));
    expect(r).toMatchObject({ ok: false, code: "ROBOTS_DISALLOWED", stepIndex: 3 });
    expect(calls).not.toContain("https://news.example.com/members/x");
  });

  it("enforces redirect, content-type and size limits", async () => {
    const loop = fakeNet({ "https://news.example.com/loop": (u) => new Response(null, { status: 302, headers: { location: `/loop?n=${Number(u.searchParams.get("n") ?? 0) + 1}` } }) }, { "news.example.com": ["93.184.216.34"] });
    expect(await captureUrl("https://news.example.com/loop", opts(loop.fetcher))).toMatchObject({ ok: false, code: "TOO_MANY_REDIRECTS" });
    const pdf = fakeNet({ "https://news.example.com/doc": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }) }, { "news.example.com": ["93.184.216.34"] });
    expect(await captureUrl("https://news.example.com/doc", opts(pdf.fetcher))).toMatchObject({ ok: false, code: "CONTENT_TYPE" });
    const big = fakeNet({ "https://news.example.com/big": () => new Response("x", { headers: { "content-type": "text/html", "content-length": String(50 * 1024 * 1024) } }) }, { "news.example.com": ["93.184.216.34"] });
    expect(await captureUrl("https://news.example.com/big", opts(big.fetcher))).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });

  it("marks transient source errors as retryable", async () => {
    const { fetcher } = fakeNet({ "https://news.example.com/x": () => html("oops", 503) }, { "news.example.com": ["93.184.216.34"] });
    expect(await captureUrl("https://news.example.com/x", opts(fetcher))).toMatchObject({ ok: false, code: "HTTP_ERROR", retryable: true });
  });
});

describe("parseUpload", () => {
  it("parses SingleFile uploads without network access", async () => {
    const file = `<!--\n Page saved with SingleFile \n url: https://news.example.com/sanofi-dte?utm_source=x \n saved date: Wed Sep 24 2026\n-->${ARTICLE}`;
    const r = await parseUpload(file, "sanofi-dte.html", file.length);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finalUrl).toBe("https://news.example.com/sanofi-dte");
    expect(r.singleFile.detected).toBe(true);
    expect(r.steps[2]?.detail).toContain("no network fetch");
  });

  it("rejects non-HTML files", async () => {
    expect(await parseUpload("%PDF-1.7", "a.pdf", 8)).toMatchObject({ ok: false, code: "CONTENT_TYPE", stepIndex: 0 });
  });
});

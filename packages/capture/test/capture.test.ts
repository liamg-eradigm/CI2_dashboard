import { describe, expect, it } from "vitest";
import { captureUrl, decodeCaptureResult, decodeEntities, detectSingleFile, encodeCaptureResult, extractArticle, isAllowed, parseUpload, processHtml, sanitizeHtml, toIsoDate } from "../src/index.js";

const enc = new TextEncoder();
const text = (b: Uint8Array) => new TextDecoder().decode(b);

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
  it("strips scripts, forms, frames, handlers and javascript: URLs", async () => {
    const { html, scan } = await sanitizeHtml(ARTICLE);
    expect(html).not.toMatch(/<script|<form|<iframe|onload=|javascript:|google-analytics|<link/i);
    expect(html).toContain("autonomous laboratory");
    expect(scan.malicious).toBe(false);
    expect(scan.scriptsRemoved).toBeGreaterThanOrEqual(2);
    expect(scan.formsRemoved).toBeGreaterThanOrEqual(1);
  });

  it("flags malware markers", async () => {
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    expect((await sanitizeHtml(`<p>${eicar}</p>`)).scan.malicious).toBe(true);
    expect((await sanitizeHtml(`<!-- ${eicar} -->`)).scan.malicious).toBe(true);
    expect((await sanitizeHtml('<a href="data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA">x</a>')).scan.malicious).toBe(true);
    expect((await sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).scan.malicious).toBe(false);
  });

  it("decodes entity-obfuscated javascript: URLs before checking them", async () => {
    const { html, scan } = await sanitizeHtml('<p><a href="java&#115;cript:alert(1)">a</a><a href="&#x6A;avascript&colon;x">b</a><a href=" JAVASCRIPT:x">c</a><a href="https://ok.example/">d</a></p>');
    expect(html).not.toMatch(/java&#115;cript|&#x6A;avascript|JAVASCRIPT/);
    expect(html).toContain('href="https://ok.example/"');
    expect(scan.handlersRemoved).toBeGreaterThanOrEqual(2);
  });

  it("keeps the content of page-wide forms, removes meta refresh and base", async () => {
    const { html } = await sanitizeHtml('<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"></head><body><form action="/x"><p>Whole page inside a form</p><input name=q></form></body></html>');
    expect(html).toContain("Whole page inside a form");
    expect(html).not.toMatch(/<form|<input|refresh|evil\.example|<base/i);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("adds a strict Content-Security-Policy so a downloaded copy stays inert", async () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*">/;
    const withHead = (await sanitizeHtml("<!doctype html><html><head><title>x</title></head><body><p>a</p></body></html>")).html;
    expect(withHead).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    const noHead = (await sanitizeHtml("<p>fragment</p>")).html;
    expect(noHead).toMatch(new RegExp(`^<!doctype html>\\n${csp.source}<p>fragment</p>$`));
    const doctypeNoHead = (await sanitizeHtml("<!DOCTYPE html><body><p>b</p></body>")).html;
    expect(doctypeNoHead).toMatch(new RegExp(`^<!DOCTYPE html>\\n${csp.source}<body>`));
  });

  it("only attaches handlers to the elements that need them (Free plan CPU budget)", async () => {
    // A navigation-heavy page: thousands of links and list items outside the article.
    const nav = '<li class="menu"><a href="/s">Section</a></li>'.repeat(3000);
    const page = `<html><head><title>t</title></head><body><nav><ul>${nav}</ul></nav><article><p>${"Article text. ".repeat(30)}</p></article></body></html>`;
    const p = await processHtml(enc.encode(page), null);
    expect(p.article.bodyText.startsWith("Article text.")).toBe(true);
    expect(p.article.bodyText).not.toContain("Section");
  });
});

describe("article extraction", () => {
  it("extracts headline, body, publication date and outlet, dropping navigation noise", async () => {
    const a = await extractArticle(ARTICLE, "https://www.roche.com/news/lab");
    expect(a.headline).toBe("Roche opens robotics-enabled autonomous lab for early discovery");
    expect(a.publicationDate).toBe("2026-09-24");
    expect(a.siteName).toBe("Roche newsroom");
    expect(a.bodyText).toContain("double experimental throughput");
    expect(a.bodyText).not.toContain("Home | About");
    expect(a.wordCount).toBeGreaterThan(40);
  });

  it("keeps text after removed elements and ignores script, style and furniture text", async () => {
    const page = `<html><head><title>T &amp; U</title><style>.x{}</style><script>var s = "<p>fake paragraph</p>";</script></head><body>
      <header><nav>Home | About</nav></header><div class="cookie-banner">We use cookies</div>
      <main><h1>Big &ldquo;news&rdquo;</h1><p>${"Real article text with plenty of words. ".repeat(4)}</p>
      <iframe src="https://ads.example">frame text</iframe><noscript>Enable JS</noscript>
      <p>After the frame &amp; the noscript block, the article continues with more detail.</p>
      <div class="share-bar">Share this</div></main><footer>Footer links</footer></body></html>`;
    const a = await extractArticle(page, "https://www.example.com/x");
    expect(a.headline).toBe("Big “news”");
    expect(a.bodyText).toContain("Real article text");
    expect(a.bodyText).toContain("After the frame & the noscript block");
    expect(a.bodyText).not.toMatch(/fake paragraph|Home \| About|cookies|frame text|Enable JS|Share this|Footer links/);
    expect(a.siteName).toBe("example.com");
  });

  it("falls back to long paragraphs when there is no main content element", async () => {
    const page = `<body><div><div>Menu</div><div><p>${"A long paragraph of news text about a product launch. ".repeat(3)}</p><p>${"Another long paragraph with details of the partnership. ".repeat(3)}</p></div></div></body>`;
    const a = await extractArticle(page, null);
    expect(a.bodyText).toContain("product launch");
    expect(a.bodyText).toContain("partnership");
    expect(a.bodyText.split("\n\n")).toHaveLength(2);
  });

  it("reads JSON-LD dates, authors and publishers", async () => {
    const page = `<head><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-08-01T09:00:00Z","author":[{"name":"J. Doe"}],"publisher":{"name":"Pharma Times"}}]}</script></head><body><p>x</p></body>`;
    const a = await extractArticle(page, "https://pharmatimes.example/a");
    expect(a).toMatchObject({ publicationDate: "2026-08-01", byline: "J. Doe", siteName: "Pharma Times" });
  });

  it("decodes entities", () => {
    expect(decodeEntities("R&amp;D &ndash; &#8220;AI&#x201D; &unknown; caf&eacute;")).toBe("R&D – “AI” &unknown; café");
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
    expect(text(r.html)).not.toContain("<script");
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
    const r = await parseUpload(enc.encode(file), "sanofi-dte.html");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finalUrl).toBe("https://news.example.com/sanofi-dte");
    expect(r.singleFile.detected).toBe(true);
    expect(r.steps[2]?.detail).toContain("no network fetch");
  });

  it("rejects non-HTML files", async () => {
    expect(await parseUpload(enc.encode("%PDF-1.7"), "a.pdf")).toMatchObject({ ok: false, code: "CONTENT_TYPE", stepIndex: 0 });
    expect(await parseUpload(enc.encode("just some text"), "a.html")).toMatchObject({ ok: false, code: "CONTENT_TYPE", stepIndex: 0 });
  });

  it("decodes non-UTF-8 files declared by a meta charset", async () => {
    const latin1 = Uint8Array.from([...'<html><head><meta charset="iso-8859-1"></head><body><p>Caf'].map((c) => c.charCodeAt(0)).concat([0xe9], [..."</p></body></html>"].map((c) => c.charCodeAt(0))));
    const r = await parseUpload(latin1, "a.html");
    expect(r.ok && r.article.bodyText).toBe("Café");
  });
});

describe("capture worker framing", () => {
  it("round-trips a success with the snapshot as raw bytes and a failure", async () => {
    const r = await parseUpload(enc.encode(ARTICLE), "a.html");
    expect(r.ok).toBe(true);
    const back = decodeCaptureResult(encodeCaptureResult(r).slice().buffer);
    expect(back.ok && text(back.html)).toBe(r.ok && text(r.html));
    expect(back.ok && back.article).toEqual(r.ok && r.article);
    const fail = { ok: false as const, code: "TOO_LARGE" as const, message: "big", retryable: false, stepIndex: 0, steps: [], finalUrl: null };
    expect(decodeCaptureResult(encodeCaptureResult(fail))).toEqual(fail);
  });

  it("processes a large page in one pass", async () => {
    const big = `<html><body><nav>${'<a href="/s">Section</a>'.repeat(2000)}</nav><article>${"<p>Paragraph of competitive-intelligence text about a launch.</p>".repeat(5000)}</article>${"<script>var x=1;</script>".repeat(500)}</body></html>`;
    const p = await processHtml(enc.encode(big), null);
    expect(p.article.wordCount).toBeGreaterThan(5_000);
    expect(p.article.truncated).toBe(true);
    expect(text(p.html)).not.toContain("<script");
  });
});

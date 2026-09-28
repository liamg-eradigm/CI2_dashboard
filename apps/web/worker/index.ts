/**
 * Dashboard Worker: serves the static React build and forwards /api/* to the
 * processing service over a service binding (same origin, no CORS, and the
 * API worker needs no public route).
 *
 * This worker holds no credentials and never touches the database; the API
 * independently checks the sign-in session on every request, so a change here
 * cannot bypass permission checks. Session cookies and the Microsoft sign-in
 * redirects pass through unchanged.
 */
interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

const HOP_BY_HOP = ["x-dev-user", "x-dev-iat"];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers(req.headers);
      // Development-only identity headers must never reach a deployed API.
      for (const h of HOP_BY_HOP) headers.delete(h);
      try {
        // redirect: "manual" so sign-in redirects (to Microsoft and back) reach the browser untouched.
        return await env.API.fetch(new Request(req, { headers, redirect: "manual" }));
      } catch {
        return Response.json({ error: { code: "UNAVAILABLE", message: "The processing service is unavailable. Please try again." } }, { status: 503 });
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

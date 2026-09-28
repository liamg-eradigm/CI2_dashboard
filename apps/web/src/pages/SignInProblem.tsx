import type { ApiError} from "../api/client";
import { DEV_AUTH, devUserStore } from "../api/client";

export function SignInProblem({ error }: { error: unknown }) {
  const e = error as ApiError | undefined;
  const msg =
    e?.status === 403
      ? e.message
      : e?.status === 401
        ? "Your session has ended. Please sign in again."
        : e?.status === 503
          ? "The service is not fully configured yet. Contact an administrator."
          : "We could not reach the service. Please try again.";
  return (
    <div className="shell">
      <main id="main" style={{ alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div className="card" style={{ maxWidth: 520 }} role="alert">
          <h1 className="card-title">Sign-in problem</h1>
          <p>{msg}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => window.location.reload()}>
              Try again
            </button>
            {!DEV_AUTH && (
              <a className="btn secondary" href="/cdn-cgi/access/logout">
                Sign out
              </a>
            )}
          </div>
          {DEV_AUTH && (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                const v = new FormData(ev.currentTarget).get("email");
                if (typeof v === "string" && v) devUserStore.set(v);
                window.location.reload();
              }}
              style={{ display: "flex", gap: 8, alignItems: "end" }}
            >
              <label className="field" style={{ flex: 1 }}>
                <span>Development sign-in (email)</span>
                <input className="control" name="email" defaultValue={devUserStore.get() ?? ""} />
              </label>
              <button className="btn secondary">Use</button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

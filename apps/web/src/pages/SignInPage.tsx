import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { type ApiError, DEV_AUTH, devUserStore, request } from "../api/client";

/** Messages for the error codes the sign-in callback can return (never provider text). */
const ERRORS: Record<string, string> = {
  not_invited: "Your Microsoft account is not linked to an account on this platform yet. Ask an Eradigm administrator for an invite link and open it to sign in for the first time.",
  invite_invalid: "This invite link has already been used, has expired or was replaced by a newer one. Ask an administrator for a new sign-in link.",
  already_linked: "This Microsoft account is already linked to a different account on this platform. Sign in with another Microsoft account, or ask an administrator for help.",
  deactivated: "Your account has been deactivated. Ask an administrator if you need access.",
  tenant: "Your organisation is not allowed to sign in to this platform.",
  consumer: "Personal Microsoft accounts (Outlook.com, Hotmail, Live) cannot be used. Sign in with your work or school Microsoft account.",
  consent: "Your organisation requires an administrator to approve this application in Microsoft Entra ID before you can sign in. Ask your IT administrator to grant consent.",
  denied: "Sign-in was cancelled.",
  state: "Your sign-in took too long or was started in another window. Please try again.",
  config: "Sign-in is not configured correctly (the Microsoft client ID or secret is wrong or has expired). Contact an administrator.",
  token: "Microsoft sign-in could not be verified. Please try again.",
  provider: "Microsoft reported a problem with the sign-in. Please try again.",
  rate_limited: "Too many sign-in attempts. Please wait a minute and try again.",
};

function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Eradigm Competitive Intelligence`;
  }, [title]);
  return (
    <div className="signin-page">
      <main id="main" className="signin-card" tabIndex={-1}>
        <div className="signin-brand">
          <div className="logo-tile">
            <img src="/eradigm-logo.webp" alt="" />
          </div>
          <div className="wordmark">
            <b>ERADIGM</b>
            <span>COMPETITIVE INTELLIGENCE</span>
          </div>
        </div>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

function MicrosoftButton({ href, label = "Sign in with Microsoft" }: { href: string; label?: string }) {
  return (
    <a className="ms-btn" href={href}>
      <MicrosoftLogo />
      <span>{label}</span>
    </a>
  );
}

function DevSignIn() {
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const v = new FormData(ev.currentTarget).get("email");
        if (typeof v === "string" && v) devUserStore.set(v);
        window.location.assign("/dashboard");
      }}
      className="signin-dev"
    >
      <label className="field" style={{ flex: 1 }}>
        <span>Development sign-in (email)</span>
        <input className="control" name="email" defaultValue={devUserStore.get() ?? ""} />
      </label>
      <button className="btn secondary">Use</button>
    </form>
  );
}

/** /signin — also shown whenever the API says the session is missing or ended. */
export function SignInPage({ problem }: { problem?: unknown }) {
  const q = new URLSearchParams(useLocation().search);
  const code = q.get("error");
  const returnTo = q.get("returnTo") ?? "/dashboard";
  const e = problem as ApiError | undefined;
  const message = code
    ? (ERRORS[code] ?? ERRORS.provider)
    : e?.status === 403
      ? e.message
      : e?.status === 503
        ? "The service is not fully configured yet. Contact an administrator."
        : e && e.status !== 401
          ? "We could not reach the service. Please try again."
          : null;
  return (
    <Frame title="Sign in">
      {q.get("signed_out") && (
        <p className="signin-note" role="status">
          You have been signed out.
        </p>
      )}
      {message && (
        <p className="err-msg" role="alert">
          {message}
        </p>
      )}
      <p className="signin-copy">Use your organisation’s Microsoft work or school account. Your organisation handles your password and multi-factor sign-in; this platform never sees your password.</p>
      <MicrosoftButton href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`} />
      <p className="signin-small">First time here? Open the invite link an Eradigm administrator sent you.</p>
      {DEV_AUTH && <DevSignIn />}
    </Frame>
  );
}

/** /invite/:token — first sign-in: links the person's Microsoft account to their platform account. */
export function InvitePage() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<{ valid: boolean; name?: string | null; workspace?: string | null; expiresAt?: string } | null>(null);
  useEffect(() => {
    request(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ valid: false }));
  }, [token]);
  if (!info) return <Frame title="Accept invitation">{<div className="skeleton" style={{ height: 80 }} />}</Frame>;
  if (!info.valid) {
    return (
      <Frame title="Invite link not valid">
        <p className="err-msg" role="alert">
          {ERRORS.invite_invalid}
        </p>
        <p className="signin-small">Already set up? Sign in normally.</p>
        <MicrosoftButton href="/api/auth/login" />
      </Frame>
    );
  }
  return (
    <Frame title="Accept invitation">
      <p className="signin-copy">
        {info.name ? `${info.name}, you` : "You"} have been invited to <b>{info.workspace ?? "Eradigm Competitive Intelligence"}</b>. Sign in with your Microsoft work or school account to activate your access. You only do this once; afterwards you sign in with the same Microsoft account.
      </p>
      <MicrosoftButton href={`/api/auth/login?invite=${encodeURIComponent(token)}&returnTo=%2Fdashboard`} label="Accept and sign in with Microsoft" />
      {info.expiresAt && <p className="signin-small">This link works once and expires on {new Date(info.expiresAt).toLocaleDateString()}.</p>}
    </Frame>
  );
}

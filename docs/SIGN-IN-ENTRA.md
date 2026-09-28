# Sign in with Microsoft (Entra ID): setup guide

People sign in to the platform with their organisation's Microsoft work or
school account. Accounts from **any organisation** are accepted: Eradigm staff
and client users alike. Each person still needs a platform account created by an
Eradigm admin or analyst, and they activate it once by opening an **invite link**.

Everything here is free. Registering an application in Microsoft Entra ID needs
no Azure subscription or billing, and nothing in Cloudflare needs a billing
account (no Cloudflare Access / Zero Trust).

> ### Where each value goes
> **Never paste Microsoft values into chat, email, tickets or any file in this repository.**
>
> | Value | What it is | Where you put it | Secret? |
> |---|---|---|---|
> | **Dashboard web address** | e.g. `https://eradigm-ci-web-production.<your-subdomain>.workers.dev` or `https://ci.eradigm.com` | ① Microsoft Entra (Redirect URI) and ② `APP_ORIGIN` in `apps/api/wrangler.jsonc` | No |
> | **Application (client) ID** | Identifies the app registration | Typed into a hidden terminal prompt: `wrangler secret put ENTRA_CLIENT_ID` | Treated as secret |
> | **Client secret *Value*** | The app's password with Microsoft | Hidden terminal prompt: `wrangler secret put ENTRA_CLIENT_SECRET` | **Yes** |
> | Directory (tenant) ID | Eradigm's Entra directory | **Not needed** for "any organisation" sign-in. Use it only for the optional allow-list in step 6. | Treated as secret |
>
> The terminal prompts store values encrypted in Cloudflare. They are not shown on screen, not saved in any file and not committed to git.

---

## Step 0: Find your dashboard web address

You need this before registering the app, because Microsoft only redirects to
addresses registered in advance.

- **Free Cloudflare address (default):** `https://eradigm-ci-web-<env>.<your-subdomain>.workers.dev`, where `<env>` is `production` or `staging`.
  - To find `<your-subdomain>`, go to the Cloudflare dashboard → **Workers & Pages** → **Overview**; it's shown on the right as "Subdomain".
  - The first `wrangler deploy` of the web worker also prints the full address.
- **Your own domain (optional):** e.g. `https://ci.eradigm.com`. Add it to Cloudflare (free plan), uncomment `routes` in `apps/web/wrangler.jsonc`, and use it everywhere below instead.

Write it down in this exact form: `https://`, then the host, with **no trailing slash**.
Below, it is written as `<WEB ADDRESS>`.

## Step 1: Register the application in Microsoft Entra ID

Someone who may register applications in Eradigm's Entra directory does this. That's
often any staff member; otherwise ask IT, or anyone with the *Application Developer* role.

1. Go to **https://entra.microsoft.com** and sign in with your Eradigm account.
2. Open **Identity → Applications → App registrations**, then click **+ New registration**.
3. Fill in:
   - **Name:** `Eradigm Competitive Intelligence`. Users see this on Microsoft's consent screen.
   - **Supported account types:** **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)"**.
     Do not choose the option that includes personal Microsoft accounts. The platform refuses them anyway.
   - **Redirect URI:** platform **Web**, value `<WEB ADDRESS>/api/auth/callback`
     (e.g. `https://eradigm-ci-web-production.acme.workers.dev/api/auth/callback`).
4. Click **Register**.
5. On the app's **Overview** page, note the **Application (client) ID**. You will type it in step 5.
   Do not send it anywhere.
6. Open **Authentication** (left menu):
   - Under **Web → Redirect URIs**, add the other environments you use:
     - `<STAGING WEB ADDRESS>/api/auth/callback`
     - `http://localhost:5173/api/auth/callback` (only if you will test real Microsoft sign-in on your own computer)
   - **Front-channel logout URL:** `<WEB ADDRESS>/api/auth/signed-out`
   - Leave **Access tokens** and **ID tokens** (implicit flow) **unticked**. The platform uses the more secure authorization-code flow.
   - Click **Save**.

## Step 2: Create the client secret

1. In the app registration, open **Certificates & secrets → Client secrets → + New client secret**.
2. **Description:** `production` (or `staging`). **Expires:** 24 months (the maximum).
3. Click **Add**, then **immediately copy the "Value" column**. It is shown only once.
   (The "Secret ID" column is not needed.)
4. Put a calendar reminder about 2 weeks before the expiry date. See [Renewing the secret](#renewing-the-client-secret).

Use a separate secret for staging and production, so one can be replaced without affecting the other.

## Step 3: Permissions (normally nothing to do)

The platform asks Microsoft only for `openid`, `profile` and `email`, the basic
"sign you in" permissions (plus Microsoft Graph `User.Read`, which the
registration adds by default). No admin-level permissions are requested.

- If Eradigm users see "Need admin approval" at sign-in, an Eradigm Entra admin opens
  **API permissions** and clicks **Grant admin consent for Eradigm**.
- For **client organisations**, see [Client users from other organisations](#client-users-from-other-organisations).

## Step 4: Put the web address in the build (the only file edit)

Open `apps/api/wrangler.jsonc` and find the line marked `▼▼ EDIT ME` in the
`production` block (and `staging`, if you use it):

```jsonc
"APP_ORIGIN": "REPLACE_WITH_PRODUCTION_WEB_ADDRESS",
```

Replace the placeholder with `<WEB ADDRESS>`, e.g.:

```jsonc
"APP_ORIGIN": "https://eradigm-ci-web-production.acme.workers.dev",
```

Save and commit this change. The web address is not secret. Deployments refuse to
run while the placeholder is still there.

## Step 5: Enter the Microsoft values as secrets

Run these from the repository folder on your own computer. Run `npx wrangler login` first if you haven't.
Each command asks **"Enter a secret value:"**. Paste the value and press Enter;
nothing is displayed.

```bash
# The Application (client) ID from step 1.5
npx wrangler secret put ENTRA_CLIENT_ID     --env production -c apps/api/wrangler.jsonc

# The client secret VALUE from step 2.3
npx wrangler secret put ENTRA_CLIENT_SECRET --env production -c apps/api/wrangler.jsonc
```

Repeat with `--env staging` for staging (with the staging client secret).
`SESSION_SECRET` was already generated by `scripts/provision.sh`. If you skipped
that script, create it with:
`openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET --env production -c apps/api/wrangler.jsonc`.

**Alternatively, without a terminal:** go to the Cloudflare dashboard → **Workers & Pages** →
`eradigm-ci-api-production` → **Settings → Variables and Secrets → + Add**. Set **Type: Secret**,
**Name** `ENTRA_CLIENT_ID` (then `ENTRA_CLIENT_SECRET`), paste the value, then click **Deploy**.

To check what is set without revealing values:
`npx wrangler secret list --env production -c apps/api/wrangler.jsonc` shows names only.

## Step 6 (optional): Only allow specific organisations

By default any organisation's work account can *attempt* to sign in, but only
people who accepted an invite link get in. To also block every other
organisation at the door, enter the allowed **Directory (tenant) IDs**, comma-separated.
Eradigm's is on the Entra **Overview** page; a client's comes from their IT.

```bash
npx wrangler secret put ENTRA_ALLOWED_TENANTS --env production -c apps/api/wrangler.jsonc
# e.g. value: 1a2b...-eradigm-tenant-id, 9f8e...-client-tenant-id
```

Leave it unset to allow any organisation, as you chose. If it is set but contains
no valid tenant ID (a typo), nobody can sign in. The platform fails closed rather
than silently allowing everyone. To remove it, run
`npx wrangler secret delete ENTRA_ALLOWED_TENANTS --env production -c apps/api/wrangler.jsonc`.

## Step 7: Deploy and invite the first admin

1. Deploy (capture → API → web) as in [DEPLOYMENT.md](DEPLOYMENT.md). Before deploying, the deploy
   workflow checks that `APP_ORIGIN`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` and `SESSION_SECRET` are set.
2. Create the workspace and its first admin. `--origin` is your `<WEB ADDRESS>`:
   ```bash
   npx tsx scripts/create-tenant.ts --name "Eradigm" --slug eradigm \
     --admin jane.doe@eradigm.com --admin-name "Jane Doe" \
     --origin <WEB ADDRESS> > /tmp/tenant.sql
   npx wrangler d1 execute DB --remote --env production -c apps/api/wrangler.jsonc --file /tmp/tenant.sql
   ```
   The terminal prints the **first admin's invite link**. Send it privately to that person.
3. They open the link, click **Accept and sign in with Microsoft**, and sign in with their
   Eradigm Microsoft account. That links the account; afterwards they sign in with the usual
   **Sign in with Microsoft** button.
4. In the app, go to **Administration → Deployment status**. It should show
   "✓ Sign in with Microsoft configured (any organisation)".

## Inviting everyone else

In **Administration → Users and roles → + Add user**, enter the email, name and role. The
platform shows a **one-time invite link** (valid 7 days); copy it and send it by email or
Teams. The Microsoft sign-in column then shows *Invite pending*, then *✓ Linked* once used.

- **Lost or expired link:** click **New invite link**. The old link stops working.
- **Someone's Microsoft account changed** (e.g. new employer email or a moved tenant): click **New sign-in link**.
  When they use it, the new Microsoft account replaces the old one and the old one's sessions end.
- **Remove access:** **Deactivate**. Their sessions end immediately and they can no longer sign in.

Why invite links instead of matching on email: with "any organisation" sign-in,
the email in a Microsoft token is set by each organisation's own admins, so it
cannot prove who someone is. The platform links an account to the permanent
Microsoft identity (organisation ID + user object ID) of whoever opened the link.
Someone else with the same email address at a different organisation can't take the account over.

## Client users from other organisations

A client signs in with their own company's Microsoft account. The first time, Microsoft
may show one of two screens:

- **"Permissions requested … Accept"**: the user accepts, and that's it.
- **"Need admin approval"**: their organisation only allows apps approved by its IT. Send the
  client's IT admin this link, which asks them to approve the app for their organisation once:
  `https://login.microsoftonline.com/organizations/adminconsent?client_id=<Application (client) ID>`.
  You will need to fill in the ID yourself when sending it.

Many organisations only let users approve apps from a **verified publisher**. To avoid admin
approval requests, Eradigm can verify itself as the publisher: in the app registration,
**Branding & properties → Publisher verification**. This is free but requires a Microsoft AI Cloud
Partner Program ID. It's optional.

## Sessions and security settings

- Session cookie: `__Host-eci_session`, HttpOnly, Secure, SameSite=Lax. Only a SHA-256 hash is stored in D1.
- Sessions end after 8 hours without activity (`SESSION_IDLE_MINUTES`, default 480) and 24 hours after
  sign-in (`SESSION_MAX_HOURS`, default 24). Both are set in `apps/api/wrangler.jsonc`.
- Sign-in endpoints are limited to 20 attempts per minute per IP address. Password guessing and lockouts
  are handled by Microsoft for each organisation. MFA and Conditional Access policies of each user's
  organisation apply automatically.
- State-changing requests need the `X-ECI-Request` header, sent by the dashboard. This blocks cross-site request forgery.
- Audited: sign-ins, failed sign-ins (reason only), sign-outs, invite links created, Microsoft accounts linked, sessions ended.

## Renewing the client secret

Before the secret expires (Entra → the app → **Certificates & secrets** shows the date):

1. Create a new client secret (step 2) and copy its Value.
2. Run `npx wrangler secret put ENTRA_CLIENT_SECRET --env production -c apps/api/wrangler.jsonc` and paste it.
   This takes effect immediately and signed-in users are not affected.
3. Delete the old secret in Entra.

If it expires first, new sign-ins fail with "Sign-in is not configured correctly (the Microsoft
client ID or secret is wrong or has expired)" until you do steps 1–2.

## Troubleshooting

| What the user sees | Cause | Fix |
|---|---|---|
| Microsoft error **AADSTS50011** "redirect URI … does not match" | The address registered in step 1 differs from `APP_ORIGIN` | Make both exactly `<WEB ADDRESS>/api/auth/callback`: same https, host, no trailing slash |
| Microsoft error **AADSTS700016** "application … not found" | Wrong `ENTRA_CLIENT_ID` | Re-enter it (step 5) |
| "Sign-in is not configured correctly…" | Wrong or expired client secret | Renew it ([above](#renewing-the-client-secret)) |
| "Microsoft sign-in is not configured for this environment (missing: …)" | A value from steps 4–5 is missing | Set the value named in the message |
| "Your Microsoft account is not linked…" | The person never used their invite link, or used a different Microsoft account | Send a **New invite link** |
| "Personal Microsoft accounts … cannot be used" | Signed in with Outlook.com, Hotmail or Live | Use a work or school account |
| "Need admin approval" (Microsoft screen) | Their organisation restricts app consent | See [Client users from other organisations](#client-users-from-other-organisations) |
| "Your organisation is not allowed to sign in" | `ENTRA_ALLOWED_TENANTS` is set and doesn't include them | Add their Directory (tenant) ID, or clear the setting |

## Local development

`npm run dev` uses a development sign-in (pick a demo user in the sidebar); it needs no
Microsoft setup. To test real Microsoft sign-in locally:
1. Register `http://localhost:5173/api/auth/callback` as a redirect URI (step 1.6).
2. Put these in `apps/api/.dev.vars` (git-ignored, never commit it):
   `AUTH_MODE=entra`, `ENTRA_CLIENT_ID=…`, `ENTRA_CLIENT_SECRET=…`, `SESSION_SECRET=<32+ random characters>`.

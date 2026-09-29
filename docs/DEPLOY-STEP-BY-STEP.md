# Deploying the platform: a step-by-step guide for beginners

This guide takes you from nothing to a live, working platform with your
first user signed in. It assumes no experience with Cloudflare, the command line
or Microsoft Entra. Allow **about 1½–2 hours** the first time.

Everything is free. At no point do you need to enter card details or set up a
billing account. If a screen ever asks for payment details, stop: you have taken a
wrong turn (see the troubleshooting table at the end).

**How to read this guide**
- Lines in grey boxes starting with `npx`, `git`, `bash` etc. are **commands**. You copy them
  into the terminal (explained in Part B) and press **Enter**.
- Text written like `<THIS>` is a placeholder. Replace it, including the `<` and `>`, with your own value.
- ✅ marks what you should see if a step worked.
- Do the parts **in order**. Each one depends on the one before.

---

## Contents

- Part A: What you need before starting
- Part B: Install the tools on your computer
- Part C: Put the latest code on your computer
- Part D: Create your free Cloudflare account
- Part E: Create the database, queues and keys (one command)
- Part F: Tell the build your web address
- Part G: Register the app with Microsoft
- Part H: Give the Microsoft values to Cloudflare (secrets)
- Part I: Deploy the three parts
- Part J: Create your workspace and sign in for the first time
- Part K: Check everything and try it out
- Part L: Save your changes to GitHub
- Part M (optional): Automatic deploys from GitHub
- Part N: Everyday tasks later
- Troubleshooting

---

## Part A: What you need before starting

1. **A computer** running Windows 10/11 or macOS, where you're allowed to install programs.
2. **Your GitHub account**, with access to the repository `liamg-eradigm/CI2_dashboard`.
3. **Your Eradigm Microsoft work account.** It must be allowed to create "App registrations" in
   Microsoft Entra. Many staff accounts can; if not, ask IT to do Part G with you. It takes about 10 minutes.
4. **An email address** for the new Cloudflare account. A shared team address such as
   `it@eradigm.com` is better than a personal one, so the account doesn't depend on one person.
5. **A password manager** (1Password, Bitwarden, Keeper or similar) to save two keys in Part E.

---

## Part B: Install the tools on your computer

You install three programs. You only do this once.

### B1. Node.js (runs the deployment tools)
1. Go to **https://nodejs.org**.
2. Download the **LTS** version (it will say "LTS", version 22 or newer) and run the installer.
   Accept all the default options by clicking **Next** / **Continue** until it finishes.

### B2. Git (downloads the code and, on Windows, gives you a terminal)
- **Windows:** go to **https://git-scm.com/download/win**, download "64-bit Git for Windows Setup",
  run it and accept all defaults. This also installs **Git Bash**, the terminal you will use.
- **Mac:** Git comes with Apple's developer tools. You'll be offered to install them the first time
  you type `git` in Terminal (step B4). Click **Install** when asked.

### B3. GitHub Desktop (easiest way to download and save the code)
Go to **https://desktop.github.com**, install it, open it, and sign in with your GitHub account.

### B4. Open a terminal and check the tools
A **terminal** is a window where you type commands.
- **Windows:** press the Windows key, type **Git Bash**, open it. **Use Git Bash (not "Command
  Prompt" or "PowerShell") for every command in this guide.**
- **Mac:** press **Cmd + Space**, type **Terminal**, press Enter.

Type each of these and press Enter:

```bash
node -v
git --version
```

✅ `node -v` shows `v22.` followed by numbers, or higher. `git --version` shows a version number.

> **Copying and pasting in the terminal**
> - **Git Bash (Windows):** paste with **Shift + Insert**, or **right-click → Paste**. Ctrl+V may not work. Copy by selecting text (it copies automatically).
> - **Mac Terminal:** Cmd+C / Cmd+V as usual.

---

## Part C: Put the latest code on your computer

### C1. Merge the latest work into `main` (on the GitHub website)
The newest changes (Microsoft sign-in and the free-plan setup) are on the branch
`claude/youthful-hopper-090h71`. Put them into `main` first:

1. Open **https://github.com/liamg-eradigm/CI2_dashboard**.
2. If you see a yellow banner "claude/youthful-hopper-090h71 had recent pushes", click **Compare & pull request**.
   Otherwise, click **Pull requests → New pull request**, choose **base: main** and **compare:
   claude/youthful-hopper-090h71**, and click **Create pull request**.
3. Click **Create pull request** again, wait for the checks to finish (green ✓), then click **Merge pull request →
   Confirm merge**.

✅ The pull request shows "Merged" in purple.

### C2. Download (clone) the repository with GitHub Desktop
1. In GitHub Desktop: **File → Clone repository…** → tab **GitHub.com** → select
   `liamg-eradigm/CI2_dashboard`.
2. **Local path:** pick an easy folder, e.g. `Documents\GitHub` (Windows) or `Documents/GitHub` (Mac).
3. Click **Clone**.
4. At the top, make sure **Current branch** says **main**. If it doesn't, click it and choose **main**, then click **Fetch origin / Pull origin**.

### C3. Open the terminal *in that folder*
- **Windows:** open File Explorer → go to `Documents\GitHub\CI2_dashboard` → right-click an empty
  area → **Open Git Bash here** (on Windows 11: **Show more options → Open Git Bash here**).
- **Mac:** in Terminal type `cd ~/Documents/GitHub/CI2_dashboard` and press Enter.

Check you're in the right place:

```bash
ls
```

✅ You see names including `apps`, `docs`, `packages`, `scripts`, `package.json`.

> **Every command from now on is run in this folder.** If you close the terminal, reopen it the same way.

### C4. Install the project's building blocks
```bash
npx npm@11 ci
```
This downloads the libraries the project uses. It takes **2–5 minutes** and prints a lot of text.
If it asks "Need to install the following packages: npm@11 … Ok to proceed?", type `y` and press Enter.

✅ It ends with a line like `added 700 packages` and no `ERR!` lines.

---

## Part D: Create your free Cloudflare account

### D1. Sign up
1. Go to **https://dash.cloudflare.com/sign-up**.
2. Enter the email from Part A and a strong password (save it in your password manager). Click **Sign up**.
3. Open the verification email from Cloudflare and click the link.
4. If Cloudflare asks what you want to do first (add a website, etc.), skip or close it.
   **You do not need to add a domain, choose a paid plan or enter payment details.**

### D2. Choose your free `workers.dev` address
Your platform will live at a free address ending in **`.workers.dev`**.
1. In the Cloudflare dashboard's left menu, click **Workers & Pages**. It may be under
   **Compute** or **Compute & AI**.
2. If you're asked to **set up your subdomain**, type a short name, e.g. `eradigm-ci`, and confirm.
   If you're not asked, look on the right-hand side of the Workers & Pages overview for **Subdomain**.
3. Write down the full subdomain, e.g. `eradigm-ci.workers.dev`.

Your platform's web address will be:

```
https://eradigm-ci-web-production.<YOUR-SUBDOMAIN>.workers.dev
```

For example, `https://eradigm-ci-web-production.eradigm-ci.workers.dev`. **Write this down; it's
your `<WEB ADDRESS>` for the rest of the guide.** It starts with `https://` and has **no `/` at the end**.

> The first part is always **`eradigm-ci-web-production`**, the name of the dashboard Worker this
> project deploys. Don't use the name of any other Worker you may see in the Cloudflare dashboard.
> Only the part between the two dots is yours (your subdomain).

### D3. Switch on Analytics Engine (free, one click)
The platform records usage metrics with Cloudflare's free **Analytics Engine**, which must be
switched on once per account; otherwise the API deploy (Part I3) stops with
"You need to enable Analytics Engine [code: 10089]".
1. In the Cloudflare dashboard's left menu: **Workers & Pages → Analytics Engine**
   (or open the link printed in that error message).
2. Click **Enable Analytics Engine** / **Set up**. It's free; no payment details are needed.

### D4. Connect the deployment tool to your Cloudflare account
In the terminal:

```bash
npx wrangler login
```

A browser window opens and asks you to allow "Wrangler" to access your Cloudflare account.
Click **Allow**, then return to the terminal.

```bash
npx wrangler whoami
```

✅ It shows your email address and an **Account ID**. Keep this window open.

---

## Part E: Create the database, queues and keys (one command)

This creates the free database that stores everything, the background job queues, and three
secret keys:

```bash
bash scripts/provision.sh production
```

It takes about a minute and shows its progress: `▸ D1 database…`, `▸ Queues…`, `▸ Secrets…`.
If it asks a yes/no question, type `y` and press Enter.

**Important:** at the end it prints a box:

```
  ┌─ SAVE THESE NOW in your password manager (shown only once) ──────────────
    SNAPSHOT_ENCRYPTION_KEY = ...
    AUDIT_HMAC_KEY = ...
  └─ ...
```

**Copy both lines into your password manager now**, e.g. as a secure note titled "Eradigm CI –
production keys". They are shown only this once. You would need them only to rebuild
the system from a backup, but without them encrypted saved pages could not be read.

✅ The output includes `database_id = <some long id> (written to apps/api/wrangler.jsonc)` and
the three lines `SNAPSHOT_ENCRYPTION_KEY set`, `AUDIT_HMAC_KEY set`, `SESSION_SECRET set`.

> You can safely run this command again (for example if your internet dropped). It never replaces keys that already exist.

---

## Part F: Tell the build your web address

You edit **one line** in one file.

1. In GitHub Desktop: **Repository → Open in Visual Studio Code** (install it if offered; it's free).
   Alternatively, open the file in any plain text editor (Notepad on Windows, TextEdit on Mac in plain-text mode).
2. Open the file **`apps/api/wrangler.jsonc`**.
3. Search for **`REPLACE_WITH_PRODUCTION_WEB_ADDRESS`** (Ctrl+F on Windows, Cmd+F on Mac). Just above it
   are comment lines marked **`▼▼ EDIT ME`**.
4. Replace the placeholder inside the quotes with your `<WEB ADDRESS>`. Before:
   ```jsonc
   "APP_ORIGIN": "REPLACE_WITH_PRODUCTION_WEB_ADDRESS",
   ```
   After (with your own address):
   ```jsonc
   "APP_ORIGIN": "https://eradigm-ci-web-production.eradigm-ci.workers.dev",
   ```
   Keep the quotes and the comma at the end. There is no `/` after `.dev`.
5. **Save** the file (Ctrl+S or Cmd+S).
6. **Leave the `staging` entries (`REPLACE_WITH_STAGING_…`) as they are.** You're only setting up production.

✅ Searching the file for `REPLACE_WITH_PRODUCTION` finds nothing, and your line reads exactly
`"APP_ORIGIN": "https://eradigm-ci-web-production.<YOUR-SUBDOMAIN>.workers.dev",`. If `https://` is missing,
sign-in will report "missing: APP_ORIGIN". The database ID was filled in automatically in Part E.

---

## Part G: Register the app with Microsoft

This tells Microsoft that your platform may use "Sign in with Microsoft".

### G1. Create the app registration
1. Go to **https://entra.microsoft.com** and sign in with your Eradigm work account.
2. In the left menu: **Identity → Applications → App registrations**. You may need to click **Identity** first to expand it.
3. Click **+ New registration**.
4. Fill in the form:
   - **Name:** `Eradigm Competitive Intelligence`. Users see this name when they sign in.
   - **Supported account types:** choose **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)"**.
     *Not* the option that also mentions "personal Microsoft accounts".
   - **Redirect URI:** in the first drop-down choose **Web**. In the box type your `<WEB ADDRESS>` followed by
     `/api/auth/callback`, e.g.
     `https://eradigm-ci-web-production.eradigm-ci.workers.dev/api/auth/callback`
5. Click **Register**.

✅ You land on the app's **Overview** page.

### G2. Note the Application (client) ID
On the **Overview** page, find **Application (client) ID**, a long code like
`1a2b3c4d-....`. You'll paste it in Part H. **Do not email it, message it or paste it into any
file or chat.** Leave this browser tab open.

(You'll also see "Directory (tenant) ID". You don't need it.)

### G3. Sign-out setting
1. In the app's left menu, click **Authentication**.
2. Find **Front-channel logout URL** and enter `<WEB ADDRESS>/api/auth/signed-out`,
   e.g. `https://eradigm-ci-web-production.eradigm-ci.workers.dev/api/auth/signed-out`.
3. Make sure the boxes **Access tokens** and **ID tokens** (under "Implicit grant and hybrid flows")
   are **not** ticked.
4. Click **Save** at the bottom.

### G4. Create the client secret (the app's password)
1. In the left menu: **Certificates & secrets** → tab **Client secrets** → **+ New client secret**.
2. **Description:** `production`. **Expires:** choose **24 months** (the longest option).
3. Click **Add**.
4. A new row appears. **Right away, click the copy icon next to the value in the "Value"
   column** (not "Secret ID"). The value is shown only now; if you leave the page it's hidden forever.
5. Keep it on your clipboard, or put it in your password manager for a few minutes, and go straight to Part H.
6. Put a reminder in your calendar for **23 months from today**: "Renew Eradigm CI Microsoft client secret"
   (how: Part N).

> Lost the value before using it? Delete that secret row and create a new one; that's fine.

---

## Part H: Give the Microsoft values to Cloudflare (secrets)

Back in the terminal (still in the project folder). Each command asks **"Enter a secret value:"**.
When you paste, **nothing appears on screen**. That's intentional; just press **Enter** after pasting.

### H1. The Application (client) ID
Copy the **Application (client) ID** from the Entra Overview page (G2), then run:

```bash
npx wrangler secret put ENTRA_CLIENT_ID --env production -c apps/api/wrangler.jsonc
```

Paste the ID (Git Bash: **Shift + Insert**) and press **Enter**.

✅ `✨ Success! Uploaded secret ENTRA_CLIENT_ID`

### H2. The client secret value
Copy the client secret **Value** (G4), then run:

```bash
npx wrangler secret put ENTRA_CLIENT_SECRET --env production -c apps/api/wrangler.jsonc
```

Paste and press **Enter**.

✅ `✨ Success! Uploaded secret ENTRA_CLIENT_SECRET`

If you saved the client secret in your password manager temporarily, you can delete it now. It's stored safely in Cloudflare
(and you can always create a new one in Entra).

### H3. Check that all secrets are in place
```bash
npx wrangler secret list --env production -c apps/api/wrangler.jsonc
```
✅ The list shows the names **AUDIT_HMAC_KEY, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, SESSION_SECRET,
SNAPSHOT_ENCRYPTION_KEY**. Only names are shown, never values.

---

## Part I: Deploy the three parts

The platform has three parts, deployed in this order:
1. **capture**: fetches web pages safely
2. **api**: the logic and the database
3. **web**: the dashboard you see in the browser

Run each command, wait for it to finish, and check the ✅ before moving on.

### I1. Capture part
```bash
npx wrangler deploy -c apps/capture/wrangler.jsonc --env production
```
If any deploy asks **"Would you like to register a workers.dev subdomain now?"**, answer `y` and enter
the same subdomain name you chose in D2.

✅ Ends with `Deployed eradigm-ci-capture-production`.

### I2. Set up the database tables
```bash
npx wrangler d1 migrations apply DB --remote -c apps/api/wrangler.jsonc --env production
```
It lists the migrations not yet applied (6 on a new database) and asks **"Ok to proceed?"**. Type `y` and press Enter.

✅ Each migration shows ✅. It ends with "Migrations applied" or similar.

### I3. API part
```bash
npx wrangler deploy -c apps/api/wrangler.jsonc --env production
```
✅ Ends with `Deployed eradigm-ci-api-production` and lists its connections (D1 database, queues, the
capture service and a schedule).

### I4. Web part (dashboard)
First build it (about 30 seconds), then deploy it:

```bash
npm run build -w apps/web
npx wrangler deploy -c apps/web/wrangler.jsonc --env production
```
✅ The deploy ends with `Deployed eradigm-ci-web-production` and prints a web address,
**exactly your `<WEB ADDRESS>`** from D2. If it's different, see Troubleshooting ("addresses don't match").

### I5. Quick health check
Open a browser at `<WEB ADDRESS>/api/health`, e.g.
`https://eradigm-ci-web-production.eradigm-ci.workers.dev/api/health`.

✅ You see text starting with `{"ok":true`.

Then open `<WEB ADDRESS>` itself. ✅ You see the Eradigm **Sign in** page with a
**Sign in with Microsoft** button. Don't sign in yet: first create your account in Part J.

---

## Part J: Create your workspace and sign in for the first time

### J1. What is a "workspace"?
A workspace holds one tracker: its entries, columns, users and history. Typically there's one
workspace per client (e.g. "Acme Pharma"). Eradigm staff are admins or analysts in each workspace;
a client's users are "client" users in their own workspace only, and never see other workspaces.

### J2. Create the first workspace with you as admin
Adapt this command:
- `--name`: the workspace name people will see, e.g. `"Acme Pharma"`
- `--slug`: a short lowercase code with no spaces, e.g. `acme`
- `--admin`: your Eradigm work email; `--admin-name`: your name
- `--origin`: your `<WEB ADDRESS>`

```bash
npx tsx scripts/create-tenant.ts --name "Acme Pharma" --slug acme --admin jane.doe@eradigm.com --admin-name "Jane Doe" --origin <WEB ADDRESS> > tenant.sql
```

The terminal prints:

```
First admin invite link for jane.doe@eradigm.com (works once, expires ...):

  https://eradigm-ci-web-production.eradigm-ci.workers.dev/invite/Xy12...
```

**Copy that link** (select it) and keep it for J4.

### J3. Load the workspace into the database
```bash
npx wrangler d1 execute DB --remote -c apps/api/wrangler.jsonc --env production --file tenant.sql
```
If asked to confirm, type `y`. ✅ It reports the commands were executed successfully.

Then delete the temporary file:

```bash
rm tenant.sql
```

### J4. Accept your invite and sign in
1. Paste the invite link from J2 into your browser.
2. You see **Accept invitation**: "Jane Doe, you have been invited to Acme Pharma…".
3. Click **Accept and sign in with Microsoft** and sign in with your Eradigm work account.
4. Microsoft may show **"Permissions requested"** for "Eradigm Competitive Intelligence". Click **Accept**.
   - If instead it says **"Need admin approval"**, your IT department must approve the app once: they
     open **Entra → App registrations → Eradigm Competitive Intelligence → API permissions → Grant admin
     consent for Eradigm**. Then try the invite link again. It still works, because it wasn't used.

✅ You arrive on the **Dashboard**, with your name and "Admin · Acme Pharma" at the bottom of
the left menu. From now on you sign in at `<WEB ADDRESS>` with **Sign in with Microsoft**; the invite
link was needed only once.

To add more workspaces (e.g. another client), repeat J2–J3 with a different `--name` and `--slug`.
You can keep the same `--admin`. You'll get a new invite link; opening it while signed in with the same Microsoft
account simply adds you to that workspace.

---

## Part K: Check everything and try it out

### K1. Deployment status
Click **Administration** in the left menu. The first card, **Deployment status**, should show ✓ for:
- Sign in with Microsoft configured (any organisation)
- Manual entry: drafts arrive with every field empty; no external AI service…
- Isolated capture worker bound
- Background work queue bound
- Snapshots stored in D1 (Workers Free plan)
- Application-level snapshot encryption key set
- Audit HMAC key set

"⚠ Operational alert webhook configured" is **optional** and fine to leave. It's for sending alerts to a Teams or Slack channel.

### K2. Try the full flow
1. Click **Input**, paste the address of a public news article, and click **Capture source**.
   ✅ The steps tick through to "Routed to Needs review".
2. Click **Inbox**. Your article is there, marked **Awaiting analyst entry**. Click **View saved page** to read it.
3. Fill in every field in the row below (Date, Competitor, Macrotrend, Subtrend…), then click **✓ Approve**.
4. Click **Dashboard** and **Tracker**. ✅ Your entry appears.
5. Optional: in **Administration → Audit record** (bottom of the page), click **Verify integrity**. ✅ "Chain intact".

### K3. Invite colleagues and clients
**Administration → Users and roles**: enter email, name and role → **+ Add user**. An **invite
link** appears. Click **Copy link** and send it to the person (email or Teams). It works once, for 7 days.
- **Analysts** can add analyst and client users; **admins** can add anyone.
- Client users sign in with **their own company's** Microsoft work account.
  If they see "Need admin approval", send their IT department this link, with your Application (client) ID filled in:
  `https://login.microsoftonline.com/organizations/adminconsent?client_id=<Application (client) ID>`
- Lost link, or someone changed Microsoft account? Click **New invite link** / **New sign-in link** next to their name.

---

## Part L: Save your changes to GitHub

You changed `apps/api/wrangler.jsonc` (the database ID and your web address). Save that to GitHub
so future deploys use the same settings. It contains **no secrets**.

1. Open GitHub Desktop. On the left it lists **1 changed file: apps/api/wrangler.jsonc**.
2. Make sure `tenant.sql` is **not** listed. You deleted it in J3; if it's there, right-click → **Discard changes**.
3. In **Summary** (bottom left) type: `Configure production (database and web address)`.
4. Click **Commit to main**, then **Push origin** (top bar).

✅ GitHub Desktop says "No local changes".

---

## Part M (optional): Automatic deploys from GitHub

Deploying from your computer (Part I) is enough. If you'd like to deploy with a button on GitHub
instead:

1. **Create a Cloudflare API token:** Cloudflare dashboard → click your profile icon (top right) → **My Profile → API Tokens →
   Create Token** → use the template **"Edit Cloudflare Workers"**. Then **+ Add more**, and add these
   permissions: **Account · D1 · Edit** and **Account · Queues · Edit**. Click **Continue to summary → Create Token**, then copy the token.
2. **Find your Account ID:** run `npx wrangler whoami` in the terminal, or look on the Workers & Pages overview page.
3. **Add both to GitHub:** on the repository page → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name `CLOUDFLARE_API_TOKEN`, value: the token.
   - Name `CLOUDFLARE_ACCOUNT_ID`, value: the Account ID.
4. **Deploy:** repository → **Actions → Deploy → Run workflow**, choose **production**, then **Run workflow**. It runs the tests,
   then deploys capture → database updates → API → web in the correct order.
5. **Optional nightly backups:** add one more repository secret, `BACKUP_PASSPHRASE`, set to a long random passphrase
   (save it in your password manager). The **Backup** workflow then saves an encrypted copy of the database every night
   (downloadable from **Actions** for 30 days).

Until you add these secrets, the Deploy and Backup workflows show "Skipping…" notices instead of failing.

---

## Part N: Everyday tasks later

| Task | What to do |
|---|---|
| **Deploy a newer version** after code changes are merged | GitHub Desktop → **Fetch origin → Pull origin** on `main`, then repeat **Part I** (I1–I4), or use **Run workflow** (Part M) |
| **Add or remove users** | Administration → Users and roles (Part K3); **Deactivate** removes access immediately |
| **Renew the Microsoft client secret** (before 24 months) | Entra → the app → Certificates & secrets → **+ New client secret** → copy the Value → `npx wrangler secret put ENTRA_CLIENT_SECRET --env production -c apps/api/wrangler.jsonc` → paste → then delete the old secret in Entra |
| **Roll back a bad deploy** | `npx wrangler deployments list -c apps/api/wrangler.jsonc --env production`, then `npx wrangler rollback <version-id> -c apps/api/wrangler.jsonc --env production` (same for `apps/web`) |
| **Locked out (no admin can sign in)** | `npx tsx scripts/create-invite.ts --tenant acme --email you@eradigm.com --name "You" --role admin --origin <WEB ADDRESS> --out invite.sql`, then `npx wrangler d1 execute DB --remote -c apps/api/wrangler.jsonc --env production --file invite.sql`, then `rm invite.sql`, and open the printed link (it only works once the second command has succeeded) |
| **Use your own domain** (e.g. `ci.eradigm.com`) | Add the domain to Cloudflare, uncomment `routes` in `apps/web/wrangler.jsonc`, change `APP_ORIGIN`, add the new `/api/auth/callback` Redirect URI in Entra, then redeploy (API and web) |

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `command not found: node` / `npx` | Node.js isn't installed, or the terminal was opened before installing | Install Node.js (B1), then close and reopen the terminal |
| `bash: scripts/provision.sh: No such file or directory` | The terminal isn't in the project folder | Redo C3 (`ls` must show `apps`, `docs`…) |
| Windows: commands behave strangely or `bash` isn't recognised | You're in Command Prompt or PowerShell | Use **Git Bash** (B4) |
| `openssl` is not recognised, or `wrangler secret list` shows nothing after provisioning | You ran the steps in PowerShell, so `scripts/provision.sh` never set the secrets | Generate each value with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` (use `32` instead of `48` for `SNAPSHOT_ENCRYPTION_KEY` and `AUDIT_HMAC_KEY`, and save those two in a password manager), then set it with `npx wrangler secret put <NAME> --env production -c apps/api/wrangler.jsonc`. Do this for `SESSION_SECRET`, `SNAPSHOT_ENCRYPTION_KEY` and `AUDIT_HMAC_KEY`, plus `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` if they are missing |
| Sign-in says *missing: SESSION_SECRET, APP_ORIGIN* | Those were not set (see the row above), or `APP_ORIGIN` is not the full web address | Set the secrets, set `APP_ORIGIN` to `https://eradigm-ci-web-production.<your-subdomain>.workers.dev` (F), redeploy the API, then reopen the same invite link |
| WSL (Ubuntu) on Windows: `Unable to read SQL text file "/home/…"` and wrangler's log path starts with `C:\` | WSL is running the **Windows** copy of Node, which cannot see Linux paths like `~/…` | Keep the file in the project folder and use a relative path (`--file invite.sql`), or use Git Bash |
| Pasting doesn't work in the terminal | Git Bash doesn't use Ctrl+V | **Shift + Insert** or right-click → Paste |
| Cloudflare asks for a card or a paid plan | You clicked into a paid product (e.g. R2, Zero Trust, a domain purchase) | Go back; nothing in this guide needs one |
| `Authentication error` / `not logged in` from wrangler | Wrangler's login expired | `npx wrangler login` again |
| Deploy says the queue or database doesn't exist | Part E didn't finish | Run `bash scripts/provision.sh production` again (safe) |
| Deploy error **"You need to enable Analytics Engine" [code: 10089]** | Analytics Engine hasn't been switched on for the account yet | Do D3 (free, one click), then run the same deploy command again |
| The web address printed in I4 differs from `APP_ORIGIN` | A different subdomain was used | Put the printed address in `APP_ORIGIN` (Part F) **and** in Entra's Redirect URI and logout URL (G1, G3), then redeploy the API (I3) |
| Microsoft error **AADSTS50011** (redirect URI mismatch) | Entra's Redirect URI doesn't exactly match `<WEB ADDRESS>/api/auth/callback` | Fix the Redirect URI in Entra → Authentication (same `https://`, no extra `/`) |
| Microsoft error **AADSTS700016** (application not found) | Wrong Application (client) ID | Redo H1 with the correct ID |
| "Sign-in is not configured correctly…" | Client secret wrong or expired | Create a new client secret (G4) and redo H2 |
| "Microsoft sign-in is not configured… (missing: APP_ORIGIN / ENTRA_…)" | A value from Part F or H is missing | Set the value named in the message, then redeploy the API (I3) if it was APP_ORIGIN |
| "Your Microsoft account is not linked…" | The person never used an invite link, or used a different Microsoft account | Send them a **New invite link** (K3) |
| "Need admin approval" (Microsoft screen) | That organisation's IT must approve new apps | Eradigm users: J4. Client users: send the adminconsent link in K3 to their IT |
| A page fails with **PROCESSING_LIMIT** | That web page is too large for the free plan's processing limit | Save the page with the SingleFile browser extension (without images) and upload the HTML on the Input page |

More detail: [SIGN-IN-ENTRA.md](SIGN-IN-ENTRA.md) (Microsoft sign-in),
[DEPLOYMENT.md](DEPLOYMENT.md) (free-plan limits, staging), and
[OPERATIONS.md](OPERATIONS.md) (monitoring, backups, rollback).

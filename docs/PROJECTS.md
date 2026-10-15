# Projects

The platform holds several **projects**, each a workspace of its own with its
own people, roles, data and pages. One account per person; who opens which
project, with which role, is set on the Admin page (**Projects and access**).

| Project | Kind | Address | Code |
|---|---|---|---|
| CI SQUARED | `ci2` | the site's root (`/dashboard`, `/database`, …) | `apps/api/src/projects/ci-squared`, `apps/web/src/projects/ci-squared` |
| Epilepsy | `epilepsy` | `/p/epilepsy/…` | `apps/api/src/projects/epilepsy`, `apps/web/src/projects/epilepsy` |

A person's first project (CI SQUARED, for anyone who has it) is at the root;
any other is under `/p/<slug>`. Someone whose only project is Epilepsy has it
at the root (a `/p/epilepsy/…` link opens the same page there).

## The layers

- **Platform**: sign-in (`auth/`), people and access (`services/users.ts`,
  `services/access.ts`), audit, incidents, the API's middleware (`app.ts`),
  the web app's shell (`App.tsx`, `components/Sidebar.tsx`), the Admin page
  (`pages/AdminPage.tsx`) and the shared styles (`styles/app.css`).
- **Projects**: everything else, each in its own folder. The platform knows
  a project only through its entry in the registry:
  - API: `apps/api/src/projects/registry.ts` lists each `ProjectModule`
    (`projects/types.ts`): its routes (and the `/api` paths they are under),
    cache rules, crons, queue and configuration checks.
  - Web: `apps/web/src/projects/registry.ts` lists each `WebProject`
    (`projects/types.ts`): its pages, menu, Admin settings and page titles.
- A project never imports another project. A change asked for one project
  touches only its folder (plus, when it needs one, the platform: a shared
  contract in `packages/shared`, a migration).

## Access

- `tenants.kind` says which project a workspace is (`test`: a CI SQUARED Test
  tab space, never listed).
- A person's access is their role in that workspace (`role_assignments`):
  admin, analyst or client, or none ("No access": the project is not listed
  for them and its addresses send them back to their first project).
- Admins of a project change anyone's access to it, rename it, add people,
  issue sign-in links and end sessions. Analysts add analysts and clients.
  Nobody changes their own access.
- Each request names its project (`x-project: <slug>`); the API answers a
  project's routes only for its own workspaces.

## Adding a project

1. A migration that makes its workspace (`INSERT INTO tenants (id, name,
   slug, created_at, kind)`), with a new kind, and gives it its first admin.
2. `apps/api/src/projects/<name>/`: its routes under `/api/<name>/` and a
   `ProjectModule` (`prefixes: ["/api/<name>/"]`), listed in the registry.
3. `apps/web/src/projects/<name>/`: its pages, menu and Admin settings as a
   `WebProject`, listed in the registry.
4. Admin → Projects and access: give people access.

## Epilepsy: the SharePoint workbook

The pages are built from four sheets of “Epilepsy Dashboard Excel.xlsx”:
“1. Platform Secondary”, “2. Platform Primary”, “3. Platform Competitor
Profiles” and “4. Platform Trials & Assets” (matched loosely: “3, Platform …”
is fine; each must start “Platform” after its number). Columns are matched by
name, ignoring case, spacing and punctuation.

It is read with the same Microsoft app as CI SQUARED's Test tab
(`SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`;
see docs/TEST-TAB-SHAREPOINT.md). With **Sites.Selected**, that app can read
only the sites it was given: give it read on the Epilepsy site
(`16-42UCBEpilepsyCI2026-2027`) the same way it was given the CI2 site
(Graph Explorer: `GET https://graph.microsoft.com/v1.0/sites/eradigm.sharepoint.com:/sites/16-42UCBEpilepsyCI2026-2027`
for the site id, then `POST …/sites/{site-id}/permissions` with
`{"roles":["read"],"grantedToIdentities":[{"application":{"id":"<client id>","displayName":"<app name>"}}]}`).

Then, on Epilepsy's Admin page: paste the workbook's link (Share → Copy link)
and Save. The link is resolved once (Graph's `/shares`; if the app may not
open sharing links, the file is found by its name on the link's site), read,
and from then on checked every minute and read again when it changes. Sync now
on every Epilepsy page does the same at once. Problems show on the Admin page
with what to fix.

Company colours (the charts') are set on the same page; a company without one
takes the next of the default palette, in the workbook's order.

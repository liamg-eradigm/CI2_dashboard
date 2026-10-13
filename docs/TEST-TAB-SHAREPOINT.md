# The Test tab and the SharePoint workbook

The **Test** tab (admins only) has three pages: **Database**, **Megatrends** and
**Primary Tracker**. They are the same pages as the live ones, but they show a
separate *test space* whose contents come only from the workbook
`Power_Automate_Test.xlsx` on SharePoint. Nothing on the Test tab changes the
live data, and nothing live shows on the Test tab.

## How it stays in step

- Every minute the platform asks Microsoft whether the workbook has changed
  (Excel in the browser saves as you type; desktop Excel when it saves). When
  it has, it reads the workbook and brings the test space in line with it.
- **Sync now** (the bar at the top of every Test page) does the same at once.
- The workbook is the master: a new row adds an entry, a changed row edits it
  (its Markdown and alert show the new values), and a row you delete removes
  the entry. The same goes for Company Profiles and Macrotrend sections.
- Changes made on the Test pages themselves are put back the next time the
  workbook changes.
- On the Workers Free plan each run applies a few rows, so a large first sync
  takes several runs. Sync now carries on until everything is in.

## The workbook

| Sheet | Feeds | Columns |
|---|---|---|
| `Primary` | Primary Tracker | The Primary Tracker's column names (as in the Inbox) |
| `Secondary` | Secondary Tracker | The Secondary Tracker's column names |
| `Competitor Trend Analysis` | Company Profiles | `Competitor`, `Company Profile` |
| `Macrotrend Analysis` | Macrotrend sections | `Macrotrend`, then any of `Macrotrend overview`, `Why does it matter?`, `Current Landscape`, `Long-Term Landscape`, `What's Next?`, `Impact on AbbVie` |

- Row 1 holds the column names; one row per entry, competitor or Macrotrend.
- Every Primary or Secondary row needs a unique **ID** (it is how a row is
  matched to its entry). A blank ID is made from the date, competitor and title.
- Dropdown values must be the platform's options (any case or spacing). A row
  with a problem is left out; **N problems** on the bar lists each one (sheet,
  row, column and why). Columns that are not fields are listed as left out.
- Lists (for example several competitors) are separated by commas, semicolons
  or new lines. Dates are real Excel dates (or YYYY-MM-DD).
- A sheet that is missing (for example renamed) leaves its part as it is.

## Check connection (the test endpoint)

**Check connection** calls `GET /api/excel/check`: it signs in to Microsoft as
the app, finds the workbook and lists its worksheets with their columns. Each
step shows ✓ or ✕; a failure says what to fix:

| Step that fails | What it means | What to do |
|---|---|---|
| Secrets | A `SHAREPOINT_*` secret is not set | `npx wrangler secret put <NAME> --env production -c apps/api/wrangler.jsonc`, then deploy the API |
| Microsoft sign-in, AADSTS7000215 | Wrong client secret | Put the secret's **Value** (not its Secret ID) in `SHAREPOINT_CLIENT_SECRET` |
| Microsoft sign-in, AADSTS7000222 | The secret expired | Make a new client secret in Entra and set it again |
| Microsoft sign-in, AADSTS700016 / 90002 | Client ID or tenant ID wrong | Copy both again from the app registration's Overview page |
| Workbook, 401 | Graph refused the app's sign-in | API permissions: Microsoft Graph → **Sites.Selected** (Application), admin consent granted |
| Workbook, 403 | The app may not read the site | Grant the app **read** on the CI2 Monitoring site (Graph Explorer, `POST /sites/{site-id}/permissions`) |
| Workbook, 404 | Wrong IDs, or the site was not shared with the app | Check `SHAREPOINT_DRIVE_ID` (starts `b!`) and `SHAREPOINT_ITEM_ID` (starts `01`) |
| Worksheets | The file is not an .xlsx workbook | Save it as .xlsx |

Errors are also written to the API's logs. To watch them live:

```
npx wrangler tail --env production -c apps/api/wrangler.jsonc --format pretty
```

and look for `sharepoint_graph_error` (what failed, Microsoft's error code and
request id; never the secret).

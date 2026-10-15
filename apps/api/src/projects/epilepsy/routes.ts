/**
 * The Epilepsy project's HTTP routes (request 61), under /api/epilepsy/. The
 * platform's middleware has resolved the caller and checked the workspace is
 * an Epilepsy one.
 */
import { EpilepsySettingsRequest, EpilepsySyncRequest, can } from "@eradigm/shared";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { body, cachedJson, P, routes } from "../../lib/http.js";
import { epilepsyData, epilepsyStatus, saveEpilepsySettings, syncEpilepsy } from "./services/workbook.js";

export const epilepsyRoutes = routes();
const app = epilepsyRoutes;

/** The four sheets, the companies' colours and when the workbook was last read (cached while nothing changed). */
app.get("/api/epilepsy/data", (c) => cachedJson(c, () => epilepsyData(c.env, P(c).tenantId), "all"));

/** The workbook's sync status (anyone in the project: the pages say when the data was last read). */
app.get("/api/epilepsy/status", async (c) => c.json(await epilepsyStatus(c.env, P(c).tenantId)));

app.put("/api/epilepsy/settings", async (c) => {
  const b = await body(c, EpilepsySettingsRequest);
  return c.json(await saveEpilepsySettings(c.env, P(c), b));
});

/** Sync now (staff): check the workbook and read it when it changed (force: read it anyway). */
app.post("/api/epilepsy/sync", async (c) => {
  const p = P(c);
  if (!can(p.role, "item:edit")) throw forbidden("Only Eradigm staff can sync the workbook");
  const b = await body(c, EpilepsySyncRequest);
  return c.json(await syncEpilepsy(c.env, p.tenantId, p, { force: !!b.force }));
});

/** Development and tests only: the workbook from an upload instead of SharePoint. */
app.post("/api/epilepsy/upload", async (c) => {
  const p = P(c);
  if (c.env.ENVIRONMENT !== "dev" && c.env.ENVIRONMENT !== "test") throw notFound("Endpoint");
  if (p.role !== "admin") throw forbidden();
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file") as unknown as File | string | null | undefined;
  if (!file || typeof file === "string") throw badRequest("Send the workbook as the multipart field “file”");
  return c.json(await syncEpilepsy(c.env, p.tenantId, p, { upload: { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "upload.xlsx" } }));
});

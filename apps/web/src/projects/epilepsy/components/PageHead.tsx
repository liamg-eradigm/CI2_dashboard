/** An Epilepsy page's title band (request 61): the project, the page, and when the workbook was last read, with Sync now for staff. */
import type { ReactNode } from "react";
import { can, type Me } from "@eradigm/shared";
import { localDateTime } from "../../../lib/format";
import { useToast } from "../../../state/toast";
import { useEpilepsyStatus, useEpilepsySync } from "../api/hooks";

export function PageHead({ me, title, intro, children }: { me: Me; title: string; intro: string; children?: ReactNode }) {
  const status = useEpilepsyStatus();
  const sync = useEpilepsySync();
  const toast = useToast();
  const s = status.data;
  const staff = can(me.role, "item:edit");
  return (
    <section className="band epi-band" aria-labelledby="page-title">
      <div className="band-row">
        <div>
          <span className="eyebrow">{me.project?.name ?? "Epilepsy"}</span>
          <h1 id="page-title">{title}</h1>
        </div>
        <div className="epi-head-end">
          <div className="band-copy">{intro}</div>
          <div className="epi-sync" data-testid="epi-sync">
            <span className={`epi-sync-dot ${s?.status === "error" ? "bad" : s?.lastSyncedAt ? "ok" : ""}`} aria-hidden="true" />
            <span className="epi-sync-text" title={s?.file.modifiedAt ? `Workbook last saved ${localDateTime(s.file.modifiedAt)}${s.file.modifiedBy ? ` by ${s.file.modifiedBy}` : ""}` : undefined}>
              {s?.status === "error" ? "Workbook not read: see Admin" : s?.lastSyncedAt ? `Data from the workbook · read ${localDateTime(s.lastSyncedAt)}` : "No workbook read yet"}
            </span>
            {staff && (
              <button
                className="btn secondary small epi-sync-btn"
                disabled={sync.isPending}
                onClick={() =>
                  sync.mutate(false, {
                    onSuccess: (r) => toast(r.status === "error" ? (r.message ?? "The workbook could not be read") : r.status === "never" ? (r.message ?? "No workbook set") : "Data synced", r.status !== "error" && r.status !== "never"),
                    onError: (e) => toast((e as Error).message, false),
                  })
                }
              >
                {sync.isPending ? "Syncing…" : "↻ Sync now"}
              </button>
            )}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

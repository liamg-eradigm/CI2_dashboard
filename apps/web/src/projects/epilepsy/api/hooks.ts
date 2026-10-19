/** The Epilepsy project's data (request 61): the workbook's four sheets, and its sync status. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EPILEPSY_SHEETS, acceptedOptions, normaliseHeader, withColumnNames, type EpilepsyData, type EpilepsySyncStatus } from "@eradigm/shared";
import type { EpiData } from "../model";
import { api } from "../../../api/client";

const dataQuery = { queryKey: ["epilepsy", "data"], queryFn: () => api<EpilepsyData>("/api/epilepsy/data"), staleTime: 30_000, refetchInterval: 60_000 };

/** Request 65: the sheets with the columns an admin named (Admin → Column names) under the names the pages read. */
function named(d: EpilepsyData): EpiData {
  const sheets = { ...d.sheets };
  const accepted: NonNullable<EpiData["accepted"]> = {};
  for (const k of EPILEPSY_SHEETS) {
    const s = sheets[k];
    if (!s) continue;
    // Each dropdown column's accepted options, by its place in the sheet (the same after renaming).
    const at = new Map(s.columns.map((c, i) => [normaliseHeader(c), i]));
    const workbook = d.dropdowns?.[k] ?? {};
    const added = d.addedOptions?.[k] ?? {};
    for (const header of new Set([...Object.keys(workbook), ...Object.keys(added)])) {
      const i = at.get(normaliseHeader(header));
      if (i != null) (accepted[k] ??= {})[i] = acceptedOptions(workbook[header], added[header]);
    }
    sheets[k] = withColumnNames(s, d.columnNames?.[k]);
  }
  return { ...d, sheets, accepted };
}

/** The workbook's data as the pages read it. */
export const useEpilepsyData = () => useQuery({ ...dataQuery, select: named });
/** The workbook's data as written (its own column names): Admin → Column names. */
export const useEpilepsyRawData = () => useQuery(dataQuery);
export const useEpilepsyStatus = (enabled = true) =>
  useQuery({ queryKey: ["epilepsy", "status"], queryFn: () => api<EpilepsySyncStatus>("/api/epilepsy/status"), enabled, refetchInterval: (q) => (q.state.data?.status === "syncing" ? 3000 : 60_000) });

/** Sync now: check the workbook and read it when it changed (force: anyway). */
export function useEpilepsySync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => api<EpilepsySyncStatus>("/api/epilepsy/sync", { method: "POST", json: { force } }),
    onSuccess: async (s) => {
      qc.setQueryData(["epilepsy", "status"], s);
      await qc.invalidateQueries({ queryKey: ["epilepsy", "data"] });
    },
  });
}

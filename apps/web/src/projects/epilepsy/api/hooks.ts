/** The Epilepsy project's data (request 61): the workbook's four sheets, and its sync status. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EpilepsyData, EpilepsySyncStatus } from "@eradigm/shared";
import { api } from "../../../api/client";

export const useEpilepsyData = () => useQuery({ queryKey: ["epilepsy", "data"], queryFn: () => api<EpilepsyData>("/api/epilepsy/data"), staleTime: 30_000, refetchInterval: 60_000 });
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

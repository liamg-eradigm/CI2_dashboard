import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  filtersToParams,
  type AuditEvent,
  type CaptureLogEntry,
  type DashboardData,
  type FilterState,
  type Incident,
  type ItemDetail,
  type ItemSummary,
  type Me,
  type QualityMetrics,
  type SavedView,
  type SignalDetail,
  type TenantSettings,
  type TrackerPage,
  type TrackerSchema,
  type TrendConfig,
  type TrendResult,
  type User,
} from "@eradigm/shared";
import { api } from "./client";

export type SchemaWithUsage = TrackerSchema & { usage?: Record<string, Record<string, number>> };

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), retry: false, staleTime: 60_000 });
export const useSchema = (withUsage = false) =>
  useQuery({ queryKey: ["schema", withUsage], queryFn: () => api<SchemaWithUsage>(`/api/schema${withUsage ? "?usage=1" : ""}`), staleTime: 30_000 });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<TenantSettings>("/api/settings"), staleTime: 60_000 });

const qs = (f: FilterState, extra: Record<string, string | number> = {}) => {
  const p = filtersToParams(f);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
};

export const useDashboard = (f: FilterState, enabled = true) =>
  useQuery({ queryKey: ["dashboard", f], queryFn: () => api<DashboardData>(`/api/dashboard?${qs(f)}`), placeholderData: keepPreviousData, enabled });

export const useTracker = (f: FilterState, sort: { key: string; dir: "asc" | "desc" }, page: number, pageSize = 10) =>
  useQuery({
    queryKey: ["tracker", f, sort, page, pageSize],
    queryFn: () => api<TrackerPage>(`/api/tracker?${qs(f, { sort: sort.key, dir: sort.dir, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });

export const exportUrl = (f: FilterState, sort: { key: string; dir: string }, scope: "filtered" | "all", format: string) =>
  `/api/tracker/export?${qs(f, { sort: sort.key, dir: sort.dir, scope, format })}`;

export const useSignal = (id: string | null) =>
  useQuery({ queryKey: ["signal", id], queryFn: () => api<SignalDetail>(`/api/signals/${id}`), enabled: !!id });

export const useItems = (statuses: string[], enabled = true, poll = false) =>
  useQuery({
    queryKey: ["items", statuses],
    queryFn: () => api<ItemSummary[]>(`/api/items?status=${statuses.join(",")}`),
    enabled,
    refetchInterval: poll ? 3000 : false,
  });

export const useItem = (id: string | null, poll = false) =>
  useQuery({ queryKey: ["item", id], queryFn: () => api<ItemDetail>(`/api/items/${id}`), enabled: !!id, refetchInterval: poll ? 1000 : false });

export const useCaptureLog = (enabled: boolean) => useQuery({ queryKey: ["capture-log"], queryFn: () => api<CaptureLogEntry[]>("/api/capture-log"), enabled });
export const useViews = () => useQuery({ queryKey: ["views"], queryFn: () => api<SavedView[]>("/api/views") });
export const useUsers = (enabled: boolean) => useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users"), enabled });
export const useAudit = (enabled: boolean) => useQuery({ queryKey: ["audit"], queryFn: () => api<AuditEvent[]>("/api/audit?limit=100"), enabled });
export const useIncidents = (enabled: boolean) => useQuery({ queryKey: ["incidents"], queryFn: () => api<Incident[]>("/api/incidents"), enabled });
export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: ["notifications"], queryFn: () => api<{ id: string; kind: string; message: string; at: string; read: boolean }[]>("/api/notifications"), enabled });
export const useQuality = (enabled: boolean) => useQuery({ queryKey: ["quality"], queryFn: () => api<QualityMetrics>("/api/metrics/quality"), enabled });
export const useConfigStatus = (enabled: boolean) =>
  useQuery({
    queryKey: ["config-status"],
    queryFn: () => api<{ environment: string; model: string; provider: string; prefill: "manual" | "llm"; checks: { key: string; ok: boolean; message: string }[] }>("/api/admin/config-status"),
    enabled,
  });

export const runTrend = (cfg: TrendConfig) => api<TrendResult & { counts: { current: number; baseline: number } }>("/api/trend-test", { method: "POST", json: cfg });

/** Invalidate everything derived from published signals or the schema. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all((keys.length ? keys : ["dashboard", "tracker", "items", "item", "signal", "schema"]).map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useApiMutation<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, invalidate: string[] = []) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: fn, onSuccess: () => inv(...invalidate) });
}

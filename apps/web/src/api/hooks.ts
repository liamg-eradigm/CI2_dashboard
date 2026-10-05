import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  IN_PROGRESS_STATUSES,
  filtersToParams,
  type AuditEvent,
  type CaptureLogEntry,
  type DashboardData,
  type DateBounds,
  type FilterState,
  type Incident,
  type ItemComment,
  type ItemDetail,
  type ItemSummary,
  type Me,
  type Competitors,
  type Megatrends,
  type Newsletter,
  type PrimarySource,
  type QualityMetrics,
  type SavedView,
  type SignalDetail,
  type Stream,
  type TenantSettings,
  type TrackerPage,
  type TrackerSchema,
  type TrendConfig,
  type TrendResult,
  type User,
} from "@eradigm/shared";
import { api, request } from "./client";

export type SchemaWithUsage = TrackerSchema & { usage?: Record<string, Record<string, number>> };

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), retry: false, staleTime: 60_000 });
/** A stream's column set, or "all" (both merged, read-only: the Dashboard). */
export const useSchema = (stream: Stream | "all" = "primary", withUsage = false) =>
  useQuery({
    queryKey: ["schema", stream, withUsage],
    queryFn: () => api<SchemaWithUsage>(`/api/schema?stream=${stream}${withUsage ? "&usage=1" : ""}`),
    staleTime: 30_000,
  });
/** Oldest and newest Tracker entry dates (the default date filter). */
export const useDateBounds = () => useQuery({ queryKey: ["bounds"], queryFn: () => api<DateBounds>("/api/tracker/bounds"), staleTime: 60_000 });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<TenantSettings>("/api/settings"), staleTime: 60_000 });

const qs = (f: FilterState, extra: Record<string, string | number> = {}) => {
  const p = filtersToParams(f);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
};

export const useDashboard = (f: FilterState, enabled = true) =>
  useQuery({ queryKey: ["dashboard", f], queryFn: () => api<DashboardData>(`/api/dashboard?${qs(f)}`), placeholderData: keepPreviousData, enabled });

/** The Tracker, Phantoms and the two Deliverables tables (built from Phantoms). */
export type TableView = "tracker" | "phantoms" | "alerts" | "newsletter";
const TABLE_PATH: Record<TableView, string> = { tracker: "/api/tracker", phantoms: "/api/phantoms", alerts: "/api/deliverables/alerts", newsletter: "/api/deliverables/newsletter" };

export const useTracker = (f: FilterState, sort: { key: string; dir: "asc" | "desc" }, page: number, pageSize = 10, stream: Stream = "primary", view: TableView = "tracker", enabled = true) =>
  useQuery({
    queryKey: ["tracker", view, stream, f, sort, page, pageSize],
    queryFn: () => api<TrackerPage>(`${TABLE_PATH[view]}?${qs(f, { sort: sort.key, dir: sort.dir, page, pageSize, stream })}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const exportUrl = (f: FilterState, sort: { key: string; dir: string }, scope: "filtered" | "all", format: string, stream: Stream = "primary", view: TableView = "tracker") =>
  `/api/tracker/export?${qs(f, { sort: sort.key, dir: sort.dir, scope, format, stream, view })}`;

/** Newsletters created on Deliverables → Newsletter, newest first. */
export const useMegatrends = (stream: Stream | "all", from: string | null, to: string | null) =>
  useQuery({
    queryKey: ["megatrends", stream, from, to],
    queryFn: () => api<Megatrends>(`/api/megatrends?${new URLSearchParams({ stream, ...(from ? { from } : {}), ...(to ? { to } : {}) })}`),
    placeholderData: keepPreviousData,
  });
export const useCompetitors = () =>
  useQuery({ queryKey: ["competitors"], queryFn: () => api<Competitors>("/api/competitors?stream=all"), placeholderData: keepPreviousData });
export const useNewsletters = (enabled = true) => useQuery({ queryKey: ["newsletters"], queryFn: () => api<Newsletter[]>("/api/newsletters"), enabled });

/** The Phantoms Markdown of an entry (text). */
export const useMarkdown = (id: string | null) =>
  useQuery({
    queryKey: ["signal", id, "markdown"],
    queryFn: async () => {
      const res = await request(`/api/signals/${id}/markdown`);
      return res.text();
    },
    enabled: !!id,
  });

/** Items awaiting the analyst in each inbox (the red badges). */
export const useClientInboxCount = (enabled: boolean) =>
  useQuery({ queryKey: ["client-inbox", "count"], queryFn: () => api<{ count: number }>("/api/client-inbox/count"), enabled, refetchInterval: enabled ? 30_000 : false });
export const useClientInbox = () => useQuery({ queryKey: ["client-inbox", "list"], queryFn: () => api<ItemSummary[]>("/api/client-inbox"), refetchInterval: 30_000 });
export const useComments = (itemId: string | null, enabled = true) =>
  useQuery({ queryKey: ["comments", itemId], queryFn: () => api<ItemComment[]>(`/api/items/${itemId}/comments`), enabled: !!itemId && enabled });
export const useInboxCounts = (enabled: boolean) =>
  useQuery({ queryKey: ["counts"], queryFn: () => api<Record<Stream, number>>("/api/items/counts"), enabled, refetchInterval: enabled ? 30_000 : false });

/** Approved Primary entries with a source (Source Role + Source Company), for "This Source Has Prior Primary Information". */
export const usePrimarySources = (enabled: boolean) =>
  useQuery({ queryKey: ["primary-sources"], queryFn: () => api<PrimarySource[]>("/api/primary-sources"), enabled, staleTime: 30_000 });

export const useSignal = (id: string | null) =>
  useQuery({ queryKey: ["signal", id], queryFn: () => api<SignalDetail>(`/api/signals/${id}`), enabled: !!id });

export const useItems = (statuses: string[], enabled = true, poll = false, stream?: Stream) =>
  useQuery({
    queryKey: ["items", statuses, stream ?? "both"],
    queryFn: () => api<ItemSummary[]>(`/api/items?status=${statuses.join(",")}${stream ? `&stream=${stream}` : ""}`),
    enabled,
    // Every 3 s while something is being captured (to show it arrive), else every 30 s (D1 rows read).
    refetchInterval: poll ? (q) => (q.state.data?.some((i) => (IN_PROGRESS_STATUSES as readonly string[]).includes(i.status)) ? 3000 : 30_000) : false,
  });

export const useItem = (id: string | null, poll = false) =>
  useQuery({
    queryKey: ["item", id],
    queryFn: () => api<ItemDetail>(`/api/items/${id}`),
    enabled: !!id,
    // While it is being captured; once it has arrived (or failed) there is nothing more to wait for.
    refetchInterval: poll ? (q) => (q.state.data && !(IN_PROGRESS_STATUSES as readonly string[]).includes(q.state.data.status) ? false : 2000) : false,
  });

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
  return (...keys: string[]) => Promise.all((keys.length ? keys : ["dashboard", "tracker", "items", "item", "signal", "schema", "counts", "megatrends", "competitors", "bounds", "client-inbox", "comments", "primary-sources"]).map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useApiMutation<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, invalidate: string[] = []) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: fn, onSuccess: () => inv(...invalidate) });
}

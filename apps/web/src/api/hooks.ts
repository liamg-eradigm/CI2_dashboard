/**
 * Platform hooks (request 61): what every project uses — who is signed in,
 * people and their access, the audit log and the API's health.
 * A project's own data hooks live in its folder (projects/<project>/api).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Access, AuditEvent, Incident, Me, User } from "@eradigm/shared";
import { api } from "./client";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), retry: false, staleTime: 60_000 });
/** Request 61: people and their access to the projects the caller manages. */
export const useAccess = (enabled: boolean) => useQuery({ queryKey: ["access"], queryFn: () => api<Access>("/api/access"), enabled });
export const useUsers = (enabled: boolean) => useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users"), enabled });
export const useAudit = (enabled: boolean) => useQuery({ queryKey: ["audit"], queryFn: () => api<AuditEvent[]>("/api/audit?limit=100"), enabled });
export const useIncidents = (enabled: boolean) => useQuery({ queryKey: ["incidents"], queryFn: () => api<Incident[]>("/api/incidents"), enabled });
export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: ["notifications"], queryFn: () => api<{ id: string; kind: string; message: string; at: string; read: boolean }[]>("/api/notifications"), enabled });
export const useConfigStatus = (enabled: boolean) =>
  useQuery({
    queryKey: ["config-status"],
    queryFn: () => api<{ environment: string; model: string; provider: string; prefill: "manual" | "llm"; checks: { key: string; ok: boolean; message: string }[] }>("/api/admin/config-status"),
    enabled,
  });

/** Read again what these query keys hold (none: everything). */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => (keys.length ? Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))) : qc.invalidateQueries());
}

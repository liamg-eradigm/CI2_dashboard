/**
 * API contract: request and response formats shared by the dashboard and the
 * processing service. The API validates every request body against these
 * schemas; `scripts/generate-openapi.ts` turns `ENDPOINTS` into an OpenAPI
 * document (the "automatically generated instructions for communicating with
 * the processing system", 4_Backend_Design).
 */
import { z } from "zod";
import { ACTIONS, ROLES } from "./permissions.js";
import { ITEM_STATUSES } from "./status.js";
import { COLUMN_TYPES, CREATABLE_COLUMN_TYPES, MAX_LABEL_LENGTH, MAX_OPTION_LENGTH } from "./schema.js";
import { EXPORT_FORMATS } from "./export.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const isoDateTime = z.string();
export const FieldValueSchema = z.union([z.string(), z.array(z.string()), z.null()]);
export const ItemValuesSchema = z.record(z.string(), FieldValueSchema);

// ---------------------------------------------------------------------------
// Schema / taxonomy
// ---------------------------------------------------------------------------

export const TrackerColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(COLUMN_TYPES),
  core: z.boolean(),
  required: z.boolean(),
  position: z.number().int(),
  options: z.array(z.string()).optional(),
  aiAssist: z.boolean(),
});

export const TrackerSchemaSchema = z.object({
  revision: z.number().int(),
  columns: z.array(TrackerColumnSchema),
  taxonomy: z.array(z.object({ name: z.string(), subtrends: z.array(z.string()) })),
});

export const AddColumnRequest = z.object({
  label: z.string().min(1).max(MAX_LABEL_LENGTH),
  type: z.enum(CREATABLE_COLUMN_TYPES),
});
export const UpdateColumnRequest = z
  .object({ label: z.string().min(1).max(MAX_LABEL_LENGTH).optional(), required: z.boolean().optional() })
  .refine((v) => v.label !== undefined || v.required !== undefined, "Nothing to update");
export const AddOptionRequest = z.object({
  value: z.string().min(1).max(MAX_OPTION_LENGTH),
  /** Macrotrend the new subtrend belongs to (subtrend column only). */
  parent: z.string().max(MAX_OPTION_LENGTH).optional(),
});
export const RenameOptionRequest = z.object({
  from: z.string().min(1).max(MAX_OPTION_LENGTH),
  to: z.string().min(1).max(MAX_OPTION_LENGTH),
});
export const DeleteOptionRequest = z.object({ value: z.string().min(1).max(MAX_OPTION_LENGTH) });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const MeSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  tenant: z.object({ id: z.string(), name: z.string() }),
  role: z.enum(ROLES),
  tenants: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(ROLES) })),
  permissions: z.array(z.enum(ACTIONS)),
  contractVersion: z.string(),
  environment: z.string(),
  timezone: z.string(),
  /** How drafts are pre-filled: "manual" (all fields empty, no external service) or "llm". Added in contract 1.1. */
  features: z.object({ prefill: z.enum(["manual", "llm"]) }).default({ prefill: "manual" }),
});

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  active: z.boolean(),
  createdAt: isoDateTime,
  lastSeenAt: isoDateTime.nullable(),
});
export const CreateUserRequest = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(120),
  role: z.enum(ROLES),
});
export const UpdateUserRequest = z
  .object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, "Nothing to update");

// ---------------------------------------------------------------------------
// Intelligence items
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.enum(["source", "ai", "analyst"]);

export const ExtractedFieldSchema = z.object({
  value: FieldValueSchema,
  confidence: z.number().nullable(),
  evidence: z.string().nullable(),
  nullReason: z.string().nullable(),
  warnings: z.array(z.string()),
});

export const ItemSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.enum(ITEM_STATUSES),
  inputType: z.enum(["url", "file"]),
  outlet: z.string().nullable(),
  submittedUrl: z.string().nullable(),
  url: z.string().nullable(),
  receivedAt: isoDateTime,
  submittedBy: z.string().nullable(),
  title: z.string().nullable(),
  draft: ItemValuesSchema,
  provenance: z.record(z.string(), ProvenanceSchema.nullable()),
  extraction: z.record(z.string(), ExtractedFieldSchema).nullable(),
  warningsCount: z.number().int(),
  modelWarnings: z.array(z.string()),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  duplicateOf: z.string().nullable(),
  quarantined: z.boolean(),
  version: z.number().int(),
  attempts: z.number().int(),
  signalCode: z.string().nullable(),
  publishedRev: z.number().int().nullable(),
  decision: z
    .object({ decision: z.enum(["approve", "reject", "reprocess"]), by: z.string(), at: isoDateTime, note: z.string().nullable() })
    .nullable(),
  hasSnapshot: z.boolean(),
});

export const RevisionSchema = z.object({
  /** Sequence across all revision kinds (1 = first LLM draft). */
  seq: z.number().int(),
  /** Published revision number (rev 1, rev 2, ...); null for drafts and edits. */
  rev: z.number().int().nullable(),
  kind: z.enum(["llm_draft", "analyst_edit", "published"]),
  values: ItemValuesSchema,
  changedKeys: z.array(z.string()),
  by: z.string(),
  at: isoDateTime,
  note: z.string().nullable(),
});

export const AttemptSchema = z.object({
  attempt: z.number().int(),
  status: z.enum(["running", "succeeded", "failed"]),
  stage: z.string(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  extractionVersion: z.string().nullable(),
  promptVersion: z.string().nullable(),
  schemaVersion: z.string().nullable(),
  /** "none" for manual entry, else the LLM adapter used. Added in contract 1.1. */
  provider: z.string().nullable().default(null),
  model: z.string().nullable(),
  /** Token usage reported by the LLM (null for manual entry). Added in contract 1.1. */
  inputTokens: z.number().int().nullable().default(null),
  outputTokens: z.number().int().nullable().default(null),
  steps: z.array(z.object({ label: z.string(), ok: z.boolean(), detail: z.string() })),
});

export const SnapshotSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  bytes: z.number().int(),
  contentType: z.string(),
  finalUrl: z.string().nullable(),
  retrievedAt: isoDateTime,
  captureMethod: z.string(),
  redirects: z.number().int(),
  retentionStatus: z.enum(["active", "expired", "deleted"]),
  singleFile: z.boolean(),
});

export const ItemDetailSchema = ItemSummarySchema.extend({
  bodyText: z.string().nullable(),
  publicationDate: z.string().nullable(),
  revisions: z.array(RevisionSchema),
  attemptsDetail: z.array(AttemptSchema),
  snapshot: SnapshotSchema.nullable(),
});

export const SaveDraftRequest = z.object({ values: ItemValuesSchema, version: z.number().int() });
export const ApproveRequest = z.object({ values: ItemValuesSchema, version: z.number().int(), note: z.string().max(500).optional() });
export const RejectRequest = z.object({ reason: z.string().max(500).optional(), version: z.number().int() });
export const ReprocessRequest = z.object({ version: z.number().int().optional() });
export const ReviseRequest = z.object({ values: ItemValuesSchema, note: z.string().min(1).max(500) });
export const CreateSubmissionRequest = z.object({ url: z.string().min(1).max(2048) });
export const CreateSubmissionResponse = z.object({ item: ItemSummarySchema, duplicate: z.boolean() });

// ---------------------------------------------------------------------------
// Tracker / dashboard
// ---------------------------------------------------------------------------

export const SignalSchema = z.object({
  id: z.string(),
  code: z.string(),
  values: ItemValuesSchema,
  text: z.string(),
  url: z.string().nullable(),
  rev: z.number().int(),
  approvedAt: isoDateTime,
  approvedBy: z.string(),
});

export const SignalDetailSchema = SignalSchema.extend({
  inboxCode: z.string(),
  receivedAt: isoDateTime,
  submittedUrl: z.string().nullable(),
  snapshot: SnapshotSchema.nullable(),
  provenance: z.record(z.string(), ProvenanceSchema.nullable()),
  evidence: z.record(z.string(), ExtractedFieldSchema).nullable(),
  extraction: z.object({
    extractionVersion: z.string().nullable(),
    promptVersion: z.string().nullable(),
    schemaVersion: z.string().nullable(),
    model: z.string().nullable(),
  }),
  revisions: z.array(RevisionSchema),
  related: z.array(z.object({ id: z.string(), code: z.string(), title: z.string(), date: z.string().nullable(), why: z.string() })),
});

export const TrackerPageSchema = z.object({
  rows: z.array(SignalSchema),
  total: z.number().int(),
  totalPublished: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

const Bar = z.object({ label: z.string(), n: z.number().int(), high: z.number().int(), medium: z.number().int(), low: z.number().int() });

export const DashboardSchema = z.object({
  kpis: z.object({
    approved: z.number().int(),
    totalPublished: z.number().int(),
    competitorsInvolved: z.number().int(),
    competitorsTracked: z.number().int(),
    high: z.number().int(),
    low: z.number().int(),
  }),
  timeline: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      date: z.string(),
      title: z.string(),
      competitors: z.array(z.string()),
      growth: z.string().nullable(),
      impact: z.string().nullable(),
      source: z.string().nullable(),
    }),
  ),
  timelineTruncated: z.boolean(),
  macroBars: z.array(Bar),
  subBars: z.array(Bar),
  compBars: z.array(Bar),
  compSum: z.number().int(),
  compItems: z.number().int(),
});

export const TrendThresholdsSchema = z.object({
  minSampleSize: z.number().int().min(0).max(100_000),
  signalCountChangePct: z.number().min(0).max(100_000),
  distinctCompetitorsChange: z.number().min(0).max(10_000),
  impactScoreChangePct: z.number().min(0).max(100_000),
  growthScoreChange: z.number().min(0).max(2),
});

export const TrendConfigSchema = z.object({
  macrotrend: z.string().max(MAX_OPTION_LENGTH),
  subtrend: z.string().max(MAX_OPTION_LENGTH),
  competitors: z.array(z.string().max(MAX_OPTION_LENGTH)).max(200),
  growth: z.string().max(MAX_OPTION_LENGTH),
  from: isoDate,
  to: isoDate,
  thresholds: TrendThresholdsSchema,
});

const MetricResultSchema = z.object({
  metric: z.string(),
  key: z.enum(["sample", "count", "competitors", "impact", "growth"]),
  current: z.number().nullable(),
  baseline: z.number().nullable(),
  change: z.string(),
  threshold: z.string(),
  progress: z.number().nullable(),
  met: z.boolean(),
  explanation: z.string(),
});
const PeriodSchema = z.object({ from: z.string(), to: z.string(), days: z.number().int() });
export const TrendResultSchema = z.object({
  current: PeriodSchema,
  baseline: PeriodSchema,
  metrics: z.array(MetricResultSchema),
  confirmed: z.boolean(),
  verdict: z.enum(["Trend confirmed", "No trend detected"]),
  unmetRules: z.array(z.string()),
  formula: z.array(z.string()),
  sampleRule: z.string(),
  explanation: z.string(),
  disclaimer: z.string(),
});

// ---------------------------------------------------------------------------
// Saved views, settings, audit, capture log
// ---------------------------------------------------------------------------

export const SavedViewStateSchema = z.object({
  filters: z
    .object({ q: z.string().max(200), from: isoDate, to: isoDate, values: z.record(z.string(), z.string().max(MAX_OPTION_LENGTH)) })
    .optional(),
  trend: TrendConfigSchema.optional(),
  sort: z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
});
export const SavedViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["dashboard", "tracker", "trend"]),
  state: SavedViewStateSchema,
  createdAt: isoDateTime,
  owner: z.string(),
  shared: z.boolean(),
});
export const CreateSavedViewRequest = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["dashboard", "tracker", "trend"]),
  state: SavedViewStateSchema,
  shared: z.boolean().default(false),
});

export const TenantSettingsSchema = z.object({
  timezone: z.string().max(64),
  trendDefaults: TrendThresholdsSchema,
  retention: z.object({
    /** Days a source snapshot is kept after capture (0 = keep until item deletion). */
    snapshotDays: z.number().int().min(0).max(3650),
    /** Days rejected or failed items keep their content before it is purged. */
    rejectedDays: z.number().int().min(0).max(3650),
    /** Days deleted items are kept before hard deletion. */
    deletedDays: z.number().int().min(0).max(3650),
  }),
  redaction: z.object({
    redactEmails: z.boolean(),
    redactPhones: z.boolean(),
    quarantineMarkers: z.array(z.string().min(3).max(80)).max(100),
  }),
});
export const UpdateSettingsRequest = TenantSettingsSchema.partial();

export const AuditEventSchema = z.object({
  seq: z.number().int(),
  at: isoDateTime,
  actor: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  hash: z.string(),
});

export const CaptureLogEntrySchema = z.object({
  id: z.string(),
  at: isoDateTime,
  input: z.string(),
  finalUrl: z.string().nullable(),
  outcome: z.string(),
  ok: z.boolean(),
  itemId: z.string().nullable(),
});

export const IncidentSchema = z.object({
  id: z.string(),
  at: isoDateTime,
  category: z.string(),
  itemCode: z.string().nullable(),
  resolved: z.boolean(),
});

export const QualityMetricsSchema = z.object({
  reviewed: z.number().int(),
  approved: z.number().int(),
  rejected: z.number().int(),
  approvedWithCorrections: z.number().int(),
  /** Approvals whose draft was pre-filled by the LLM (correction rates are measured against these). Added in contract 1.1. */
  aiDrafted: z.number().int().default(0),
  correctionRate: z.number().nullable(),
  fieldCorrectionRates: z.array(z.object({ key: z.string(), label: z.string(), corrected: z.number().int(), rate: z.number().nullable() })),
  requiredFieldCompletion: z.number().nullable(),
  evidenceCoverage: z.number().nullable(),
  duplicatesDetected: z.number().int(),
  failed: z.number().int(),
  quarantined: z.number().int(),
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.array(z.object({ key: z.string(), label: z.string(), code: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});

export type Me = z.infer<typeof MeSchema>;
export type User = z.infer<typeof UserSchema>;
export type ItemSummary = z.infer<typeof ItemSummarySchema>;
export type ItemDetail = z.infer<typeof ItemDetailSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type SignalDetail = z.infer<typeof SignalDetailSchema>;
export type TrackerPage = z.infer<typeof TrackerPageSchema>;
export type DashboardData = z.infer<typeof DashboardSchema>;
export type Bar = z.infer<typeof Bar>;
export type SavedView = z.infer<typeof SavedViewSchema>;
export type SavedViewState = z.infer<typeof SavedViewStateSchema>;
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type CaptureLogEntry = z.infer<typeof CaptureLogEntrySchema>;
export type Incident = z.infer<typeof IncidentSchema>;
export type QualityMetrics = z.infer<typeof QualityMetricsSchema>;
export type ApiError = z.infer<typeof ErrorSchema>;
export type ExtractedFieldView = z.infer<typeof ExtractedFieldSchema>;

// ---------------------------------------------------------------------------
// Endpoint table (drives the generated OpenAPI document)
// ---------------------------------------------------------------------------

export interface EndpointDef {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  roles: readonly string[];
  request?: z.ZodType;
  response?: z.ZodType;
  query?: string[];
  multipart?: boolean;
  raw?: string;
}

const ALL_ROLES = ROLES;
const STAFF = ["admin", "analyst"] as const;
const ADMIN = ["admin"] as const;

export const ENDPOINTS: EndpointDef[] = [
  { method: "get", path: "/api/health", summary: "Liveness probe (no authentication)", roles: [] },
  { method: "get", path: "/api/me", summary: "Current user, tenant, role and permissions", roles: ALL_ROLES, response: MeSchema },
  { method: "post", path: "/api/me/sessions/revoke", summary: "End all of my active sessions", roles: ALL_ROLES },
  { method: "get", path: "/api/schema", summary: "Tracker columns and taxonomy", roles: ALL_ROLES, response: TrackerSchemaSchema },
  { method: "post", path: "/api/schema/columns", summary: "Add a column", roles: STAFF, request: AddColumnRequest, response: TrackerSchemaSchema },
  { method: "patch", path: "/api/schema/columns/{key}", summary: "Rename a column or toggle Required", roles: STAFF, request: UpdateColumnRequest, response: TrackerSchemaSchema },
  { method: "delete", path: "/api/schema/columns/{key}", summary: "Delete a non-core column", roles: STAFF, response: TrackerSchemaSchema },
  { method: "post", path: "/api/schema/columns/{key}/options", summary: "Add a dropdown option", roles: STAFF, request: AddOptionRequest, response: TrackerSchemaSchema },
  { method: "patch", path: "/api/schema/columns/{key}/options", summary: "Rename an option (propagates to signals, drafts and filters)", roles: STAFF, request: RenameOptionRequest, response: TrackerSchemaSchema },
  { method: "delete", path: "/api/schema/columns/{key}/options", summary: "Delete an unused option", roles: STAFF, request: DeleteOptionRequest, response: TrackerSchemaSchema },
  { method: "get", path: "/api/tracker", summary: "Server-side filtered, sorted, paginated approved signals", roles: ALL_ROLES, query: ["q", "from", "to", "f.<column>", "sort", "dir", "page", "pageSize"], response: TrackerPageSchema },
  { method: "get", path: "/api/tracker/export", summary: "Export approved signals (audited)", roles: ALL_ROLES, query: ["scope", "format", "q", "from", "to", "f.<column>", "sort", "dir"], raw: `One of ${EXPORT_FORMATS.join(", ")}` },
  { method: "get", path: "/api/signals/{id}", summary: "Approved signal detail with provenance and history", roles: ALL_ROLES, response: SignalDetailSchema },
  { method: "post", path: "/api/signals/{id}/revise", summary: "Publish a new revision of an approved signal", roles: STAFF, request: ReviseRequest, response: SignalDetailSchema },
  { method: "get", path: "/api/dashboard", summary: "KPIs, timeline and chart aggregates for the shared filter state", roles: ALL_ROLES, query: ["q", "from", "to", "f.<column>"], response: DashboardSchema },
  { method: "post", path: "/api/trend-test", summary: "Evaluate the Trend Test", roles: ALL_ROLES, request: TrendConfigSchema, response: TrendResultSchema },
  { method: "post", path: "/api/submissions", summary: "Submit a URL (JSON) or HTML file (multipart). Idempotent on URL/content and Idempotency-Key.", roles: STAFF, request: CreateSubmissionRequest, response: CreateSubmissionResponse, multipart: true },
  { method: "get", path: "/api/capture-log", summary: "Final resolved URL and retrieval outcome for every submission", roles: STAFF, response: z.array(CaptureLogEntrySchema) },
  { method: "get", path: "/api/items", summary: "Inbox items", roles: STAFF, query: ["status"], response: z.array(ItemSummarySchema) },
  { method: "get", path: "/api/items/{id}", summary: "Inbox item detail", roles: STAFF, response: ItemDetailSchema },
  { method: "get", path: "/api/items/{id}/snapshot", summary: "Sanitised source snapshot (sandboxed HTML)", roles: ALL_ROLES, raw: "text/html" },
  { method: "patch", path: "/api/items/{id}/draft", summary: "Save analyst edits to a draft", roles: STAFF, request: SaveDraftRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/approve", summary: "Validate server-side and publish as a new revision", roles: STAFF, request: ApproveRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/reject", summary: "Reject a draft", roles: STAFF, request: RejectRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/reprocess", summary: "Request another processing attempt (safe to retry)", roles: STAFF, request: ReprocessRequest, response: ItemSummarySchema },
  { method: "delete", path: "/api/items/{id}", summary: "Mark an item Deleted", roles: STAFF, response: ItemSummarySchema },
  { method: "get", path: "/api/views", summary: "Saved views", roles: ALL_ROLES, response: z.array(SavedViewSchema) },
  { method: "post", path: "/api/views", summary: "Save a view", roles: ALL_ROLES, request: CreateSavedViewRequest, response: SavedViewSchema },
  { method: "delete", path: "/api/views/{id}", summary: "Delete a saved view", roles: ALL_ROLES },
  { method: "get", path: "/api/settings", summary: "Tenant settings (visible to all users)", roles: ALL_ROLES, response: TenantSettingsSchema },
  { method: "patch", path: "/api/settings", summary: "Update tenant settings", roles: ADMIN, request: UpdateSettingsRequest, response: TenantSettingsSchema },
  { method: "get", path: "/api/users", summary: "Users in this tenant", roles: STAFF, response: z.array(UserSchema) },
  { method: "post", path: "/api/users", summary: "Create a user (analysts: analyst/client only)", roles: STAFF, request: CreateUserRequest, response: UserSchema },
  { method: "patch", path: "/api/users/{id}", summary: "Change role or deactivate (admin only)", roles: ADMIN, request: UpdateUserRequest, response: UserSchema },
  { method: "post", path: "/api/users/{id}/sessions/revoke", summary: "End a user's active sessions", roles: ADMIN },
  { method: "get", path: "/api/audit", summary: "Tamper-evident audit log", roles: ADMIN, query: ["before", "limit"], response: z.array(AuditEventSchema) },
  { method: "get", path: "/api/audit/verify", summary: "Verify the audit hash chain", roles: ADMIN },
  { method: "get", path: "/api/incidents", summary: "Quarantine incidents (category and time only)", roles: ADMIN, response: z.array(IncidentSchema) },
  { method: "post", path: "/api/incidents/{id}/resolve", summary: "Mark an incident resolved", roles: ADMIN },
  { method: "get", path: "/api/metrics/quality", summary: "Extraction quality: completion, corrections, evidence coverage", roles: STAFF, response: QualityMetricsSchema },
];

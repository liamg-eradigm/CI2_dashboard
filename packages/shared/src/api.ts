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
import { COLUMN_TYPES, CREATABLE_COLUMN_TYPES, MAX_LABEL_LENGTH, MAX_OPTION_LENGTH, STREAMS } from "./schema.js";
import { EXPORT_FORMATS } from "./export.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const isoDateTime = z.string();
export const FieldValueSchema = z.union([z.string(), z.array(z.string()), z.null()]);
export const ItemValuesSchema = z.record(z.string(), FieldValueSchema);
/** Primary or Secondary stream (Source → Inbox → Tracker → Phantoms). Added in contract 1.4. */
export const StreamSchema = z.enum(STREAMS);

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
  /** A column of the Tracker table. Added in contract 1.4. */
  inTracker: z.boolean().default(true),
  /** Order in the Tracker table; Phantoms table membership and order. Added in contract 1.6. */
  trackerPosition: z.number().int().default(0),
  inPhantoms: z.boolean().default(false),
  phantomsPosition: z.number().int().default(0),
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
  .object({
    label: z.string().min(1).max(MAX_LABEL_LENGTH).optional(),
    required: z.boolean().optional(),
    /** Add the column to (true, at the end) or remove it from (false) the Tracker / Phantoms table. */
    inTracker: z.boolean().optional(),
    inPhantoms: z.boolean().optional(),
  })
  .refine((v) => v.label !== undefined || v.required !== undefined || v.inTracker !== undefined || v.inPhantoms !== undefined, "Nothing to update");
/** Optional reason recorded in the audit log when an item or tracker entry is deleted. */
export const DeleteItemRequest = z.object({
  reason: z.string().max(500).optional(),
  /**
   * Tracker entries only: remove it from the Tracker (it stays in Phantoms),
   * from Phantoms (it stays in the Tracker), or everywhere ("global", the
   * default). An entry left in neither table is deleted globally.
   */
  from: z.enum(["tracker", "phantoms", "global"]).optional(),
});
export type DeleteItemRequest = z.infer<typeof DeleteItemRequest>;
/** The full new column order: every current column key exactly once. */
export const ReorderColumnsRequest = z.object({
  keys: z.array(z.string().min(1).max(64)).min(1).max(200),
  /** Which table to reorder: the Inbox (default, every column) or the Tracker / Phantoms table (its columns only). */
  table: z.enum(["inbox", "tracker", "phantoms"]).default("inbox"),
});
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
/** The full new order of a column's options (for Subtrend: of one macrotrend's subtrends, named by `parent`). */
export const ReorderOptionsRequest = z.object({
  values: z.array(z.string().min(1).max(MAX_OPTION_LENGTH)).min(1).max(500),
  parent: z.string().min(1).max(MAX_OPTION_LENGTH).optional(),
});

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
  /** Microsoft sign-in status: linked to a Microsoft account, invite link pending, or neither. Added in contract 1.2. */
  signIn: z.enum(["linked", "invited", "not_invited"]).default("not_invited"),
});
/** One-time invite / sign-in link (shown once to the person who created it). */
export const InviteSchema = z.object({ url: z.string(), expiresAt: isoDateTime });
export const UserWithInviteSchema = UserSchema.extend({ invite: InviteSchema });
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
  stream: StreamSchema.default("primary"),
  status: z.enum(ITEM_STATUSES),
  /** "manual": a blank entry created from the Input page, with no source file. */
  inputType: z.enum(["url", "file", "manual"]),
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
  /** Signal code of an entry ALREADY IN THE TRACKER that this item duplicates (only approved entries count). */
  duplicateOf: z.string().nullable(),
  duplicateItemId: z.string().nullable(),
  duplicateBasis: z.enum(["url", "file", "content"]).nullable(),
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
export const ApproveRequest = z.object({
  values: ItemValuesSchema,
  version: z.number().int(),
  note: z.string().max(500).optional(),
  /** Publish even though the same source is already in the tracker (the API refuses with DUPLICATE otherwise). */
  overrideDuplicate: z.boolean().optional(),
});
export const RejectRequest = z.object({ reason: z.string().max(500).optional(), version: z.number().int() });
export const ReprocessRequest = z.object({ version: z.number().int().optional() });
export const ReviseRequest = z.object({ values: ItemValuesSchema, note: z.string().min(1).max(500) });
export const CreateSubmissionRequest = z.object({ url: z.string().min(1).max(2048), stream: StreamSchema.default("primary") });
/** A blank Inbox entry, typed in by an analyst in its entirety (no source file). */
export const CreateManualRequest = z.object({ stream: StreamSchema.default("primary") });
/** Deliverables → Newsletter: build a newsletter from selected Newsletter entries (High / Medium impact Phantoms). */
export const MAX_NEWSLETTER_NAME = 120;
export const CreateNewsletterRequest = z.object({
  name: z.string().trim().min(1, "Name the newsletter").max(MAX_NEWSLETTER_NAME),
  itemIds: z.array(z.string().min(1).max(64)).min(1, "Select at least one entry").max(200),
});
export const NewsletterSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: isoDateTime,
  createdBy: z.string(),
  /** The Phantoms it was built from, in the order they were used (deleted ones stay listed). */
  items: z.array(z.object({ id: z.string(), code: z.string().nullable(), recordId: z.string().nullable(), title: z.string(), stream: StreamSchema, deleted: z.boolean() })),
});
export type Newsletter = z.infer<typeof NewsletterSchema>;

/** One-off spreadsheet import into a tracker: rows keyed by the tracker's column labels, already parsed by the dashboard. */
export const IMPORT_CHUNK_ROWS = 8;
export const ImportRequest = z.object({
  fileName: z.string().min(1).max(255),
  rows: z
    .array(z.object({ row: z.number().int().min(1), values: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])) }))
    .min(1)
    .max(200),
  /** Only check the rows (types, taxonomy, required fields, unique IDs); nothing is written. */
  dryRun: z.boolean().optional(),
});
export const ImportResponse = z.object({
  ok: z.boolean(),
  imported: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), column: z.string().nullable(), message: z.string() })),
  codes: z.array(z.string()),
});
export const CreateSubmissionResponse = z.object({ item: ItemSummarySchema, duplicate: z.boolean() });

// ---------------------------------------------------------------------------
// Tracker / dashboard
// ---------------------------------------------------------------------------

export const SignalSchema = z.object({
  id: z.string(),
  code: z.string(),
  stream: StreamSchema.default("primary"),
  values: ItemValuesSchema,
  text: z.string(),
  url: z.string().nullable(),
  rev: z.number().int(),
  approvedAt: isoDateTime,
  approvedBy: z.string(),
  /** A saved copy of the source page exists (else it can be attached from the Tracker). Added in contract 1.5. */
  hasSnapshot: z.boolean().default(false),
  /** Deliverables → Alerts rows only: the stored .docx alert. Added in contract 1.7. */
  alertId: z.string().nullable().optional(),
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

/**
 * Entries that match every filter except the dates (so the date range hides
 * them), and the Event Date span of all matching entries, for "Show all dates".
 * Added in contract 1.8.
 */
export const OutsideDatesSchema = z.object({ count: z.number().int(), from: z.string().nullable(), to: z.string().nullable() });
export type OutsideDates = z.infer<typeof OutsideDatesSchema>;

export const TrackerPageSchema = z.object({
  rows: z.array(SignalSchema),
  total: z.number().int(),
  totalPublished: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  outsideDates: OutsideDatesSchema.optional(),
});

const Bar = z.object({ label: z.string(), n: z.number().int(), high: z.number().int(), medium: z.number().int(), low: z.number().int() });

export const DashboardSchema = z.object({
  outsideDates: OutsideDatesSchema.optional(),
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
  /** Which Secondary Tracker entries also appear in Phantoms (Primary entries always do). Added in contract 1.4. */
  phantoms: z.object({ secondaryMinImpact: z.string().min(1).max(MAX_OPTION_LENGTH) }).default({ secondaryMinImpact: "Low" }),
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
  stream: StreamSchema.nullable().default(null),
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
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type Me = z.infer<typeof MeSchema>;
export type Invite = z.infer<typeof InviteSchema>;
export type UserWithInvite = z.infer<typeof UserWithInviteSchema>;
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
  method: "get" | "post" | "put" | "patch" | "delete";
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
  { method: "get", path: "/api/auth/login", summary: "Start Sign in with Microsoft (redirect to Entra ID; optional invite token)", roles: [], query: ["returnTo", "invite"] },
  { method: "get", path: "/api/auth/callback", summary: "Microsoft redirect target: validates the ID token and creates the session", roles: [], query: ["code", "state"] },
  { method: "post", path: "/api/auth/logout", summary: "End the session; returns Microsoft's sign-out URL", roles: [] },
  { method: "get", path: "/api/auth/signed-out", summary: "Post-sign-out / front-channel logout landing", roles: [] },
  { method: "get", path: "/api/auth/invite/{token}", summary: "Whether an invite link is valid, and for whom", roles: [] },
  { method: "get", path: "/api/me", summary: "Current user, tenant, role and permissions", roles: ALL_ROLES, response: MeSchema },
  { method: "post", path: "/api/me/sessions/revoke", summary: "End all of my active sessions", roles: ALL_ROLES },
  { method: "get", path: "/api/schema", summary: "Tracker columns and taxonomy", roles: ALL_ROLES, response: TrackerSchemaSchema },
  { method: "post", path: "/api/schema/columns", summary: "Add a column", roles: STAFF, request: AddColumnRequest, response: TrackerSchemaSchema },
  { method: "patch", path: "/api/schema/columns/{key}", summary: "Rename a column or toggle Required", roles: STAFF, request: UpdateColumnRequest, response: TrackerSchemaSchema },
  { method: "delete", path: "/api/schema/columns/{key}", summary: "Delete a non-core column", roles: STAFF, response: TrackerSchemaSchema },
  { method: "post", path: "/api/import", summary: "Import approved entries into a tracker (query: stream). At most 200 rows per request for a dry run, 8 otherwise", roles: STAFF, request: ImportRequest, response: ImportResponse },
  { method: "post", path: "/api/items/{id}/snapshot", summary: "Attach the saved HTML page to a tracker entry that has none (multipart: file)", roles: STAFF, response: z.object({ id: z.string(), hasSnapshot: z.boolean() }) },
  { method: "get", path: "/api/phantoms", summary: "Phantoms table (query: stream, filters, sort, page): every Primary entry, and Secondary entries at or above the admin-set Impact", roles: ALL_ROLES, response: TrackerPageSchema },
  { method: "get", path: "/api/deliverables/alerts", summary: "Deliverables → Alerts: Phantoms with the highest Impact (High), each with its stored .docx alert (generated automatically)", roles: ALL_ROLES, response: TrackerPageSchema },
  { method: "get", path: "/api/deliverables/newsletter", summary: "Deliverables → Newsletter: Phantoms with High or Medium Impact, to build newsletters from", roles: ALL_ROLES, response: TrackerPageSchema },
  { method: "get", path: "/api/newsletters", summary: "Newsletters created so far, newest first", roles: ALL_ROLES, response: z.array(NewsletterSchema) },
  { method: "post", path: "/api/newsletters", summary: "Create a newsletter (.docx) from selected Newsletter entries", roles: STAFF, request: CreateNewsletterRequest, response: NewsletterSchema },
  { method: "get", path: "/api/deliverables/{id}/docx", summary: "A stored alert or newsletter .docx (inline for the viewer, ?download=1 as a file)", roles: ALL_ROLES },
  { method: "get", path: "/api/signals/{id}/markdown", summary: "Markdown for a tracker entry (text/markdown; ?download=1 for an attachment)", roles: ALL_ROLES, raw: "text/markdown" },
  { method: "put", path: "/api/schema/columns/order", summary: "Change the column order of the Inbox, Tracker or Phantoms table", roles: STAFF, request: ReorderColumnsRequest, response: TrackerSchemaSchema },
  { method: "post", path: "/api/schema/columns/{key}/options", summary: "Add a dropdown option", roles: STAFF, request: AddOptionRequest, response: TrackerSchemaSchema },
  { method: "patch", path: "/api/schema/columns/{key}/options", summary: "Rename an option (propagates to signals, drafts and filters)", roles: STAFF, request: RenameOptionRequest, response: TrackerSchemaSchema },
  { method: "put", path: "/api/schema/columns/{key}/options/order", summary: "Change the order of a column's dropdown options (or of one macrotrend's subtrends)", roles: STAFF, request: ReorderOptionsRequest, response: TrackerSchemaSchema },
  { method: "delete", path: "/api/schema/columns/{key}/options", summary: "Delete an unused option", roles: STAFF, request: DeleteOptionRequest, response: TrackerSchemaSchema },
  { method: "get", path: "/api/tracker", summary: "Server-side filtered, sorted, paginated approved signals", roles: ALL_ROLES, query: ["q", "from", "to", "f.<column>", "sort", "dir", "page", "pageSize"], response: TrackerPageSchema },
  { method: "get", path: "/api/tracker/export", summary: "Export approved signals (audited)", roles: ALL_ROLES, query: ["scope", "format", "q", "from", "to", "f.<column>", "sort", "dir"], raw: `One of ${EXPORT_FORMATS.join(", ")}` },
  { method: "get", path: "/api/signals/{id}", summary: "Approved signal detail with provenance and history", roles: ALL_ROLES, response: SignalDetailSchema },
  { method: "post", path: "/api/signals/{id}/revise", summary: "Publish a new revision of an approved signal", roles: STAFF, request: ReviseRequest, response: SignalDetailSchema },
  { method: "get", path: "/api/dashboard", summary: "KPIs, timeline and chart aggregates for the shared filter state", roles: ALL_ROLES, query: ["q", "from", "to", "f.<column>"], response: DashboardSchema },
  { method: "post", path: "/api/trend-test", summary: "Evaluate the Trend Test", roles: ALL_ROLES, request: TrendConfigSchema, response: TrendResultSchema },
  { method: "post", path: "/api/submissions", summary: "Submit a URL (JSON) or HTML file (multipart). Idempotent on URL/content and Idempotency-Key.", roles: STAFF, request: CreateSubmissionRequest, response: CreateSubmissionResponse, multipart: true },
  { method: "post", path: "/api/submissions/manual", summary: "Send a blank entry to a stream's Inbox for an analyst to fill in (no source file). Idempotent on Idempotency-Key.", roles: STAFF, request: CreateManualRequest, response: CreateSubmissionResponse },
  { method: "get", path: "/api/capture-log", summary: "Final resolved URL and retrieval outcome for every submission", roles: STAFF, response: z.array(CaptureLogEntrySchema) },
  { method: "get", path: "/api/items", summary: "Inbox items", roles: STAFF, query: ["status"], response: z.array(ItemSummarySchema) },
  { method: "get", path: "/api/items/{id}", summary: "Inbox item detail", roles: STAFF, response: ItemDetailSchema },
  { method: "get", path: "/api/items/{id}/snapshot", summary: "Sanitised source snapshot (sandboxed HTML)", roles: ALL_ROLES, raw: "text/html" },
  { method: "patch", path: "/api/items/{id}/draft", summary: "Save analyst edits to a draft", roles: STAFF, request: SaveDraftRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/approve", summary: "Validate server-side and publish as a new revision", roles: STAFF, request: ApproveRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/reject", summary: "Reject a draft", roles: STAFF, request: RejectRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/reprocess", summary: "Request another processing attempt (safe to retry)", roles: STAFF, request: ReprocessRequest, response: ItemSummarySchema },
  { method: "delete", path: "/api/items/{id}", summary: "Mark an item Deleted (also removes an approved entry from the tracker)", roles: STAFF, request: DeleteItemRequest, response: ItemSummarySchema },
  { method: "get", path: "/api/views", summary: "Saved views", roles: ALL_ROLES, response: z.array(SavedViewSchema) },
  { method: "post", path: "/api/views", summary: "Save a view", roles: ALL_ROLES, request: CreateSavedViewRequest, response: SavedViewSchema },
  { method: "delete", path: "/api/views/{id}", summary: "Delete a saved view", roles: ALL_ROLES },
  { method: "get", path: "/api/settings", summary: "Tenant settings (visible to all users)", roles: ALL_ROLES, response: TenantSettingsSchema },
  { method: "patch", path: "/api/settings", summary: "Update tenant settings", roles: ADMIN, request: UpdateSettingsRequest, response: TenantSettingsSchema },
  { method: "get", path: "/api/users", summary: "Users in this tenant", roles: STAFF, response: z.array(UserSchema) },
  { method: "post", path: "/api/users", summary: "Create a user and a one-time Microsoft sign-in invite link (analysts: analyst/client only)", roles: STAFF, request: CreateUserRequest, response: UserWithInviteSchema },
  { method: "post", path: "/api/users/{id}/invite", summary: "Issue a new one-time sign-in link (also re-links a changed Microsoft account)", roles: STAFF, response: InviteSchema },
  { method: "patch", path: "/api/users/{id}", summary: "Change role or deactivate (admin only)", roles: ADMIN, request: UpdateUserRequest, response: UserSchema },
  { method: "post", path: "/api/users/{id}/sessions/revoke", summary: "End a user's active sessions", roles: ADMIN },
  { method: "get", path: "/api/audit", summary: "Tamper-evident audit log", roles: ADMIN, query: ["before", "limit"], response: z.array(AuditEventSchema) },
  { method: "get", path: "/api/audit/verify", summary: "Verify the audit hash chain", roles: ADMIN },
  { method: "get", path: "/api/incidents", summary: "Quarantine incidents (category and time only)", roles: ADMIN, response: z.array(IncidentSchema) },
  { method: "post", path: "/api/incidents/{id}/resolve", summary: "Mark an incident resolved", roles: ADMIN },
  { method: "get", path: "/api/metrics/quality", summary: "Extraction quality: completion, corrections, evidence coverage", roles: STAFF, response: QualityMetricsSchema },
];

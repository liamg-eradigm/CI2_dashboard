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
import { DEFAULT_NAV_ORDER, MAX_SUMMARY_LENGTH, NAV_TABS, SUMMARY_MODELS, SUMMARY_SOURCES, TREND_LEVELS } from "./megatrends.js";
import { TREND_ANALYSIS_CATEGORIES, TREND_ANALYSIS_SOURCES } from "./trendAnalyses.js";
import { DEFAULT_COMPETITOR_TIERS } from "./competitors.js";
import { KiqTopicsSchema } from "./kiq.js";
import { DEFAULT_MENU, MAX_MENU_LABEL, MENU_GROUPS, MENU_ITEMS } from "./menu.js";

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
    /** Switch between Text and Long text (contract 1.13): the only type change there is. */
    type: z.enum(["text", "long"]).optional(),
  })
  .refine((v) => v.label !== undefined || v.required !== undefined || v.inTracker !== undefined || v.inPhantoms !== undefined || v.type !== undefined, "Nothing to update");
/**
 * "Delete All" in the Eradigm Inbox's Pushed & Rejected view (contract 1.13):
 * rejected entries are deleted; pushed entries only leave the Inbox and stay
 * in the Tracker and Phantoms. Omit `stream` for both streams.
 */
export const ClearDecidedRequest = z.object({ stream: z.enum(STREAMS).optional() });
export type ClearDecidedRequest = z.infer<typeof ClearDecidedRequest>;
export const ClearDecidedResultSchema = z.object({ rejectedDeleted: z.number().int(), pushedCleared: z.number().int() });
export type ClearDecidedResult = z.infer<typeof ClearDecidedResultSchema>;

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
  /** Client Inbox (contract 1.12): sent to the client to check, and back from them. */
  withClient: z.boolean().default(false),
  sentToClient: z.object({ by: z.string(), at: isoDateTime }).nullable().default(null),
  returnedByClient: z.object({ by: z.string(), at: isoDateTime }).nullable().default(null),
  /** Open (unresolved) comments on the entry's text. */
  comments: z.number().int().default(0),
  /** Primary entries (contract 1.15): the Insight Topics and their Key Intelligence Questions, once entered as a list. */
  kiqs: KiqTopicsSchema.nullable().default(null),
  /** The entry this one was split from (one Tracker entry per Key Intelligence Question). */
  splitFrom: z.string().nullable().default(null),
});

/** A comment on an entry's text, anchored to a field and the highlighted words (like a Word comment). */
export const CommentSchema = z.object({
  id: z.string(),
  field: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  quote: z.string(),
  body: z.string(),
  author: z.string(),
  authorRole: z.enum(ROLES),
  mine: z.boolean(),
  at: isoDateTime,
  resolved: z.object({ by: z.string(), at: isoDateTime }).nullable(),
});
export type ItemComment = z.infer<typeof CommentSchema>;
/** The page text of an entry can be commented on too, under this field key. */
export const PAGE_TEXT_FIELD = "_text";
export const MAX_COMMENT_LENGTH = 2000;
export const CreateCommentRequest = z.object({
  field: z.string().min(1).max(80),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  quote: z.string().min(1).max(4000),
  body: z.string().trim().min(1, "Write a comment").max(MAX_COMMENT_LENGTH),
});
export const UpdateCommentRequest = z.object({ resolved: z.boolean() });
export const VersionRequest = z.object({ version: z.number().int() });

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

export const SaveDraftRequest = z.object({
  values: ItemValuesSchema,
  version: z.number().int(),
  /** Primary entries: the topics and Key Intelligence Questions (the first one also fills the entry's own fields). */
  kiqs: KiqTopicsSchema.optional(),
});
/**
 * Before Push to Tracker (contract 1.15): a Primary entry with several Key
 * Intelligence Questions becomes one Inbox entry per question (this one keeps
 * the first; the others are new, sharing every other field and the saved page).
 */
export const SplitRequest = z.object({ version: z.number().int(), kiqs: KiqTopicsSchema });
export const ApproveRequest = z.object({
  values: ItemValuesSchema,
  version: z.number().int(),
  note: z.string().max(500).optional(),
  /** Publish even though the same source is already in the tracker (the API refuses with DUPLICATE otherwise). */
  overrideDuplicate: z.boolean().optional(),
});
export const RejectRequest = z.object({ reason: z.string().max(500).optional(), version: z.number().int() });
export const ReprocessRequest = z.object({ version: z.number().int().optional() });
/** Edit an approved entry and approve it again (the note is optional since contract 1.9). */
export const ReviseRequest = z.object({ values: ItemValuesSchema, note: z.string().max(500).optional() });
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

/** Megatrends (contract 1.10): a Macrotrend / Subtrend summary. */
export const TrendSummarySchema = z.object({
  text: z.string(),
  source: z.enum(SUMMARY_SOURCES),
  updatedAt: isoDateTime.nullable(),
  updatedBy: z.string().nullable(),
  /** AI summaries: the model, the time frame (days) and how many entries it was written from. */
  model: z.string().nullable(),
  windowDays: z.number().int().nullable(),
  entries: z.number().int().nullable(),
});
export const MegatrendNodeSchema = z.object({ name: z.string(), count: z.number().int(), summary: TrendSummarySchema.nullable() });
export const MegatrendEntrySchema = z.object({
  id: z.string(),
  code: z.string(),
  recordId: z.string().nullable(),
  stream: StreamSchema,
  date: isoDate,
  title: z.string(),
  macrotrend: z.string(),
  subtrend: z.string().nullable(),
  impact: z.string().nullable(),
});
export const MegatrendsSchema = z.object({
  /** "all" = both trackers. */
  stream: z.enum(["all", ...STREAMS]),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  /** Whether summaries can be generated by the AI writer (LLM_PROVIDER set). */
  aiConnected: z.boolean(),
  /** Every Macrotrend of the taxonomy in order, with its Subtrends; count = Tracker entries (the dashboard hides zero counts). */
  macrotrends: z.array(MegatrendNodeSchema.extend({ subtrends: z.array(MegatrendNodeSchema) })),
  /** The entries, oldest first (the timeline). */
  entries: z.array(MegatrendEntrySchema),
  /** True when more entries matched than were returned. */
  truncated: z.boolean(),
});
export const UpdateTrendSummaryRequest = z.object({
  level: z.enum(TREND_LEVELS),
  name: z.string().min(1).max(MAX_OPTION_LENGTH),
  /** The Subtrend's Macrotrend (informational). */
  parent: z.string().max(MAX_OPTION_LENGTH).optional(),
  text: z.string().trim().max(MAX_SUMMARY_LENGTH),
});
export const GenerateTrendSummaryRequest = z.object({
  level: z.enum(TREND_LEVELS),
  name: z.string().min(1).max(MAX_OPTION_LENGTH),
  parent: z.string().max(MAX_OPTION_LENGTH).optional(),
});
export type TrendSummary = z.infer<typeof TrendSummarySchema>;

/** Trend Analyses (contract 1.18): an analysis submitted on the Input page, kept in the Trend Analyses tracker. */
export const TrendAnalysisSchema = z.object({
  id: z.string(),
  category: z.enum(TREND_ANALYSIS_CATEGORIES),
  level: z.enum(TREND_LEVELS),
  name: z.string(),
  /** A Subtrend's Macrotrend. */
  parent: z.string().nullable(),
  text: z.string(),
  submittedAt: isoDateTime,
  submittedBy: z.string(),
  source: z.enum(TREND_ANALYSIS_SOURCES),
  /** The spreadsheet it was imported from. */
  fileName: z.string().nullable(),
});
export const CreateTrendAnalysisRequest = z.object({
  level: z.enum(TREND_LEVELS),
  name: z.string().trim().min(1).max(MAX_OPTION_LENGTH),
  /** A Subtrend's Macrotrend (worked out by the API when left out). */
  parent: z.string().trim().max(MAX_OPTION_LENGTH).optional(),
  text: z.string().trim().min(1, "Write the trend analysis").max(MAX_SUMMARY_LENGTH),
});
/** Rows keyed by the four column names (TREND_ANALYSIS_COLUMNS), already parsed by the dashboard. */
export const ImportTrendAnalysesRequest = z.object({
  fileName: z.string().min(1).max(255),
  rows: z
    .array(z.object({ row: z.number().int().min(1), values: z.record(z.string(), z.string()) }))
    .min(1)
    .max(200),
  /** Only check the rows; nothing is written. At most IMPORT_CHUNK_ROWS rows otherwise. */
  dryRun: z.boolean().optional(),
});
export const ImportTrendAnalysesResponse = z.object({
  ok: z.boolean(),
  imported: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), column: z.string().nullable(), message: z.string() })),
});
export type TrendAnalysis = z.infer<typeof TrendAnalysisSchema>;
export type MegatrendNode = z.infer<typeof MegatrendNodeSchema>;
export type MegatrendEntry = z.infer<typeof MegatrendEntrySchema>;
export type Megatrends = z.infer<typeof MegatrendsSchema>;

/** Competitors (contract 1.14): Tracker entries per competitor named, how often competitors appear together, and the entries. */
export const CompetitorEntrySchema = MegatrendEntrySchema.extend({ competitors: z.array(z.string()) });
export const CompetitorsSchema = z.object({
  aiConnected: z.boolean(),
  /** Competitors named by at least one Tracker entry, most-named first, with their tier (1–4, contract 1.15). */
  competitors: z.array(MegatrendNodeSchema.extend({ tier: z.number().int().min(1).max(4).default(4) })),
  /** Pairs of competitors named by the same entries (a < b), with how many. */
  pairs: z.array(z.object({ a: z.string(), b: z.string(), count: z.number().int() })),
  /** The entries naming a competitor, oldest first (the timeline). */
  entries: z.array(CompetitorEntrySchema),
  truncated: z.boolean(),
});
export type CompetitorEntry = z.infer<typeof CompetitorEntrySchema>;
export type Competitors = z.infer<typeof CompetitorsSchema>;

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
  /** Saved HTML pages of the entry (1 = just its first page; more → a list to pick from). Added in contract 1.11. */
  pages: z.number().int().default(0),
  /** Deliverables → Alerts rows only: the stored .docx alert. Added in contract 1.7. */
  alertId: z.string().nullable().optional(),
  /**
   * Primary entries from the same source (Source Role + Source Company): the
   * entry just before this one and just after it, by Event Date (ids). Added
   * in contract 1.16.
   */
  linkedEarlier: z.string().nullable().optional(),
  linkedLater: z.string().nullable().optional(),
});

/** An approved Primary entry with a source (Source Role + Source Company), for "prior primary information" while entering one. Contract 1.16. */
export const PrimarySourceSchema = z.object({
  /** primarySourceKey(role, company) */
  key: z.string(),
  id: z.string(),
  code: z.string(),
  recordId: z.string().nullable(),
  title: z.string(),
  date: z.string().nullable(),
});
export type PrimarySource = z.infer<typeof PrimarySourceSchema>;

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
/** Saved HTML pages per Tracker entry (contract 1.11). */
export const MAX_SAVED_PAGES = 10;
export const SavedPageSchema = z.object({ id: z.string(), name: z.string(), first: z.boolean(), bytes: z.number().int(), savedAt: isoDateTime });
export type SavedPage = z.infer<typeof SavedPageSchema>;
/** Tracker / Phantoms "Display all": at most this many rows on one page. */
export const TABLE_ALL_MAX = 1000;
/** Event Dates of the oldest and newest Tracker entries: the default date filter (contract 1.11). */
export const DateBoundsSchema = z.object({ oldest: isoDate.nullable(), newest: isoDate.nullable() });
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
  /** The order of the tabs in the menu (added in contract 1.10). Each tab once; tabs a role cannot use stay hidden. */
  navOrder: z
    .array(z.enum(NAV_TABS))
    .max(NAV_TABS.length)
    .refine((a) => new Set(a).size === a.length, "Each tab can appear only once")
    .default([...DEFAULT_NAV_ORDER]),
  /**
   * The menu (contract 1.17): groups (Trackers, Megatrends, Competitors,
   * Inputs, Admin) in order, each with its subtabs in order, and any names an
   * admin gave them. Made whole when read (normaliseMenu). navOrder above is
   * kept for older dashboards.
   */
  menu: z
    .object({
      groups: z
        .array(
          z.object({
            key: z.enum(MENU_GROUPS),
            label: z.string().max(MAX_MENU_LABEL * 2).optional(),
            items: z.array(z.object({ key: z.enum(MENU_ITEMS), label: z.string().max(MAX_MENU_LABEL * 2).optional() })).max(MENU_ITEMS.length),
          }),
        )
        .max(MENU_GROUPS.length),
    })
    .default(structuredClone(DEFAULT_MENU)),
  /** Competitor tiers on the Competitors tab (contract 1.15); any competitor not listed is Tier 4. */
  competitorTiers: z
    .object({
      tier1: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).max(300),
      tier2: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).max(300),
      tier3: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).max(300),
    })
    .default({ tier1: [...DEFAULT_COMPETITOR_TIERS.tier1], tier2: [...DEFAULT_COMPETITOR_TIERS.tier2], tier3: [...DEFAULT_COMPETITOR_TIERS.tier3] }),
  /** How the AI writer summarises each Macrotrend and Subtrend (added in contract 1.10). */
  megatrends: z
    .object({
      /** Entries from the last N days (by Event Date) are summarised. */
      summaryDays: z.number().int().min(7).max(1095),
      /** At most this many sentences per summary. */
      summarySentences: z.number().int().min(1).max(6),
      model: z.enum(SUMMARY_MODELS.map((m) => m.id) as [string, ...string[]]),
      /** The company the summaries are written for ("For AbbVie, …"). */
      perspective: z.string().trim().max(80),
    })
    .default({ summaryDays: 90, summarySentences: 2, model: "claude-opus-5-5", perspective: "AbbVie" }),
});
export const UpdateSettingsRequest = TenantSettingsSchema.partial().extend({
  navOrder: TenantSettingsSchema.shape.navOrder.unwrap().optional(),
  menu: TenantSettingsSchema.shape.menu.unwrap().optional(),
  megatrends: TenantSettingsSchema.shape.megatrends.unwrap().partial().optional(),
});

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
const CLIENT_INBOX = ["admin", "client"] as const;

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
  { method: "patch", path: "/api/schema/columns/{key}", summary: "Rename a column, toggle Required or the Tracker/Phantoms tables, or switch Text ⇄ Long text", roles: STAFF, request: UpdateColumnRequest, response: TrackerSchemaSchema },
  { method: "delete", path: "/api/schema/columns/{key}", summary: "Delete a non-core column", roles: STAFF, response: TrackerSchemaSchema },
  { method: "post", path: "/api/import", summary: "Import approved entries into a tracker (query: stream). At most 200 rows per request for a dry run, 8 otherwise", roles: STAFF, request: ImportRequest, response: ImportResponse },
  { method: "post", path: "/api/items/{id}/snapshot", summary: `Attach a saved HTML page to a tracker entry (multipart: file). The first becomes the entry's page; later ones are added to its list (at most ${MAX_SAVED_PAGES})`, roles: STAFF, response: z.object({ id: z.string(), hasSnapshot: z.boolean(), pages: z.number().int() }) },
  { method: "post", path: "/api/items/clear-decided", summary: "Eradigm Inbox \"Delete All\" in Pushed & Rejected: delete rejected entries; pushed entries leave the Inbox but stay in the Tracker and Phantoms", roles: STAFF, request: ClearDecidedRequest, response: ClearDecidedResultSchema },
  { method: "post", path: "/api/items/{id}/send-to-client", summary: "Eradigm Inbox: send an entry awaiting review to the Client Inbox", roles: STAFF, request: VersionRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/recall", summary: "Eradigm Inbox: take an entry back from the Client Inbox", roles: STAFF, request: VersionRequest, response: ItemSummarySchema },
  { method: "get", path: "/api/client-inbox", summary: "Client Inbox: entries Eradigm sent to the client to check", roles: CLIENT_INBOX, response: z.array(ItemSummarySchema) },
  { method: "get", path: "/api/client-inbox/count", summary: "How many entries are in the Client Inbox", roles: CLIENT_INBOX, response: z.object({ count: z.number().int() }) },
  { method: "get", path: "/api/client-inbox/{id}", summary: "An entry in the Client Inbox, with its page text", roles: CLIENT_INBOX, response: ItemDetailSchema },
  { method: "post", path: "/api/client-inbox/{id}/send-to-eradigm", summary: "Client Inbox: send the entry back to the Eradigm Inbox (comments are kept)", roles: CLIENT_INBOX, request: VersionRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/client-inbox/{id}/push", summary: "Client Inbox: push the entry to the Tracker as it stands (validated like Push to Tracker)", roles: CLIENT_INBOX, request: VersionRequest, response: ItemSummarySchema },
  { method: "get", path: "/api/items/{id}/comments", summary: "Comments on an entry's text (Eradigm; the client while it is in their inbox)", roles: ALL_ROLES, response: z.array(CommentSchema) },
  { method: "post", path: "/api/items/{id}/comments", summary: "Comment on highlighted text of a field (or of the page text, field _text)", roles: ALL_ROLES, request: CreateCommentRequest, response: z.array(CommentSchema) },
  { method: "patch", path: "/api/items/{id}/comments/{cid}", summary: "Resolve or reopen a comment (Eradigm)", roles: STAFF, request: UpdateCommentRequest, response: z.array(CommentSchema) },
  { method: "delete", path: "/api/items/{id}/comments/{cid}", summary: "Delete a comment (its author, or an admin)", roles: ALL_ROLES, response: z.array(CommentSchema) },
  { method: "get", path: "/api/items/{id}/snapshots", summary: "The saved HTML pages of an entry, first page first", roles: ALL_ROLES, response: z.array(SavedPageSchema) },
  { method: "get", path: "/api/primary-sources", summary: "Approved Primary entries with a Source Role and Source Company (newest first), to flag “This Source Has Prior Primary Information” while one is entered", roles: ALL_ROLES, response: z.array(PrimarySourceSchema) },
  { method: "get", path: "/api/phantoms", summary: "Phantoms table (query: stream, filters, sort, page): every Primary entry, and Secondary entries at or above the admin-set Impact", roles: ALL_ROLES, response: TrackerPageSchema },
  { method: "get", path: "/api/deliverables/alerts", summary: "Deliverables → Alerts: Phantoms with the highest Impact (High), each with its stored .docx alert (generated automatically)", roles: ALL_ROLES, response: TrackerPageSchema },
  { method: "get", path: "/api/deliverables/newsletter", summary: "Deliverables → Newsletter: Phantoms with High or Medium Impact, to build newsletters from", roles: ALL_ROLES, response: TrackerPageSchema },
  { method: "get", path: "/api/newsletters", summary: "Newsletters created so far, newest first", roles: ALL_ROLES, response: z.array(NewsletterSchema) },
  { method: "post", path: "/api/newsletters", summary: "Create a newsletter (.docx) from selected Newsletter entries", roles: STAFF, request: CreateNewsletterRequest, response: NewsletterSchema },
  { method: "get", path: "/api/deliverables/{id}/docx", summary: "A stored alert or newsletter .docx (inline for the viewer, ?download=1 as a file)", roles: ALL_ROLES },
  { method: "get", path: "/api/megatrends", summary: "Megatrends: Tracker entries per Macrotrend and Subtrend (query: stream all|primary|secondary, from, to), their summaries, and the entries for the timeline", roles: ALL_ROLES, query: ["stream", "from", "to"], response: MegatrendsSchema },
  { method: "get", path: "/api/competitors", summary: "Competitors: Tracker entries per competitor named, co-occurring competitors, their summaries and the entries for the timeline (query: stream all|primary|secondary)", roles: ALL_ROLES, query: ["stream"], response: CompetitorsSchema },
  { method: "put", path: "/api/megatrends/summaries", summary: "Write a Macrotrend, Subtrend or competitor summary by hand (empty text = back to the default)", roles: STAFF, request: UpdateTrendSummaryRequest, response: TrendSummarySchema },
  { method: "post", path: "/api/megatrends/summaries/generate", summary: "Write a Macrotrend, Subtrend or competitor summary with the AI writer from its entries (competitors: high-impact and recent first; 409 while the AI is not connected)", roles: STAFF, request: GenerateTrendSummaryRequest, response: TrendSummarySchema },
  { method: "get", path: "/api/trend-analyses", summary: "Trend Analyses: every trend analysis submitted, newest first", roles: ALL_ROLES, response: z.array(TrendAnalysisSchema) },
  { method: "post", path: "/api/trend-analyses", summary: "Submit a trend analysis: it becomes the analysis of that Macrotrend, Subtrend or competitor (Trend analysis subtab and knowledge graph) and is kept in Trend Analyses", roles: STAFF, request: CreateTrendAnalysisRequest, response: TrendAnalysisSchema },
  { method: "post", path: "/api/trend-analyses/import", summary: "Import trend analyses from a spreadsheet (columns: Macrotrend or Competitor; Competitor, Macrotrend, or Subtrend; Name; Trend analysis). At most 200 rows for a dry run, 8 otherwise", roles: STAFF, request: ImportTrendAnalysesRequest, response: ImportTrendAnalysesResponse },
  { method: "get", path: "/api/trend-analyses/{id}/markdown", summary: "A submitted trend analysis as Markdown (inline, or ?download=1 as a file)", roles: ALL_ROLES, raw: "text/markdown" },
  { method: "delete", path: "/api/trend-analyses/{id}", summary: "Remove a submission from Trend Analyses (the trend keeps its current analysis)", roles: STAFF, response: z.object({ ok: z.literal(true) }) },
  { method: "get", path: "/api/signals/{id}/markdown", summary: "Markdown for a tracker entry (text/markdown; ?download=1 for an attachment)", roles: ALL_ROLES, raw: "text/markdown" },
  { method: "put", path: "/api/schema/columns/order", summary: "Change the column order of the Inbox, Tracker or Phantoms table", roles: STAFF, request: ReorderColumnsRequest, response: TrackerSchemaSchema },
  { method: "post", path: "/api/schema/columns/{key}/options", summary: "Add a dropdown option", roles: STAFF, request: AddOptionRequest, response: TrackerSchemaSchema },
  { method: "patch", path: "/api/schema/columns/{key}/options", summary: "Rename an option (propagates to signals, drafts and filters)", roles: STAFF, request: RenameOptionRequest, response: TrackerSchemaSchema },
  { method: "put", path: "/api/schema/columns/{key}/options/order", summary: "Change the order of a column's dropdown options (or of one macrotrend's subtrends)", roles: STAFF, request: ReorderOptionsRequest, response: TrackerSchemaSchema },
  { method: "delete", path: "/api/schema/columns/{key}/options", summary: "Delete an unused option", roles: STAFF, request: DeleteOptionRequest, response: TrackerSchemaSchema },
  { method: "get", path: "/api/tracker/bounds", summary: "Event Dates of the oldest and newest Tracker entries (the default date filter: everything in view)", roles: ALL_ROLES, response: DateBoundsSchema },
  { method: "get", path: "/api/tracker", summary: "Server-side filtered, sorted, paginated approved signals", roles: ALL_ROLES, query: ["q", "from", "to", "f.<column>", "sort", "dir", "page", "pageSize"], response: TrackerPageSchema },
  { method: "get", path: "/api/tracker/export", summary: "Export approved signals (audited)", roles: ALL_ROLES, query: ["scope", "format", "q", "from", "to", "f.<column>", "sort", "dir"], raw: `One of ${EXPORT_FORMATS.join(", ")}` },
  { method: "get", path: "/api/signals/{id}", summary: "Approved signal detail with provenance and history", roles: ALL_ROLES, response: SignalDetailSchema },
  { method: "post", path: "/api/signals/{id}/revise", summary: "Edit an approved entry and approve it again: validated like an approval, published as a new revision (Tracker, Phantoms, Markdown, Dashboard and alerts follow)", roles: STAFF, request: ReviseRequest, response: SignalDetailSchema },
  { method: "get", path: "/api/dashboard", summary: "KPIs, timeline and chart aggregates for the shared filter state", roles: ALL_ROLES, query: ["q", "from", "to", "f.<column>"], response: DashboardSchema },
  { method: "post", path: "/api/trend-test", summary: "Evaluate the Trend Test", roles: ALL_ROLES, request: TrendConfigSchema, response: TrendResultSchema },
  { method: "post", path: "/api/submissions", summary: "Submit a URL (JSON) or HTML file (multipart). Idempotent on URL/content and Idempotency-Key.", roles: STAFF, request: CreateSubmissionRequest, response: CreateSubmissionResponse, multipart: true },
  { method: "post", path: "/api/submissions/manual", summary: "Send a blank entry to a stream's Inbox for an analyst to fill in (no source file). Idempotent on Idempotency-Key.", roles: STAFF, request: CreateManualRequest, response: CreateSubmissionResponse },
  { method: "get", path: "/api/capture-log", summary: "Final resolved URL and retrieval outcome for every submission", roles: STAFF, response: z.array(CaptureLogEntrySchema) },
  { method: "get", path: "/api/items", summary: "Inbox items", roles: STAFF, query: ["status"], response: z.array(ItemSummarySchema) },
  { method: "get", path: "/api/items/{id}", summary: "Inbox item detail", roles: STAFF, response: ItemDetailSchema },
  { method: "get", path: "/api/items/{id}/snapshot", summary: "Sanitised source snapshot (sandboxed HTML)", roles: ALL_ROLES, raw: "text/html" },
  { method: "patch", path: "/api/items/{id}/draft", summary: "Save analyst edits to a draft", roles: STAFF, request: SaveDraftRequest, response: ItemSummarySchema },
  { method: "post", path: "/api/items/{id}/split", summary: "Primary entries: one Inbox entry per Key Intelligence Question, before Push to Tracker (staff; clients for entries in their inbox)", roles: ALL_ROLES, request: SplitRequest, response: z.array(ItemSummarySchema) },
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

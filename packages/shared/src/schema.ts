/**
 * Tracker structure (3_Frontend_Design, "Tracker Structure").
 *
 * Columns and dropdown options are data, not code: analysts and admins can
 * create, delete and rename columns and options from the Inbox. The seven
 * chart-critical core columns can be renamed but never deleted.
 */
export const COLUMN_TYPES = ["date", "multi", "macro", "sub", "text", "select"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Column types an analyst may create from the "Add column" control. */
export const CREATABLE_COLUMN_TYPES = ["select", "text", "date"] as const;
export type CreatableColumnType = (typeof CREATABLE_COLUMN_TYPES)[number];

export const TYPE_LABEL: Record<ColumnType, string> = {
  date: "Date",
  multi: "Multi-select",
  macro: "Dropdown · parent",
  sub: "Dropdown · per macrotrend",
  text: "Text",
  select: "Dropdown",
};

export interface TrackerColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Chart-critical: can be renamed but not deleted. */
  core: boolean;
  /** Whether approval requires a value. */
  required: boolean;
  position: number;
  /** Ordered options for `select` and `multi` columns. Order defines numeric encodings. */
  options?: string[];
  /**
   * Whether the LLM proposes a value for this column. Analyst-owned columns
   * (e.g. Action) are never inferred and always start empty.
   */
  aiAssist: boolean;
}

export interface MacrotrendGroup {
  name: string;
  subtrends: string[];
}

export interface TrackerSchema {
  /** Monotonic revision of the tenant's schema; bumps on every schema edit. */
  revision: number;
  columns: TrackerColumn[];
  taxonomy: MacrotrendGroup[];
}

/** Fixed keys of the core columns. Labels are editable; keys never change. */
export const CORE = {
  date: "date",
  competitors: "competitors",
  macrotrend: "macrotrend",
  subtrend: "subtrend",
  title: "title",
  growth: "growth",
  impact: "impact",
} as const;
export const CORE_KEYS: readonly string[] = Object.values(CORE);

/** Default (non-core) columns seeded for every tenant. */
export const DEFAULT_KEYS = { source: "source", action: "action" } as const;

/** Reserved filter value meaning "no filter". It must never be stored as a value. */
export const ALL = "All";

export const DEFAULT_COMPETITORS = ["Pfizer", "Novartis", "Roche", "Sanofi", "AstraZeneca"];

/** Growth Intensity: numeric encoding Stable = 0, Slight Increase = 1, Strong Increase = 2 (option index). */
export const DEFAULT_GROWTH = ["Stable", "Slight Increase", "Strong Increase"];
export const DEFAULT_IMPACT = ["Low", "Medium", "High"];
export const DEFAULT_SOURCES = ["LinkedIn", "PR", "Publication", "Primary Source", "Client Signals"];
export const DEFAULT_ACTIONS = ["Actioned", "Not Actioned"];

export const DEFAULT_TAXONOMY: MacrotrendGroup[] = [
  {
    name: "AI Investment in R&D",
    subtrends: [
      "Proprietary AI Drug Discovery Tools",
      "Computational Infrastructure",
      "External Partnerships to Accelerate AI",
      "R&D Resource and Workforce Restructuring",
      "Agentic AI Platforms",
    ],
  },
  {
    name: "Workforce AI Upskilling",
    subtrends: [
      "Tiered AI accreditation & Internal Certification",
      "Experiential, Festival-style & Gamified AI",
      "Centralized AI Enablement Hubs & Storefronts",
      "Role-based, Function-specific AI Upskilling",
      "Digital & AI Cultural Adoption",
      "Executive-first Sponsorship & Communities/Champions",
      "Senior AI/Digital Leadership Hires & Public Ambition",
    ],
  },
  {
    name: "Integrated Digital Pharma Innovation",
    subtrends: [
      "AI/Digital Pharma Transformation & Investment",
      "External Partnerships to Accelerate Enterprise Digital Implementation",
      "Industry Awards",
      "AI in Regulatory Affairs",
      "Clinical Trials Optimization",
      "Tools for Salesforce Effectiveness",
    ],
  },
  {
    name: "Direct-to-Patient (DTP) Strategy",
    subtrends: [
      "New DTP Program Launch",
      "DTP for Affordability & Cost Transparency",
      "Global DTP Expansion",
      "DTP Platformization & Infrastructure Building",
      "Expansion of DTP into Broader Retail or DTC Channels",
      "Creative Campaigns and Partnerships",
      "Regulatory Action Against DTC",
      "Direct-to-Employer (DTE)",
    ],
  },
  { name: "Geopolitics", subtrends: ["IRA Pricing/Tariffs", "Bypassing Traditional Intermediaries (PBMs, Insurers)"] },
  { name: "Portfolio Restructuring", subtrends: ["Mergers & Acquisitions", "Licensing & Co-Development Deals"] },
  {
    name: "Medical-grade Intelligence Augmentation",
    subtrends: ["Clinical Decision Support LLMs", "Generative Engine Optimization"],
  },
  {
    name: "Robotics and Open-source Models for Pharma",
    subtrends: ["Robotics-enabled Labs", "Open-source Models for Pharma"],
  },
  { name: "Others", subtrends: ["Others"] },
];

export function defaultColumns(): TrackerColumn[] {
  const cols: Omit<TrackerColumn, "position" | "aiAssist">[] = [
    { key: CORE.date, label: "Date", type: "date", core: true, required: true },
    { key: CORE.competitors, label: "Competitor", type: "multi", core: true, required: true, options: [...DEFAULT_COMPETITORS] },
    { key: CORE.macrotrend, label: "Macrotrend", type: "macro", core: true, required: true },
    { key: CORE.subtrend, label: "Subtrend", type: "sub", core: true, required: true },
    { key: CORE.title, label: "News title", type: "text", core: true, required: true },
    { key: CORE.growth, label: "Growth intensity", type: "select", core: true, required: true, options: [...DEFAULT_GROWTH] },
    { key: CORE.impact, label: "Impact", type: "select", core: true, required: true, options: [...DEFAULT_IMPACT] },
    { key: DEFAULT_KEYS.source, label: "Source", type: "select", core: false, required: true, options: [...DEFAULT_SOURCES] },
    { key: DEFAULT_KEYS.action, label: "Action", type: "select", core: false, required: true, options: [...DEFAULT_ACTIONS] },
  ];
  return cols.map((c, i) => ({ ...c, position: i, aiAssist: c.key !== DEFAULT_KEYS.action }));
}

export function defaultSchema(): TrackerSchema {
  return {
    revision: 1,
    columns: defaultColumns(),
    taxonomy: DEFAULT_TAXONOMY.map((g) => ({ name: g.name, subtrends: [...g.subtrends] })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getColumn(schema: TrackerSchema, key: string): TrackerColumn | undefined {
  return schema.columns.find((c) => c.key === key);
}

export function sortedColumns(schema: TrackerSchema): TrackerColumn[] {
  return [...schema.columns].sort((a, b) => a.position - b.position);
}

export function macrotrends(schema: TrackerSchema): string[] {
  return schema.taxonomy.map((g) => g.name);
}

export function subtrendsOf(schema: TrackerSchema, macro: string | null | undefined): string[] {
  if (!macro || macro === ALL) return allSubtrends(schema);
  return schema.taxonomy.find((g) => g.name === macro)?.subtrends ?? [];
}

export function allSubtrends(schema: TrackerSchema): string[] {
  return schema.taxonomy.flatMap((g) => g.subtrends);
}

export function macroOfSubtrend(schema: TrackerSchema, sub: string): string | undefined {
  return schema.taxonomy.find((g) => g.subtrends.includes(sub))?.name;
}

/** Every option a column accepts (macro/sub derive from the taxonomy). */
export function optionsOf(schema: TrackerSchema, col: TrackerColumn): string[] {
  if (col.type === "macro") return macrotrends(schema);
  if (col.type === "sub") return allSubtrends(schema);
  return col.options ?? [];
}

export function hasOptions(col: TrackerColumn): boolean {
  return col.type === "select" || col.type === "multi" || col.type === "macro" || col.type === "sub";
}

/** Columns that appear as dashboard/tracker filters (all dropdown-style columns). */
export function filterableColumns(schema: TrackerSchema): TrackerColumn[] {
  return sortedColumns(schema).filter(hasOptions);
}

/** Numeric level of an ordered option (Growth: Stable = 0, Slight Increase = 1, Strong Increase = 2). */
export function levelOf(col: TrackerColumn | undefined, value: string | null | undefined): number {
  if (!col || !value) return -1;
  return (col.options ?? []).indexOf(value);
}

/** Map an option index onto three visual buckets (low / medium / high) for glyphs and colours. */
export function bucket(index: number, count: number): 0 | 1 | 2 {
  if (index < 0 || count <= 1) return 0;
  return Math.round((index / (count - 1)) * 2) as 0 | 1 | 2;
}

/** Impact weight used by the Trend Test: Low = 1, Medium = 2, High = 3 (index + 1). */
export function impactWeight(impactCol: TrackerColumn | undefined, value: string | null | undefined): number {
  const i = levelOf(impactCol, value);
  return i < 0 ? 0 : i + 1;
}

export const COLUMN_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_LABEL_LENGTH = 60;
export const MAX_OPTION_LENGTH = 120;

export function normaliseLabel(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkColumnLabel(schema: TrackerSchema, label: string, exceptKey?: string): NameCheck {
  const v = normaliseLabel(label);
  if (!v) return { ok: false, error: "Column name is required" };
  if (v.length > MAX_LABEL_LENGTH) return { ok: false, error: `Column name must be ${MAX_LABEL_LENGTH} characters or fewer` };
  const lower = v.toLowerCase();
  if (schema.columns.some((c) => c.key !== exceptKey && c.label.toLowerCase() === lower)) {
    return { ok: false, error: `A column called “${v}” already exists` };
  }
  return { ok: true, value: v };
}

/**
 * Validate a new/renamed option. Subtrends must be unique across all
 * macrotrends because an item stores the subtrend by name.
 */
export function checkOptionName(
  schema: TrackerSchema,
  col: TrackerColumn,
  value: string,
  except?: string,
): NameCheck {
  const v = normaliseLabel(value);
  if (!v) return { ok: false, error: "Option name is required" };
  if (v.length > MAX_OPTION_LENGTH) return { ok: false, error: `Option must be ${MAX_OPTION_LENGTH} characters or fewer` };
  if (v.toLowerCase() === ALL.toLowerCase()) return { ok: false, error: "“All” is reserved for filters and cannot be stored" };
  const existing = optionsOf(schema, col).filter((o) => o !== except);
  if (existing.some((o) => o.toLowerCase() === v.toLowerCase())) {
    const what = col.type === "macro" ? "A macrotrend" : col.type === "sub" ? "A subtrend" : `“${col.label}” already has an option`;
    return { ok: false, error: col.type === "macro" || col.type === "sub" ? `${what} called “${v}” already exists` : `${what} called “${v}”` };
  }
  return { ok: true, value: v };
}

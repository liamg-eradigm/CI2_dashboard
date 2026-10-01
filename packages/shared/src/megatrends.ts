/**
 * Megatrends: the knowledge graph of tracker entries by Macrotrend and
 * Subtrend, with a short summary of each (added in contract 1.10).
 *
 * Summaries are written by hand for now (the defaults below, then edited in
 * the dashboard) and, once the Claude API is connected, generated from the
 * recent entries of each Macrotrend / Subtrend (see the `megatrends` settings).
 * A stored summary overrides the default; summaries are keyed by name, so they
 * are shared by the Primary and Secondary trackers.
 */

export const TREND_LEVELS = ["macro", "sub"] as const;
export type TrendLevel = (typeof TREND_LEVELS)[number];

/** Where a summary came from: the built-in text, an analyst, or the AI writer. */
export const SUMMARY_SOURCES = ["default", "manual", "ai"] as const;
export type SummarySource = (typeof SUMMARY_SOURCES)[number];

/** Models offered for AI-written summaries (Settings → Megatrends). */
export const SUMMARY_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 · most capable" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 · balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 · fastest, lowest cost" },
] as const;
export type SummaryModel = (typeof SUMMARY_MODELS)[number]["id"];

export const MAX_SUMMARY_LENGTH = 2000;

/** Default Macrotrend summaries, by Macrotrend name. */
export const DEFAULT_MACRO_SUMMARIES: Readonly<Record<string, string>> = {
  "AI Investment in R&D":
    "Competitors are investing in R&D compute and data partnerships (BMS–NVIDIA, Regeneron–TriNetX), but advantage increasingly rests on proprietary data and workflow integration. For AbbVie, the question is whether its data can drive pipeline productivity before peers build data moats.",
  "Direct-to-Patient (DTP) Strategy":
    "Lilly, Novo and Sanofi are building owned DTP platforms and corporate brands, while GoodRx moves into subscriptions. For AbbVie, this raises the bar on time-to-treatment, patient-data ownership and corporate brand equity.",
  Geopolitics:
    "The most-favored-nation (MFN) pricing framework is expanding from the largest pharma companies to mid-sized and international manufacturers. For AbbVie, MFN alignment is becoming a reputational baseline, with further exposure possible via new CMS Medicare pilots.",
  "Integrated Digital Pharma Innovation":
    "Peers are scaling AI into enterprise-wide operating layers via frontier-model partnerships, owned data stacks and in-house tools, increasingly backed by published results. For AbbVie, credibility now depends on proven productivity outcomes, and platform and vendor choices are becoming strategic decisions.",
  "Medical-grade Intelligence Augmentation":
    "AI platforms like OpenEvidence and ChatGPT for Clinicians are embedding at the point of prescribing. For AbbVie, accurate representation of its evidence on these platforms is becoming a commercial priority.",
  "Robotics and Open-source Models for Pharma":
    "Genentech and Lilly are adopting open-source and open-weight models to gain control and transparency. For AbbVie, advantage is shifting toward model ownership, proprietary data and reduced vendor dependence.",
  "Workforce AI Upskilling":
    "Peers are treating AI readiness as an organizational challenge, using mandatory training, protected learning time, champion networks and executive sponsorship. For AbbVie, the differentiator is now converting trained users into measurable outcomes and publicizing them.",
};

/** Default Subtrend summaries, by Subtrend name. */
export const DEFAULT_SUB_SUMMARIES: Readonly<Record<string, string>> = {
  "Computational Infrastructure":
    "BMS's NVIDIA \"AI factory\" scales proprietary models and agentic target identification across therapeutic areas that overlap with AbbVie's. The watchpoint is whether BMS turns its data into a lasting R&D productivity edge.",
  "External Partnerships to Accelerate AI":
    "OpenAI's GPT-Rosalind and Regeneron's exclusive TriNetX data deal show R&D AI partnerships splitting between licensed models and data moats. For AbbVie, partnership value will hinge on proprietary data access, not model choice.",
  "Creative Campaigns and Partnerships":
    "Lilly and Novo are shifting from product brands to pipeline-spanning corporate brands that frame commercial activity as mission-driven. For AbbVie, whose visibility rests on product brands, corporate brand equity may become a competitive gap.",
  "DTP Platformization & Infrastructure Building":
    "Sanofi's iCare+ and Novo's NovoCare 2.0 are rebuilding patient services as owned digital infrastructure. For AbbVie, time-to-treatment is becoming a public benchmark, and peers' advantage from owning patient data will compound.",
  "DTP for Affordability & Cost Transparency":
    "GoodRx's household subscription, with free generics and an employer-funded route, positions it as a payer-adjacent rival to pharmacy benefits. For AbbVie, this strengthens the economics of generic alternatives, a dynamic to monitor in access strategy.",
  "IRA Pricing/Tariffs":
    "Nine more manufacturers agreed to offer Medicaid most-favored-nation (MFN) prices, though savings remain unclear given existing deep Medicaid discounts. For AbbVie, peer pressure is rising, but the bigger watchpoint is two additional CMS Medicare pricing pilots.",
  "AI/Digital Pharma Transformation & Investment":
    "Genentech, BMS, Roche, Sanofi and J&J are publicly disclosing granular AI outcomes, signaling a move from pilot to industry standard. For AbbVie, peers' usage and cycle-time benchmarks raise the bar for its own investor narrative.",
  "Agentic AI":
    "Merck and Sanofi are deploying agentic AI at enterprise scale, while Veeva and Salesforce converge on automating regulated workflows. For AbbVie, this will reshape content, CRM and compliance vendor choices, with Sanofi's results setting the ROI yardstick.",
  "Clinical Trials Optimization":
    "The FDA's real-time trial monitoring pilots with AstraZeneca and Amgen let regulators see data as it is collected. For AbbVie, the risk is falling behind sponsors with real-time, regulatory-grade data infrastructure as the program scales.",
  "External Partnerships to Accelerate Enterprise Digital Implementation":
    "Novo, BMS, Sanofi and Lilly are making divergent bets on how to build an enterprise AI operating layer. For AbbVie, the trade-off is the upside of a unified single provider versus concentration and data-security risk.",
  "Tools for Salesforce Effectiveness":
    "Sanofi's Concierge for Field AI agent cuts reps' pre-call research from hours to seconds. For AbbVie, AI-prepared HCP engagement is becoming a baseline for field teams.",
  "Clinical Decision Support LLMs":
    "OpenEvidence is defending its lead with evidence grading and workflow integrations as OpenAI enters with free ChatGPT for Clinicians. For AbbVie, evidence strength is now visible at the point of prescribing, making high-quality, machine-readable evidence increasingly important.",
  "Open-source Models for Pharma":
    "Genentech's open-source Meridian model and Lilly's LillyPod show peers using open models for transparency and organization-wide access. For AbbVie, these approaches offer control and cost savings but demand stronger internal governance.",
  "Digital & AI Cultural Adoption":
    "Sanofi and Pfizer frame employee mindset, not technology, as the main barrier to AI value. For AbbVie, adoption KPIs like daily active users will become benchmarks, making change management a strategic lever.",
  "Executive-first Sponsorship & Communities/Champions":
    "J&J executives tie AI to faster development, while BMS reports ~24,000 active AI users backed by 170+ champions. For AbbVie, BMS shows the value of institutionalizing adoption early and linking it to outcomes.",
  "Experiential, Festival-style & Gamified AI":
    "J&J's gamified Learn Quest engaged 74% of its Technology organization, with protected learning time. For AbbVie, it signals a shift from voluntary training to structured operational commitment.",
  "Senior AI/Digital Leadership Hires & Public Ambition":
    "Pharma tech leaders are publicly setting AI benchmarks, J&J is formalizing AI governance roles, and Anthropic is deepening its life-sciences ties. For AbbVie, public AI articulation is now a competitive signal, and decisions on whether to own, partner for or buy AI capabilities grow more consequential.",
};

export const defaultSummary = (level: TrendLevel, name: string): string | null =>
  (level === "macro" ? DEFAULT_MACRO_SUMMARIES[name] : DEFAULT_SUB_SUMMARIES[name]) ?? null;

// ---------------------------------------------------------------------------
// Navigation (the tab order is an admin setting since contract 1.10)
// ---------------------------------------------------------------------------

export const NAV_TABS = ["dashboard", "tracker", "phantoms", "deliverables", "megatrends", "inbox", "input", "admin"] as const;
export type NavTab = (typeof NAV_TABS)[number];
export const NAV_LABEL: Record<NavTab, string> = {
  dashboard: "Dashboard",
  tracker: "Tracker",
  phantoms: "Phantoms",
  deliverables: "Deliverables",
  megatrends: "Megatrends",
  inbox: "Inbox",
  input: "Input",
  admin: "Administration",
};
export const DEFAULT_NAV_ORDER: NavTab[] = [...NAV_TABS];

/** A stored tab order made whole: unknown or repeated tabs dropped, tabs added since appended at the end. */
export function normaliseNavOrder(order: readonly string[] | undefined): NavTab[] {
  const seen = new Set<NavTab>();
  for (const k of order ?? []) if ((NAV_TABS as readonly string[]).includes(k)) seen.add(k as NavTab);
  for (const k of NAV_TABS) seen.add(k);
  return [...seen];
}

/**
 * Competitors (contract 1.14): the knowledge graph of Tracker entries by the
 * competitors they name, with a short CI summary of each competitor.
 *
 * Like the Megatrends summaries, the defaults below ship with the dashboard;
 * an analyst can rewrite one, and once the Claude API is connected the AI
 * writer rewrites it from the competitor's entries (high-impact and recent
 * first). Stored summaries use the "competitor" level of trend_summaries.
 *
 * Competitor names in entries vary ("BMS", "Bristol-Myers Squibb Co."), so
 * defaults are found by a normalised key, aliases and common suffixes.
 */

/** Default competitor summaries, by competitor name. */
export const DEFAULT_COMPETITOR_SUMMARIES: Readonly<Record<string, string>> = {
  "89bio":
    "Roche agreed to acquire this liver-disease drug developer for up to $3.5B (Sep 2025); also cited in Roche's Q3 2025 R&D investment stance as part of its pipeline build-out.",
  "ABL Bio":
    "Korean biotech whose licensing deal with Eli Lilly (Nov 2025) made its founder a billionaire. Tracked as a Lilly dealmaking signal; no CI perspective written.",
  "Adverum Biotechnologies":
    "Eli Lilly acquired this cash-strapped gene therapy company (announced Oct 2025, tender completed Dec 2025) to gain its Phase 3 eye-disease asset, Ixo-vec.",
  "Akero Therapeutics":
    "Novo Nordisk agreed to acquire it (Oct 2025) for its Phase 3 FGF21 analogue, expanding Novo's MASH (liver disease) portfolio.",
  "Amgen":
    "Joined the Medicaid most-favored-nation pricing agreements and expanded DTP access (AmgenNow); FDA real-time clinical-trial monitoring pilot partner; OpenAI GPT-Rosalind preview partner; chose Veeva Vault CRM globally; CEO publicly discusses AI and sponsors FIFA World Cup.",
  "Argenx":
    "Featured among biopharma participants at Veeva's May 2026 Commercial Summit on AI successes and the path to agentic commercial; minor signal.",
  "AriBio":
    "Dementia-drug developer that joined Eli Lilly's AI platform (June 2026), extending Lilly's model of opening its AI tools to outside biotechs.",
  "Astellas":
    "One of nine mid-sized manufacturers agreeing to Medicaid MFN pricing, a framework spreading beyond the largest drugmakers for reputational more than economic reasons. Also deployed NVIDIA's Boltz-2 AI for drug discovery and consolidated DTC/HCP media with a new agency.",
  "AstraZeneca":
    "First pharma to acquire an AI company (Modella AI, oncology R&D), possibly opening the door to more AI acquisitions. FDA real-time clinical-trial pilot partner, signalling regulatory-grade data infrastructure. Also launched AstraZeneca Direct DTP and US manufacturing investments.",
  "Avidity Biosciences":
    "Novartis agreed to acquire this RNA therapeutics innovator (Oct 2025), strengthening its late-stage neuroscience pipeline.",
  "Bayer":
    "Low-signal competitor: Bayer Radiology partnered with Google Cloud on an AI platform, its head of AI discussed keeping pace with AI, and it featured at Veeva's agentic commercial summit.",
  "Biogen":
    "Selected Veeva Vault CRM globally as its agentic commercial foundation (Aug 2026), adding to Veeva's growing top-20 pharma CRM wins.",
  "BioNTech":
    "Pfizer cut its stake in its COVID vaccine partner BioNTech (Nov 2025), a portfolio-restructuring signal.",
  "Boehringer":
    "Early adopter of Veeva's Falcon agentic platform for clinical and site collaboration, part of Veeva's shift from system of record to execution layer. Also launched a DTC platform cutting Spiriva Respimat prices.",
  "Bristol Myers Squibb":
    "Enterprise-wide AI push: Anthropic Claude Enterprise deal, NVIDIA proprietary-data AI factory, in-house Oasis workbench replacing up to 45 marketing tools, and ~24,000 active AI users through AIQ Academy, a workforce-adoption benchmark. Early quantum preparation; Veeva Vault CRM committed.",
  "Celltrion":
    "Acquired Eli Lilly's US manufacturing facility alongside a 680 billion won contract-manufacturing agreement (Jan 2026).",
  "Chiesi Group":
    "Adopted Salesforce Agentforce for global commercial transformation (Apr 2026), a commercial AI platform win for Salesforce.",
  "Chugai Pharmaceutical":
    "Selected as a 2026 'Digital Transformation Stock' (DX Stock) in Japan (Apr 2026), an external recognition of digital maturity.",
  "Creyon Bio":
    "Referenced in coverage of Eli Lilly's $1.2B Sanegene metabolic RNA-medicine pact (Nov 2025) as a related RNA-focused partner; minor signal.",
  "Crinetics":
    "Named among customers in Veeva's December 2025 launch of Veeva AI Agents; minor adoption signal for Veeva.",
  "CSPC Pharmaceutical":
    "AstraZeneca partner: a deal worth up to $5.33B (Jun 2025, high impact) and a January 2026 collaboration expanding AstraZeneca's weight-management portfolio.",
  "Daiichi Sankyo":
    "Using AI for antibody-drug conjugate biomarker discovery, via collaborations with Imagene AI and 4D Path (Apr 2026).",
  "Denali Therapeutics":
    "Referenced in Eli Lilly's November 2025 Executive Committee and leadership expansion announcement, via a link to Lilly's neuroscience leadership; minor signal.",
  "Dynavax":
    "Sanofi agreed to acquire it (Dec 2025), adding a marketed adult hepatitis B vaccine and a Phase 1/2 shingles candidate.",
  "Eli Lilly":
    "Repositioning as a technology-built 'medicine company' via consumer branding, LillyDirect and Super Bowl spots. LillyPod runs open-weight LLMs on-premises with no token limits; NVIDIA co-innovation lab; stayed with Veeva Vault CRM; many AI-biotech partnerships.",
  "Evaxion Biotech":
    "Offloaded a vaccine candidate to Merck for $592M in potential milestones (Sep 2025), tracked as a high-impact deal.",
  "GammaDelta Therapeutics":
    "Referenced in Takeda's October 2025 US layoffs (137 staff) as Takeda retreats from cell therapy.",
  "Genentech":
    "Industrializing AI across its US commercial model through a CDAO-led 'product model', with ~40% of technical leaders from Tier-1 tech. Adopted Google's open-source Meridian for media measurement, trading convenience for control; frames orchestration as pharma's next AI challenge.",
  "Gilead":
    "Low-signal: won an 'Award of Excellence' for AI-driven chronic disease management (Sep 2025), part of a $32B US investment programme, and featured at Veeva's agentic commercial summit.",
  "GSK":
    "Early adopter of Veeva Falcon. Building AI-discovery partnerships (Relation Therapeutics, A-Alpha Bio/Boltz antibody consortium, Sino Biopharm), Imperial/Oxford digital-twins centre; $30B US investment, 350 R&D layoffs and a CEO transition.",
  "Halda Therapeutics":
    "Johnson & Johnson acquired it (Nov 2025) in a cancer-treatment deal, a portfolio-restructuring signal.",
  "Haleon":
    "Peripheral: grouped with peers still relying on multiple legacy SaaS agent layers that Sanofi is moving beyond; also referenced in GSK's CEO succession coverage.",
  "Innovent Biologics":
    "Takeda partner in a global oncology collaboration worth up to $11.4B (announced Oct 2025, closed Dec 2025), highlighted in Takeda's Q3 2025 R&D investment stance.",
  "Intra-Cellular Therapies":
    "Referenced in J&J's Q2 2025 earnings investment stance as an acquisition supporting its portfolio build-out.",
  "Ionis Pharmaceuticals":
    "One of nine manufacturers agreeing to Medicaid MFN pricing (Aug 2026); the framework has moved from the largest drugmakers to mid-sized companies, though savings remain unclear.",
  "Johnson & Johnson":
    "Public AI-ROI benchmarks (lead times halved, trial reports from 700 hours to 15 minutes); outcomes-led AI approach and first Quantum Day; Learn Quest upskilling; new Chief Architect role formalizing AI governance; Medicaid MFN and US pricing agreements.",
  "Lexeo Therapeutics":
    "Research collaboration with Johnson & Johnson on targeted cardiac delivery of AAV gene therapy (Jan 2026).",
  "Lundbeck":
    "Promoted Markus Kede to Chief AI Officer (Mar 2026), a senior AI leadership signal.",
  "Mangoceuticals":
    "Novo Nordisk and Eli Lilly denied any partnership with this company on obesity drugs (Nov 2025); a DTP-channel signal.",
  "Merck":
    "Signed a ~$1B multi-year Google Cloud agentic AI partnership across all functions, a day-one enterprise-scale bet; co-developer with Doceree on Daily Command; deepened Siemens AI partnership; Evaxion vaccine deal; US government pricing agreement; chose Salesforce Agentforce for Merck Animal Health.",
  "Metsera":
    "Obesity biotech at the centre of a Pfizer–Novo Nordisk bidding war; Pfizer completed its up to $10B acquisition (Nov 2025) and sued Novo for allegedly stalling the deal.",
  "Moderna":
    "Selected Salesforce for global customer engagement (Apr 2026); GPT-Rosalind preview partner with OpenAI; named in Veeva AI Agents launch; targets 45% of work done by AI by 2030 after trimming its digital team.",
  "Monte Rosa Therapeutics":
    "Novartis struck a $5.7B deal with it for AI-driven degrader discovery (Sep 2025).",
  "Novartis":
    "CEO Narasimhan joined Anthropic's board, giving pharma a co-shaping role in AI governance; multi-sourced AI (Microsoft, Isomorphic). Joined US pricing agreements and DTC cuts; Avidity and Monte Rosa deals; AI roles, innovation lab and Game Studio.",
  "Novo Nordisk":
    "Capital Markets Day formalized its AI programme and NovoCare 2.0 (consumer cash-pay focus); rebranded as 'Novo' under CEO Doustdar's execution reset; multi-year OpenAI partnership plus Claude R&D collaboration; Veeva Vault CRM commitment; Metsera and Akero deals.",
  "Orbital Therapeutics":
    "Bristol Myers Squibb acquired it (Oct 2025) to strengthen and diversify its cell therapy portfolio; also cited in BMS's Q3 2025 R&D investment stance.",
  "Otsuka":
    "Named among customers in Veeva's December 2025 launch of Veeva AI Agents; minor adoption signal for Veeva.",
  "Pallando Therapeutics":
    "Joined Eli Lilly's TuneLab AI platform (Jul 2026), another biotech onboarded to Lilly's AI ecosystem.",
  "Pfizer":
    "CEO-level AI narrative built on proprietary data, a federated AI model and enterprise AI-fluency certification; decentralized AI upskilling; Jeremy Forman as Chief AI officer; Metsera acquisition; Boltz partnership; PfizerForAll DTP and TrumpRx; Medicaid MFN participation.",
  "Philochem":
    "Referenced alongside Orbital Therapeutics in BMS's Q3 2025 R&D investment stance as part of its business-development activity.",
  "Regeneron":
    "Committed up to $200M to TriNetX for exclusive access to 300M patient records, a data-exclusivity bet. Also selected Veeva Vault CRM globally, built an enterprise data and AI organization, and partnered with Telix and the US government.",
  "Regulus Therapeutics":
    "Referenced in Novartis's Q2 2025 earnings stance on reinvestment, as an acquisition supporting its pipeline.",
  "Replicate Bioscience":
    "Partnered with Novo Nordisk on self-replicating RNA therapies for obesity and diabetes (Sep 2025).",
  "Roche":
    "AI embedded in sustainable workflows: NVIDIA hybrid-cloud AI factory; 40,000+ ThoughtSpot users and ~2M monthly commercial queries; RocheChat reached ~15% daily workforce engagement; Google Cloud ties; Veeva Vault CRM and Falcon; digital-health vision.",
  "Rovi Pharmaceutical":
    "Digitalizing batch execution with Rockwell Automation's FactoryTalk PharmaSuite MES (Mar 2026), a manufacturing digitization signal.",
  "Rznomics":
    "Referenced in coverage of Eli Lilly's $1.2B Sanegene metabolic RNA-medicine pact (Nov 2025) as a related RNA-focused partner; minor signal.",
  "Sandoz":
    "Tested direct-to-consumer sales of Omnitrope, a growth hormone biosimilar (Jul 2026), extending DTP models to biosimilars.",
  "SanegeneBio":
    "Eli Lilly's partner in a $1.2B pact (Nov 2025) to better target metabolic RNA medicines, supporting Lilly's obesity/metabolic strategy.",
  "Sanofi":
    "AI-at-scale leader: Concierge for 80,000 employees with quantified productivity gains and early Concierge for Field; Snowflake/Elementum stack replacing multi-vendor SaaS; Plai at 20,000+ daily users; iCare+ owned patient-services data. Publicises metrics, setting benchmarks.",
  "Seagen":
    "Referenced in Pfizer's Q2 2025 earnings R&D investment stance as an acquisition supporting its oncology pipeline.",
  "Shionogi":
    "Selected as a 2026 'DX Stock' (Digital Transformation Stocks) in Japan (Apr 2026), an external recognition of digital maturity.",
  "Sino BioPharm":
    "Struck a drug licensing deal with AstraZeneca (Jul 2026) while deepening its partnership with GSK.",
  "SiteOne Therapeutics":
    "Referenced in Eli Lilly's Q2 2025 earnings stance on acquisitions, as part of its portfolio build-out.",
  "Takeda":
    "Moving AI from experimentation to enterprise impact, treating workforce as core; Iambic $1.7B AI discovery deal; $11.4B Innovent oncology partnership; retreat from cell therapy; new CEO Julie Kim; leaders frame AI around measurable ROI and regulated governance.",
  "Telix Pharmaceuticals":
    "Partnered with Regeneron to advance radiopharmaceutical therapies (Apr 2026).",
  "Thirty Madison":
    "Referenced in coverage of a former Eli Lilly executive raising a $52M seed round for a healthcare AI startup (Nov 2025); minor signal.",
  "UCB":
    "Early adopter of Veeva Falcon for quality, safety and compliance; also selected PANTHERx Rare as exclusive specialty pharmacy for KYGEVVI (Mar 2026).",
  "Ventyx Biosciences":
    "Eli Lilly agreed to acquire it (Jan 2026) to advance oral therapies for inflammatory diseases.",
  "Vertex Pharmaceuticals":
    "Featured among biopharma participants at Veeva's May 2026 Commercial Summit on AI successes and the path to agentic commercial; minor signal.",
  "Verve Therapeutics":
    "Referenced in Eli Lilly's Q2 2025 earnings stance on acquisitions, as part of its portfolio build-out.",
  "Viatris":
    "Partnered with GoodRx to offer up to 85% savings on established brand medications (Mar 2026), a DTP affordability signal.",
  "Vicebio":
    "Sanofi completed its acquisition (Dec 2025), adding vaccine capabilities.",
  "YaoPharma":
    "Pfizer entered an exclusive collaboration and licence agreement with it (Dec 2025), a medium-impact portfolio signal.",
};

/** Other names for the competitors above (normalised keys, see competitorKey). */
const ALIASES: Readonly<Record<string, string>> = {
  bms: "Bristol Myers Squibb",
  bristolmyers: "Bristol Myers Squibb",
  lilly: "Eli Lilly",
  elililly: "Eli Lilly",
  jandj: "Johnson & Johnson",
  jnj: "Johnson & Johnson",
  janssen: "Johnson & Johnson",
  novo: "Novo Nordisk",
  boehringeringelheim: "Boehringer",
  glaxosmithkline: "GSK",
  gsk: "GSK",
  msd: "Merck",
  merckandco: "Merck",
  merckco: "Merck",
  az: "AstraZeneca",
  sinobiopharmaceutical: "Sino BioPharm",
  cspc: "CSPC Pharmaceutical",
  chiesi: "Chiesi Group",
  chugai: "Chugai Pharmaceutical",
  rovi: "Rovi Pharmaceutical",
  vertex: "Vertex Pharmaceuticals",
  ionis: "Ionis Pharmaceuticals",
  telix: "Telix Pharmaceuticals",
  sanegene: "SanegeneBio",
  intracellular: "Intra-Cellular Therapies",
  bristolmyersquibb: "Bristol Myers Squibb",
  beigene: "BeOne",
  beonemedicines: "BeOne",
  veeva: "Veeva Systems",
  goodrx: "GoodRx Holdings",
  nvidiacorporation: "NVIDIA",
  hoffmannlaroche: "Roche",
  frochoffmannlaroche: "Roche",
  rocheholdings: "Roche",
  takedapharmaceuticalcompany: "Takeda",
}

/** Words dropped when matching names ("Takeda Pharmaceutical Co., Ltd." → "takeda"). */
const SUFFIXES = /^(and|incorporated|inc|plc|ag|sa|se|nv|co|ltd|limited|llc|corp|corporation|company|group|holdings|systems|medicines|pharmaceuticals?|pharma|therapeutics|biosciences|bioscience|biotechnologies|biotechnology|biotech|biologics|bio|laboratories|labs)$/;

/** A name reduced to lower-case letters and digits ("Johnson & Johnson" → "johnsonandjohnson"). */
export function competitorKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/** The key without corporate suffixes, repeatedly ("Takeda Pharmaceutical Company" → "takeda"). */
function coreKey(name: string): string {
  let words = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.test(words[words.length - 1]!)) words = words.slice(0, -1);
  return words.join("");
}

let index: Map<string, string> | null = null;
function defaultsIndex(): Map<string, string> {
  if (index) return index;
  index = new Map();
  for (const name of Object.keys(DEFAULT_COMPETITOR_SUMMARIES)) {
    index.set(competitorKey(name), name);
    if (!index.has(coreKey(name))) index.set(coreKey(name), name);
  }
  for (const [alias, name] of Object.entries(ALIASES)) if (!index.has(alias)) index.set(alias, name);
  return index;
}

/** The default summary's competitor for a name as written in entries, if there is one. */
export function defaultCompetitorName(name: string): string | null {
  const ix = defaultsIndex();
  return ix.get(competitorKey(name)) ?? ix.get(coreKey(name)) ?? null;
}

export const defaultCompetitorSummary = (name: string): string | null => {
  const key = defaultCompetitorName(name);
  return key ? (DEFAULT_COMPETITOR_SUMMARIES[key] ?? null) : null;
};

// ---------------------------------------------------------------------------
// Tiers (contract 1.15): set by admins; any competitor not listed is Tier 4.
// ---------------------------------------------------------------------------

export const COMPETITOR_TIERS = [1, 2, 3, 4] as const;
export type CompetitorTier = (typeof COMPETITOR_TIERS)[number];
export interface CompetitorTiers {
  tier1: string[];
  tier2: string[];
  tier3: string[];
}
export const DEFAULT_COMPETITOR_TIERS: CompetitorTiers = {
  tier1: ["Johnson & Johnson", "Roche", "Novartis", "Bristol Myers Squibb", "Eli Lilly", "AstraZeneca", "Sanofi", "Pfizer", "Takeda"],
  tier2: ["Amgen", "Salesforce", "Veeva Systems", "BeOne"],
  tier3: ["GSK", "NVIDIA", "GoodRx Holdings", "OpenEvidence", "Novo Nordisk"],
};

/**
 * One key per company however it is written: aliases ("BMS", "J&J", "Lilly",
 * "Veeva"), "&" / "and", punctuation and corporate suffixes all collapse.
 */
export function companyKey(name: string): string {
  const canonical = ALIASES[competitorKey(name)] ?? ALIASES[coreKey(name)] ?? name;
  return coreKey(canonical);
}

/** A competitor's tier: the first tier that lists it (by companyKey), else 4. */
export function tierOf(name: string, tiers: CompetitorTiers): CompetitorTier {
  const key = companyKey(name);
  if (tiers.tier1.some((n) => companyKey(n) === key)) return 1;
  if (tiers.tier2.some((n) => companyKey(n) === key)) return 2;
  if (tiers.tier3.some((n) => companyKey(n) === key)) return 3;
  return 4;
}

/** Competitor values that mean "no competitor" (N/A, None, Not applicable, -, …): never a node on the Competitors tab. */
const PLACEHOLDERS = new Set(["", "na", "nan", "none", "nil", "null", "notapplicable", "notavailable", "nocompetitor", "nocompetitors", "tbc", "tbd", "unknown"]);
export function isPlaceholderCompetitor(name: string): boolean {
  return PLACEHOLDERS.has(competitorKey(name));
}

/**
 * Node radius in the Competitors graph: grows exponentially with the number
 * of entries (relative to the most-named competitor), so competitors named
 * once or twice stay very small and the few most active ones stand out.
 */
export function competitorRadius(count: number, max: number, min = 1.4, top = 26, curve = 3.2): number {
  if (count <= 0 || max <= 0) return min;
  const t = Math.min(1, count / max);
  return min + (top - min) * ((Math.exp(curve * t) - 1) / (Math.exp(curve) - 1));
}

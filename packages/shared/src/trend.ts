/**
 * Trend Test (3_Frontend_Design, "Trend Test").
 *
 * Compares a selected current period with the immediately preceding baseline
 * period of equal length. This is an analyst-configured indicator, not
 * statistical proof: a trend is confirmed only when the minimum sample-size
 * rule and every configured threshold are met.
 */
import { ALL } from "./schema.js";
import { addDays, daysBetween } from "./filters.js";

export interface TrendThresholds {
  /** Minimum number of approved signals required in the current period. */
  minSampleSize: number;
  /** Minimum % increase in approved signal count vs baseline. */
  signalCountChangePct: number;
  /** Minimum increase in the number of distinct competitors. */
  distinctCompetitorsChange: number;
  /** Minimum % increase in the impact-weighted signal score. */
  impactScoreChangePct: number;
  /** Minimum increase in the mean growth-intensity score (0–2 scale). */
  growthScoreChange: number;
}

export const DEFAULT_TREND_THRESHOLDS: TrendThresholds = {
  minSampleSize: 5,
  signalCountChangePct: 25,
  distinctCompetitorsChange: 1,
  impactScoreChangePct: 25,
  growthScoreChange: 0.2,
};

export interface TrendConfig {
  macrotrend: string;
  subtrend: string;
  competitors: string[];
  growth: string;
  from: string;
  to: string;
  thresholds: TrendThresholds;
}

export interface PeriodStats {
  count: number;
  distinctCompetitors: number;
  /** Σ impact weights (Low = 1, Medium = 2, High = 3). */
  impactScore: number;
  /** Mean growth intensity (Stable = 0, Slight Increase = 1, Strong Increase = 2); null when there are no signals. */
  growthScore: number | null;
}

export interface Period {
  from: string;
  to: string;
  days: number;
}

/** Baseline = the immediately preceding period of equal length (inclusive dates). */
export function baselinePeriod(from: string, to: string): { current: Period; baseline: Period } {
  const days = daysBetween(from, to) + 1;
  const bTo = addDays(from, -1);
  const bFrom = addDays(bTo, -(days - 1));
  return { current: { from, to, days }, baseline: { from: bFrom, to: bTo, days } };
}

export interface SignalForTrend {
  competitors: string[];
  /** Impact option index (0 = lowest). */
  impactIndex: number;
  /** Growth option index (0 = Stable). */
  growthIndex: number;
}

export function computePeriodStats(signals: SignalForTrend[]): PeriodStats {
  const comps = new Set<string>();
  let impact = 0;
  let growthSum = 0;
  let growthN = 0;
  for (const s of signals) {
    s.competitors.forEach((c) => comps.add(c));
    if (s.impactIndex >= 0) impact += s.impactIndex + 1;
    if (s.growthIndex >= 0) {
      growthSum += s.growthIndex;
      growthN++;
    }
  }
  return {
    count: signals.length,
    distinctCompetitors: comps.size,
    impactScore: impact,
    growthScore: growthN ? round2(growthSum / growthN) : null,
  };
}

export type RuleKind = "pct" | "abs";

export interface MetricResult {
  metric: string;
  key: "sample" | "count" | "competitors" | "impact" | "growth";
  current: number | null;
  baseline: number | null;
  /** Human-readable change, e.g. "+40%", "+2", "New (baseline 0)". */
  change: string;
  threshold: string;
  /** 0–100+ percentage of the threshold achieved; null = Not applicable. */
  progress: number | null;
  met: boolean;
  explanation: string;
}

export interface TrendResult {
  current: Period;
  baseline: Period;
  metrics: MetricResult[];
  confirmed: boolean;
  verdict: "Trend confirmed" | "No trend detected";
  unmetRules: string[];
  formula: string[];
  sampleRule: string;
  explanation: string;
  disclaimer: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function pctRule(
  key: MetricResult["key"],
  metric: string,
  cur: number,
  base: number,
  thresholdPct: number,
): MetricResult {
  const threshold = `≥ +${fmtNum(thresholdPct)}%`;
  if (base === 0) {
    const met = cur > 0;
    return {
      key,
      metric,
      current: cur,
      baseline: base,
      change: cur > 0 ? "New (baseline 0)" : "No change",
      threshold,
      progress: null,
      met,
      explanation: met
        ? `Baseline is 0, so a percentage change is undefined; the current period has ${fmtNum(cur)}, which counts as an increase.`
        : "Both periods are 0, so there is no increase.",
    };
  }
  const pct = ((cur - base) / base) * 100;
  const met = pct >= thresholdPct;
  const progress = thresholdPct > 0 ? Math.round((pct / thresholdPct) * 100) : null;
  return {
    key,
    metric,
    current: cur,
    baseline: base,
    change: `${sign(pct)}${fmtNum(Math.abs(round2(pct)))}%`,
    threshold,
    progress,
    met,
    explanation: `${fmtNum(cur)} vs ${fmtNum(base)} is ${sign(pct)}${fmtNum(Math.abs(round2(pct)))}%, ${met ? "meeting" : "below"} the ${threshold} threshold.`,
  };
}

function absRule(
  key: MetricResult["key"],
  metric: string,
  cur: number | null,
  base: number | null,
  threshold: number,
  unit = "",
): MetricResult {
  const thresholdLabel = `≥ +${fmtNum(threshold)}${unit}`;
  if (cur == null || base == null) {
    return {
      key,
      metric,
      current: cur,
      baseline: base,
      change: "Not applicable",
      threshold: thresholdLabel,
      progress: null,
      met: false,
      explanation: "One of the periods has no signals, so this score cannot be compared.",
    };
  }
  const diff = round2(cur - base);
  const met = diff >= threshold;
  return {
    key,
    metric,
    current: cur,
    baseline: base,
    change: `${sign(diff)}${fmtNum(Math.abs(diff))}${unit}`,
    threshold: thresholdLabel,
    progress: threshold > 0 ? Math.round((diff / threshold) * 100) : null,
    met,
    explanation: `${fmtNum(cur)} vs ${fmtNum(base)} is a change of ${sign(diff)}${fmtNum(Math.abs(diff))}${unit}, ${met ? "meeting" : "below"} the ${thresholdLabel} threshold.`,
  };
}

export function evaluateTrend(
  config: Pick<TrendConfig, "from" | "to" | "thresholds" | "macrotrend" | "subtrend" | "competitors" | "growth">,
  current: PeriodStats,
  baseline: PeriodStats,
): TrendResult {
  const t = config.thresholds;
  const periods = baselinePeriod(config.from, config.to);
  const sampleMet = current.count >= t.minSampleSize;
  const sample: MetricResult = {
    key: "sample",
    metric: "Minimum sample size",
    current: current.count,
    baseline: baseline.count,
    change: "—",
    threshold: `≥ ${t.minSampleSize} signals in current period`,
    progress: t.minSampleSize > 0 ? Math.round((current.count / t.minSampleSize) * 100) : null,
    met: sampleMet,
    explanation: sampleMet
      ? `${current.count} approved signals in the current period meets the minimum of ${t.minSampleSize}.`
      : `Only ${current.count} approved signals in the current period; at least ${t.minSampleSize} are required.`,
  };
  const metrics: MetricResult[] = [
    sample,
    pctRule("count", "Approved signal count", current.count, baseline.count, t.signalCountChangePct),
    absRule("competitors", "Distinct competitors", current.distinctCompetitors, baseline.distinctCompetitors, t.distinctCompetitorsChange),
    pctRule("impact", "Impact-weighted signal score", current.impactScore, baseline.impactScore, t.impactScoreChangePct),
    absRule("growth", "Growth-intensity score", current.growthScore, baseline.growthScore, t.growthScoreChange),
  ];
  const unmet = metrics.filter((m) => !m.met).map((m) => m.metric);
  const confirmed = unmet.length === 0;
  const scope = [
    config.macrotrend && config.macrotrend !== ALL ? config.macrotrend : "all macrotrends",
    config.subtrend && config.subtrend !== ALL ? config.subtrend : null,
    config.competitors.length ? config.competitors.join(", ") : "all competitors",
    config.growth && config.growth !== ALL ? `growth = ${config.growth}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    current: periods.current,
    baseline: periods.baseline,
    metrics,
    confirmed,
    verdict: confirmed ? "Trend confirmed" : "No trend detected",
    unmetRules: unmet,
    sampleRule: `The current period must contain at least ${t.minSampleSize} approved signals.`,
    formula: [
      "Baseline = the immediately preceding period of equal length.",
      "Change % = (current − baseline) ÷ baseline × 100 (undefined when baseline = 0).",
      "Impact-weighted score = Σ impact weight, where Low = 1, Medium = 2, High = 3.",
      "Growth-intensity score = mean growth, where Stable = 0, Slight Increase = 1, Strong Increase = 2.",
      "Progress = change ÷ threshold × 100 (Not applicable when the denominator is not valid).",
    ],
    explanation: confirmed
      ? `For ${scope}, every configured rule is met: activity in ${periods.current.days} days to ${config.to} rose against the preceding ${periods.baseline.days} days.`
      : `For ${scope}, ${unmet.length} rule${unmet.length === 1 ? "" : "s"} ${unmet.length === 1 ? "is" : "are"} not met (${unmet.join("; ")}), so no trend is reported.`,
    disclaimer: "Analyst-configured indicator, not statistical proof.",
  };
}

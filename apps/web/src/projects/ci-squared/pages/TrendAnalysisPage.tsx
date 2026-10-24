/**
 * A trend's own page (request 31; first built as the Megatrends / Competitors
 * "Trend analysis" subtabs in request 27). /analytics/megatrends?m= opens a
 * Macrotrend's dashboard (request 34); /analytics/competitors?c= opens a
 * competitor's page (request 48): Company Profile, Signal Timeline, impact mix
 * by Macrotrend, then Explore Signals.
 *
 * Request 73: the lists of all Macrotrends and all competitors are gone (the
 * Dashboard picks them now): without a trend, and when leaving one, these
 * addresses go back to the Dashboard.
 */
import { useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { DEFAULT_COMPETITOR_TIERS, isPlaceholderCompetitor, tierOf, type Me } from "@eradigm/shared";
import { useCompetitors, useSettings } from "../api/hooks";
import { CompetitorDashboard } from "../components/analytics/CompetitorDashboard";
import { MacroDashboard } from "../components/analytics/MacroDashboard";
import { NEUTRAL, TIER_COLOUR } from "../components/megatrends/model";
import "../styles/megatrends.css";

type Kind = "macro" | "competitor";

export function TrendAnalysisPage({ me, kind }: { me: Me; kind: Kind }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cq = useCompetitors();
  const settings = useSettings();
  const tiers = settings.data?.competitorTiers ?? DEFAULT_COMPETITOR_TIERS;
  const selMacro = kind === "macro" ? params.get("m") : null;
  const selComp = kind === "competitor" ? params.get("c") : null;
  const comps = useMemo(
    () => (cq.data?.competitors ?? []).filter((c) => !isPlaceholderCompetitor(c.name)).map((c) => ({ ...c, tier: tierOf(c.name, tiers) as 1 | 2 | 3 | 4 })),
    [cq.data, tiers],
  );
  const back = () => navigate("/dashboard");

  // Request 34: a Macrotrend opens its own dashboard.
  if (selMacro) return <MacroDashboard me={me} macro={selMacro} onBack={back} />;

  // Request 48: a competitor opens its own page (Company Profile, timeline, impact mix, then Explore Signals).
  if (selComp) {
    const comp = comps.find((c) => c.name === selComp);
    return (
      <CompetitorDashboard
        key={selComp}
        me={me}
        name={selComp}
        summary={comp?.summary ?? null}
        colour={comp ? TIER_COLOUR[comp.tier] : NEUTRAL}
        note={comp ? `Competitor · Tier ${comp.tier}` : "Competitor"}
        onBack={back}
      />
    );
  }

  return <Navigate to="/dashboard" replace />;
}

import { Link } from "react-router-dom";
import type { Me } from "@eradigm/shared";
import { ImpactMixes, RecordFromTimeline, SignalTimeline, useAnalytics, useRecordParam } from "../components/analytics/Analytics";
import "../styles/megatrends.css";

/**
 * Analytics → Dashboard (request 31): the Analytics Dashboard, in the knowledge
 * graph's night sky. The Signal Timeline (zoomable) over all Tracker entries,
 * the impact mixes by Macrotrend and by Competitor side by side, then Trends
 * Analysis: Megatrends and Competitors, each a list that opens a trend's own
 * dashboard and analysis.
 */
export function DashboardPage({ me }: { me: Me }) {
  const { schema, filters, dash } = useAnalytics({}, me);
  const rec = useRecordParam();
  const d = dash.data;
  return (
    <div className="mg-page ad-page" data-testid="analytics-dashboard">
      <header className="mg-head ad-head">
        <div>
          <span className="eyebrow">Analytics</span>
          <h1>Analytics Dashboard</h1>
        </div>
      </header>
      <div className="ad-body">
        {dash.isError && (
          <p className="mg-err" role="alert">
            Could not load the dashboard: {(dash.error as Error).message}
          </p>
        )}
        {d && schema && filters ? (
          <>
            <SignalTimeline data={d} schema={schema} from={filters.from} to={filters.to} onOpen={rec.open} />
            <ImpactMixes filters={filters} schema={schema} show={["macro", "comp"]} />
          </>
        ) : (
          !dash.isError && <div className="ad-skeleton" style={{ height: 520 }} role="status" aria-label="Loading the dashboard" />
        )}
        <section className="ad-trends" aria-labelledby="ad-trends-title">
          <h2 id="ad-trends-title">Trends Analysis</h2>
          <div className="ad-trend-links">
            <Link to="/analytics/megatrends" data-testid="ad-megatrends">
              <b>Megatrends</b>
              <span>Each Macrotrend and its Subtrends: signals over time, impact by competitor and the trend analysis</span>
            </Link>
            <Link to="/analytics/competitors" data-testid="ad-competitors">
              <b>Competitors</b>
              <span>Each competitor: signals over time, impact by Macrotrend and the trend analysis</span>
            </Link>
          </div>
        </section>
      </div>
      {schema && <RecordFromTimeline schema={schema} me={me} />}
    </div>
  );
}

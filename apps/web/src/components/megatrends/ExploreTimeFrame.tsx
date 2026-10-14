import { useCallback, useMemo } from "react";
import { TimeFrameSlider, monthsBetween, timeFrameDates, useTimeFrameParam } from "../analytics/Analytics";

export interface ExploreFrame {
  /** There is a span to pick from (Explore Signals inside a dashboard). */
  framing: boolean;
  /** Part of the span is picked: the graph and its lists show only those signals. */
  framed: boolean;
  inFrame: (date: string) => boolean;
  months: string[];
  range: [number, number];
  setRange: (r: [number, number]) => void;
}

/**
 * Request 58: Explore Signals' time frame. It is the dashboard's (the address's
 * `tf`), so the bar under the graph and the dashboard's Impact Mix move
 * together. No span (the full-page graphs): every date, and no bar.
 */
export function useExploreFrame(span: { from: string; to: string } | undefined): ExploreFrame {
  const months = useMemo(() => (span ? monthsBetween(span.from, span.to) : []), [span?.from, span?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useTimeFrameParam(months);
  const { from, to } = timeFrameDates(months, range);
  const inFrame = useCallback((d: string) => (!from || d >= from) && (!to || d <= to), [from, to]);
  return { framing: months.length > 0, framed: !!(from || to), inFrame, months, range, setRange };
}

/** The slim bar under Explore Signals' graph: the same time frame slider as under the dashboard's Impact Mix. */
export function ExploreTimeFrame({ frame, title }: { frame: ExploreFrame; title: string }) {
  return (
    <div className="mg-frame" data-testid="explore-frame">
      <TimeFrameSlider id="explore" title={title} months={frame.months} range={frame.range} onRange={frame.setRange} />
    </div>
  );
}

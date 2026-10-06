import { useNavigate } from "react-router-dom";

/**
 * Analytics → Knowledge Graph (request 31): one tab for both graphs. The toggle
 * sits at the top left, where "All macrotrends" / "All competitors" was; the
 * current graph's button still goes back to its top level.
 */
export function GraphToggle({ current, onAll }: { current: "megatrends" | "competitors"; onAll: () => void }) {
  const nav = useNavigate();
  return (
    <div className="mg-toggle" role="group" aria-label="Knowledge graph of">
      {(["megatrends", "competitors"] as const).map((k) => (
        <button
          key={k}
          aria-pressed={current === k}
          data-testid={`kg-${k}`}
          title={current === k ? `All ${k}` : `Show the ${k === "megatrends" ? "Megatrends" : "Competitors"} knowledge graph`}
          onClick={() => (current === k ? onAll() : nav(`/${k}`))}
        >
          {k === "megatrends" ? "Megatrends" : "Competitors"}
        </button>
      ))}
    </div>
  );
}

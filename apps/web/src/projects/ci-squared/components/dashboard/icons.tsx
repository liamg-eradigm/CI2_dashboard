/** Request 70: the Profile icons. Macrotrends get a drawn symbol; competitors their logo (Admin → Competitor logos), else their initials. */
import { useEffect, useMemo, type ReactNode } from "react";
import { TIER_COLOUR } from "../megatrends/model";
import { useCompetitorLogo } from "../../api/hooks";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Symbols by what a Macrotrend's name is about (simple line drawings on a 24 grid). */
const SYMBOLS: [RegExp, ReactNode][] = [
  [
    /manufactur|factory|supply/i,
    <path key="f" {...P} d="M3 20V10l5 3v-3l5 3v-3l5 3V5h3v15zM7 17h2M12 17h2M17 17h1" />,
  ],
  [
    /robot/i,
    <g key="r" {...P}>
      <rect x="5" y="9" width="14" height="10" rx="2" />
      <path d="M12 9V5M9 14h.01M15 14h.01M9 17h6" />
      <circle cx="12" cy="4" r="1" />
    </g>,
  ],
  [
    /workforce|upskill|people|talent/i,
    <g key="w" {...P}>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c0 1.2 2.7 3 6 3s6-1.8 6-3v-5M22 9v5" />
    </g>,
  ],
  [
    /medical|health|clinical|intelligence augment/i,
    <path key="m" {...P} d="M3 12h4l2-5 4 10 2-5h6" />,
  ],
  [
    /geopolit|tariff|policy|global/i,
    <g key="g" {...P}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" />
    </g>,
  ],
  [
    /portfolio|m&a|merger|restructur|deal/i,
    <g key="p" {...P}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5h6v2M3 12h18" />
    </g>,
  ],
  [
    /direct|dtp|patient|consumer/i,
    <g key="d" {...P}>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4M12 11v10" />
    </g>,
  ],
  [
    /digital|integrat|platform|data/i,
    <g key="i" {...P}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 6h10M6 8l5 8.3M18 8l-5 8.3" />
    </g>,
  ],
  [
    /\bai\b|r&d|research|model/i,
    <g key="a" {...P}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4M10 10h4v4h-4z" />
    </g>,
  ],
  [
    /^others?$/i,
    <g key="o" {...P}>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </g>,
  ],
];

export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s&-]/gu, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function MacroIcon({ name, colour, hatch }: { name: string; colour: string; hatch?: boolean }) {
  const sym = SYMBOLS.find(([re]) => re.test(name))?.[1];
  return (
    <span className={`dd-icon macro${hatch ? " hatch" : ""}`} style={{ "--c": colour } as React.CSSProperties} aria-hidden="true">
      {sym ? (
        <svg viewBox="0 0 24 24" width="22" height="22">
          {sym}
        </svg>
      ) : (
        <b>{initials(name)}</b>
      )}
    </span>
  );
}

/** A competitor's logo in a rounded square, or its initials in its tier's colour. */
export function CompetitorIcon({ name, tier, logo }: { name: string; tier: number; logo: string | null }) {
  const q = useCompetitorLogo(logo ? name : null, logo);
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url ? (
    <span className="dd-icon logo" aria-hidden="true">
      <img src={url} alt="" />
    </span>
  ) : (
    <span className="dd-icon initials" style={{ "--c": TIER_COLOUR[(tier as 1 | 2 | 3 | 4) ?? 4] ?? TIER_COLOUR[4] } as React.CSSProperties} aria-hidden="true">
      <b>{initials(name)}</b>
    </span>
  );
}

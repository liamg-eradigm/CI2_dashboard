/**
 * Request 70: Admin → Competitor logos. Each competitor's logo for the
 * Dashboard's Competitor Profile (a PNG, JPEG, WebP or GIF of at most 256 KB,
 * shown in a rounded square); without one, its initials in its tier's colour.
 */
import { useEffect, useRef, useState } from "react";
import { COMPETITOR_LOGO_MAX_BYTES, type CompetitorLogo } from "@eradigm/shared";
import { api } from "../../../api/client";
import { useCompetitorLogos, useCompetitors, useInvalidate } from "../api/hooks";
import { CompetitorIcon } from "../components/dashboard/icons";
import { plural } from "../components/megatrends/model";
import { useToast } from "../../../state/toast";

const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function CompetitorLogosCard() {
  const comps = useCompetitors();
  const logos = useCompetitorLogos();
  const inv = useInvalidate();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);
  // The Dashboard's "Add a logo" links here.
  useEffect(() => {
    if (window.location.hash === "#competitor-logos" && comps.data) card.current?.scrollIntoView({ block: "start" });
  }, [comps.data]);
  if (!comps.data) return null;
  const have = new Map((logos.data ?? []).map((l) => [l.name, l.updatedAt]));
  const list = comps.data.competitors.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const upload = async (name: string, file: File) => {
    if (!TYPES.includes(file.type)) return toast("The logo must be a PNG, JPEG, WebP or GIF image", false);
    if (file.size > COMPETITOR_LOGO_MAX_BYTES) return toast(`The logo is too large: at most ${COMPETITOR_LOGO_MAX_BYTES / 1024} KB`, false);
    setBusy(name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api<CompetitorLogo[]>(`/api/competitor-logos?${new URLSearchParams({ name })}`, { method: "PUT", body: fd });
      await inv("competitor-logos");
      toast(`Logo of ${name} saved`);
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (name: string) => {
    setBusy(name);
    try {
      await api(`/api/competitor-logos?${new URLSearchParams({ name })}`, { method: "DELETE" });
      await inv("competitor-logos");
      toast(`Logo of ${name} removed`);
    } catch (e) {
      toast((e as Error).message, false);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" id="competitor-logos" ref={card} aria-labelledby="logos-title" data-testid="competitor-logos">
      <div>
        <h2 className="card-title" id="logos-title">
          Competitor logos
        </h2>
        <span className="card-sub">
          The icons of the Dashboard's Competitor Profile. A PNG, JPEG, WebP or GIF of at most {COMPETITOR_LOGO_MAX_BYTES / 1024} KB, ideally square; it is shown in a rounded square. Without one, a competitor shows its initials in its tier's colour.
        </span>
      </div>
      <input className="control" type="search" placeholder={`Search ${plural(comps.data.competitors.length, "competitor")}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search competitors" style={{ maxWidth: 320 }} />
      <ul className="logo-list">
        {list.map((c) => (
          <li key={c.name} data-testid="logo-row">
            <span className="logo-icon">
              <CompetitorIcon name={c.name} tier={c.tier} logo={have.get(c.name) ?? null} />
            </span>
            <span className="logo-name">
              {c.name} <small>{plural(c.count, "signal")}</small>
            </span>
            <label className={`btn secondary small${busy === c.name ? " disabled" : ""}`}>
              {have.has(c.name) ? "Replace" : "Upload logo"}
              <input
                type="file"
                accept={TYPES.join(",")}
                className="sr-only"
                disabled={busy === c.name}
                aria-label={`${have.has(c.name) ? "Replace" : "Upload"} the logo of ${c.name}`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(c.name, f);
                }}
              />
            </label>
            {have.has(c.name) && (
              <button type="button" className="btn secondary small" disabled={busy === c.name} onClick={() => void remove(c.name)} aria-label={`Remove the logo of ${c.name}`}>
                Remove
              </button>
            )}
          </li>
        ))}
        {!list.length && <li className="muted">No competitor matches “{q}”.</li>}
      </ul>
    </section>
  );
}

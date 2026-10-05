/**
 * Primary sources with prior information (request 27).
 *
 * Duplicate detection (same URL, file or article text) applies to Secondary
 * entries only. A Primary entry from the same source as an earlier one (the
 * same Source Role and Source Company) is not a duplicate: it carries key
 * updates. It is flagged while it is entered, and once in the Tracker it is
 * linked to the entry from that source just before it (by Event Date).
 */

/** The flag shown while a Primary entry from a known source is entered. */
export const PRIOR_PRIMARY_TEXT = "This Source Has Prior Primary Information";

/** One value of the key: trimmed, inner whitespace collapsed, ASCII letters lower-cased (as SQLite's lower(), so stored keys match). */
function part(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The key two Primary entries share when they come from the same source:
 * Source Role and Source Company, ignoring case and spacing. Null unless both
 * are filled in.
 */
export function primarySourceKey(role: unknown, company: unknown): string | null {
  const r = part(role);
  const c = part(company);
  return r && c ? `${r}\u001f${c}` : null;
}

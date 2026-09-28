/**
 * Article extraction helpers. The extraction itself runs in the same native
 * HTMLRewriter pass as sanitisation (see sanitize.ts).
 */
import type { SingleFileInfo } from "./types.js";

export { extractArticle, MAX_BODY_CHARS, toIsoDate } from "./sanitize.js";

export function detectSingleFile(html: string): SingleFileInfo {
  const head = html.slice(0, 8000);
  const detected = /Page saved with SingleFile/i.test(head);
  if (!detected) return { detected: false, sourceUrl: null, savedAt: null };
  const url = /^\s*url:\s*(https?:\/\/\S+)\s*$/im.exec(head)?.[1] ?? null;
  const saved = /^\s*saved date:\s*(.+?)\s*$/im.exec(head)?.[1] ?? null;
  return { detected, sourceUrl: url, savedAt: saved };
}

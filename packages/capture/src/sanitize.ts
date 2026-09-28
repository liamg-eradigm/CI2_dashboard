/**
 * Content scan and sanitisation before storage (2_Input_Architecture).
 *
 *  - Rejects content with known malware markers (EICAR test signature,
 *    embedded Windows executables / installers in data: URIs).
 *  - Strips scripts, trackers, forms, frames, plugins, event handlers,
 *    javascript: URLs, meta refresh and <base>, so the stored snapshot is inert.
 *
 * The snapshot is additionally served to browsers with a sandboxing CSP.
 * This heuristic scan is not a substitute for an antivirus engine; the
 * container capture service can add ClamAV (see services/capture-container).
 */
import { parseHTML } from "linkedom";
import type { ScanResult } from "./types.js";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EXEC_DATA_URI = /data:(?:application\/(?:x-msdownload|x-msdos-program|x-dosexec|vnd\.microsoft\.portable-executable|x-sh|java-archive|x-msi|hta)|text\/x-shellscript)[;,]/i;
const PE_BASE64 = /base64,\s*TV(?:qQ|pQ|oA|pB)AA/;

const REMOVE = [
  "script",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "base",
  "portal",
  "link",
  "meta[http-equiv]",
];
const TRACKER_HOSTS = /(google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|scorecardresearch|quantserve|hotjar|segment\.(io|com)|mixpanel|chartbeat|parsely|pixel\.|analytics\.)/i;
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "srcset", "data"];

export function scanForMalware(html: string): string[] {
  const reasons: string[] = [];
  if (html.includes(EICAR)) reasons.push("EICAR antivirus test signature");
  if (EXEC_DATA_URI.test(html)) reasons.push("Embedded executable data URI");
  if (PE_BASE64.test(html)) reasons.push("Embedded Windows executable (PE header)");
  return reasons;
}

export function sanitizeHtml(raw: string): { html: string; scan: ScanResult } {
  const reasons = scanForMalware(raw);
  const { document } = parseHTML(raw);
  const stats = { scriptsRemoved: 0, formsRemoved: 0, framesRemoved: 0, handlersRemoved: 0, linksRemoved: 0 };

  for (const sel of REMOVE) {
    for (const el of [...document.querySelectorAll(sel)]) {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "noscript") stats.scriptsRemoved++;
      else if (tag === "form" || tag === "input" || tag === "button" || tag === "select" || tag === "textarea") stats.formsRemoved++;
      else if (tag === "iframe" || tag === "frame" || tag === "frameset" || tag === "object" || tag === "embed" || tag === "applet" || tag === "portal") stats.framesRemoved++;
      else if (tag === "link") stats.linksRemoved++;
      el.remove();
    }
  }

  for (const el of [...document.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value ?? "";
      if (name.startsWith("on") || name === "srcdoc" || name === "ping") {
        el.removeAttribute(attr.name);
        stats.handlersRemoved++;
        continue;
      }
      if (URL_ATTRS.includes(name)) {
        // eslint-disable-next-line no-control-regex -- strip control characters used to obfuscate "javascript:" URLs
        const v = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        if (v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("data:text/html") || v.startsWith("data:image/svg+xml")) {
          el.removeAttribute(attr.name);
          stats.handlersRemoved++;
        }
      }
    }
    // Tracking pixels.
    if (el.tagName.toLowerCase() === "img") {
      const src = el.getAttribute("src") ?? "";
      const w = el.getAttribute("width");
      const h = el.getAttribute("height");
      if (TRACKER_HOSTS.test(src) || (w === "1" && h === "1")) {
        el.remove();
        stats.scriptsRemoved++;
      }
    }
  }

  const html = `<!doctype html>\n${document.documentElement?.outerHTML ?? document.toString()}`;
  return { html, scan: { malicious: reasons.length > 0, reasons, ...stats } };
}

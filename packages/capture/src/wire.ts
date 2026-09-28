/**
 * Binary framing for capture results between the capture worker and the API.
 *
 *   [4-byte big-endian JSON length][JSON metadata][sanitised HTML bytes]
 *
 * Sending the snapshot as raw bytes (instead of a JSON string) avoids
 * escaping and re-encoding megabytes of HTML on both sides, which matters
 * under the Workers Free plan CPU limit.
 */
import type { CaptureResult } from "./types.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const CAPTURE_WIRE_TYPE = "application/x-eradigm-capture";

export function encodeCaptureResult(r: CaptureResult): Uint8Array {
  const html = r.ok ? r.html : new Uint8Array();
  const meta = enc.encode(JSON.stringify(r.ok ? { ...r, html: undefined } : r));
  const out = new Uint8Array(4 + meta.byteLength + html.byteLength);
  new DataView(out.buffer).setUint32(0, meta.byteLength);
  out.set(meta, 4);
  out.set(html, 4 + meta.byteLength);
  return out;
}

export function decodeCaptureResult(buf: ArrayBuffer | Uint8Array): CaptureResult {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength < 4) throw new Error("Truncated capture response");
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (4 + len > bytes.byteLength) throw new Error("Truncated capture response");
  const meta = JSON.parse(dec.decode(bytes.subarray(4, 4 + len))) as CaptureResult;
  if (meta.ok) meta.html = bytes.subarray(4 + len);
  return meta;
}

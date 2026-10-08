/**
 * Minimal .docx writer for the Deliverables (Alerts and Newsletters).
 *
 * For now a deliverable is one bold 32 pt paragraph (the entry's Title, or the
 * newsletter's name). The AI-written content will replace `titleDocx` later;
 * the package layout (content types, relationships, styles, A4 page) is a
 * valid WordprocessingML document that Word, Google Docs and LibreOffice open.
 */
import { xmlEscape, zipStore } from "./export.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Word measures font size in half-points: 32 pt is w:sz="64". */
export const DELIVERABLE_TITLE_PT = 32;

const enc = new TextEncoder();
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const CONTENT_TYPES =
  XML +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  "</Types>";

const ROOT_RELS =
  XML +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  "</Relationships>";

const DOC_RELS =
  XML +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

const STYLES =
  XML +
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>` +
  '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';

function core(title: string, createdAt: string): string {
  return (
    XML +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>Eradigm Competitive Intelligence</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`
  );
}

/** A .docx whose only content is `text` in bold, 32 pt (line breaks kept). */
export function titleDocx(text: string, createdAt = new Date().toISOString().replace(/\.\d+Z$/, "Z")): Uint8Array {
  const sz = DELIVERABLE_TITLE_PT * 2;
  const lines = (text.trim() || "Untitled").split(/\r?\n/);
  const runs = lines.map((l, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(l)}</w:t>`).join("");
  const document =
    XML +
    `<w:document xmlns:w="${W}"><w:body>` +
    `<w:p><w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>${runs}</w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
    { name: "docProps/core.xml", data: enc.encode(core(lines[0] ?? "", createdAt)) },
  ]);
}

/**
 * A .docx with a bold 32 pt heading and one paragraph per line below it
 * (request 43: a generated newsletter lists the titles of the entries it was
 * built from, until the AI writer is connected).
 */
export function listDocx(heading: string, lines: string[], createdAt = new Date().toISOString().replace(/\.\d+Z$/, "Z")): Uint8Array {
  const sz = DELIVERABLE_TITLE_PT * 2;
  const head = heading.trim() || "Untitled";
  const items = lines.map((l) => `<w:p><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">•\t${xmlEscape(l.trim() || "Untitled")}</w:t></w:r></w:p>`).join("");
  const document =
    XML +
    `<w:document xmlns:w="${W}"><w:body>` +
    `<w:p><w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(head)}</w:t></w:r></w:p>` +
    items +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(DOC_RELS) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
    { name: "docProps/core.xml", data: enc.encode(core(head, createdAt)) },
  ]);
}

/** Safe .docx file name from a label, e.g. "P-1106 alert" → "P-1106-alert.docx". */
export function docxFileName(label: string, fallback = "deliverable"): string {
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 100);
  return `${safe || fallback}.docx`;
}

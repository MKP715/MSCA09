// The document library: minutes, motions, reports, guidelines, newsletters … 1999 → today.
//
// Sources (volunteers only ever edit the CSV files):
//   data/documents/*.csv          one row per document (the index; publish = yes to show it), split into
//                                 small files: current.csv, archive-<decade>.csv, held.csv (rows that keep
//                                 unredacted originals off the site — never delete them). An older single
//                                 data/documents.csv is still read too, if it exists.
//   data/document-categories.csv  the shelves (label, icon, colour, order)
//   data/generated/drive-files.json  OPTIONAL — written by scripts/drive-index.mjs at build time.
//                                 Files found in the Area's public Drive "docs" folder that are not in
//                                 documents.csv yet are added automatically, titled from their file
//                                 name, so a new upload appears on the site with no CSV edit.
//
// Only documents with publish = yes AND a link (url or Drive id) are shown.
// Safety rules applied whatever the CSV says (Tradition Eleven, BUILD-SPEC §8):
//   - General Service Board quarterly meeting minutes / board weekend reports are never shown (they list
//     trustees and attendees by full name) — a build warning names the row;
//   - the build STOPS if a published row points at the unredacted original of a "-redacted" copy, or at a
//     file that a held row (publish = review / no) keeps off the site;
//   - files found in Drive that are such an original, or are held, are never added automatically;
//   - files the weekly media check holds (data/flyer-holds.csv, or "hold: …" in data/media-review.csv) are left
//     out quietly — a build warning names the row, the build never stops for them.
//
// Returns (BUILD-SPEC §9.5):
//   { all, current, archive, categories, byCategory, byDistrict, byCommittee, latest, pages, stats, facets }
//   Doc = { id, title, title_es, category, collection, date, year, language, format, size_kb, url, drive_id,
//           district, committee, meeting_type, kind, … display helpers (cat_en, cat_es, icon, color, …) }
import fs from "node:fs";
import path from "node:path";
import { readCsv, readCsvDir, yes, list, num, DATA_DIR } from "../_lib/csv.js";
import { LANGS } from "../_lib/i18n.js";

const DRIVE_JSON = path.join(DATA_DIR, "generated", "drive-files.json");
const STATIC_DIR = path.join(process.cwd(), "src", "static");
const THIS_YEAR = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric" }).format(new Date()));

/** First year of the previous panel (panels last two years): "2026–2027" → 2024. Documents from then on are "Current". */
function currentFromYear() {
  const settings = Object.fromEntries(readCsv("settings.csv").map((r) => [r.key, r.value]));
  const first = Number((String(settings.panel_years || "").match(/(19|20)\d{2}/) || [])[0]) || THIS_YEAR - (THIS_YEAR % 2);
  return first - 2;
}

// ------------------------------------------------------------------ helpers
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const pad2 = (n) => String(n).padStart(2, "0");

/** Drive file id from any Drive URL. */
function driveIdOf(u) {
  const s = String(u || "");
  const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : "";
}

/** "d15", "15", "District 15", "D1 & 3", "d01-03" → district slug (BUILD-SPEC §9.1: d01-03, d02 … d30). */
function districtSlug(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  const nums = (s.match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n < 100);
  if (!nums.length) return "";
  // Districts 1 and 3 merged: both map to "d01-03".
  if (nums.includes(1) || (nums.length === 1 && nums[0] === 3)) return "d01-03";
  return "d" + nums.map(pad2).join("-");
}

/** "d01-03" → { nums: [1,3], label: "1 & 3" } */
function districtNumber(slug) {
  const nums = (String(slug || "").match(/\d+/g) || []).map(Number);
  return { nums, label: nums.join(" & ") };
}

function normLanguage(v, fallbackName = "") {
  const s = norm(v);
  const name = norm(fallbackName);
  const hasEn = /\b(en|eng|english|ingles)\b/.test(s);
  const hasEs = /\b(es|sp|spa|span|spanish|espanol|esp)\b/.test(s);
  if ((hasEn && hasEs) || /bilingu|both|en sp|en es/.test(s)) return "Bilingual";
  if (hasEs) return "Spanish";
  if (hasEn) return "English";
  // From a file name: "...-en.pdf", "..._EN_SP.pdf", "ES_Mayo_2026.pdf"
  if (name) {
    if (/\b(en (sp|es)|bilingual)\b/.test(name)) return "Bilingual";
    if (/(^| )(es|sp|span|spanish|espanol)( |$)/.test(name)) return "Spanish";
    if (/(^| )(en|eng|english)( |$)/.test(name)) return "English";
  }
  return "";
}

const MIME_FORMATS = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt",
  "application/vnd.google-apps.document": "doc",
  "application/vnd.google-apps.spreadsheet": "xls",
  "application/vnd.google-apps.presentation": "ppt",
  "text/html": "html",
  "text/plain": "txt",
};

/** Canonical formats: key → English label (Spanish labels come from data/text/documents.csv: documents.format.<key>). */
const FORMATS = {
  pdf: "PDF",
  doc: "Word",
  xls: "Excel",
  ppt: "PowerPoint",
  html: "Web page",
  img: "Image",
  audio: "Audio",
  video: "Video",
  txt: "Text",
  other: "File",
};

/** "PDF", "Word", "DOCX", ".pptx", "Web page", a file name or a MIME type → format key (pdf, doc, xls, ppt, html, img, audio, video, txt). */
function normFormat(v, fileName = "", mime = "") {
  let f = norm(v);
  if (!f && fileName) {
    const m = String(fileName).match(/\.([a-z0-9]{2,5})$/i);
    if (m) f = m[1].toLowerCase();
  }
  if (!f && mime) f = MIME_FORMATS[mime] || (/^image\//.test(mime) ? "img" : /^audio\//.test(mime) ? "audio" : /^video\//.test(mime) ? "video" : "");
  if (!f) return "";
  if (/^pdf/.test(f)) return "pdf";
  if (/^(docx?|word|rtf|odt|google doc)/.test(f)) return "doc";
  if (/^(xlsx?|excel|csv|ods|google sheet)/.test(f)) return "xls";
  if (/^(pptx?|powerpoint|odp|google slide|slides)/.test(f)) return "ppt";
  if (/^(html?|web|pagina web)/.test(f)) return "html";
  if (/^(jpe?g|png|gif|webp|heic|image|imagen)/.test(f)) return "img";
  if (/^(mp3|m4a|wav|audio)/.test(f)) return "audio";
  if (/^(mp4|mov|video)/.test(f)) return "video";
  if (/^(txt|text|texto)/.test(f)) return "txt";
  return "other";
}

// Month names (EN + ES, full and short) → month number.
const MONTHS = {};
[
  ["january", "jan", "enero", "ene"],
  ["february", "feb", "febrero"],
  ["march", "mar", "marzo"],
  ["april", "apr", "abril", "abr"],
  ["may", "mayo"],
  ["june", "jun", "junio"],
  ["july", "jul", "julio"],
  ["august", "aug", "agosto", "ago"],
  ["september", "sep", "sept", "septiembre", "setiembre"],
  ["october", "oct", "octubre"],
  ["november", "nov", "noviembre"],
  ["december", "dec", "diciembre", "dic"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

/** Best-effort date from a file name: { date: "YYYY-MM-DD" | "YYYY-MM" | "", year }. */
function dateFromName(name, folderPath = "") {
  const s = String(name || "");
  let m;
  const ok = (y, mo, d) => y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && (!d || (d >= 1 && d <= 31));
  if ((m = s.match(/(19\d{2}|20\d{2})[._-](\d{1,2})[._-](\d{1,2})(?!\d)/)) && ok(+m[1], +m[2], +m[3]))
    return { date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, year: +m[1] };
  if ((m = s.match(/(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](19\d{2}|20\d{2})(?!\d)/)) && ok(+m[3], +m[1], +m[2]))
    return { date: `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`, year: +m[3] };
  if ((m = s.match(/(19\d{2}|20\d{2})[._-](\d{2})(?!\d)/)) && ok(+m[1], +m[2]))
    return { date: `${m[1]}-${m[2]}`, year: +m[1] };
  const words = norm(s.replace(/\.[a-z0-9]+$/i, "")).split(" ");
  for (let i = 0; i < words.length; i++) {
    const mo = MONTHS[words[i]];
    if (!mo) continue;
    for (let j = i + 1; j <= i + 3 && j < words.length; j++) {
      if (/^(19|20)\d{2}$/.test(words[j])) return { date: `${words[j]}-${pad2(mo)}`, year: +words[j] };
    }
    for (let j = i - 1; j >= i - 2 && j >= 0; j--) {
      if (/^(19|20)\d{2}$/.test(words[j])) return { date: `${words[j]}-${pad2(mo)}`, year: +words[j] };
    }
  }
  if ((m = s.match(/(?<!\d)(19[89]\d|20\d{2})(?!\d)/))) return { date: "", year: +m[1] };
  if ((m = String(folderPath).match(/(?:^|\/)(19[89]\d|20\d{2})(?:\/|$)/))) return { date: "", year: +m[1] };
  return { date: "", year: 0 };
}

const ACRONYMS = new Set([
  "asc", "asa", "csa", "gsc", "gso", "gsb", "gsr", "rsg", "dcm", "dcmc", "cmcd", "mcd", "msca", "aa", "praasa", "prf",
  "cec", "cpc", "pi", "ypaa", "ap", "ar", "p", "pdf", "faq", "faqs", "plbb", "h", "i", "it", "osg", "jsg", "aaws", "usa", "oc", "ie",
]);
const SMALL = new Set(["of", "and", "the", "to", "for", "in", "on", "at", "by", "a", "an", "de", "del", "la", "las", "el", "los", "y", "en", "para", "con"]);

/** A readable title from a file name: "May_2026_Area_Assembly_Approved_Minutes.docx.pdf" → "May 2026 Area Assembly Approved Minutes". */
function titleFromName(name) {
  let s = String(name || "")
    .replace(/(\.(docx?|pdf|xlsx?|pptx?|html?|txt|rtf|jpe?g|png|gif|mp3|m4a|mp4))+$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/_amp_/gi, " & ")
    .replace(/[_]+/g, " ")
    .replace(/(?<=[a-z])-(?=[a-z])/gi, " ")
    .replace(/(?<=\D)-|-(?=\D)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Trailing language markers ("… EN", "… en sp", "… es") are shown as badges instead.
  s = s.replace(/\s+(en\s+(sp|es)|en|eng|english|es|sp|spa|spanish)$/i, "").trim();
  s = s.replace(/^(es|en|sp)\s+/i, "").trim();
  // Leading dates and sequence numbers ("2026-08-22 …", "08_P76_…") are shown as the date instead.
  s = s.replace(/^(19|20)\d{2}[ .]\d{2}[ .]\d{2}\s+/, "").replace(/^\d{1,3}\s+(?=[a-z])/i, "").trim();
  const words = s.split(" ").map((w, i) => {
    const lw = w.toLowerCase();
    if (ACRONYMS.has(lw)) return lw === "msca" ? "MSCA" : lw.toUpperCase();
    if (lw.length > 2 && lw.endsWith("s") && ACRONYMS.has(lw.slice(0, -1))) return lw.slice(0, -1).toUpperCase() + "s";
    if (/^p\d+$/i.test(w)) return "P" + w.slice(1); // P76 (panel)
    if (/^rev$/i.test(w)) return "Rev.";
    if (/^rpt$/i.test(w)) return "Report";
    if (/^stmt$/i.test(w)) return "Statement";
    if (/^qtrs?$/i.test(w)) return "Quarter" + (w.length > 3 ? "s" : "");
    if (/^\d+(st|nd|rd|th)$/i.test(w)) return lw;
    if (w === lw && w.length > 0 && (i === 0 || !SMALL.has(lw))) return w[0].toUpperCase() + w.slice(1);
    return w;
  });
  return (
    words
      .join(" ")
      .replace(/\bH (&|and) I\b/gi, "H&I")
      .replace(/\b((?:19|20)\d{2}) (\d{2}) (\d{2})\b/g, "$1-$2-$3")
      .replace(/\b((?:19|20)\d{2}) (0[1-9]|1[0-2])\b(?! \d)/g, "$1-$2")
      .replace(/\s+/g, " ")
      .trim() || String(name || "")
  );
}

// ------------------------------------------------------------------ categories
function loadCategories() {
  const rows = readCsv("document-categories.csv").filter((r) => r.key && !r.key.startsWith("#"));
  return rows
    .map((r) => ({
      key: r.key.trim().toLowerCase(),
      label_en: r.label_en || r.key,
      label_es: r.label_es || r.label_en || r.key,
      icon: r.icon || "file-text",
      color: r.color || "",
      sort: num(r.sort, 999),
      description_en: r.description_en || "",
      description_es: r.description_es || "",
      // expect_yearly = yes: a year with nothing on this shelf shows "not posted yet" + who to ask (gap_email).
      expect_yearly: yes(r.expect_yearly),
      gap_email: r.gap_email || "",
      aliases: [r.key, r.label_en, r.label_es, ...list(r.aliases)].map(norm).filter(Boolean),
    }))
    .sort((a, b) => a.sort - b.sort);
}

function makeCategoryMatcher(cats) {
  const fallback = cats.find((c) => c.key === "misc") || cats[cats.length - 1];
  const exact = new Map();
  for (const c of cats) for (const a of c.aliases) if (!exact.has(a)) exact.set(a, c);
  /** From a category cell ("Minutes", "Motions & agendas", "delegate") */
  const fromValue = (v) => {
    const n = norm(v);
    if (!n) return null;
    if (exact.has(n)) return exact.get(n);
    // "Area minutes", "Delegate report" … : first alias that appears as a whole word
    for (const c of cats) for (const a of c.aliases) if (a.length > 3 && new RegExp(`\\b${a}\\b`).test(n)) return c;
    return null;
  };
  /** From a Drive path ("docs/reports/Treasurer AP/x.pdf"): deepest matching folder wins. */
  const fromPath = (p) => {
    const segs = String(p || "").split("/").slice(0, -1).map(norm).filter(Boolean).reverse();
    for (const s of segs) {
      if (exact.has(s)) return exact.get(s);
      for (const c of cats) for (const a of c.aliases) if (a.length > 3 && (s.startsWith(a + " ") || s === a)) return c;
    }
    return null;
  };
  return { fromValue, fromPath, fallback };
}

// ------------------------------------------------------------------ committees (names for chips)
const COMMITTEE_FALLBACK = {
  cec: ["CEC", "CEC"],
  cpc: ["CPC", "CCP"],
  ypaa: ["YPAA", "YPAA"],
  "grapevine-la-vina": ["Grapevine & La Viña", "Grapevine y La Viña"],
  "hospitals-institutions": ["H&I", "H&I"],
  "gsr-school": ["GSR School", "Escuela de RSG"],
  "dcm-school": ["DCM School", "Escuela de MCD"],
  archives: ["Archives", "Archivos Históricos"],
  literature: ["Literature", "Literatura"],
  "public-information": ["Public Information", "Información Pública"],
  corrections: ["Corrections", "Instituciones Correccionales"],
  treatment: ["Treatment", "Centros de Tratamiento"],
  accessibilities: ["Accessibilities", "Accesibilidad"],
  finance: ["Finance", "Finanzas"],
  technology: ["Technology", "Tecnología"],
  communications: ["Communications", "Comunicaciones"],
  registration: ["Registration", "Inscripción"],
  "remote-communities": ["Remote Communities", "Comunidades Remotas"],
  "convention-liaison": ["Convention Liaison", "Enlace de Convenciones"],
  "special-needs": ["Special Needs", "Necesidades Especiales"],
  delegate: ["Delegate", "Delegado"],
  treasurer: ["Treasurer", "Tesorero"],
};

function committeeNames() {
  const out = {};
  for (const r of readCsv("committees.csv")) {
    const slug = (r.slug || "").trim();
    if (slug) out[slug] = { name_en: r.name_en || r.name || slug, name_es: r.name_es || r.name_en || r.name || slug };
  }
  return (slug) => {
    if (out[slug]) return out[slug];
    const f = COMMITTEE_FALLBACK[slug];
    if (f) return { name_en: f[0], name_es: f[1] };
    const t = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { name_en: t, name_es: t };
  };
}

/** For files found in Drive (not in the CSV): guess the committee from folder and file names. */
function committeeGuesser() {
  const rules = [];
  const add = (slug, phrase) => {
    const n = norm(phrase);
    // norm() leaves only a–z, 0–9 and spaces, so the phrase is safe inside a RegExp.
    if (n.length >= 3) rules.push({ slug, re: new RegExp(`(^| )${n}( |$)`) });
  };
  for (const r of readCsv("committees.csv")) {
    const slug = (r.slug || "").trim();
    if (!slug || /^(service-event|ad-hoc)$/.test(r.category || "")) continue;
    add(slug, r.name_en);
    add(slug, r.name_es);
    if (/^(CEC|CPC|YPAA|H&I|GAP|PI)$/i.test(r.short_en || "")) add(slug, r.short_en);
    for (const k of list(r.calendar_match)) if (!/@|type:/.test(k) && k.length >= 5) add(slug, k);
  }
  // Folder names used in the Area's Drive.
  add("treasurer-ap", "treasurer ap");
  add("treasurer-ar", "treasurer ar");
  add("grapevine-la-vina", "lavina");
  add("convention-liaison", "conventionliasion");
  add("ypaa", "yppa");
  add("corrections", "correctionales");
  add("public-information", "pi guidelines");
  add("public-information", "pi committee");
  add("accessibilities", "special needs");
  add("convention-liaison", "conventionliasionguidelines");
  add("archives", "archivesguidemsca09");
  return (text) => {
    const n = norm(String(text || "").replace(/[_/-]+/g, " "));
    const hit = rules.find((r) => r.re.test(n));
    return hit ? hit.slug : "";
  };
}

// ------------------------------------------------------------------ documents
const isHttp = (u) => /^https?:\/\//i.test(String(u || ""));
const normPath = (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase().trim();

// Never published automatically, whatever folder they are in (Tradition Eleven / confidential).
const NEVER_AUTO = /roster|confidential|password|private|IMG_7284|paypal|givewp|\bPRF\b.*2028.*(ppt|slides)/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|rtf|txt|html?)$/i;
const GOOGLE_DOC = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation)$/;

function readDriveFiles() {
  const file = process.env.MSCA_DRIVE_JSON || DRIVE_JSON;
  try {
    if (!fs.existsSync(file)) return [];
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(json?.files) ? json.files : [];
  } catch (err) {
    console.warn(`[documents] could not read ${path.relative(process.cwd(), file)}: ${err.message}`);
    return [];
  }
}

function readIndexCsv() {
  // MSCA_DOCUMENTS_CSV lets a developer point the build at a test copy of the index.
  const override = process.env.MSCA_DOCUMENTS_CSV;
  if (override && fs.existsSync(override)) {
    const rel = path.relative(DATA_DIR, override);
    return readCsv(rel);
  }
  // data/documents/*.csv (the split index), plus the older single file if someone still keeps one.
  const rows = [];
  if (fs.existsSync(path.join(DATA_DIR, "documents"))) rows.push(...readCsvDir("documents"));
  if (fs.existsSync(path.join(DATA_DIR, "documents.csv"))) rows.push(...readCsv("documents.csv"));
  return rows;
}

// GSB quarterly meeting minutes and board weekend reports print trustees' and attendees' full names
// (Conference-confidential background): never published, whatever the publish column says.
// The public "General Service Board quarterly report" handouts (F-14) do not match.
const NEVER_PUBLISH =
  /(\bG\.?\s?S\.?\s?B\b|General Service Board|Junta de Servicios Generales|\bJ\.?\s?S\.?\s?G\b).*\b(minutes|meeting|actas|reuni[oó]n)\b|board weekend report|fin de semana de la junta/i;
const neverPublish = (r) =>
  NEVER_PUBLISH.test(`${r.title_en || r.title || ""} ${r.title_es || ""}`) || NEVER_PUBLISH.test(String(r.id || "").replace(/[-_]+/g, " "));

/**
 * Drive ids held by the media check: every data/flyer-holds.csv row, and data/media-review.csv rows whose
 * result starts with "hold" (the rule scripts/check-site.mjs uses). A cell may hold a bare id or a Drive link.
 */
function loadMediaHolds() {
  const ids = new Set();
  const add = (v) => {
    const s = String(v || "").trim();
    if (!s || s.startsWith("#")) return;
    ids.add(s);
    const id = driveIdOf(s);
    if (id) ids.add(id);
  };
  for (const r of readCsv("flyer-holds.csv")) add(r.drive_id);
  for (const r of readCsv("media-review.csv")) if (/^hold/i.test(String(r.result || "").trim())) add(r.drive_id);
  return ids;
}

/** "docs/minutes/2024/feb-2024-asc-minutes-en-redacted.pdf" → "docs/minutes/2024/feb-2024-asc-minutes-en" (lower case). */
const twinBase = (p) => normPath(p).replace(/\.[a-z0-9]{2,5}$/, "").replace(/-redacted$/, "");
const isRedactedCopy = (p) => /-redacted\.[a-z0-9]{2,5}$/i.test(String(p || ""));

function sortKey(d) {
  return d.date ? d.date.padEnd(10, "-00") : d.year ? `${d.year}-00-00` : "0000-00-00";
}
const newestFirst = (a, b) => sortKey(b).localeCompare(sortKey(a)) || a.title.localeCompare(b.title, "en", { numeric: true });

let CURRENT_FROM = 0;

function loadDocuments() {
  CURRENT_FROM = currentFromYear();
  const cats = loadCategories();
  const match = makeCategoryMatcher(cats);
  const committee = committeeNames();
  const guessCommittee = committeeGuesser();

  const rows = readIndexCsv();
  const driveFiles = readDriveFiles();
  const driveById = new Map(driveFiles.map((f) => [f.id, f]));
  const driveByPath = new Map(driveFiles.map((f) => [normPath(f.path), f]));

  const docs = [];
  const seenUrl = new Set();
  const seenDrive = new Set();
  const seenPath = new Set();
  let withheld = 0;
  let unlinked = 0;
  const warnings = [];
  const futureDated = [];

  const build = (src, auto) => {
    const fileName = src.name || (src.drive_path || "").split("/").pop() || "";
    let url = src.url || "";
    let drive_id = src.drive_id || driveIdOf(url);
    // A repo-relative or empty url: a copy kept in src/static/ (served at /docs/…), else the Drive copy.
    if (!isHttp(url)) {
      const rel = String(url || "").replace(/^\/+/, "");
      const f = (drive_id && driveById.get(drive_id)) || driveByPath.get(normPath(src.drive_path));
      if (rel && fs.existsSync(path.join(STATIC_DIR, rel))) {
        url = "/" + rel;
      } else if (f) {
        url = f.url || `https://drive.google.com/file/d/${f.id}/view`;
        drive_id = f.id;
      } else if (drive_id) {
        url = `https://drive.google.com/file/d/${drive_id}/view`;
      } else url = "";
    }
    const cat =
      match.fromValue(src.category) ||
      match.fromPath(src.drive_path) ||
      match.fromValue(src.title_en) ||
      match.fallback;
    const fromName = dateFromName(fileName, src.drive_path);
    let date = String(src.date || "").trim();
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) date = "";
    if (/^\d{4}$/.test(date)) date = "";
    let year = num(src.year, 0) || (date ? +date.slice(0, 4) : 0);
    if (!date && !year && auto) {
      date = fromName.date;
      year = fromName.year;
    }
    if (!year && date) year = +date.slice(0, 4);
    // A date after this year is a typo (or a file-name misread): show the document as undated instead.
    if (year > THIS_YEAR) {
      futureDated.push(`${src.id || fileName} (${date || year})`);
      date = "";
      year = 0;
    }
    let title = src.title_en || src.title || (fileName ? titleFromName(fileName) : "");
    // "Mayo 2026" (a minutes file named only by its month) → "Actas – Mayo 2026"
    if (auto && cat.key === "minutes" && !/minute|acta|mins\b/i.test(title)) {
      title = (/^spanish$/i.test(normLanguage(src.language, fileName.replace(/\.[a-z0-9]+$/i, ""))) ? "Actas – " : "Minutes – ") + title;
    }
    const title_es = src.title_es && src.title_es !== title ? src.title_es : "";
    const district = districtSlug(src.district) || districtSlug((String(src.drive_path || "").match(/districts?\/d(\d+)\//i) || [])[1] || "");
    let committees = list(src.committee).map((s) => s.toLowerCase());
    if (!committees.length && auto) {
      const g = guessCommittee(String(src.drive_path || "").replace(/^docs\//i, "").replace(/\.[a-z0-9]+$/i, ""));
      if (g) committees = [g];
    }
    const language = normLanguage(src.language, auto ? fileName.replace(/\.[a-z0-9]+$/i, "") : "");
    const coll = norm(src.collection);
    // Current = this panel and the previous one, whatever the CSV says; older documents are the archive.
    const collection = year && year >= CURRENT_FROM
      ? "current"
      : coll.startsWith("arch") || coll.startsWith("hist")
        ? "archive"
        : coll.startsWith("cur") || coll.startsWith("act")
          ? "current"
          : /(^|\/)archive\//i.test(src.drive_path || "")
            ? "archive"
            : "current";
    const meeting = String(src.meeting_type || "").trim();
    const mt = meeting || (cat.key === "minutes" ? (/\b(asa|assembly|asamblea)\b/i.test(title) ? "ASA" : /\b(asc|committee|comite)\b/i.test(title) ? "ASC" : "") : "");
    const dn = district ? districtNumber(district) : null;
    const cm = committees.map((slug) => ({ slug, ...committee(slug) }));
    return {
      id: src.id || drive_id || normPath(src.drive_path) || url,
      title,
      title_es,
      category: cat.key,
      cat_en: cat.label_en,
      cat_es: cat.label_es,
      icon: cat.icon,
      color: cat.color,
      collection,
      date,
      year: year || "",
      language,
      fmt: normFormat(src.format, fileName, src.mimeType),
      format: FORMATS[normFormat(src.format, fileName, src.mimeType)] || "",
      size_kb: Math.round(num(src.size_kb, 0)) || (src.size ? Math.max(1, Math.round(Number(src.size) / 1024)) : 0),
      url,
      drive_id,
      district,
      district_label: dn ? dn.label : "",
      committee: committees[0] || "",
      committees,
      committee_en: cm.map((c) => c.name_en).join(", "),
      committee_es: cm.map((c) => c.name_es).join(", "),
      meeting_type: mt,
      kind: (src.kind || mt || cat.key).toLowerCase(),
      source: src.source || (auto ? "Drive" : ""),
      notes: src.notes || "",
      auto,
    };
  };

  // Files the index keeps off the site (publish = review / no), and the originals of "-redacted" copies.
  const heldPaths = new Set();
  const heldIds = new Set();
  const twins = new Set();
  for (const r of rows) {
    if (isRedactedCopy(r.drive_path)) twins.add(twinBase(r.drive_path));
    if (yes(r.publish)) continue;
    if (r.drive_path) heldPaths.add(normPath(r.drive_path));
    const did = driveIdOf(r.url) || (r.drive_id || "");
    if (did) heldIds.add(did);
  }
  // Files the weekly media check (scripts/check-media.mjs) holds because their printed words show a personal
  // phone number, e-mail address or sobriety date: every row of data/flyer-holds.csv, and data/media-review.csv
  // rows whose result starts with "hold" (the same rule as scripts/check-site.mjs). They are simply left out —
  // never a build error — so a new hold never stops the website from publishing.
  const mediaHeld = loadMediaHolds();
  const mediaWithheld = [];
  const unsafe = [];
  const blocked = [];
  const seenIds = new Map();
  const dupIds = [];

  // 1. The index (data/documents/*.csv)
  for (const r of rows) {
    const p = normPath(r.drive_path);
    const did = driveIdOf(r.url) || (r.drive_id || "");
    const where = `${r._file || "documents.csv"} row ${r._row} (${r.id || p || did})`;
    if (r.id) {
      if (seenIds.has(r.id)) dupIds.push(`${where} — same id as ${seenIds.get(r.id)}`);
      else seenIds.set(r.id, `${r._file} row ${r._row}`);
    }
    // Remember every listed file — even withheld ones — so the Drive scan never re-adds them.
    if (p) seenPath.add(p);
    if (did) seenDrive.add(did);
    if (!yes(r.publish)) {
      withheld++;
      continue;
    }
    if (p && !isRedactedCopy(p) && twins.has(twinBase(p))) unsafe.push(`${where}: the unredacted original of a "-redacted" copy`);
    if ((p && heldPaths.has(p)) || (did && heldIds.has(did))) unsafe.push(`${where}: the same file as a held row (publish = review / no)`);
    if (neverPublish(r)) {
      blocked.push(where);
      withheld++;
      continue;
    }
    const d = build(r, false);
    const heldId = [did, d.drive_id, driveIdOf(d.url)].find((id) => id && mediaHeld.has(id));
    if (heldId) {
      withheld++;
      mediaWithheld.push(`${r._file || "documents.csv"} row ${r._row} (${r.id || heldId})`);
      continue;
    }
    if (!d.url) {
      unlinked++;
      continue;
    }
    if (!d.title) {
      warnings.push(`row ${r._row}: no title`);
      continue;
    }
    if (seenUrl.has(d.url)) continue; // duplicate row
    seenUrl.add(d.url);
    docs.push(d);
  }
  if (unsafe.length) {
    throw new Error(
      `[documents] ${unsafe.length} published row(s) would put an unredacted or held file on the site (Tradition Eleven). ` +
        `Set publish = review on these rows, or remove them:\n   ` +
        unsafe.join("\n   ")
    );
  }

  // 2. New files in Drive that the index does not list yet.
  let auto = 0;
  const byFolderName = new Set(driveFiles.map((f) => normPath(f.path)));
  for (const f of driveFiles) {
    const p = normPath(f.path);
    if (!f.id || seenDrive.has(f.id) || seenPath.has(p)) continue;
    if (!/^docs\//.test(p) && !f.category) continue; // only the public docs/ folder (or folders given a category)
    // Event flyers and agendas belong to their calendar entries (/events/…), not to the library.
    if (/^docs\/(events|meetings)\//.test(p) && !f.category) continue;
    if (/(^|\/)(old|_old|trash|private|drafts?)\//.test(p)) continue;
    if (/(^|\/)(readme\.md|desktop\.ini)$/.test(p) || /\.lnk$/.test(p)) continue;
    if (NEVER_AUTO.test(f.name || "") || NEVER_AUTO.test(f.path || "")) continue;
    // The unredacted original of a "-redacted" copy, or a file held for review: never listed.
    if ((!isRedactedCopy(p) && twins.has(twinBase(p))) || heldPaths.has(p) || heldIds.has(f.id) || mediaHeld.has(f.id)) continue;
    if (neverPublish({ title: f.name, id: f.path })) continue;
    const isDoc = DOC_EXT.test(f.name || "") || GOOGLE_DOC.test(f.mimeType || "");
    if (!isDoc && !f.category) continue; // images etc. only when drive-folders.csv gives the folder a category
    // "Report (1).pdf" next to "Report.pdf" is a duplicate upload.
    const dupOf = p.replace(/\s*\(\d+\)(\.[a-z0-9]+)$/, "$1");
    if (dupOf !== p && byFolderName.has(dupOf)) continue;
    const d = build(
      {
        id: f.id,
        name: f.name,
        drive_path: f.path,
        url: f.url,
        drive_id: f.id,
        category: f.category,
        collection: f.collection,
        size: f.size,
        mimeType: f.mimeType,
      },
      true
    );
    if (!d.url || seenUrl.has(d.url)) continue;
    seenUrl.add(d.url);
    seenDrive.add(f.id);
    docs.push(d);
    auto++;
  }

  // Two published rows with the same title, date and language: readers cannot tell which is the right one.
  const dupKey = new Map();
  const dups = [];
  for (const d of docs) {
    if (d.auto) continue;
    const k = [norm(d.title), d.date || d.year, d.language].join("|");
    if (dupKey.has(k)) dups.push(`${d.id} = ${dupKey.get(k)}`);
    else dupKey.set(k, d.id);
  }

  if (!loadDocuments.warned) {
    loadDocuments.warned = true; // once per process (the dev server rebuilds often)
    if (warnings.length)
      console.warn(`[documents] ${warnings.length} row(s) in data/documents/ skipped:\n   ` + warnings.slice(0, 10).join("\n   "));
    if (blocked.length)
      console.warn(
        `[documents] ${blocked.length} row(s) not published: General Service Board meeting minutes / board weekend reports ` +
          `list trustees and attendees by full name. Set publish = no:\n   ` +
          blocked.join("\n   ")
      );
    if (mediaWithheld.length)
      console.warn(
        `[documents] ${mediaWithheld.length} published document(s) not shown: the media check holds them (data/flyer-holds.csv / ` +
          `data/media-review.csv). Upload a corrected copy in Drive (Manage versions, same id), then delete the hold row ` +
          `and mark it "cleared" in data/media-review.csv:\n   ` +
          mediaWithheld.slice(0, 20).join("\n   ") +
          (mediaWithheld.length > 20 ? `\n   … and ${mediaWithheld.length - 20} more` : "")
      );
    if (dupIds.length) console.warn(`[documents] ${dupIds.length} duplicate id(s):\n   ` + dupIds.slice(0, 10).join("\n   "));
    if (dups.length)
      console.warn(
        `[documents] ${dups.length} published document(s) share title, date and language with another one — keep one ` +
          `(publish = no, note "duplicate of <id>") or make the titles different:\n   ` +
          dups.slice(0, 10).join("\n   ")
      );
    if (futureDated.length)
      console.warn(
        `[documents] ${futureDated.length} document(s) dated after ${THIS_YEAR} are shown as undated — fix the date in data/documents.csv:\n   ` +
          futureDated.slice(0, 10).join("\n   ")
      );
  }

  docs.sort(newestFirst);

  // ---------------------------------------------------------------- groupings
  const byCategory = Object.fromEntries(cats.map((c) => [c.key, []]));
  const byDistrict = {};
  const byCommittee = {};
  for (const d of docs) {
    (byCategory[d.category] ||= []).push(d);
    if (d.district) (byDistrict[d.district] ||= []).push(d);
    for (const c of d.committees) (byCommittee[c] ||= []).push(d);
  }

  const groupYears = (items) => {
    const map = new Map();
    for (const d of items) {
      const y = d.year ? String(d.year) : "";
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(d);
    }
    return [...map]
      .sort((a, b) => (b[0] || "0").localeCompare(a[0] || "0"))
      .map(([year, items]) => ({ year, items }));
  };
  const countBy = (items, fn) => {
    const out = {};
    for (const d of items) {
      const k = fn(d);
      if (k) out[k] = (out[k] || 0) + 1;
    }
    return out;
  };

  const categories = cats.map((c) => {
    const items = byCategory[c.key] || [];
    const years = [...new Set(items.map((d) => d.year).filter(Boolean))].sort((a, b) => b - a);
    return {
      key: c.key,
      label_en: c.label_en,
      label_es: c.label_es,
      icon: c.icon,
      color: c.color,
      sort: c.sort,
      description_en: c.description_en,
      description_es: c.description_es,
      expect_yearly: c.expect_yearly,
      gap_email: c.gap_email,
      url: `/documents/${c.key}/`,
      count: items.length,
      years,
      firstYear: years.length ? years[years.length - 1] : "",
      lastYear: years.length ? years[0] : "",
      current: items.filter((d) => d.collection === "current").length,
      archive: items.filter((d) => d.collection === "archive").length,
      languages: countBy(items, (d) => d.language),
      latest: items[0] || null,
    };
  });
  const shelves = categories.filter((c) => c.count > 0);

  const latestOf = (key, n = 16, keep = () => true) => (byCategory[key] || []).filter((d) => d.year && keep(d)).slice(0, n);
  // Agendas of Area meetings and motions — not treasurer reports or other papers filed on the same shelf.
  const isAgendaOrMotion = (d) =>
    /\b(agenda|agendas|motions?|mociones|moci[oó]n|orden del d[ií]a)\b/i.test(`${d.title} ${d.title_es}`) &&
    !/\b(treasurer|tesorer|report|informe)\b/i.test(`${d.title} ${d.title_es}`);
  const latest = {
    minutes: latestOf("minutes", 16, (d) => /^(ASC|ASA)$/i.test(d.meeting_type) || /\b(asc|asa|csa|assembly|asamblea|area committee)\b/i.test(d.title)),
    motions: latestOf("motions", 16, isAgendaOrMotion),
    // Officer, committee and delegate reports, plus the treasurer's reports and statements.
    reports: [
      ...(byCategory.reports || []),
      ...(byCategory.conference || []),
      ...(byCategory.finances || []).filter((d) => /report|informe|statement|estado|budget|presupuesto|treasurer|tesorer/i.test(d.title + " " + d.title_es)),
    ]
      .filter((d) => d.year)
      .sort(newestFirst)
      .slice(0, 12),
  };

  // Every year from the oldest document to the newest (gaps included, so charts keep a true time axis).
  const yearCounts = countBy(docs, (d) => d.year && String(d.year));
  const yearNums = Object.keys(yearCounts).map(Number);
  const years = [];
  if (yearNums.length) {
    for (let y = Math.min(...yearNums); y <= Math.max(...yearNums); y++) {
      years.push({
        year: y,
        count: yearCounts[y] || 0,
        archive: docs.filter((d) => +d.year === y && d.collection === "archive").length,
      });
    }
  }
  const yearMax = Math.max(1, ...years.map((y) => y.count));
  for (const y of years) y.h = y.count ? Math.max(6, Math.round((y.count / yearMax) * 100)) : 0;

  // Per-shelf sparkline: documents per year on the shared time axis, scaled to the shelf's busiest year.
  for (const c of categories) {
    const per = countBy(byCategory[c.key] || [], (d) => d.year && String(d.year));
    const max = Math.max(1, ...Object.values(per));
    c.spark = years.map((y) => ({ year: y.year, n: per[y.year] || 0, h: per[y.year] ? Math.max(10, Math.round((per[y.year] / max) * 100)) : 0 }));
  }

  // Category pages (both languages): every document of a shelf, by year. rank = 0 for the newest year with
  // documents (the page folds older years on phones). Shelves that expect documents every year get a
  // { year, gap: true } entry for each missing year from their first year to this one.
  const withGaps = (c, groups) => {
    const out = groups.filter((g) => g.year);
    if (c.expect_yearly && c.firstYear) {
      const have = new Set(out.map((g) => +g.year));
      const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "numeric" }).format(new Date()));
      const last = month > 2 ? THIS_YEAR : THIS_YEAR - 1; // January's minutes are approved in February or March
      for (let y = +c.firstYear; y <= last; y++) if (!have.has(y)) out.push({ year: String(y), items: [], gap: true });
      out.sort((a, b) => b.year.localeCompare(a.year));
    }
    let rank = 0;
    for (const g of out) if (!g.gap) g.rank = rank++;
    const undated = groups.find((g) => !g.year);
    if (undated) out.push({ ...undated, rank: rank++ });
    return out;
  };
  const pageItems = shelves.map((c) => ({ ...c, groups: withGaps(c, groupYears(byCategory[c.key] || [])) }));
  const pages = LANGS.flatMap((lang) => pageItems.map((item) => ({ lang, item })));

  // Facets for the library's filter panel.
  const districtCounts = countBy(docs, (d) => d.district);
  const committeeCounts = {};
  for (const d of docs) for (const c of d.committees) committeeCounts[c] = (committeeCounts[c] || 0) + 1;
  const facets = {
    years,
    districts: Object.entries(districtCounts)
      .map(([slug, count]) => ({ slug, label: districtNumber(slug).label, first: districtNumber(slug).nums[0] || 0, count }))
      .sort((a, b) => a.first - b.first),
    committees: Object.entries(committeeCounts)
      .map(([slug, count]) => ({ slug, ...committee(slug), count }))
      .sort((a, b) => a.name_en.localeCompare(b.name_en)),
    formats: Object.entries(countBy(docs, (d) => d.fmt))
      .map(([key, count]) => ({ key, label: FORMATS[key] || key, count }))
      .sort((a, b) => b.count - a.count),
    languages: ["English", "Spanish", "Bilingual"]
      .map((key) => ({ key, count: docs.filter((d) => d.language === key).length }))
      .filter((x) => x.count),
  };

  const current = docs.filter((d) => d.collection === "current");
  const archive = docs.filter((d) => d.collection === "archive");
  const dated = docs.filter((d) => d.year);
  const sourceKind = (s) => {
    const n = norm(s);
    if (/legacy|area09 org|area 09 legacy/.test(n)) return "area09";
    if (/msca09|wordpress|website/.test(n)) return "msca09";
    if (/drive/.test(n)) return "drive";
    return n ? "other" : "";
  };
  const sources = countBy(archive, (d) => sourceKind(d.source));
  // Where the archive came from: { area09: { count, first, last }, msca09: {…} }
  const sourceYears = {};
  for (const d of archive) {
    const k = sourceKind(d.source);
    if (!k) continue;
    const s = (sourceYears[k] ||= { count: 0, first: 0, last: 0 });
    s.count++;
    const y = +d.year;
    if (y) {
      s.first = s.first ? Math.min(s.first, y) : y;
      s.last = Math.max(s.last, y);
    }
  }
  // Archive documents by shelf (for /documents/archive/).
  const archiveShelves = categories
    .map((c) => ({ key: c.key, label_en: c.label_en, label_es: c.label_es, icon: c.icon, color: c.color, count: c.archive }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const archiveYearList = years.filter((y) => y.archive).map((y) => y.year);
  const archiveYearsChart = years
    .filter((y) => archiveYearList.length && y.year >= archiveYearList[0] && y.year <= archiveYearList[archiveYearList.length - 1])
    .map((y) => ({ year: y.year, n: y.archive }));
  const archiveMax = Math.max(1, ...archiveYearsChart.map((y) => y.n));
  for (const y of archiveYearsChart) y.h = y.n ? Math.max(4, Math.round((y.n / archiveMax) * 100)) : 0;
  const archiveYears = archive.map((d) => +d.year).filter(Boolean);

  const stats = {
    total: docs.length,
    current: current.length,
    archive: archive.length,
    english: docs.filter((d) => d.language === "English").length,
    spanish: docs.filter((d) => d.language === "Spanish").length,
    bilingual: docs.filter((d) => d.language === "Bilingual").length,
    shelves: shelves.length,
    firstYear: dated.length ? Math.min(...dated.map((d) => +d.year)) : "",
    lastYear: dated.length ? Math.max(...dated.map((d) => +d.year)) : "",
    currentFrom: CURRENT_FROM,
    archiveFirstYear: archiveYears.length ? Math.min(...archiveYears) : "",
    archiveLastYear: archiveYears.length ? Math.max(...archiveYears) : "",
    undated: docs.length - dated.length,
    withheld,
    unlinked,
    auto,
    sources,
    sourceYears,
    archiveShelves,
    archiveYears: archiveYearsChart,
    districts: Object.keys(byDistrict).length,
    newest: docs.find((d) => d.date) || null,
    totalMb: Math.round(docs.reduce((s, d) => s + (d.size_kb || 0), 0) / 1024),
  };

  return {
    all: docs,
    current,
    archive,
    categories: shelves,
    allCategories: categories,
    categoryMap: Object.fromEntries(categories.map((c) => [c.key, c])),
    byCategory,
    byDistrict,
    byCommittee,
    latest,
    pages,
    facets,
    stats,
  };
}

export default function () {
  return loadDocuments();
}

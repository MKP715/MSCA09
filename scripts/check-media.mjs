// Reads the words printed in flyers and PDFs before the website shows them (Tradition Eleven).
//
//   node scripts/check-media.mjs                  check new files (at most 150), update the CSVs
//   node scripts/check-media.mjs --limit 20       check at most 20 files this time
//   node scripts/check-media.mjs --dry-run        report only, change no file
//   node scripts/check-media.mjs --holds <file> --review <file>   use other CSV files (testing)
//   node scripts/check-media.mjs --extra-links   also read the Drive files linked from committee-resources.csv,
//                                                resources.csv, motions.csv and districts.csv (run it after adding
//                                                such a link; a hold there must be resolved by removing the link)
//   node scripts/check-media.mjs --ids <id,id…|@file>   read only these Drive files (again), e.g. after a
//                                                  file was replaced; their old rows are replaced
//
// Which files: every Google Drive file in an IMG: or Link: line of the Area calendar
// (data/calendar.ics) and every document published in data/documents/*.csv (publish = yes).
// Each file is read once: the result is written to data/media-review.csv
// (drive_id, checked_on, result, notes) and the file is not read again unless its row is
// deleted. A file whose words include a phone number or e-mail address that is not a public
// office line or a role mailbox (data/contact-allowlist.csv, data/central-offices.csv,
// …@msca09aa.org), or a sobriety date / "years sober", gets a row in data/flyer-holds.csv:
// the website then leaves it out (and `npm run check` refuses to publish a page linking it).
// The details found are never written anywhere — only what kind of detail it was.
//
// A false alarm (OCR misread, a public line): open the file, then delete its row in
// data/flyer-holds.csv and change its result in data/media-review.csv to "cleared".
//
// Needs: tesseract (with the eng and spa languages) for pictures, pdftotext and pdftoppm
// (poppler-utils) for PDFs. The weekly workflow .github/workflows/media-check.yml installs
// them. Word, Excel and PowerPoint files (.docx/.xlsx/.pptx, and old .doc/.xls) are read
// directly, without any program. When a tool is missing the script says so and checks what it
// can — it never fails a build. Other OCR/PDF programs can be plugged in with MEDIA_OCR_CMD
// ("{in}" = image file) and MEDIA_PDFTEXT_CMD / MEDIA_RASTER_CMD ("{in}", "{out}"; the raster
// command must write {out}-1.png, {out}-2.png … for the first 3 pages).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { readCsv, readCsvDir, parseCsvText, yes } from "../src/_lib/csv.js";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes("--dry-run");
const ONLY = (() => {
  const v = opt("--ids", "");
  const text = v.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : v;
  const ids = text.split(/[\s,]+/).filter(Boolean);
  return ids.length ? new Set(ids) : null;
})();
const LIMIT = Number(opt("--limit", process.env.MEDIA_LIMIT || 150)) || 150;
const MAX_MINUTES = Number(opt("--max-minutes", process.env.MEDIA_MAX_MINUTES || 45)) || 45;
const HOLDS = path.resolve(opt("--holds", "data/flyer-holds.csv"));
const REVIEW = path.resolve(opt("--review", "data/media-review.csv"));
const TODAY = new Date().toISOString().slice(0, 10);
const started = Date.now();

const OCR_CMD = process.env.MEDIA_OCR_CMD || 'tesseract "{in}" stdout -l eng+spa --psm 3';
// every page: reading a PDF's text layer is fast (only scanned pages, below, are slow)
const PDFTEXT_CMD = process.env.MEDIA_PDFTEXT_CMD || 'pdftotext -layout "{in}" -';
const RASTER_CMD = process.env.MEDIA_RASTER_CMD || 'pdftoppm -r 150 -f 1 -l 3 -png "{in}" "{out}"';

const run = (cmd, timeout = 120000) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout, maxBuffer: 64 * 1024 * 1024 });
// Is a program installed? (Some print their version and exit with a non-zero code, e.g. pdftotext -v.)
// A missing program: exit code 127 ("/bin/sh: tesseract: not found") or, on Windows, "'tesseract' is not
// recognized as an internal or external command" — both name the program, so look for those words first.
const has = (cmd) => {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 20000 });
    return true;
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    if (e.status === 127 || e.code === "ENOENT" || /not found|not recognized|no such file|cannot find/i.test(out)) return false;
    return /version|copyright|poppler|tesseract/i.test(out);
  }
};
const tools = {
  ocr: process.env.MEDIA_OCR_CMD ? true : has("tesseract --version"),
  pdftext: process.env.MEDIA_PDFTEXT_CMD ? true : has("pdftotext -v"),
  raster: process.env.MEDIA_RASTER_CMD ? true : has("pdftoppm -v"),
};
if (!tools.ocr) console.log("tesseract is not installed: pictures cannot be read this time (install tesseract-ocr tesseract-ocr-spa).");
if (!tools.pdftext) console.log("pdftotext is not installed: PDFs cannot be read this time (install poppler-utils).");
if (!tools.ocr && !tools.pdftext) {
  console.log("Nothing to read with — no file was checked.");
  process.exit(0);
}

/* ------------------------------------------------------------------ CSV helpers */
const q = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// --ids: the files read again replace their old rows (and a file that is now clean leaves flyer-holds.csv).
function dropRows(file, ids) {
  if (!ids.size || DRY || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const keep = lines.filter((l, i) => i === 0 || !ids.has(l.split(",")[0].trim()));
  if (keep.length !== lines.length) fs.writeFileSync(file, keep.join(nl));
}
function appendRows(file, header, comments, rows) {
  if (!rows.length || DRY) return;
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  if (!text.trim()) text = [header.join(","), ...comments.map((c) => q(c) + ",".repeat(header.length - 1))].join(nl) + nl;
  if (!text.endsWith("\n")) text += nl;
  text += rows.map((r) => header.map((h) => q(r[h])).join(",")).join(nl) + nl;
  fs.writeFileSync(file, text);
}
// Rows of a CSV file anywhere (the holds/review files may be test copies outside data/).
const readRows = (file) => {
  if (!fs.existsSync(file)) return [];
  const { records } = parseCsvText(fs.readFileSync(file, "utf8"), path.basename(file));
  if (!records.length) return [];
  const header = records[0].record.map((h) => String(h).trim().toLowerCase());
  return records
    .slice(1)
    .map(({ record }) => Object.fromEntries(header.map((h, i) => [h, String(record[i] ?? "").trim()])))
    .filter((r) => !String(Object.values(r)[0] || "").startsWith("#"));
};

/* ------------------------------------------------------------------ what may be printed */
const allow = readCsv("contact-allowlist.csv");
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const okPhones = new Set(allow.filter((r) => r.kind === "phone").map((r) => digits(r.value)));
for (const file of ["central-offices.csv", "resources.csv"]) {
  for (const row of readCsv(file)) for (const v of Object.values(row)) for (const m of String(v).matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) okPhones.add(digits(m[0]));
}
// OCR confuses l/I/1 and 0/O: compare addresses by their "skeleton".
const skeleton = (s) => String(s).toLowerCase().replace(/[1il|]/g, "l").replace(/0/g, "o").replace(/rn/g, "m").replace(/\s+/g, "");
const okEmails = new Set(allow.filter((r) => r.kind === "email").map((r) => skeleton(r.value)));
const ROLE_DOMAINS = ["msca09aa.org", "aa.org", "aagrapevine.org", "area9btg.org"].map((d) => "@" + skeleton(d));

// Up to 4 separator characters between the groups, line breaks and the Unicode hyphens included: PDF text
// often breaks a number over two lines ("(714)\n\n555-0123") or prints "909‐555‐0147" with U+2010.
const PHONE = /(?<![\d#])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.\-‐-―−]{0,4}(\d{3})[\s.\-‐-―−]{0,4}(\d{4})(?!\d)/g;
const ID_LABEL = /(?:\bzoom\s*(?:meeting\s*)?(?:id|#)?|(?:meeting|webinar|reuni[oó]n)\s*(?:id|#)|zoom(?:gov)?\.us\/\w+\/|\bid\s*(?:de\s+(?:la\s+)?reuni[oó]n|de\s+zoom)?|\bpmi|passcode|password|contrase[nñ]a|c[oó]digo)\s*[:#=-]?\s*$/i;
const EMAIL = /[\w.+-]+\s?@\s?[\w-]+(?:\.[\w-]+)+/g;
const SOBRIETY = /sobriety\s+(date|birthday|anniversary)|years?\s+(of\s+)?sob(er|riety)|sober\s+(since|date|birthday|anniversary)|fecha\s+de\s+sobriedad|años\s+de\s+sobriedad|aniversario\s+de\s+sobriedad/i;

function analyse(text) {
  const found = { phone: 0, email: 0, sobriety: 0 };
  const t = String(text || "").replace(/\r/g, "");
  for (const m of t.matchAll(PHONE)) {
    const d = m[1] + m[2] + m[3];
    if (okPhones.has(d) || /^8(00|33|44|55|66|77|88)/.test(d)) continue;
    if (ID_LABEL.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
    found.phone++;
  }
  for (const m of t.matchAll(EMAIL)) {
    const sk = skeleton(m[0].replace(/[.,;:]+$/, ""));
    if (ROLE_DOMAINS.some((d) => sk.endsWith(d)) || okEmails.has(sk)) continue;
    found.email++;
  }
  if (SOBRIETY.test(t)) found.sobriety++;
  return found;
}
const describe = (f) =>
  [
    f.phone && `${f.phone === 1 ? "a personal phone number" : `${f.phone} personal phone numbers`}`,
    f.email && `${f.email === 1 ? "a personal e-mail address" : `${f.email} personal e-mail addresses`}`,
    f.sobriety && "a sobriety date",
  ]
    .filter(Boolean)
    .join(", ");

/* ------------------------------------------------------------------ which files */
const DRIVE_ID = /(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/g;
const candidates = new Map(); // id -> { kind, source }
function addCandidate(id, kind, source) {
  if (!candidates.has(id)) candidates.set(id, { kind, source });
}

// 1) the calendar mirror: IMG: and Link: lines
function calendarFiles() {
  const file = path.join(ROOT, "data", "calendar.ics");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8").replace(/\r?\n[ \t]/g, "");
  const events = text.split("BEGIN:VEVENT").slice(1);
  const out = [];
  for (const ev of events) {
    const get = (k) => (new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.*)$`, "m").exec(ev) || [])[1] || "";
    const unescape = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
    const title = unescape(get("SUMMARY")).trim();
    const start = get("DTSTART").slice(0, 8);
    const desc = unescape(get("DESCRIPTION"))
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 $1")
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&");
    for (const line of desc.split("\n")) {
      const kind = /^\s*(IMG|Image|Flyer)\s*:/i.test(line) ? "flyer" : /^\s*Link\s*:/i.test(line) ? "link" : "";
      if (!kind) continue;
      for (const m of line.matchAll(DRIVE_ID)) out.push({ id: m[1], kind, start, title });
    }
  }
  // newest events first: what is on the site right now matters most
  out.sort((a, b) => b.start.localeCompare(a.start));
  for (const f of out) addCandidate(f.id, f.kind, `calendar ${f.kind} – ${f.title}${f.start ? ` (${f.start.slice(0, 4)}-${f.start.slice(4, 6)}-${f.start.slice(6, 8)})` : ""}`);
}
// 2) published documents
function documentFiles() {
  // the document index: data/documents/*.csv (and an old single data/documents.csv, if one is added)
  const rows = [...readCsvDir("documents"), ...readCsv("documents.csv")].filter((r) => yes(r.publish));
  rows.sort((a, b) => String(b.date || b.year || "").localeCompare(String(a.date || a.year || "")));
  for (const r of rows) {
    const m = new RegExp(DRIVE_ID.source).exec(r.url || "") || (/^[A-Za-z0-9_-]{25,}$/.test(r.drive_id || "") ? [null, r.drive_id] : null);
    if (m) addCandidate(m[1], "document", `document ${r.id || ""}`.trim());
  }
}
// 3) (with --extra-links) Drive files linked from other pages' data: committee guidelines, resources, motions, districts
function extraLinkFiles() {
  for (const f of ["committee-resources.csv", "resources.csv", "motions.csv", "districts.csv"]) {
    for (const r of readCsv(f)) {
      if (r.show && !yes(r.show)) continue;
      for (const [col, v] of Object.entries(r)) {
        if (col.startsWith("_") || col === "notes") continue;
        for (const m of String(v || "").matchAll(new RegExp(DRIVE_ID.source, "g"))) addCandidate(m[1], "link", `${f} ${col}${r.committee ? ` (${r.committee})` : r.key ? ` (${r.key})` : r.slug ? ` (${r.slug})` : r.id ? ` (${r.id})` : ""}`);
      }
    }
  }
}
calendarFiles();
documentFiles();
if (args.includes("--extra-links")) extraLinkFiles();

const reviewed = new Map(readRows(REVIEW).filter((r) => r.drive_id).map((r) => [r.drive_id.trim(), r]));
const heldIds = new Set(readRows(HOLDS).filter((r) => r.drive_id).map((r) => r.drive_id.trim()));
const due = (r) => !r || (/^error/i.test(r.result || "") && (Date.parse(TODAY) - Date.parse(r.checked_on || TODAY)) / 864e5 >= 30);
const todo = ONLY
  ? [...candidates.entries()].filter(([id]) => ONLY.has(id))
  : [...candidates.entries()].filter(([id]) => due(reviewed.get(id)) && !heldIds.has(id));
console.log(`${candidates.size} Drive files in the calendar and the published documents; ${candidates.size - todo.length} already checked or held; ${todo.length} to check (at most ${LIMIT} now).`);

/* ------------------------------------------------------------------ reading a file */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "msca-media-"));
async function download(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "msca09-media-check" } });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: r.ok, status: r.status, type, buf };
  } finally {
    clearTimeout(timer);
  }
}
const sniff = (buf) =>
  buf.slice(0, 5).toString("latin1") === "%PDF-"
    ? "application/pdf"
    : buf[0] === 0xff && buf[1] === 0xd8
      ? "image/jpeg"
      : buf.slice(1, 4).toString("latin1") === "PNG"
        ? "image/png"
        : buf.slice(0, 4).toString("latin1") === "GIF8"
          ? "image/gif"
          : buf.slice(8, 12).toString("latin1") === "WEBP"
            ? "image/webp"
            : buf.slice(0, 4).toString("latin1") === "PK\x03\x04"
              ? "application/zip" // .docx / .xlsx / .pptx (and .odt …) are zip files
              : buf.slice(0, 8).toString("hex") === "d0cf11e0a1b11ae1"
                ? "application/x-ole" // old .doc / .xls / .ppt
                : "";
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

/* ------------------------------------------------------------------ Office files */
// A small zip reader (central directory + stored/deflated entries): enough for Office files, no extra program.
function unzip(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("damaged zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + skip;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.slice(start, start + size);
    try {
      if (method === 0) out.set(name, data);
      else if (method === 8) out.set(name, zlib.inflateRawSync(data));
    } catch {}
  }
  return out;
}
const xmlText = (xml) =>
  String(xml)
    .replace(/<w:tab\/>|<a:tab\/>/g, "\t")
    .replace(/<\/w:p>|<\/a:p>|<w:br\/>|<a:br\/>|<\/text:p>|<\/text:h>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
// The words of a .docx / .pptx / .xlsx (or .odt/.ods/.odp): body, headers, footers, notes, comments, cells.
function readOffice(buf) {
  const z = unzip(buf);
  const get = (n) => (z.has(n) ? z.get(n).toString("utf8") : "");
  const names = [...z.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const parts = [];
  for (const n of names) {
    if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n) || /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n) || /^content\.xml$/.test(n))
      parts.push(xmlText(get(n)));
  }
  // Excel: shared strings + every cell value (numbers too: a phone number can be a number)
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  for (const n of names.filter((x) => /^xl\/worksheets\/[^/]+\.xml$/.test(x))) {
    for (const row of get(n).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = ""]) => {
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        if (/\bt="s"/.test(attrs)) return shared[Number(v)] ?? "";
        if (/\bt="inlineStr"/.test(attrs)) return xmlText(inner);
        return v == null ? "" : xmlText(v);
      });
      parts.push(cells.join(" | "));
    }
  }
  return parts.join("\n");
}
// Old binary Office files: the readable runs of text (8-bit and UTF-16).
function readOle(buf) {
  const runs = [];
  for (const m of buf.toString("latin1").matchAll(/[\x20-\x7e\xa0-\xff\r\n\t]{4,}/g)) runs.push(m[0]);
  for (const m of buf.toString("latin1").matchAll(/(?:[\x20-\x7e\xa0-\xff\r\n\t]\x00){4,}/g)) runs.push(Buffer.from(m[0], "latin1").toString("utf16le"));
  return runs.join("\n");
}

function ocrImage(file) {
  if (!tools.ocr) throw new Error("no OCR program");
  return run(fill(OCR_CMD, { in: file }), 180000);
}
function readPdf(file) {
  let text = "";
  if (tools.pdftext) {
    try {
      text = run(fill(PDFTEXT_CMD, { in: file }));
    } catch {}
  }
  if (text.replace(/\s/g, "").length >= 80) return { text, how: "pdf text" };
  // a scanned PDF: turn the first pages into pictures and read those
  if (tools.raster && tools.ocr) {
    const out = path.join(TMP, "page");
    run(fill(RASTER_CMD, { in: file, out }), 180000);
    const pages = fs.readdirSync(TMP).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
    let ocr = "";
    for (const p of pages) {
      ocr += "\n" + ocrImage(path.join(TMP, p));
      fs.rmSync(path.join(TMP, p), { force: true });
    }
    return { text: text + "\n" + ocr, how: "pdf scan (first 3 pages)" };
  }
  // only a scanned PDF's first page can be read without pdftoppm: the Drive picture of it
  return { text, how: "pdf text only", unreadable: text.replace(/\s/g, "").length < 80 };
}

async function check(id, info) {
  // Pictures: the Drive image service (what the site itself shows). Anything else: the file.
  let file;
  let type;
  if (info.kind === "flyer") {
    const r = await download(`https://lh3.googleusercontent.com/d/${id}=w2000`);
    type = sniff(r.buf) || r.type;
    if (!r.ok || !type.startsWith("image/")) return { result: `error: not public or not a picture (HTTP ${r.status})` };
    file = path.join(TMP, `${id}.img`);
    fs.writeFileSync(file, r.buf);
  } else {
    let r = await download(`https://drive.google.com/uc?export=download&id=${id}`);
    type = sniff(r.buf) || r.type;
    if (!r.ok || type === "text/html") {
      // too big to download directly, or a Google Doc: read the first page as a picture
      r = await download(`https://lh3.googleusercontent.com/d/${id}=w2000`);
      type = sniff(r.buf) || r.type;
      if (!r.ok || !type.startsWith("image/")) return { result: `error: could not download (HTTP ${r.status})` };
      info.firstPageOnly = true;
    }
    file = path.join(TMP, `${id}.${type === "application/pdf" ? "pdf" : type.startsWith("image/") ? "img" : "bin"}`);
    fs.writeFileSync(file, r.buf);
  }
  try {
    let text;
    let how;
    if (type === "application/pdf") {
      if (!tools.pdftext && !tools.ocr) return null; // try again on a machine with the tools
      let unreadable;
      ({ text, how, unreadable } = readPdf(file));
      if (unreadable) {
        // a scanned PDF and no pdftoppm here: read the Drive picture of its first page
        const r = tools.ocr ? await download(`https://lh3.googleusercontent.com/d/${id}=w2000`) : null;
        if (!r || !r.ok || !(sniff(r.buf) || r.type).startsWith("image/")) return tools.raster ? { result: "error: no words could be read" } : null;
        const img = path.join(TMP, `${id}-p1.img`);
        fs.writeFileSync(img, r.buf);
        try {
          text += "\n" + ocrImage(img);
        } finally {
          fs.rmSync(img, { force: true });
        }
        how = "scanned pdf, first page picture";
      }
    } else if (type.startsWith("image/")) {
      if (!tools.ocr) return null; // try again on a machine with tesseract
      text = ocrImage(file);
      how = info.firstPageOnly ? "first page picture" : "picture";
    } else if (type === "application/zip" || /officedocument|opendocument/.test(type)) {
      text = readOffice(fs.readFileSync(file));
      how = "office file text";
    } else if (type === "application/x-ole" || /msword|ms-excel|ms-powerpoint/.test(type)) {
      text = readOle(fs.readFileSync(file));
      how = "old office file text";
    } else return { result: `error: unsupported file type ${type || "unknown"}` };
    // No words at all means the reader failed (every flyer has words): try again later.
    if (String(text || "").replace(/\s/g, "").length < 5) return { result: "error: no words could be read", how };
    const f = analyse(text);
    const what = describe(f);
    return { result: what ? `hold: ${what}` : "clean", how, found: f };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/* ------------------------------------------------------------------ run */
const reviewRows = [];
const holdRows = [];
let n = 0;
for (const [id, info] of todo) {
  if (n >= LIMIT) break;
  if ((Date.now() - started) / 60000 > MAX_MINUTES) {
    console.log(`Stopping after ${MAX_MINUTES} minutes; the rest are checked next time.`);
    break;
  }
  n++;
  let res;
  try {
    res = await check(id, info);
  } catch (e) {
    res = { result: `error: ${String(e.message || e).split("\n")[0].slice(0, 120)}` };
  }
  if (!res) continue;
  console.log(`${String(n).padStart(4)} ${id}  ${res.result}${res.how ? `  (${res.how})` : ""}  — ${info.source}`);
  reviewRows.push({ drive_id: id, checked_on: TODAY, result: res.result, notes: `${info.source}${res.how ? ` · read as ${res.how}` : ""}` });
  if (/^hold/.test(res.result)) {
    const reason = [res.found.phone && "personal phone number", res.found.email && "personal e-mail address", res.found.sobriety && "sobriety date"].filter(Boolean).join(" + ");
    holdRows.push({
      drive_id: id,
      reason,
      held_on: TODAY,
      notes: `${info.source} — found by scripts/check-media.mjs (${res.result.replace(/^hold: /, "")}); if it is a false alarm, delete this row and mark it "cleared" in data/media-review.csv`,
    });
  }
}
fs.rmSync(TMP, { recursive: true, force: true });

if (ONLY) {
  const reread = new Set(reviewRows.map((r) => r.drive_id));
  dropRows(REVIEW, reread);
  dropRows(HOLDS, reread);
}
appendRows(
  REVIEW,
  ["drive_id", "checked_on", "result", "notes"],
  [
    "# Drive files (flyers and PDFs) whose printed words were already checked for personal phone numbers, e-mail addresses and sobriety dates by scripts/check-media.mjs. Written automatically; a file listed here is not read again.",
    '# result = clean | hold: … (also added to flyer-holds.csv) | cleared (a person looked: false alarm) | error: … (tried again after 30 days). Delete a row to have the file read again.',
  ],
  reviewRows,
);
appendRows(HOLDS, ["drive_id", "reason", "held_on", "notes"], [], holdRows);
const holds = reviewRows.filter((r) => /^hold/.test(r.result)).length;
console.log(`\nChecked ${reviewRows.length} file(s): ${holds} held, ${reviewRows.filter((r) => r.result === "clean").length} clean, ${reviewRows.filter((r) => /^error/.test(r.result)).length} could not be read.${DRY ? " (dry run: no file changed)" : ""}`);
if (process.env.GITHUB_OUTPUT && !DRY) fs.appendFileSync(process.env.GITHUB_OUTPUT, `checked=${reviewRows.length}\nheld=${holds}\n`);

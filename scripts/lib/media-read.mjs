// Shared helpers of scripts/check-media.mjs: the programs that read pictures and PDFs (tesseract,
// pdftotext, pdftoppm, or the MEDIA_OCR_CMD / MEDIA_PDFTEXT_CMD / MEDIA_RASTER_CMD stand-ins), the file
// type sniffer, the Word/Excel/PowerPoint readers, the rules for what a printed file may show, and the
// small pure helpers of the central-office flyer check (`check-media.mjs --office-flyers`).
//
// Moved here from check-media.mjs without changing what they do; the Drive file check uses them exactly
// as before. Nothing here downloads anything on import or writes a file outside the scratch folder it is
// given.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { readCsv, parseCsvText } from "../../src/_lib/csv.js";
import { ROBOTS_TOKEN } from "./robots.mjs";

/* ------------------------------------------------------------------ the reading programs */
export const run = (cmd, timeout = 120000) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout, maxBuffer: 64 * 1024 * 1024 });
// Is a program installed? (Some print their version and exit with a non-zero code, e.g. pdftotext -v.)
// A missing program: exit code 127 ("/bin/sh: tesseract: not found") or, on Windows, "'tesseract' is not
// recognized as an internal or external command" — both name the program, so look for those words first.
export const has = (cmd) => {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 20000 });
    return true;
  } catch (e) {
    const out = String(e.stdout || "") + String(e.stderr || "");
    if (e.status === 127 || e.code === "ENOENT" || /not found|not recognized|no such file|cannot find/i.test(out)) return false;
    return /version|copyright|poppler|tesseract/i.test(out);
  }
};

/** The commands that read files ("{in}" = the file, "{out}" = the page picture prefix) and which ones work here. */
export function readingTools(env = process.env) {
  const cmds = {
    ocr: env.MEDIA_OCR_CMD || 'tesseract "{in}" stdout -l eng+spa --psm 3',
    // every page: reading a PDF's text layer is fast (only scanned pages, below, are slow)
    pdftext: env.MEDIA_PDFTEXT_CMD || 'pdftotext -layout "{in}" -',
    raster: env.MEDIA_RASTER_CMD || 'pdftoppm -r 150 -f 1 -l 3 -png "{in}" "{out}"',
  };
  const tools = {
    ocr: env.MEDIA_OCR_CMD ? true : has("tesseract --version"),
    pdftext: env.MEDIA_PDFTEXT_CMD ? true : has("pdftotext -v"),
    raster: env.MEDIA_RASTER_CMD ? true : has("pdftoppm -v"),
  };
  return { cmds, tools };
}

export const sniff = (buf) =>
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
export const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

/* ------------------------------------------------------------------ Office files */
// A small zip reader (central directory + stored/deflated entries): enough for Office files, no extra program.
export function unzip(buf) {
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
export const xmlText = (xml) =>
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
export function readOffice(buf) {
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
export function readOle(buf) {
  const runs = [];
  for (const m of buf.toString("latin1").matchAll(/[\x20-\x7e\xa0-\xff\r\n\t]{4,}/g)) runs.push(m[0]);
  for (const m of buf.toString("latin1").matchAll(/(?:[\x20-\x7e\xa0-\xff\r\n\t]\x00){4,}/g)) runs.push(Buffer.from(m[0], "latin1").toString("utf16le"));
  return runs.join("\n");
}

/** ocrImage(file) and readPdf(file), using the programs of readingTools() and a scratch folder (tmp) for page pictures. */
export function makeReaders({ cmds, tools, tmp }) {
  function ocrImage(file) {
    if (!tools.ocr) throw new Error("no OCR program");
    return run(fill(cmds.ocr, { in: file }), 180000);
  }
  function readPdf(file) {
    let text = "";
    if (tools.pdftext) {
      try {
        text = run(fill(cmds.pdftext, { in: file }));
      } catch {}
    }
    if (text.replace(/\s/g, "").length >= 80) return { text, how: "pdf text" };
    // a scanned PDF: turn the first pages into pictures and read those
    if (tools.raster && tools.ocr) {
      const out = path.join(tmp, "page");
      run(fill(cmds.raster, { in: file, out }), 180000);
      const pages = fs.readdirSync(tmp).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
      let ocr = "";
      for (const p of pages) {
        ocr += "\n" + ocrImage(path.join(tmp, p));
        fs.rmSync(path.join(tmp, p), { force: true });
      }
      return { text: text + "\n" + ocr, how: "pdf scan (first 3 pages)" };
    }
    // only a scanned PDF's first page can be read without pdftoppm: the Drive picture of it
    return { text, how: "pdf text only", unreadable: text.replace(/\s/g, "").length < 80 };
  }
  return { ocrImage, readPdf };
}

/* ------------------------------------------------------------------ what may be printed */
export const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
// OCR confuses l/I/1 and 0/O: compare addresses by their "skeleton".
export const skeleton = (s) => String(s).toLowerCase().replace(/[1il|]/g, "l").replace(/0/g, "o").replace(/rn/g, "m").replace(/\s+/g, "");
export const ROLE_DOMAINS = ["msca09aa.org", "aa.org", "aagrapevine.org", "area9btg.org"].map((d) => "@" + skeleton(d));

/** The public lines and role mailboxes a file may print: data/contact-allowlist.csv, plus every number in
 *  data/central-offices.csv and data/resources.csv. → { okPhones: Set(10 digits), okEmails: Set(skeletons) } */
export function loadAllowed() {
  const allow = readCsv("contact-allowlist.csv");
  const okPhones = new Set(allow.filter((r) => r.kind === "phone").map((r) => digits(r.value)));
  for (const file of ["central-offices.csv", "resources.csv"]) {
    for (const row of readCsv(file)) for (const v of Object.values(row)) for (const m of String(v).matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) okPhones.add(digits(m[0]));
  }
  const okEmails = new Set(allow.filter((r) => r.kind === "email").map((r) => skeleton(r.value)));
  return { okPhones, okEmails };
}

// Up to 4 separator characters between the groups, line breaks and the Unicode hyphens included: PDF text
// often breaks a number over two lines ("(714)\n\n555-0123") or prints "909‐555‐0147" with U+2010.
export const PHONE = /(?<![\d#])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.\-‐-―−]{0,4}(\d{3})[\s.\-‐-―−]{0,4}(\d{4})(?!\d)/g;
export const ID_LABEL = /(?:\bzoom\s*(?:meeting\s*)?(?:id|#)?|(?:meeting|webinar|reuni[oó]n)\s*(?:id|#)|zoom(?:gov)?\.us\/\w+\/|\bid\s*(?:de\s+(?:la\s+)?reuni[oó]n|de\s+zoom)?|\bpmi|passcode|password|contrase[nñ]a|c[oó]digo)\s*[:#=-]?\s*$/i;
export const EMAIL = /[\w.+-]+\s?@\s?[\w-]+(?:\.[\w-]+)+/g;
export const SOBRIETY = /sobriety\s+(date|birthday|anniversary)|years?\s+(of\s+)?sob(er|riety)|sober\s+(since|date|birthday|anniversary)|fecha\s+de\s+sobriedad|años\s+de\s+sobriedad|aniversario\s+de\s+sobriedad/i;
// An old msca09aa.org page password ("Password protected: …", "Protegido por contraseña: …"), the pattern that
// src/_lib/calendar.js scanBody and scripts/fetch-calendar.mjs remove. Zoom passcodes are not page passwords.
export const PAGE_PASSWORD = /(?:Password[\s-]*Protected|Protegid[oa]\s+(?:por|con)\s+contrase[nñ]a)\s*:?\s*[^\s)\]]+/i;

/** A bare host name ("https://www.oc-aa.org/x" or "www.oc-aa.org" → "oc-aa.org"), "" when there is none. */
export function siteHost(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  try {
    return new URL(/^[a-z][\w+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * What a file's words show: { phone, email, sobriety } counts (and password with passwords: true).
 * phones: false skips phone numbers (flyers, owner's rule 2026-10-22). allowed = loadAllowed().
 * domains: extra host names whose addresses are allowed (a central office's own domain, its sub-domains too).
 */
export function analyse(text, { phones = true, allowed, domains = [], passwords = false } = {}) {
  const { okPhones, okEmails } = allowed || loadAllowed();
  const own = domains.map(siteHost).filter(Boolean).map(skeleton);
  const found = { phone: 0, email: 0, sobriety: 0 };
  const t = String(text || "").replace(/\r/g, "");
  for (const m of phones ? t.matchAll(PHONE) : []) {
    const d = m[1] + m[2] + m[3];
    if (okPhones.has(d) || /^8(00|33|44|55|66|77|88)/.test(d)) continue;
    if (ID_LABEL.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
    found.phone++;
  }
  for (const m of t.matchAll(EMAIL)) {
    const sk = skeleton(m[0].replace(/[.,;:]+$/, ""));
    if (ROLE_DOMAINS.some((d) => sk.endsWith(d)) || okEmails.has(sk)) continue;
    if (own.some((d) => sk.endsWith("@" + d) || (sk.includes("@") && sk.endsWith("." + d)))) continue;
    found.email++;
  }
  if (SOBRIETY.test(t)) found.sobriety++;
  if (passwords) found.password = PAGE_PASSWORD.test(t) ? 1 : 0;
  return found;
}
export const describe = (f) =>
  [
    f.phone && `${f.phone === 1 ? "a personal phone number" : `${f.phone} personal phone numbers`}`,
    f.email && `${f.email === 1 ? "a personal e-mail address" : `${f.email} personal e-mail addresses`}`,
    f.sobriety && "a sobriety date",
    f.password && "an old page password",
  ]
    .filter(Boolean)
    .join(", ");

/* ------------------------------------------------------------------ central-office flyers */
// Used by `check-media.mjs --office-flyers` (data/central-office-events.json → data/office-flyer-review.csv).

// The importer (scripts/office-events.mjs) sends the same User-Agent and Accept header when it fingerprints a flyer,
// so a server that picks the format from the Accept header (JPEG or WebP …) answers both with the same bytes.
export const OFFICE_UA = `Mozilla/5.0 (compatible; ${ROBOTS_TOKEN}; +https://msca09aa.org/calendar/central-offices/)`;
export const OFFICE_ACCEPT = "image/*,application/pdf;q=0.9";
export const OFFICE_MAX_BYTES = 8 * 1024 * 1024;
export const REVIEW_HEADER = ["url", "sha256", "checked_on", "result", "notes"];
export const REVIEW_COMMENTS = [
  "# Central-office flyers: the pictures and PDFs linked from the offices' own websites (data/central-office-events.json). scripts/check-media.mjs --office-flyers reads each one's printed words for personal e-mail addresses, sobriety dates and old page passwords — not phone numbers (owner's rule, 2026-10-22). Role mailboxes in data/contact-allowlist.csv and addresses on the office's own domain are fine. Written automatically: one row per flyer address (url) and file fingerprint (sha256).",
  "# The site shows an imported flyer only when result is clean or cleared AND sha256 equals the one in data/central-office-events.json. result = clean | hold: e-mail | hold: sobriety | hold: password (the flyer stays hidden) | cleared (an editor opened the flyer and found it fine — type it by hand, keep sha256 as it is) | pending (waiting to be read) | error: … (read again after 7 days; error: robots = the site's robots.txt does not allow it or could not be read). Clean and cleared flyers are downloaded again every 14 days: when the office replaced the file at the same address, the row becomes error: changed (hidden until the importer fingerprints the new file and that file is checked). A cleared flyer stays cleared while it is the same file — keep its notes as they are (a PDF original fingerprint there is compared too). Never write the personal details themselves. Delete a row to have that flyer read again.",
];

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** What an imported flyer may be, decided from its bytes (sniff), not from what the server says. */
export const FLYER_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

/** The calendar date (yyyy-mm-dd) in California of a Date. */
export const ptDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Is a review row due to be read (again)? No row, "pending", an empty result, or an error at least `days` old. */
export function reviewDue(row, today, days = 7) {
  if (!row) return true;
  const result = String(row.result || "").trim();
  if (!result || /^pending$/i.test(result)) return true;
  if (!/^error/i.test(result)) return false;
  const age = daysBetween(String(row.checked_on || "").trim(), today);
  return !Number.isFinite(age) || age >= days;
}

/** A clean or cleared flyer is downloaded again after this many days, to see that the office has not replaced the file. */
export const RECHECK_DAYS = 14;

/**
 * Is a clean or cleared row due to be checked again? Its checked_on is `days` old or more, missing or not a date
 * (or in the future). The file is then downloaded again and its SHA-256 compared with the mirror's.
 */
export function recheckDue(row, today, days = RECHECK_DAYS) {
  if (!row || !/^(clean|cleared)$/i.test(String(row.result || "").trim())) return false;
  const age = daysBetween(String(row.checked_on || "").trim(), today);
  return !Number.isFinite(age) || age < 0 || age >= days;
}

/**
 * How many of the `watched` clean or cleared flyers one run checks again: twice the steady pace (each one every
 * `days` days), at least 3, so the re-checks spread over the days instead of all coming due on one day.
 */
export const recheckCap = (watched, days = RECHECK_DAYS) => (watched > 0 ? Math.max(3, Math.ceil((2 * watched) / days)) : 0);

/**
 * Every flyer of the mirror, once per (url, sha256), in the mirror's order (soonest events first):
 * [{ url, sha256, mime, pdf, office, also, ids:[event ids], src }]. Flyers without a sha256 are listed too
 * (the importer has not downloaded them yet); the caller skips them.
 */
export function mirrorFlyers(mirror) {
  const out = new Map();
  for (const ev of Array.isArray(mirror?.events) ? mirror.events : []) {
    for (const f of Array.isArray(ev?.flyers) ? ev.flyers : []) {
      const url = String(f?.url || "").trim();
      if (!url) continue;
      const sha = String(f.sha256 || "").trim().toLowerCase();
      const key = `${url}\n${sha}`;
      if (out.has(key)) {
        out.get(key).ids.push(String(ev.id || ""));
        continue;
      }
      out.set(key, {
        url,
        sha256: sha,
        mime: String(f.mime || "").trim().toLowerCase(),
        pdf: String(f.pdf || "").trim(),
        office: String(ev.office || ""),
        also: Array.isArray(ev.also) ? ev.also.map(String) : [],
        ids: [String(ev.id || "")],
        src: String(ev.src || ""),
      });
    }
  }
  return [...out.values()];
}

/** data/office-flyer-review.csv (or a test copy) → { header, comments: [[cells]], rows: [{url, sha256, …}], nl }. */
export function readReview(file) {
  const empty = { header: [...REVIEW_HEADER], comments: [], rows: [], nl: "\n", exists: false };
  if (!fs.existsSync(file)) return empty;
  const text = fs.readFileSync(file, "utf8");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const { records } = parseCsvText(text, path.basename(file));
  if (!records.length) return { ...empty, nl, exists: true };
  const header = records[0].record.map((h) => String(h).trim().toLowerCase());
  const comments = [];
  const rows = [];
  for (const { record } of records.slice(1)) {
    const cells = record.map((v) => String(v ?? "").replace(/\r/g, "").trim());
    if (cells.every((v) => v === "")) continue;
    if (cells[0].startsWith("#")) comments.push(cells);
    else rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
  }
  return { header, comments, rows, nl, exists: true };
}

const q = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The review rows after a run: every new row replaces the row with the same (url, sha256), and the rows of
 * the same url whose sha256 the mirror no longer uses (an older version of that file). Rows sorted by url,
 * then sha256, so the committed file changes only where a flyer changed.
 */
export function mergeReview(rows, updates, mirrorShas = new Map()) {
  const key = (r) => `${r.url}\n${String(r.sha256 || "").toLowerCase()}`;
  const fresh = new Map(updates.map((r) => [key(r), r]));
  const touched = new Set(updates.map((r) => r.url));
  const kept = rows.filter((r) => {
    if (fresh.has(key(r))) return false;
    if (!touched.has(r.url)) return true;
    const used = mirrorShas.get(r.url);
    return used ? used.has(String(r.sha256 || "").toLowerCase()) : true;
  });
  return [...kept, ...fresh.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : String(a.sha256).localeCompare(String(b.sha256))));
}

/** The text of the review file: header, comment rows, data rows (every row as wide as the header). */
export function reviewText({ header = REVIEW_HEADER, comments = [], rows = [], nl = "\n" }) {
  const width = header.length;
  const line = (cells) => cells.map(q).join(",");
  const pad = (cells) => [...cells.slice(0, width), ...Array(Math.max(0, width - cells.length)).fill("")];
  return [line(header), ...comments.map((c) => line(pad(c))), ...rows.map((r) => line(header.map((h) => r[h] ?? "")))].join(nl) + nl;
}

/**
 * Download one file politely: the office User-Agent and Accept header, no Referer, at most maxBytes (stops reading
 * past it). robots.txt is the caller's business (scripts/lib/robots.mjs).
 * → { ok, status, type (content-type), buf, error } where error is a short reason ("HTTP 404", "too big", …).
 */
export async function fetchCapped(url, { maxBytes = OFFICE_MAX_BYTES, timeoutMs = 30000, userAgent = OFFICE_UA, accept = OFFICE_ACCEPT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r;
    try {
      r = await fetch(url, {
        redirect: "follow",
        signal: ctrl.signal,
        referrerPolicy: "no-referrer",
        headers: { "user-agent": userAgent, accept },
      });
    } catch (e) {
      return { ok: false, status: 0, type: "", error: ctrl.signal.aborted ? "timeout" : `could not connect (${String(e.cause?.code || e.message || e).slice(0, 60)})` };
    }
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const drop = () => r.body?.cancel().catch(() => {});
    if (!r.ok) {
      drop();
      return { ok: false, status: r.status, type, error: `HTTP ${r.status}` };
    }
    const declared = Number(r.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      drop();
      return { ok: false, status: r.status, type, error: `too big (over ${Math.round(maxBytes / 1048576)} MB)` };
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of r.body || []) {
        size += chunk.length;
        if (size > maxBytes) {
          ctrl.abort();
          return { ok: false, status: r.status, type, error: `too big (over ${Math.round(maxBytes / 1048576)} MB)` };
        }
        chunks.push(chunk);
      }
    } catch (e) {
      return { ok: false, status: r.status, type, error: ctrl.signal.aborted ? "timeout" : "download interrupted" };
    }
    return { ok: true, status: r.status, type, buf: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
  }
}

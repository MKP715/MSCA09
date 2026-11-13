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
//   node scripts/check-media.mjs --office-flyers [dir]   the central offices' flyers instead (see the end of
//                                                  this note); no Drive file is read
//
// Which files: every Google Drive file in an IMG: or Link: line of the Area calendar
// (data/calendar.ics) and every document published in data/documents/*.csv (publish = yes).
// Each file is read once: the result is written to data/media-review.csv
// (drive_id, checked_on, result, notes) and the file is not read again unless its row is
// deleted. A file whose words include a phone number or e-mail address that is not a public
// office line or a role mailbox (data/contact-allowlist.csv, data/central-offices.csv,
// …@msca09aa.org), or a sobriety date / "years sober", gets a row in data/flyer-holds.csv:
// the website then leaves it out (and `npm run check` refuses to publish a page linking it).
// Flyers are NOT checked for phone numbers — the owner's rule since 2026-10-22: hosts print
// their own contact and Zoom numbers on flyers, and those flyers show as uploaded. A flyer is any
// picture, and any file on a calendar IMG: or Link: line (PDF flyers too) except a Link: whose
// label names a document (agenda, minutes, report …, see DOC_LABEL). Flyers are still checked
// for e-mail addresses and sobriety dates; documents are checked for all three.
// The details found are never written anywhere — only what kind of detail it was.
// The Zoom audio recordings in data/recordings.csv are never downloaded or read, wherever their id turns up:
// they are hours of sound with no printed words (and up to hundreds of MB each).
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
// command must write {out}-1.png, {out}-2.png … for the first 3 pages). The readers and the rules
// live in scripts/lib/media-read.mjs.
//
// Central-office flyers (--office-flyers): the pictures and PDFs that data/central-office-events.json (written by
// scripts/office-events.mjs) links from the offices' own websites. Every flyer whose address (url) and fingerprint
// (sha256) has no row in data/office-flyer-review.csv yet, or whose row is "pending" or an error at least 7 days
// old, is downloaded (8 MB at most, a picture or a PDF, the importer's User-Agent and Accept header, no Referer,
// the office's crawl delay between two requests to one site, and only where the site's robots.txt allows it:
// "error: robots" when it does not, or when robots.txt cannot be read — scripts/lib/robots.mjs), compared with the
// fingerprint in the mirror ("error: changed" when it differs) and read like a calendar flyer: personal e-mail
// addresses (role mailboxes in contact-allowlist.csv and addresses on the office's own domain are fine), sobriety
// dates and old page passwords — never phone numbers. A flyer whose `pdf` names the PDF original behind a preview
// picture has that PDF read too. The row (url, sha256, checked_on, result, notes; result = clean | hold: e-mail /
// sobriety / password | error: …) replaces the flyer's old rows. The site shows an imported flyer only while its row
// says clean or cleared and its sha256 still matches the mirror.
// An office can replace a picture at the same address, so clean and cleared flyers are downloaded again once their
// check is 14 days old (after the new ones, a few a day: twice the steady pace, at least 3). A clean one is read
// again. When the file is not the one fingerprinted any more, the row becomes "error: changed": the site hides the
// flyer, and the importer fingerprints the new file, which is then checked like a new one. A cleared one (an
// editor's decision) stays cleared while it is still the very file the editor looked at — its PDF original too, by
// the "PDF original fingerprint" in notes — and only its checked_on moves; when it cannot be downloaded, its error
// row starts its notes with "was cleared by an editor", and "cleared" comes back once the same file can be read.
// Options:
//   [dir]              a folder of flyers already downloaded, named <sha256>.<ext>: used instead of downloading
//   --limit N          read at most N flyers (default 150)       --max-minutes M   stop after M minutes (default 10)
//   --mirror <file>    another events file                      --review <file>   another review file (tests)
//   --now <ISO time>   "today" (tests)                          --dry-run         change no file
// MEDIA_OFFICE_DELAY=<seconds> replaces the wait between two requests to one site (tests; normally the larger of
// 5 s and the office's crawl_delay in data/office-event-sources.csv).
// It always exits 0; problems are reported with ::warning:: lines, and checked=<n> / held=<n> go to $GITHUB_OUTPUT.
// The run log (public: the Actions logs of a public repository) names file ids, event ids, kinds, counts and the
// offices' own addresses only: never an event's title, a flyer's words or a central-office flyer's address or file
// name (it is "<office> <hash of its address>", as the importer names it); an error by its name or code (a JSON
// error's message quotes the text it was reading).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCsv, readCsvDir, parseCsvText, yes } from "../src/_lib/csv.js";
import {
  readingTools,
  makeReaders,
  sniff,
  readOffice,
  readOle,
  loadAllowed,
  analyse as analyseText,
  describe,
  siteHost,
  sha256,
  ptDate,
  reviewDue,
  recheckDue,
  recheckCap,
  RECHECK_DAYS,
  mirrorFlyers,
  readReview,
  mergeReview,
  reviewText,
  fetchCapped,
  FLYER_TYPES,
  OFFICE_MAX_BYTES,
  OFFICE_UA,
  OFFICE_ACCEPT,
  REVIEW_HEADER,
  REVIEW_COMMENTS,
} from "./lib/media-read.mjs";
import { fetchRobots, robotsAllows } from "./lib/robots.mjs";
import { hashKey } from "../src/_lib/office-import.js";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes("--dry-run");
const OFFICE = args.includes("--office-flyers");
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

const { cmds, tools } = readingTools();
if (!tools.ocr) console.log("tesseract is not installed: pictures cannot be read this time (install tesseract-ocr tesseract-ocr-spa).");
if (!tools.pdftext) console.log("pdftotext is not installed: PDFs cannot be read this time (install poppler-utils).");
if (!tools.ocr && !tools.pdftext && !OFFICE) {
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
// public lines and role mailboxes (data/contact-allowlist.csv, central-offices.csv, resources.csv): see media-read.mjs
const allowed = loadAllowed();
const analyse = (text, options = {}) => analyseText(text, { ...options, allowed });

/* ------------------------------------------------------------------ central-office flyers (--office-flyers) */
// The wait between two requests to one site, in seconds: the larger of 5 and the crawl_delay of every office whose
// feed, events page or website is on that site (data/office-event-sources.csv: the crawl_delay column, or
// "crawl_delay=N" in options). MEDIA_OFFICE_DELAY replaces it (tests).
function officeDelays(offices) {
  const out = new Map();
  for (const r of readCsv("office-event-sources.csv")) {
    const n = Math.max(Number(r.crawl_delay) || 0, Number((/crawl_delay\s*=\s*(\d+(?:\.\d+)?)/i.exec(r.options || "") || [])[1]) || 0);
    if (!n) continue;
    for (const h of [r.feed, r.events_page, offices.get(r.office)?.website].map(siteHost).filter(Boolean)) out.set(h, Math.max(out.get(h) || 0, n));
  }
  return out;
}

async function officeFlyers() {
  const MIRROR = path.resolve(opt("--mirror", "data/central-office-events.json"));
  const FILE = path.resolve(opt("--review", "data/office-flyer-review.csv"));
  const dirArg = opt("--office-flyers", "");
  const SAVED = dirArg && !dirArg.startsWith("--") ? path.resolve(dirArg) : "";
  const maxMinutes = Number(opt("--max-minutes", process.env.MEDIA_MAX_MINUTES || 10)) || 10;
  const nowArg = opt("--now", "");
  const today = ptDate(nowArg && !Number.isNaN(Date.parse(nowArg)) ? new Date(nowArg) : new Date());
  const shown = (file) => path.relative(ROOT, file).replace(/\\/g, "/") || file;
  const output = (checked, held) => {
    if (process.env.GITHUB_OUTPUT && !DRY) fs.appendFileSync(process.env.GITHUB_OUTPUT, `checked=${checked}\nheld=${held}\n`);
  };

  if (!fs.existsSync(MIRROR)) {
    console.log(`No central-office events yet (${shown(MIRROR)} does not exist): no flyer to check.`);
    return output(0, 0);
  }
  let mirror;
  try {
    mirror = JSON.parse(fs.readFileSync(MIRROR, "utf8"));
  } catch (e) {
    console.log(`::warning::${shown(MIRROR)} could not be read (${(e && (e.code || e.name)) || "error"}); no central-office flyer was checked.`);
    return output(0, 0);
  }

  const review = readReview(FILE);
  const keyOf = (url, sha) => `${url}\n${String(sha || "").toLowerCase()}`;
  const rowOf = new Map(review.rows.map((r) => [keyOf(r.url, r.sha256), r]));
  const flyers = mirrorFlyers(mirror);
  const fingerprinted = flyers.filter((f) => /^[0-9a-f]{64}$/.test(f.sha256));
  const unfingerprinted = flyers.length - fingerprinted.length;
  for (const f of fingerprinted) f.row = rowOf.get(keyOf(f.url, f.sha256));
  // first the flyers never read, pending ones and errors at least 7 days old …
  const due = fingerprinted.filter((f) => reviewDue(f.row, today, 7));
  // … then clean or cleared ones whose check is 14 days old or more (the office may have replaced the file at the
  // same address): the oldest check first, a few a day, so they spread over the days
  const watched = fingerprinted.filter((f) => /^(clean|cleared)$/i.test(String(f.row?.result || "").trim()));
  const checkedOn = (f) => (/^\d{4}-\d{2}-\d{2}$/.test(String(f.row.checked_on || "").trim()) ? f.row.checked_on.trim() : "");
  const stale = watched
    .filter((f) => recheckDue(f.row, today, RECHECK_DAYS))
    .map((f, i) => ({ f, i, on: checkedOn(f) }))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.i - b.i))
    .map((x) => x.f);
  const again = stale.slice(0, recheckCap(watched.length));
  for (const f of again) f.again = true;
  // one site after another (soonest events first within a site), so a crawl delay rarely holds the run up
  const bySite = (list) => {
    const sites = new Map();
    for (const f of list) {
      const h = siteHost(f.url);
      if (!sites.has(h)) sites.set(h, []);
      sites.get(h).push(f);
    }
    const out = [];
    for (let i = 0; out.length < list.length; i++) for (const l of sites.values()) if (l[i]) out.push(l[i]);
    return out;
  };
  const todo = [...bySite(due), ...bySite(again)];
  console.log(
    `${flyers.length} flyer(s) in the central-office events; ${fingerprinted.length - todo.length} already checked; ` +
      `${unfingerprinted} without a fingerprint yet (the importer adds it); ${todo.length} to check (at most ${LIMIT} now)` +
      (stale.length
        ? `, ${again.length} of them clean or cleared flyers downloaded again (their check is ${RECHECK_DAYS} days old or more` +
          `${stale.length > again.length ? `; ${stale.length - again.length} more on the next days` : ""})`
        : "") +
      ".",
  );
  if (!tools.ocr && !tools.pdftext) {
    console.log("Nothing to read with — no central-office flyer was checked.");
    return output(0, 0);
  }

  const offices = new Map(readCsv("central-offices.csv").map((r) => [r.key, r]));
  const delays = officeDelays(offices);
  const robotsDelay = new Map(); // site -> the Crawl-delay its robots.txt asks for (seconds, at most 60)
  const fixedDelay = process.env.MEDIA_OFFICE_DELAY != null && process.env.MEDIA_OFFICE_DELAY !== "" ? Math.max(0, Number(process.env.MEDIA_OFFICE_DELAY) || 0) : null;
  const delayOf = (host) => (fixedDelay != null ? fixedDelay : Math.max(5, delays.get(host) || 0, robotsDelay.get(host) || 0));
  // the office's own domain: its website(s) and its event pages (an address there is the office's, not a member's)
  const domainsOf = (f) =>
    [...new Set([f.office, ...f.also].flatMap((k) => [offices.get(k)?.website, offices.get(k)?.website_es]).concat(f.src).map(siteHost).filter(Boolean))];

  const deadline = started + maxMinutes * 60000;
  const nextAt = new Map(); // site -> earliest time of the next request
  // wait for the site's turn; false when that wait would run past the time limit (the flyer is read next time)
  async function turn(host) {
    const wait = (nextAt.get(host) || 0) - Date.now();
    if (wait <= 0) return true;
    if (Date.now() + wait > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return true;
  }
  // each site's robots.txt, read once per run before anything else there (null: no time left to read it)
  const robotsOf = new Map();
  function robotsFor(url) {
    const origin = new URL(url).origin;
    if (!robotsOf.has(origin)) {
      robotsOf.set(
        origin,
        (async () => {
          const host = siteHost(url);
          if (!(await turn(host))) return null;
          try {
            const robots = await fetchRobots(origin, { ua: OFFICE_UA, timeoutMs: 20000 });
            robotsDelay.set(host, Math.max(robotsDelay.get(host) || 0, Math.min(60, robots.delay || 0)));
            return robots;
          } finally {
            nextAt.set(host, Date.now() + delayOf(host) * 1000);
          }
        })(),
      );
    }
    return robotsOf.get(origin);
  }
  async function politeGet(url) {
    const robots = await robotsFor(url);
    if (!robots) return { ok: false, later: true };
    if (!robotsAllows(robots, url)) {
      return {
        ok: false,
        error: "robots",
        note: robots.unreachable ? `robots.txt could not be read (${robots.error}), so nothing on that site was read` : "robots.txt does not allow reading this address",
      };
    }
    const host = siteHost(url);
    if (!(await turn(host))) return { ok: false, later: true };
    try {
      return await fetchCapped(url, { maxBytes: OFFICE_MAX_BYTES, userAgent: OFFICE_UA, accept: OFFICE_ACCEPT });
    } finally {
      nextAt.set(host, Date.now() + delayOf(host) * 1000);
    }
  }
  // a copy the importer already downloaded (<dir>/<sha256>.<ext>), used only when its bytes still match
  function savedCopy(sha) {
    if (!SAVED || !fs.existsSync(SAVED)) return null;
    for (const name of fs.readdirSync(SAVED).filter((n) => n.toLowerCase().startsWith(sha))) {
      const file = path.join(SAVED, name);
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > OFFICE_MAX_BYTES) continue;
      const buf = fs.readFileSync(file);
      if (sha256(buf) === sha) return buf;
    }
    return null;
  }

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "msca-office-"));
  const { ocrImage, readPdf } = makeReaders({ cmds, tools, tmp: TMP });
  // The words of a picture or PDF: { text, how }, or null when this machine has no program that can read it.
  function readBytes(buf, type, name) {
    const file = path.join(TMP, `${name}.${type === "application/pdf" ? "pdf" : "img"}`);
    fs.writeFileSync(file, buf);
    try {
      if (type === "application/pdf") {
        if (!tools.pdftext && !tools.ocr) return null;
        const { text, how, unreadable } = readPdf(file);
        return unreadable ? null : { text, how }; // a scanned PDF and no pdftoppm here: try again elsewhere
      }
      if (!tools.ocr) return null;
      return { text: ocrImage(file), how: "picture" };
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  const hasWords = (text) => String(text || "").replace(/\s/g, "").length >= 5;

  // An editor's "cleared" belongs to one file (url + sha256). It stays while that file can be read again unchanged;
  // an error row in between keeps it in its notes, so it comes back when the same file can be read again.
  const CLEARED_NOTE = "was cleared by an editor";
  const PDF_PRINT = /PDF original fingerprint ([0-9a-f]{16})/;
  const wasCleared = (row) => {
    const result = String(row?.result || "").trim();
    return /^cleared$/i.test(result) || (/^error/i.test(result) && String(row.notes || "").startsWith(CLEARED_NOTE));
  };
  const editorNotes = (notes) => String(notes || "").replace(/^was cleared by an editor(?: · )?/, "");
  const LATER = { later: "no time left for this site's crawl delay" };
  // the PDF original behind a preview picture: { buf } or { result } (an error) or LATER
  async function originalOf(f) {
    if (!/^https?:\/\//i.test(f.pdf)) return { result: "error: the PDF original is not a web address" };
    const r = await politeGet(f.pdf);
    if (r.later) return LATER;
    if (!r.ok) return r.error === "robots" ? { result: "error: robots", notes: `the PDF original: ${r.note}` } : { result: `error: PDF original ${r.error}` };
    if (sniff(r.buf) !== "application/pdf") return { result: "error: the PDF original is not a PDF" };
    return { buf: r.buf };
  }

  async function checkFlyer(f) {
    if (!/^https?:\/\//i.test(f.url)) return { result: "error: not a web address" };
    // a re-check downloads the file again: the point is to see what the address serves today
    let buf = f.again ? null : savedCopy(f.sha256);
    let serverType = "";
    if (!buf) {
      const r = await politeGet(f.url);
      if (r.later) return LATER;
      if (!r.ok) return { result: `error: ${r.error}`, notes: r.note };
      buf = r.buf;
      serverType = r.type;
    }
    if (sha256(buf) !== f.sha256) return { result: "error: changed", notes: "the file at this address is not the one in the events file any more; the importer fingerprints it again" };
    const type = sniff(buf);
    if (!FLYER_TYPES.includes(type)) return { result: `error: not a picture or PDF (${type || serverType || "unknown type"})` };
    const hasOriginal = !!f.pdf && f.pdf !== f.url;
    let original = null;
    if (wasCleared(f.row)) {
      // the very file the editor looked at: their decision stands (its PDF original too, unless that changed)
      if (!hasOriginal) return { result: "cleared", keep: true };
      original = await originalOf(f);
      if (!original.buf) return original;
      const print = sha256(original.buf).slice(0, 16);
      const known = (PDF_PRINT.exec(String(f.row.notes || "")) || [])[1];
      if (!known) return { result: "cleared", keep: true, print };
      if (known === print) return { result: "cleared", keep: true };
      // the PDF original is not the one the editor looked at: read both like a new flyer
    }
    const parts = [];
    const main = readBytes(buf, type, f.sha256.slice(0, 16));
    if (!main) return null;
    if (!hasWords(main.text)) return { result: "error: no words could be read", how: main.how };
    parts.push(main);
    let print = "";
    // the PDF original behind a preview picture: the site links it, so its words are read too
    if (hasOriginal) {
      if (!original) original = await originalOf(f);
      if (!original.buf) return original;
      print = sha256(original.buf).slice(0, 16);
      const pdf = readBytes(original.buf, "application/pdf", `${f.sha256.slice(0, 16)}-original`);
      if (!pdf) return null;
      if (!hasWords(pdf.text)) return { result: "error: no words could be read in the PDF original", how: `${main.how} + PDF original (${pdf.how})`, print };
      parts.push({ text: pdf.text, how: `PDF original (${pdf.how})` });
    }
    // flyers: e-mail addresses, sobriety dates and old page passwords — never phone numbers (owner's rule 2026-10-22)
    const found = analyse(parts.map((p) => p.text).join("\n"), { phones: false, domains: domainsOf(f), passwords: true });
    const kinds = [found.email && "e-mail", found.sobriety && "sobriety", found.password && "password"].filter(Boolean);
    return { result: kinds.length ? `hold: ${kinds.join(", ")}` : "clean", how: parts.map((p) => p.how).join(" + "), found, print };
  }

  const updates = [];
  let held = 0;
  let errors = 0;
  let n = 0;
  try {
    for (const f of todo) {
      if (n >= LIMIT) break;
      if ((Date.now() - started) / 60000 > maxMinutes) {
        console.log(`Stopping after ${maxMinutes} minutes; the rest are checked next time.`);
        break;
      }
      n++;
      let res;
      try {
        res = await checkFlyer(f);
      } catch (e) {
        // by its code or name only: an exception's message may quote the address it was reading
        res = { result: `error: ${(e && (e.code || e.name)) || "error"}` };
      }
      const events = f.ids.slice(0, 3).join(" ") + (f.ids.length > 3 ? ` +${f.ids.length - 3}` : "");
      if (!res || res.later) {
        console.log(`${String(n).padStart(4)} not read: ${res ? res.later : "no program here can read it"} (tried again next time) — ${events}`);
        continue;
      }
      const label = f.again ? " (checked again)" : "";
      // a flyer is named by its office and the hash of its address, never by its file name (an office may name a file
      // after its event: "ana-r-sobriety-date-….jpg"); the review file keeps the address
      console.log(`${String(n).padStart(4)} ${res.result}${label}${res.how ? `  (${res.how})` : ""}  — ${events}  ${f.office} ${hashKey(f.url)}`);
      let notes;
      if (res.keep) {
        // the editor's decision and notes stay; only checked_on moves (and the PDF original's fingerprint is noted)
        notes = [editorNotes(f.row.notes), res.print && `PDF original fingerprint ${res.print}`].filter(Boolean).join(" · ");
      } else if (/^error/.test(res.result) && wasCleared(f.row)) {
        notes = [CLEARED_NOTE, editorNotes(f.row.notes)].filter(Boolean).join(" · ");
      } else {
        const what = res.found ? describe(res.found) : "";
        notes = [what && `found ${what}`, res.how && `read as ${res.how}`, res.print && `PDF original fingerprint ${res.print}`, res.notes, events].filter(Boolean).join(" · ");
      }
      updates.push({ url: f.url, sha256: f.sha256, checked_on: today, result: res.result, notes });
      if (/^hold/.test(res.result)) {
        held++;
        console.log(`::warning::A central-office flyer is held (${res.result.replace(/^hold: /, "")}) — ${f.office}: ${events}. It stays hidden; an editor who opens it and finds it fine can set its result to "cleared" in data/office-flyer-review.csv.`);
      } else if (/^error/.test(res.result)) errors++;
    }
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  if (updates.length && !DRY) {
    const used = new Map();
    for (const f of flyers) {
      if (!used.has(f.url)) used.set(f.url, new Set());
      used.get(f.url).add(f.sha256);
    }
    const text = reviewText({
      header: review.exists && review.header.length ? review.header : REVIEW_HEADER,
      comments: review.exists ? review.comments : REVIEW_COMMENTS.map((c) => [c]),
      rows: mergeReview(review.rows, updates, used),
      nl: review.nl,
    });
    const before = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : null;
    if (text !== before) {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, text);
    }
  }
  if (errors) console.log(`::warning::${errors} central-office flyer(s) could not be checked; they stay hidden and are tried again in 7 days.`);
  const cleared = updates.filter((r) => r.result === "cleared").length;
  console.log(
    `\nChecked ${updates.length} central-office flyer(s): ${held} held, ${updates.filter((r) => r.result === "clean").length} clean, ${errors} could not be read` +
      `${cleared ? `, ${cleared} still cleared` : ""}.${DRY ? " (dry run: no file changed)" : ""}`,
  );
  output(updates.length, held);
}

if (OFFICE) {
  try {
    await officeFlyers();
  } catch (e) {
    console.log(`::warning::The central-office flyer check stopped early (${(e && (e.code || e.name)) || "error"}); the flyers not checked stay hidden.`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ which files */
const DRIVE_ID = /(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/g;
const candidates = new Map(); // id -> { kind, source, flyer }
// Zoom audio recordings (data/recordings.csv, every row, shown or not): never downloaded, even when a calendar
// Link: or a resource row points at one (--ids cannot pick them either: they never become candidates)
const RECORDINGS = new Set(readCsv("recordings.csv").map((r) => String(r.drive_id || "").trim()).filter(Boolean));
function addCandidate(id, kind, source, flyer = false) {
  if (RECORDINGS.has(id)) return;
  if (!candidates.has(id)) candidates.set(id, { kind, source, flyer });
}
// a calendar Link: whose label names one of these is a document, not a flyer: it is checked for phone numbers
// (unless the label also says flyer: "delegate report back flyer")
const DOC_LABEL = /\b(agendas?|orden del d[ií]a|minutes|actas?|reports?|informes?|reportes?|packets?|paquetes?|budgets?|presupuestos?|motions?|mociones|moci[oó]n|guidelines?|gu[ií]as?|financ\w*|finanzas|treasurer|tesorer\w*|rosters?|directory|directorio|sign-?in)\b/i;
const FLYER_LABEL = /fl(y|i)er|\bfly\b|volante|poster|cartel/i;

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
      const label = line.replace(/https?:\/\/\S+/g, "");
      const flyer = kind === "flyer" || FLYER_LABEL.test(label) || !DOC_LABEL.test(label);
      for (const m of line.matchAll(DRIVE_ID)) out.push({ id: m[1], kind, start, title, flyer });
    }
  }
  // newest events first: what is on the site right now matters most
  out.sort((a, b) => b.start.localeCompare(a.start));
  for (const f of out) addCandidate(f.id, f.kind, `calendar ${f.kind} – ${f.title}${f.start ? ` (${f.start.slice(0, 4)}-${f.start.slice(4, 6)}-${f.start.slice(6, 8)})` : ""}`, f.flyer);
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
      if (/^hidden$/i.test(r.status || "")) continue; // a committee-resources row kept off the site
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
const { ocrImage, readPdf } = makeReaders({ cmds, tools, tmp: TMP });
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
    // flyers are not checked for phone numbers (see the top of this file); a library document's page picture is
    const f = analyse(text, { phones: !(info.flyer || (type.startsWith("image/") && !info.firstPageOnly)) });
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
  // the log names the file and where it is linked from, not the event's title ("calendar flyer (2026-11-14)")
  const from = info.source.replace(/^(calendar \w+) – .*?((?: \(\d{4}-\d{2}-\d{2}\))?)$/, "$1$2");
  console.log(`${String(n).padStart(4)} ${id}  ${res.result}${res.how ? `  (${res.how})` : ""}  — ${from}`);
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
    "# Drive files (flyers and PDFs) whose printed words were already checked for personal phone numbers, e-mail addresses and sobriety dates by scripts/check-media.mjs (flyers — pictures and calendar PDF flyers: e-mail addresses and sobriety dates only, not phone numbers). Written automatically; a file listed here is not read again.",
    '# result = clean | hold: … (also added to flyer-holds.csv) | cleared (a person looked: false alarm) | error: … (tried again after 30 days). Delete a row to have the file read again.',
  ],
  reviewRows,
);
appendRows(HOLDS, ["drive_id", "reason", "held_on", "notes"], [], holdRows);
const holds = reviewRows.filter((r) => /^hold/.test(r.result)).length;
console.log(`\nChecked ${reviewRows.length} file(s): ${holds} held, ${reviewRows.filter((r) => r.result === "clean").length} clean, ${reviewRows.filter((r) => /^error/.test(r.result)).length} could not be read.${DRY ? " (dry run: no file changed)" : ""}`);
if (process.env.GITHUB_OUTPUT && !DRY) fs.appendFileSync(process.env.GITHUB_OUTPUT, `checked=${reviewRows.length}\nheld=${holds}\n`);

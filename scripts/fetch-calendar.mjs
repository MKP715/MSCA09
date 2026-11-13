// Downloads the Area's Google Calendar (public iCal feed) into data/calendar.ics.
// The build reads that file. If Google can't be reached, or sends something that
// isn't a calendar, the existing file is kept and the build carries on.
//
//   node scripts/fetch-calendar.mjs            download, put in canonical form, save if it changed
//   node scripts/fetch-calendar.mjs --check    also print the calendar check (never fails the run)
//
// Canonical form: Google lists the entries in a different order on every download and stamps
// each one with the download time (DTSTAMP). Both are removed from the comparison by sorting
// the VEVENT blocks by UID + RECURRENCE-ID and dropping DTSTAMP, so data/calendar.ics only
// changes (and the deploy workflow only commits it) when someone really edited the calendar.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCsv } from "../src/_lib/csv.js";

const settings = Object.fromEntries(readCsv("settings.csv").map((r) => [r.key, r.value]));
const id = process.env.CALENDAR_ID || settings.calendar_id;
const out = process.env.CALENDAR_OUT || path.join(process.cwd(), "data", "calendar.ics"); // CALENDAR_OUT: for testing
const MIN_EVENTS = 50; // a feed with fewer entries than this is an outage, not the Area's calendar
const MIN_SHARE = 0.6; // refuse a download that lost more than 40 % of the entries we already have

if (!id) {
  console.warn("[calendar] no calendar_id in data/settings.csv — skipping download");
  process.exit(0);
}

const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

// Old msca09aa.org page passwords that editors once typed into calendar entries
// ("… Password Protected: xxx", "Protegido por contraseña: xxx"). The site never shows
// them; they are also removed from the copy kept in the repository, which is public.
// (Zoom passcodes — "Password: 1234" next to a meeting ID — are join details and stay.)
const PAGE_PASSWORD = /\s*(?:\\?[;,.])?\s*(?:Password[\s-]*Protected|Protegid[oa]\s+(?:por|con)\s+contrase[nñ]a)(?:\s|\\n)*:?(?:\s|\\n)*[^\s:)\]\\]+/gi;

/** Fold one unfolded iCalendar content line at 75 octets (RFC 5545 §3.1), never inside a character. */
function fold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** Remove old page passwords from one VEVENT block; returns the block unchanged (same bytes) when there are none. */
function scrubBlock(block) {
  const unfolded = block.replace(/\r\n[ \t]/g, "");
  if (!/password[\s-]*protected|contrase[nñ]a/i.test(unfolded)) return block;
  let changed = false;
  const lines = unfolded.split("\r\n").map((l) => {
    if (!/^(DESCRIPTION|SUMMARY|LOCATION)[;:]/.test(l)) return l;
    const s = l.replace(PAGE_PASSWORD, "");
    if (s !== l) changed = true;
    return s;
  });
  if (!changed) return block;
  return lines.map((l) => (l ? fold(l) : l)).join("\r\n");
}

/** Sort VEVENTs by UID + RECURRENCE-ID and drop DTSTAMP; keep everything else byte for byte
 *  (except old page passwords, which are removed — see PAGE_PASSWORD). */
export function canonicalize(text) {
  const src = String(text).replace(/\r?\n/g, "\r\n");
  const first = src.indexOf("BEGIN:VEVENT");
  if (first < 0) return src;
  const endTag = "END:VEVENT\r\n";
  const last = src.lastIndexOf(endTag) + endTag.length;
  const head = src.slice(0, first);
  const tail = src.slice(last);
  const blocks = src.slice(first, last).split(/(?=BEGIN:VEVENT\r\n)/);
  const key = (b) => {
    const un = b.replace(/\r\n[ \t]/g, "");
    const uid = (/^UID:(.*)$/m.exec(un) || [, ""])[1];
    const rid = (/^RECURRENCE-ID[^:]*:(.*)$/m.exec(un) || [, ""])[1];
    return `${uid}\u0000${rid}`;
  };
  const clean = blocks
    .map((b) => b.replace(/^DTSTAMP:[^\r\n]*\r\n/m, ""))
    .map(scrubBlock)
    .map((b) => ({ k: key(b), b }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((x) => x.b);
  return head + clean.join("") + tail;
}

async function get(tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "msca09-site-build" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.warn(`[calendar] attempt ${i} failed: ${err.message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
  return null;
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = await get();
  if (!text) {
    console.warn("[calendar] could not download — keeping the existing data/calendar.ics");
    process.exit(0);
  }
  if (!text.startsWith("BEGIN:VCALENDAR") || !/END:VCALENDAR\s*$/.test(text)) {
    console.warn("[calendar] response is not a complete iCalendar file — keeping the existing copy");
    process.exit(0);
  }
  const count = (text.match(/^BEGIN:VEVENT/gm) || []).length;
  if (count < MIN_EVENTS) {
    console.warn(`[calendar] only ${count} entries came back — refusing to replace the existing copy`);
    process.exit(0);
  }
  const prev = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  const prevCount = (prev.match(/^BEGIN:VEVENT/gm) || []).length;
  if (prevCount && count < prevCount * MIN_SHARE) {
    console.warn(`[calendar] ${count} entries came back but the saved copy has ${prevCount} — refusing to replace it (outage?)`);
    process.exit(0);
  }

  const next = canonicalize(text);
  if (canonicalize(prev) === next) {
    console.log(`[calendar] ${count} entries — no change`);
  } else {
    fs.writeFileSync(out, next);
    console.log(`[calendar] ${count} entries — updated data/calendar.ics (${count - prevCount >= 0 ? "+" : ""}${count - prevCount})`);
  }

  if (process.argv.includes("--check")) {
    // report problems in the log; never block the build
    spawnSync(process.execPath, [path.join("scripts", "check-calendar.mjs"), out], { stdio: "inherit" });
  }
}

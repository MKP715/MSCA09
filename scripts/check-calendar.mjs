// Checks the Area calendar entries and prints what needs fixing in Google Calendar.
//
//   node scripts/check-calendar.mjs                      entries still running or upcoming
//   node scripts/check-calendar.mjs --all                every entry, past ones too
//   node scripts/check-calendar.mjs --json               machine-readable
//   node scripts/check-calendar.mjs path/to/file.ics     another copy of the feed
//
// Each entry's description should look like:
//     MSCA09|District|Hybrid
//     Language: English
//     ZoomID: 818 2990 3892
//     Email: d18dcmc@msca09aa.org
//     Note: Registration from 8:00 AM.
//     Nota: Inscripción desde las 8:00 a. m.
//     --
//     free text
// (full guide: README "Adding something to the calendar"). Problems are grouped by severity:
//   ANONYMITY  personal e-mail addresses — the site removes them, but fix them at the source
//   ERROR      the entry cannot be read properly (first line, type, format, language, repeat rule)
//   WARN       something people need is missing or looks wrong (no place, no Zoom, misspelled city,
//              a flyer on hold, a bare street address, a Spanish event without a Spanish title…)
//   INFO       cosmetic (shown only with --all)
// After the list comes "Flyers and documents on hold": every file in data/flyer-holds.csv that the calendar
// still uses, with the entry, so the maintainer can ask the host for a copy with role contacts only.
// Exit code 1 only when there is an anonymity problem, so the build log shows the rest without failing.
import fs from "node:fs";
import path from "node:path";
import { parseCalendar, DEFAULT_TOPICS, TYPO_FIXES } from "../src/_lib/calendar.js";
import { readCsv, yes } from "../src/_lib/csv.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) || path.join("data", "calendar.ics");
const all = args.includes("--all");
const asJson = args.includes("--json");

if (!fs.existsSync(file)) {
  console.error(`[check-calendar] ${file} not found`);
  process.exit(0);
}

// the same type table the site uses, so a new Type must be added to data/event-types.csv
const typeRows = readCsv("event-types.csv").filter((r) => r.key);
const types = typeRows.length
  ? Object.fromEntries(typeRows.map((r) => [r.key, { group: r.group, pages: [yes(r.is_meeting) && "meetings", yes(r.is_event) && "events"].filter(Boolean) }]))
  : undefined;
// flyers / PDFs that print personal contact details (never shown on the site)
const holdRows = readCsv("flyer-holds.csv").filter((r) => /^[A-Za-z0-9_-]{20,}$/.test(String(r.drive_id || "").trim()));
const holds = new Set(holdRows.map((r) => r.drive_id.trim()));
const holdReason = Object.fromEntries(holdRows.map((r) => [r.drive_id.trim(), r.reason || ""]));

const ANONYMITY = new Set(["E_PERSONAL_EMAIL", "E_PERSONAL_EMAIL_BODY"]);
const icsText = fs.readFileSync(file, "utf8");
const { events } = parseCalendar(icsText, { types, topics: DEFAULT_TOPICS, holds });
const nowIso = new Date().toISOString();
const isUpcoming = (e) => (e.recurrence ? e.recurrence.active : e.time.endUtc >= nowIso);
const rows = [];
const row = (e, severity, code, message) => rows.push({
  severity, code,
  when: e.recurrence ? (e.recurrence.text && e.recurrence.text.en) || e.recurrence.rrule : e.time.startDate,
  summary: e.summary, uid: e.uid, message,
});
for (const e of events) {
  if (!all && !isUpcoming(e)) continue;
  for (const p of e.problems) {
    if (p.severity === "info" && !all) continue;
    row(e, ANONYMITY.has(p.code) ? "anonymity" : p.severity, p.code, p.message);
  }
}

// Spanish-language (or bilingual) entries without a Spanish title: the Spanish pages show the English one.
// The site's loader knows the title_es rows of data/text/calendar.csv, so ask it.
try {
  process.env.CALENDAR_ICS = path.resolve(file);
  const { default: load } = await import("../src/_data/calendar.js");
  const cal = await load();
  const upcomingSlugs = new Set((cal.upcoming || []).map((o) => o.slug));
  for (const s of cal.series || []) {
    if (!all && !upcomingSlugs.has(s.slug)) continue;
    if ((s.languageAsWritten === "Spanish" || s.language === "Spanish") && !s.title_es) {
      const e = events.find((x) => x.uid === s.uid);
      if (e) row(e, "warn", "W_NO_TITLE_ES", `Spanish-language entry without a Spanish title — add a "Título:" line in Google Calendar (or a calendar.title_es.${s.slug} row in data/text/calendar.csv)`);
    }
  }
  for (const slug of cal.staleNoteRows || []) {
    const s = cal.bySlug[slug];
    const e = s && events.find((x) => x.uid === s.uid);
    if (e) row(e, "warn", "W_NOTE_ES_STALE", `the Note lines changed: update the Spanish row calendar.note_es.${slug} in data/text/calendar.csv (or add Nota: lines in Google Calendar) — until then Spanish pages show the English note`);
  }
  for (const s of cal.series || []) {
    if (!(all || upcomingSlugs.has(s.slug)) || !(s.notes || []).length || (s.notes_es || []).length) continue;
    const e = events.find((x) => x.uid === s.uid);
    if (e) row(e, "info", "I_NO_NOTA", `Note lines without a Spanish version — add Nota: lines (Spanish pages show the English note)`);
  }
  for (const [re, good] of TYPO_FIXES || []) {
    for (const e of events) {
      const text = [e.summary, e.location && e.location.raw, e.bodyRaw].join("\n");
      if ((all || isUpcoming(e)) && new RegExp(re.source, "i").test(text)) row(e, "warn", "W_TYPO", `"${re.source.replace(/\\b/g, "")}" — write "${good}" (the site corrects it for now)`);
    }
  }
} catch (err) {
  console.warn(`[check-calendar] could not run the title checks: ${err.message}`);
}

const order = { anonymity: 0, error: 1, warn: 2, info: 3 };
rows.sort((a, b) => order[a.severity] - order[b.severity] || String(a.when).localeCompare(String(b.when)));

// every held file the calendar still points to (upcoming first), whatever --all says
const heldUses = [];
for (const e of events) for (const h of e.held || []) heldUses.push({ id: h.id, field: h.field, summary: e.summary, when: e.time.startDate, upcoming: isUpcoming(e), reason: holdReason[h.id] || "" });
heldUses.sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || b.when.localeCompare(a.when));

// Public logs (GitHub Actions logs of a public repository are public): show contact details masked —
// "j…@gmail.com", "(714) …-…43". Run locally (not in CI) to see them in full, or add --show.
const SHOW = !process.env.CI && !process.env.GITHUB_ACTIONS || process.argv.includes("--show");
const maskContacts = (s) =>
  SHOW
    ? String(s)
    : String(s)
        .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[a-z]{2,})/g, "$1…@$2")
        .replace(/\(?\b(\d{3})\)?([\s.-]?)\d{3}[\s.-]?\d{2}(\d{2})\b/g, "($1)$2…-…$3");

if (asJson) {
  console.log(JSON.stringify({ findings: rows, held: heldUses }, null, 2));
} else {
  const n = (s) => rows.filter((r) => r.severity === s).length;
  console.log(`${file}: ${events.length} entries — ${rows.length} finding(s)${all ? "" : " in entries that are still running or upcoming"}`);
  console.log(`  anonymity ${n("anonymity")} · errors ${n("error")} · warnings ${n("warn")}${all ? ` · info ${n("info")}` : ""}`);
  for (const r of rows) {
    console.log(`  ${r.severity.toUpperCase().padEnd(9)} ${String(r.when).padEnd(26).slice(0, 26)} ${r.summary.slice(0, 42).padEnd(42)} ${maskContacts(r.message)}`);
  }
  if (!rows.length) console.log("  Everything looks good.");
  const upcomingHeld = heldUses.filter((h) => h.upcoming);
  console.log(`\nFlyers and documents on hold (data/flyer-holds.csv): ${holds.size} file(s); the calendar still uses ${new Set(heldUses.map((h) => h.id)).size} — ${upcomingHeld.length} on upcoming entries.`);
  console.log("  They are left out of the website. Ask the host for a version with role e-mails / office numbers only, upload it");
  console.log("  in Drive with Manage versions > Upload new version (same id), then delete the row in data/flyer-holds.csv.");
  for (const h of all ? heldUses : upcomingHeld) {
    console.log(`  ${h.upcoming ? "UPCOMING " : "past     "} ${h.when.padEnd(10)} ${h.summary.slice(0, 44).padEnd(44)} ${h.field.padEnd(4)} ${h.id}  ${h.reason}`);
  }
  if (!all && heldUses.length > upcomingHeld.length) console.log(`  (+ ${heldUses.length - upcomingHeld.length} on past entries: run with --all)`);
}
process.exit(rows.some((r) => r.severity === "anonymity") ? 1 : 0);

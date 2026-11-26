// Events added by hand (data/central-office-manual-events.csv): manualRecord (one row → a record), and the importer
// with the table, run offline in a scratch folder: the rows join the mirror flagged "manual", cleaned and with their
// flyers fingerprinted; --manual-changed and --manual-only; an office's later reads never keep or double them; a row
// whose event the office's own listing now carries is reported; a row with a mistake is named by its line, never its
// text. This file is public history: it holds no real person's name or contact detail.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { manualRecord, cleanRecord, isManual, manualHash, MANUAL_COLUMNS, MANUAL_FLAG } from "../../src/_lib/office-import.js";
import { NOW, importerSandbox, cacheOffice, cacheFlyer, fakeSha, runImporter, ROBOTS_OK } from "./helpers.mjs";

const row = (o = {}) => Object.fromEntries(MANUAL_COLUMNS.map((c) => [c, o[c] ?? ""]));
const rec = (o, ctx = {}) => manualRecord(row({ office: "inland-empire", title: "Holiday Dance", date: "2026-12-31", ...o }), { lang: "English", now: NOW, ...ctx });

test("manualRecord: times, all-day and multi-day events, language, format, type and flyers", () => {
  // an evening that ends after midnight: the next day's small hours, still that evening's event
  const dance = rec({ id: "nye-dance", start_time: "8:00 PM", end_time: "1:00 AM", type: "social" }).record;
  assert.equal(dance.id, "co-inland-empire-manual-nye-dance");
  assert.equal(dance.start, "2026-12-31T20:00:00-08:00");
  assert.equal(dance.end, "2027-01-01T01:00:00-08:00");
  assert.equal(dance.endDate, "");
  assert.equal(dance.allDay, false);
  assert.equal(dance.type, "Social");
  assert.deepEqual(dance.flags, [MANUAL_FLAG]);
  assert.ok(isManual(dance));
  // 24-hour times; no end time: flagged as such
  const noon = rec({ start_time: "12:30" }).record;
  assert.equal(noon.start, "2026-12-31T12:30:00-08:00");
  assert.equal(noon.end, "");
  assert.deepEqual(noon.flags, [MANUAL_FLAG, "no-end-time"]);
  // no start time: all day, endDate always set; a convention over three days
  const conv = rec({ title: "Convención Hispana", date: "2027-01-15", end_date: "2027-01-17" }, { lang: "Spanish" }).record;
  assert.deepEqual([conv.start, conv.end, conv.allDay, conv.endDate], ["2027-01-15", "", true, "2027-01-17"]);
  assert.equal(conv.lang, "Spanish"); // the office's language when the row gives none
  assert.equal(conv.type, "Convention"); // guessed from the title
  const one = rec({}).record;
  assert.deepEqual([one.allDay, one.endDate], [true, "2026-12-31"]);
  // a timed multi-day event: its last day; written words for the format and the language
  const retreat = rec({ date: "2027-02-05", end_date: "2027-02-07", start_time: "18:00", end_time: "12:00", format: "online", language: "Bilingüe" }).record;
  assert.equal(retreat.end, "2027-02-07T12:00:00-08:00");
  assert.equal(retreat.endDate, "2027-02-07");
  assert.deepEqual([retreat.format, retreat.lang], ["Virtual", "Bilingual"]);
  // flyers: the office's own addresses, separated by spaces, commas or semicolons; http becomes https; a PDF is a PDF
  const f = rec({ flyers: "https://aainlandempire.org/wp-content/uploads/2026/11/dance.jpg; http://aainlandempire.org/x/flyer.pdf, not-an-address" }).record.flyers;
  assert.deepEqual(f.map((x) => [x.url, x.mime, x.sha256]), [
    ["https://aainlandempire.org/wp-content/uploads/2026/11/dance.jpg", "image/jpeg", ""],
    ["https://aainlandempire.org/x/flyer.pdf", "application/pdf", ""],
  ]);
  // no id: made from the title and the date; the same row gives the same record (and source hash) every time
  assert.equal(rec({}).record.id, "co-inland-empire-manual-holiday-dance-2026-12-31");
  assert.deepEqual(rec({ start_time: "19:00" }), rec({ start_time: "19:00" }));
  assert.notEqual(rec({ start_time: "19:00" }).record.srcHash, rec({ start_time: "19:30" }).record.srcHash);
  // what editors keep for themselves (checked, notes) changes nothing
  assert.deepEqual(rec({ checked: "2026-11-25", notes: "seen on the page" }), rec({}));
  // cleaned like an office's record: the flag and the id stay, and cleaning it again changes nothing
  const clean = cleanRecord(dance, { officeHost: "aainlandempire.org", now: NOW });
  assert.deepEqual(clean.flags, [MANUAL_FLAG]);
  assert.equal(clean.id, dance.id);
  assert.deepEqual(cleanRecord(clean, { officeHost: "aainlandempire.org", now: NOW }), clean);
});

test("manualRecord: a row with a mistake says what is wrong, never quoting the row", () => {
  const problem = (o) => rec(o).problem;
  assert.equal(problem({ office: "" }), "no office");
  assert.equal(problem({ title: " " }), "no title");
  assert.equal(problem({ date: "12/31/2026" }), "date is not yyyy-mm-dd");
  assert.equal(problem({ date: "2027-02-30" }), "date is not yyyy-mm-dd");
  assert.equal(problem({ end_date: "2026-12-30" }), "end_date is before date");
  assert.equal(problem({ start_time: "25:00" }), "start_time cannot be read (19:00 or 7:00 PM)");
  assert.equal(problem({ start_time: "7 o'clock" }), "start_time cannot be read (19:00 or 7:00 PM)");
  assert.equal(problem({ end_time: "21:00" }), "end_time without start_time");
  assert.equal(problem({ start_time: "13:00 PM" }), "start_time cannot be read (19:00 or 7:00 PM)");
});

test("manualHash: the same rows give the same fingerprint, whatever the line endings", () => {
  assert.equal(manualHash("a,b\r\nc,d\r\n"), manualHash("a,b\nc,d"));
  assert.notEqual(manualHash("a,b\nc,d"), manualHash("a,b\nc,e"));
});

/* ------------------------------------------------------------------ the importer with the table */

const HEADER = MANUAL_COLUMNS.join(",");
const DANCE_FLYER = "https://aainlandempire.org/wp-content/uploads/2026/11/holiday-dance.jpg";
const line = (o) => MANUAL_COLUMNS.map((c) => (o[c] ? `"${String(o[c]).replace(/"/g, '""')}"` : "")).join(",");
const TABLE = [
  HEADER,
  `"# a note for editors",${",".repeat(MANUAL_COLUMNS.length - 2)}`,
  line({ office: "inland-empire", id: "holiday-dance", title: "Holiday Dance", date: "2026-12-12", start_time: "7:00 PM", end_time: "11:00 PM", venue: "Unity Hall", city: "Riverside", flyers: DANCE_FLYER, src: "https://aainlandempire.org/special-events" }),
  line({ office: "inland-empire", id: "bad-date", title: "Picnic", date: "Dec 5" }),
  line({ office: "nowhere", title: "Picnic", date: "2026-12-05" }),
  line({ office: "inland-empire", id: "gone", title: "Fall Social", date: "2026-10-01" }),
  // Temecula's own page lists this one already (the fixture's Children's Holiday Party)
  line({ office: "temecula", id: "kids-party", title: "Children's Holiday Party", date: "2026-12-19", start_time: "2:00 PM", end_time: "4:00 PM", city: "Temecula" }),
  "",
].join("\n");
const write = (sb, text) => fs.writeFileSync(sb.file("data", "central-office-manual-events.csv"), text);
const reportLine = (out, office) => (out.split("\n").find((l) => l.startsWith(office)) || "");

test("importer: rows join the mirror flagged manual, cleaned, their flyers fingerprinted; mistakes named by line; same bytes again", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    cacheOffice(sb, "temecula");
    sb.put("robots", "https://aainlandempire.org/robots.txt", { status: 200, body: ROBOTS_OK });
    cacheFlyer(sb, DANCE_FLYER);
    write(sb, TABLE);
    const r = runImporter(sb, ["--now", NOW]);
    const m = JSON.parse(r.mirror);
    const dance = m.events.find((e) => e.id === "co-inland-empire-manual-holiday-dance");
    assert.ok(dance, r.out);
    assert.deepEqual(dance.flags, ["manual"]);
    assert.equal(dance.start, "2026-12-12T19:00:00-08:00");
    assert.equal(dance.venue, "Unity Hall");
    assert.equal(dance.src, "https://aainlandempire.org/special-events");
    assert.deepEqual(dance.flyers.map((f) => [f.url, f.sha256, f.w, f.h]), [[DANCE_FLYER, fakeSha(DANCE_FLYER), 600, 800]]);
    // the past row and the rows with a mistake are not there; Temecula's own record is kept, not the row's copy
    assert.equal(m.events.filter(isManual).length, 1);
    assert.ok(m.events.some((e) => e.id === "co-temecula-children-s-holiday-party-20261219"));
    assert.ok(!m.events.some((e) => e.id === "co-temecula-manual-kids-party"));
    // the table's fingerprint is remembered; an office's state never lists a hand-added event
    assert.equal(m.manual, manualHash(TABLE));
    for (const st of Object.values(m.offices)) for (const id of Object.keys(st.sources || {})) assert.ok(!/-manual-/.test(id), id);
    // the report: one "(by hand)" line, rows named by line number, the row the office now carries named by its ids
    const hand = reportLine(r.out, "(by hand)");
    assert.match(hand, /line 4 \(inland-empire\): date is not yyyy-mm-dd/);
    assert.match(hand, /line 5: no such office/);
    assert.match(hand, /co-temecula-manual-kids-party = co-temecula-children-s-holiday-party-20261219/);
    assert.match(r.out, /::warning::Central-office events: 2 row\(s\) of data\/central-office-manual-events\.csv could not be used/);
    // never a row's text in the log (its title, its place or its flyer's file name)
    for (const word of ["Picnic", "Unity Hall", "holiday-dance.jpg", "Fall Social"]) assert.ok(!r.out.includes(word), word);
    // nothing changed: the same bytes, and the flyer is not downloaded again
    sb.drop("flyer", DANCE_FLYER);
    const again = runImporter(sb, ["--now", NOW]);
    assert.equal(again.mirror, r.mirror);
    assert.doesNotMatch(reportLine(again.out, "(by hand)"), /flyer not read/);
    // --check reads the hand-added events too
    assert.equal(runImporter(sb, ["--check"]).status, 0);
  } finally {
    sb.remove();
  }
});

test("importer: --manual-changed tells an edit of the table; --manual-only reads no office; an office's failure never doubles a row", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    cacheOffice(sb, "temecula");
    sb.put("robots", "https://aainlandempire.org/robots.txt", { status: 200, body: ROBOTS_OK });
    cacheFlyer(sb, DANCE_FLYER);
    write(sb, TABLE);
    const first = runImporter(sb, ["--now", NOW]);
    assert.match(runImporter(sb, ["--manual-changed"]).output, /^manual_changed=false\n$/);
    // the table is edited: told at once; --manual-only takes the new row in without asking Temecula's site again
    const edited = TABLE.replace(/\n$/, "\n") + line({ office: "victor-valley", id: "sober-social", title: "Sober Social", date: "2026-11-21", start_time: "17:00" }) + "\n";
    write(sb, edited);
    assert.match(runImporter(sb, ["--manual-changed"]).output, /^manual_changed=true\n$/);
    for (const f of fs.readdirSync(sb.cache)) if (f.startsWith("text-")) fs.rmSync(`${sb.cache}/${f}`); // a read of an office would fail now
    const only = runImporter(sb, ["--manual-only", "--now", NOW]);
    const m = JSON.parse(only.mirror);
    assert.ok(m.events.some((e) => e.id === "co-victor-valley-manual-sober-social"), only.out);
    assert.equal(m.manual, manualHash(edited));
    assert.equal(reportLine(only.out, "temecula"), ""); // Temecula was not read
    assert.deepEqual(m.offices.temecula, JSON.parse(first.mirror).offices.temecula);
    assert.match(runImporter(sb, ["--manual-changed"]).output, /^manual_changed=false\n$/);
    // the next day Temecula's site fails: its earlier events are kept, the hand-added ones are made from the table, once
    const failed = runImporter(sb, ["--now", "2026-10-31T12:00-07:00"]);
    const m2 = JSON.parse(failed.mirror);
    assert.equal(m2.offices.temecula.status, "error");
    const ids = m2.events.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(m2.events.filter(isManual).length, 2);
    // a row deleted from the table leaves the mirror at the next run, also while its office fails
    write(sb, TABLE);
    const m3 = JSON.parse(runImporter(sb, ["--manual-only", "--now", "2026-10-31T12:00-07:00"]).mirror);
    assert.ok(!m3.events.some((e) => e.id === "co-victor-valley-manual-sober-social"));
  } finally {
    sb.remove();
  }
});

test("manualRecord: an id that would read as a full name (the editor's id, or a title with one) is a hash", () => {
  const person = ["Ana", "Garcia"].join(" "); // put together at run time: this file holds no name
  const fromTitle = rec({ title: `Memorial Picnic for ${person}`, date: "2026-12-12" });
  assert.equal(fromTitle.hashed, true);
  assert.match(fromTitle.record.id, /^co-inland-empire-manual-e[a-p]{10}$/);
  const fromId = rec({ id: `${person.toLowerCase().replace(" ", "-")}-memorial` });
  assert.equal(fromId.hashed, true);
  assert.match(fromId.record.id, /^co-inland-empire-manual-e[a-p]{10}$/);
  assert.equal(rec({ id: "holiday-dance" }).hashed, undefined);
  // a hashed id never shows the event's own page (cleanRecord: the office's events page instead)
  const clean = cleanRecord({ ...fromTitle.record, src: "https://aainlandempire.org/event/x/" }, { officeHost: "aainlandempire.org", eventsPage: "https://aainlandempire.org/special-events", now: NOW });
  assert.equal(clean.src, "https://aainlandempire.org/special-events");
});

test("importer --check reads a hand-added event's id for a full name, naming no detail", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    const person = ["ana", "garcia"].join("-");
    const ev = { id: `co-inland-empire-manual-${person}-memorial`, office: "inland-empire", also: [], src: "", title: "Memorial", title_es: "", lang: "English", type: "Event", cats: [], start: "2026-12-12", end: "", allDay: true, endDate: "2026-12-12", venue: "", address: "", city: "", zip: "", format: "In person", cost: "", summary: "", flyers: [], flags: ["manual"], srcHash: "" };
    fs.writeFileSync(sb.mirrorPath, JSON.stringify({ v: 1, tz: "America/Los_Angeles", offices: {}, events: [ev] }));
    const r = runImporter(sb, ["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /::error::events\[0\] id: full name/);
    assert.ok(!r.out.includes(person), "the log never shows the id that carries a name");
    // the same id without the manual flag is an adapter's: those are hashed by their readers, and not read this way
    fs.writeFileSync(sb.mirrorPath, JSON.stringify({ v: 1, tz: "America/Los_Angeles", offices: {}, events: [{ ...ev, flags: [] }] }));
    assert.equal(runImporter(sb, ["--check"]).status, 0);
  } finally {
    sb.remove();
  }
});

test("importer: a deleted or changed row takes its offices off the card at once, also on --manual-only days", () => {
  const sb = importerSandbox(["temecula", "oiaa", "oc-central", "south-oc"]);
  try {
    cacheOffice(sb, "temecula");
    cacheOffice(sb, "oc-central");
    const both = [
      HEADER,
      line({ office: "inland-empire", id: "iwc", title: "International Women's Conference", date: "2027-02-11", end_date: "2027-02-14", city: "Buffalo, NY" }),
      line({ office: "oiaa", id: "iwc", title: "International Women's Conference", date: "2027-02-11", end_date: "2027-02-14", city: "Buffalo, NY" }),
      line({ office: "oc-central", id: "picnic", title: "Fellowship Picnic", date: "2026-11-21", start_time: "11:00", city: "Lake Forest" }),
      "",
    ].join("\n");
    write(sb, both);
    const m1 = JSON.parse(runImporter(sb, ["--now", NOW]).mirror);
    const iwc = (m) => m.events.find((e) => /-manual-iwc$/.test(e.id));
    assert.deepEqual(iwc(m1).also, ["oiaa"]);
    assert.deepEqual(m1.events.find((e) => e.id === "co-oc-central-manual-picnic").also, ["south-oc"]); // a South OC city
    // OIAA's row goes and the picnic moves to Huntington Beach: --manual-only takes both in at once
    const edited = both.replace(/^"oiaa",.*\n/m, "").replace("Lake Forest", "Huntington Beach");
    assert.notEqual(edited.split("\n").length, both.split("\n").length);
    write(sb, edited);
    const r2 = runImporter(sb, ["--manual-only", "--now", NOW]);
    const m2 = JSON.parse(r2.mirror);
    assert.deepEqual(iwc(m2).also, []);
    assert.deepEqual(m2.events.find((e) => e.id === "co-oc-central-manual-picnic").also, []);
    assert.equal(m2.offices.oiaa.count, 0);
    // and a full read agrees, byte for byte (no change from one kind of run to the other)
    const r3 = runImporter(sb, ["--now", NOW]);
    assert.equal(r3.mirror, r2.mirror);
  } finally {
    sb.remove();
  }
});

test("importer: an office whose adapter is none is never asked for a row's flyer; a folded row's flyer goes to the card kept", () => {
  const sb = importerSandbox(["temecula", "oiaa"]);
  try {
    cacheOffice(sb, "temecula");
    const OIAA_FLYER = "https://aa-intergroup.org/wp-content/uploads/2026/10/conference.pdf";
    const TVCO_FLYER = "https://www.temeculacentraloffice.org/aa/wp-content/uploads/conference.png";
    cacheFlyer(sb, TVCO_FLYER);
    write(sb, [
      HEADER,
      line({ office: "oiaa", id: "online-day", title: "Online Unity Day", date: "2026-12-05", flyers: OIAA_FLYER }),
      // the same convention by two offices: Inland Empire's row (no flyer) and Temecula's (a flyer)
      line({ office: "inland-empire", id: "conv", title: "Spring Desert Convention", date: "2027-03-12", end_date: "2027-03-14", city: "Palm Springs" }),
      line({ office: "temecula", id: "conv", title: "Spring Desert Convention", date: "2027-03-12", end_date: "2027-03-14", city: "Palm Springs", flyers: TVCO_FLYER }),
      "",
    ].join("\n"));
    const r = runImporter(sb, ["--now", NOW]);
    const m = JSON.parse(r.mirror);
    const day = m.events.find((e) => e.id === "co-oiaa-manual-online-day");
    assert.deepEqual(day.flyers.map((f) => [f.url, f.sha256]), [[OIAA_FLYER, ""]]);
    assert.match(reportLine(r.out, "(by hand)"), /flyers not read: oiaa's adapter is none/);
    assert.ok(!/aa-intergroup\.org/.test(r.out));
    // one card for the convention, whichever office leads it, with Temecula's flyer fingerprinted
    const conv = m.events.filter((e) => /-manual-conv$/.test(e.id));
    assert.equal(conv.length, 1);
    assert.deepEqual(conv[0].flyers.map((f) => [f.url, f.sha256]), [[TVCO_FLYER, fakeSha(TVCO_FLYER)]]);
    // the next run carries the fingerprint over: nothing is downloaded again, the same bytes
    sb.drop("flyer", TVCO_FLYER);
    const again = runImporter(sb, ["--now", NOW]);
    assert.equal(again.mirror, r.mirror);
    assert.doesNotMatch(reportLine(again.out, "(by hand)"), /flyer not read/);
  } finally {
    sb.remove();
  }
});

test("importer: a row whose event is on the site already from an office's own listing is left out and reported, the same on every kind of run", () => {
  const sb = importerSandbox(["oc-central", "nocco"]);
  try {
    cacheOffice(sb, "oc-central");
    cacheOffice(sb, "nocco");
    const before = runImporter(sb, ["--now", NOW]).mirror; // the offices alone
    // NOCCO's YPAA Halloween Party is folded into OC Intergroup's record of the same party (the fixtures of Oct 30);
    // OC's Open House is OC's own. Rows for both (by NOCCO and by Inland Empire) change nothing on the offices' cards
    write(sb, [
      HEADER,
      line({ office: "nocco", id: "halloween", title: "YPAA Halloween Party", date: "2026-10-31", start_time: "19:00" }),
      line({ office: "inland-empire", id: "open-house", title: "Central Office Open House", date: "2026-11-14", start_time: "11:00", end_time: "15:00", city: "Santa Ana" }),
      "",
    ].join("\n"));
    const full = runImporter(sb, ["--now", NOW]);
    const hand = reportLine(full.out, "(by hand)");
    assert.match(hand, /co-nocco-manual-halloween = co-oc-central-70310/);
    assert.match(hand, /co-inland-empire-manual-open-house = co-oc-central-\d+/);
    const strip = (t) => { const m = JSON.parse(t); delete m.manual; return JSON.stringify(m); };
    assert.equal(strip(full.mirror), strip(before)); // nothing but the table's fingerprint
    // a day without a read of the offices, and one while OC's site fails: the same mirror, the same report
    const only = runImporter(sb, ["--manual-only", "--now", NOW]);
    assert.equal(only.mirror, full.mirror);
    assert.equal(reportLine(only.out, "(by hand)").replace(/\s+/g, " ").trim(), hand.replace(/\s+/g, " ").trim());
    // the rows go: nothing on the offices' cards changes either
    write(sb, [HEADER, ""].join("\n"));
    assert.equal(strip(runImporter(sb, ["--manual-only", "--now", NOW]).mirror), strip(before));
  } finally {
    sb.remove();
  }
});

test("importer: two rows for one event keep every flyer on the one card (carried, not downloaded again); a flyer on an adapter-none office's site is never asked for", () => {
  const sb = importerSandbox(["temecula", "oiaa"]);
  try {
    cacheOffice(sb, "temecula");
    const A = "https://www.temeculacentraloffice.org/aa/wp-content/uploads/convention-a.png";
    const B = "https://www.temeculacentraloffice.org/aa/wp-content/uploads/convention-b.png";
    const ON_OIAA = "https://aa-intergroup.org/wp-content/uploads/2026/10/convention.pdf";
    cacheFlyer(sb, A);
    cacheFlyer(sb, B);
    write(sb, [
      HEADER,
      line({ office: "temecula", id: "conv", title: "Spring Desert Convention", date: "2027-03-12", end_date: "2027-03-14", city: "Palm Springs", flyers: A }),
      line({ office: "inland-empire", id: "conv", title: "Spring Desert Convention", date: "2027-03-12", end_date: "2027-03-14", city: "Palm Springs", flyers: `${B} ${ON_OIAA}` }),
      "",
    ].join("\n"));
    const r = runImporter(sb, ["--now", NOW]);
    const conv = JSON.parse(r.mirror).events.filter((e) => /-manual-conv$/.test(e.id));
    assert.equal(conv.length, 1);
    const got = Object.fromEntries(conv[0].flyers.map((f) => [f.url, f.sha256]));
    assert.deepEqual(got, { [A]: fakeSha(A), [B]: fakeSha(B), [ON_OIAA]: "" });
    assert.match(reportLine(r.out, "(by hand)"), /flyers not read: oiaa's adapter is none/);
    sb.drop("flyer", A);
    sb.drop("flyer", B);
    const again = runImporter(sb, ["--now", NOW]);
    assert.equal(again.mirror, r.mirror);
    assert.doesNotMatch(reportLine(again.out, "(by hand)"), /flyer not read \(/);
  } finally {
    sb.remove();
  }
});

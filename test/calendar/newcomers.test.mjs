// Calendar entries for newcomers: they are listed on /newcomers/ as well as on the calendar pages. An entry says so with
// a "Newcomers: yes" (or "no") line, read by parseDescription / parseCalendar (src/_lib/calendar.js); without one its
// type decides (the newcomers column of data/event-types.csv: yes for Recovery). The loader (src/_data/calendar.js)
// puts the answer on the series (s.newcomers), its dates (o.newcomers) and the types (.newcomers), and gathers
// calendar.newcomers = { meetings, events } for the page. The loader reads data/*.csv, so run from the repo root:
// npm run test:calendar
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDescription, parseCalendar } from "../../src/_lib/calendar.js";
import loadCalendar from "../../src/_data/calendar.js";

const NOW = "2026-11-28T12:00:00-08:00";
const VTZ = ["BEGIN:VTIMEZONE", "TZID:America/Los_Angeles", "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "TZNAME:PDT",
  "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800", "TZNAME:PST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD", "END:VTIMEZONE"];
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const vevent = ({ uid, title, desc, start, end, rrule, location, status, rid }) => [
  "BEGIN:VEVENT", `UID:${uid}@test`,
  `DTSTART;TZID=America/Los_Angeles:${start}`, `DTEND;TZID=America/Los_Angeles:${end}`,
  ...(rid ? [`RECURRENCE-ID;TZID=America/Los_Angeles:${rid}`] : []),
  ...(rrule ? [`RRULE:${rrule}`] : []), ...(status ? [`STATUS:${status}`] : []),
  `SUMMARY:${title}`, ...(location ? [`LOCATION:${esc(location)}`] : []), `DESCRIPTION:${esc(desc)}`, "END:VEVENT"];
const ics = (...events) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "X-WR-TIMEZONE:America/Los_Angeles", ...VTZ,
  ...events.flatMap(vevent), "END:VCALENDAR"].join("\r\n");
const desc = (type, lines = [], text = "free text") => [`MSCA09|${type}|Virtual`, "Language: English", ...lines, "--", text].join("\n");
const zoom = (n) => `https://zoom.us/j/8100000000${n}`;

// the first entry for newcomers, as it will be typed in Google Calendar (without its flyer line)
const PLBB = [
  "MSCA09|Recovery|Virtual", "Language: English", "Título: Estudio del Libro Grande en lenguaje sencillo", "Newcomers: yes",
  "Topic: Literature", "ZoomID: 863 0672 2639",
  "Note: Reading the Plain Language Big Book, followed by discussion. No passcode needed.",
  "Nota: Lectura del Libro Grande en lenguaje sencillo, seguida de una conversación. La reunión es en inglés y no necesita código de acceso.",
  "--", "Plain Language Big Book Study", "Mondays, 7:00 to 8:00 PM (Pacific), on Zoom.",
].join("\n");
const PLBB_EVENT = {
  uid: "plbb", title: "Plain Language Big Book Study", desc: PLBB, start: "20270104T190000", end: "20270104T200000",
  rrule: "FREQ=WEEKLY;UNTIL=20280101T075959Z;BYDAY=MO", location: "https://zoom.us/j/86306722639",
};

// one weekly entry, parsed with the parser's built-in type table (DEFAULT_TYPES, which has Recovery too)
const parseOne = (description) => parseCalendar(ics({ ...PLBB_EVENT, uid: "one", title: "Test meeting", desc: description }), { now: new Date(NOW) }).events[0];
const codes = (e) => e.problems.map((p) => p.code);

// the loader remembers its result per CALENDAR_ICS / CALENDAR_NOW: every scenario gets a file of its own
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "msca-newcomers-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
async function load(name, text, now = NOW) {
  const file = path.join(tmp, `${name}.ics`);
  fs.writeFileSync(file, text);
  process.env.CALENDAR_ICS = file;
  process.env.CALENDAR_NOW = now;
  return loadCalendar();
}

test("the Plain Language Big Book Study reads cleanly: Newcomers is a known field", () => {
  const d = parseDescription(PLBB);
  assert.deepEqual(d.fields.Newcomers, ["yes"]);
  assert.equal(d.fields["x:Newcomers"], undefined);
  const e = parseCalendar(ics(PLBB_EVENT), { now: new Date(NOW) }).events[0];
  assert.equal(e.newcomers, true);
  assert.equal(e.type, "Recovery");
  assert.equal(e.isMeeting, true);
  assert.deepEqual(codes(e), []);
  assert.deepEqual(e.extraFields, {});
});

test("yes words give true, no words false, no line null", () => {
  for (const v of ["yes", "Yes", "YES", "sí", "Sí", "si", "true", "1", "x", "y"]) {
    const e = parseOne(desc("Committee", [`Newcomers: ${v}`]));
    assert.equal(e.newcomers, true, v);
    assert.ok(!codes(e).includes("W_BAD_NEWCOMERS"), v);
  }
  for (const v of ["no", "No", "false", "0", "n"]) {
    const e = parseOne(desc("Recovery", [`Newcomers: ${v}`]));
    assert.equal(e.newcomers, false, v);
    assert.ok(!codes(e).includes("W_BAD_NEWCOMERS"), v);
  }
  assert.equal(parseOne(desc("Recovery")).newcomers, null);
});

test("any other value warns W_BAD_NEWCOMERS and is ignored", () => {
  for (const v of ["maybe", "yes please", "welcome"]) {
    const e = parseOne(desc("Recovery", [`Newcomers: ${v}`]));
    assert.equal(e.newcomers, null, v);
    const p = e.problems.find((x) => x.code === "W_BAD_NEWCOMERS");
    assert.ok(p, v);
    assert.equal(p.severity, "warn");
  }
});

test("the Spanish spellings are quiet aliases; Newcomer (singular) is read with a warning", () => {
  for (const line of ["Recién llegados: sí", "Recien llegados: si", "Recién llegado: sí", "recien-llegados: yes"]) {
    const e = parseOne(desc("Committee", [line]));
    assert.equal(e.newcomers, true, line);
    assert.ok(!codes(e).includes("W_FIELD_ALIAS"), line);
    assert.ok(!codes(e).includes("W_UNKNOWN_FIELD"), line);
  }
  assert.ok(!codes(parseOne(desc("Committee", ["newcomers: yes"]))).includes("W_FIELD_ALIAS"));
  const e = parseOne(desc("Committee", ["Newcomer: yes"]));
  assert.equal(e.newcomers, true);
  assert.ok(codes(e).includes("W_FIELD_ALIAS"));
});

test("a second Newcomers line is a duplicate: the first one counts", () => {
  const e = parseOne(desc("Recovery", ["Newcomers: no", "Recién llegados: sí"]));
  assert.equal(e.newcomers, false);
  assert.ok(codes(e).includes("W_DUP_FIELD"));
});

test("without a -- line, the Newcomers line still belongs to the fields, not to the public text", () => {
  const e = parseOne("MSCA09|Recovery|Virtual\nLanguage: English\nNewcomers: yes\nZoomID: 863 0672 2639\nfree text");
  assert.equal(e.newcomers, true);
  assert.ok(codes(e).includes("W_NO_SEPARATOR"));
  assert.equal(e.body, "free text");
});

test("the loader: series, dates, types and calendar.newcomers", async () => {
  const weekly = (uid, title, type, lines, start, byday, n) => ({
    uid, title, desc: desc(type, lines), start: `${start}T190000`, end: `${start}T200000`,
    rrule: `FREQ=WEEKLY;UNTIL=20270701T065959Z;BYDAY=${byday}`, location: zoom(n),
  });
  const once = (uid, title, lines, day, status) => ({
    uid, title, desc: desc("Workshop", lines), start: `${day}T090000`, end: `${day}T120000`, location: zoom(9), status,
  });
  const cal = await load("mix", ics(
    PLBB_EVENT,
    weekly("bigbook", "Big Book Study", "Recovery", [], "20261201", "TU", 1),                       // the type says yes
    weekly("typo", "Step Study", "Recovery", ["Newcomers: maybe"], "20261202", "WE", 2),           // ignored: the type says yes
    weekly("optout", "Closed Step Meeting", "Recovery", ["Newcomers: no"], "20261205", "SA", 3),   // the line wins over the type
    weekly("committee", "Literature Committee", "Committee", [], "20261204", "FR", 4),             // a service meeting
    weekly("gsr", "GSR Orientation", "Committee", ["Newcomers: yes"], "20261203", "TH", 5),         // a service meeting, flagged
    { ...weekly("ended", "Old Big Book Study", "Recovery", ["Newcomers: yes"], "20250106", "MO", 6), rrule: "FREQ=WEEKLY;UNTIL=20250701T065959Z;BYDAY=MO" },
    once("ws-yes", "Steps Workshop for Newcomers", ["Newcomers: yes"], "20270116"),
    once("ws-no", "Concepts Workshop", [], "20270123"),
    once("ws-cancelled", "Traditions Workshop for Newcomers", ["Newcomers: yes"], "20270130", "CANCELLED"),
    once("ws-past", "Sponsorship Workshop for Newcomers", ["Newcomers: yes"], "20261003"),
  ));
  assert.equal(cal.ok, true);
  const S = (uid) => cal.series.find((s) => s.uid === `${uid}@test`);

  // types
  assert.equal(cal.typeMap.Recovery.newcomers, true);
  assert.equal(cal.typeMap.Committee.newcomers, false);
  assert.equal(cal.typeMap.Other.newcomers, false);
  for (const ty of cal.types) assert.equal(typeof ty.newcomers, "boolean", ty.key);

  // series: the entry's line, else its type
  assert.equal(S("plbb").newcomers, true);
  assert.equal(S("plbb").url, "/events/plain-language-big-book-study/");
  assert.equal(S("bigbook").newcomers, true);
  assert.equal(S("typo").newcomers, true);
  assert.equal(S("optout").newcomers, false);
  assert.equal(S("committee").newcomers, false);
  assert.equal(S("gsr").newcomers, true);
  assert.equal(S("ended").newcomers, true);
  assert.equal(S("ended").ended, true);
  assert.equal(S("ws-yes").newcomers, true);
  assert.equal(S("ws-no").newcomers, false);

  // dates carry their series' answer
  const dates = (uid) => cal.occurrences.filter((o) => o.uid === `${uid}@test`);
  assert.equal(dates("plbb").length, 52);
  assert.ok(dates("plbb").every((o) => o.newcomers === true));
  assert.ok(dates("optout").length && dates("optout").every((o) => o.newcomers === false));

  // calendar.newcomers: the live flagged series by weekday (Mon, Tue, Wed, Thu here); the flagged one-time dates still to
  // come; until = the end of the last of their dates (the Study's last Monday)
  assert.deepEqual(cal.newcomers.meetings.map((s) => s.uid), ["plbb@test", "bigbook@test", "typo@test", "gsr@test"]);
  assert.deepEqual(cal.newcomers.events.map((o) => o.uid), ["ws-yes@test"]);
  assert.equal(cal.newcomers.events[0].newcomers, true);
  assert.equal(Date.parse(cal.newcomers.until), Date.parse("2027-12-27T20:00:00-08:00"));

  // a recovery type is not a service meeting: left out of upcomingMeetings ("This week in service"); a flagged service
  // meeting stays in it
  const meetingUids = new Set(cal.upcomingMeetings.map((o) => o.uid));
  assert.ok(!meetingUids.has("plbb@test") && !meetingUids.has("bigbook@test") && !meetingUids.has("optout@test"));
  assert.ok(meetingUids.has("committee@test") && meetingUids.has("gsr@test"));
  assert.ok(cal.upcoming.some((o) => o.uid === "plbb@test"));
});

test("a calendar with nothing for newcomers, and the empty calendar, still give the lists", async () => {
  const none = await load("none", ics({ ...PLBB_EVENT, desc: PLBB.replace("MSCA09|Recovery|", "MSCA09|Committee|").replace("Newcomers: yes", "Newcomers: no") }));
  assert.equal(none.ok, true);
  assert.equal(none.series[0].newcomers, false);
  assert.deepEqual(none.newcomers, { meetings: [], events: [], until: "" });
  const empty = await load("empty", "");
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.newcomers, { meetings: [], events: [], until: "" });
});

test("the meetings keep their order as the weeks pass (weekday, time, then title), so /newcomers/ is not re-dated", async () => {
  const weekly = (uid, title, start, byday, at = "190000") => ({
    uid, title, desc: desc("Recovery"), start: `${start}T${at}`, end: `${start}T${String(+at.slice(0, 2) + 1).padStart(2, "0")}${at.slice(2)}`,
    rrule: `FREQ=WEEKLY;UNTIL=20280101T075959Z;BYDAY=${byday}`, location: zoom(1),
  });
  const text = ics(
    weekly("tue", "Big Book Study", "20270105", "TU"),
    weekly("mon", "Plain Language Big Book Study", "20270104", "MO"),
    weekly("sun-late", "Sunday Evening Study", "20270103", "SU", "180000"),
    weekly("sun-b", "B Sunday Study", "20270103", "SU", "100000"),
    weekly("sun-a", "A Sunday Study", "20270103", "SU", "100000"),
  );
  const order = ["sun-a@test", "sun-b@test", "sun-late@test", "mon@test", "tue@test"];
  // before, between and after the Monday and Tuesday meetings of one week
  for (const [i, now] of ["2027-01-11T12:00:00-08:00", "2027-01-11T21:00:00-08:00", "2027-01-12T21:00:00-08:00"].entries()) {
    const cal = await load(`order-${i}`, text, now);
    assert.deepEqual(cal.newcomers.meetings.map((s) => s.uid), order, now);
  }
});

test("a date of a Recovery series retyped in Google Calendar stays out of the service list, like the rest of it", async () => {
  const series = { ...PLBB_EVENT, uid: "ov", start: "20261201T190000", end: "20261201T200000", rrule: "FREQ=WEEKLY;COUNT=4;BYDAY=TU" };
  const edited = { ...series, rrule: "", desc: PLBB.replace("MSCA09|Recovery|", "MSCA09|Committee|"), start: "20261208T190000", end: "20261208T200000", rid: "20261208T190000" };
  const cal = await load("retyped", ics(series, edited));
  const dates = cal.upcoming.filter((o) => o.uid === "ov@test");
  assert.equal(dates.length, 4);
  assert.equal(dates.find((o) => o.date === "2026-12-08").type, "Committee");
  assert.ok(!cal.upcomingMeetings.some((o) => o.uid === "ov@test"));
});

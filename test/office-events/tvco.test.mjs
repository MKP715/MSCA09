// Temecula Valley Central Office: a hand-typed WordPress page, one paragraph per event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, fixtureJson, clone } from "./helpers.mjs";
import { parseTvcoDate } from "../../src/_lib/office-import.js";

const page = fixtureJson("temecula", "page.json");
const run = pipeline("temecula", page);

test("4 event paragraphs (the Gratitude Gazette note is not one), all read", () => {
  assert.equal(run.stats.read, 4);
  assert.equal(run.stats.unparsed, 0);
  assert.deepEqual(run.records.map((r) => r.title), [
    "Bingo at Unity Hall",
    "Thanksgiving Alcathon",
    "Children’s Holiday Party",
    "ACYPAA LIV: State of Mental Goose Flesh",
  ]);
  for (const r of run.records) assert.equal(r.src, "https://www.temeculacentraloffice.org/aa-events/");
});

test("7am–1am ends the next day; the hall in bold is the venue, not part of the title", () => {
  const a = run.byTitle(/alcathon/i);
  assert.equal(a.start, "2026-11-26T07:00:00-08:00");
  assert.equal(a.end, "2026-11-27T01:00:00-08:00");
  assert.equal(a.venue, "Serenity Circle Hall");
  assert.deepEqual([a.address, a.city, a.zip], ["27574 Commerce Center Dr # 139", "Temecula", "92590"]);
  assert.equal(a.type, "Social");
  assert.equal(a.id, "co-temecula-thanksgiving-alcathon-20261126");
});

test("\"April 15-18 2027\" is all day, from the 15th to the 18th; a place only on the flyer is flagged", () => {
  const y = run.byTitle(/ACYPAA/);
  assert.deepEqual([y.allDay, y.start, y.end, y.endDate], [true, "2027-04-15", "", "2027-04-18"]);
  assert.ok(y.flags.includes("place-on-flyer"));
  assert.equal(y.type, "YPAA");
  assert.equal(y.flyers.length, 2);
});

test("flyer links: http:// becomes https://, PDFs are PDFs (a link, not a picture)", () => {
  const b = run.byTitle(/bingo/i);
  assert.equal(b.flyers[0].url, "https://www.temeculacentraloffice.org/aa/wp-content/uploads/Bingo_11.14.26.pdf");
  assert.equal(b.flyers[0].mime, "application/pdf");
  assert.equal(b.flyers[0].pdf, b.flyers[0].url);
  assert.deepEqual([b.venue, b.address, b.city], ["Unity Hall", "27732 Encanto Dr.", "Menifee"]);
  for (const f of run.records.flatMap((r) => r.flyers)) assert.match(f.url, /^https:\/\//);
  assert.equal(run.byTitle(/ACYPAA/).flyers[0].mime, "image/png");
});

test("a paragraph with a flyer but no readable date is reported, not guessed", () => {
  const p = clone(page);
  p.content.rendered = p.content.rendered.replace("Saturday, December 19, 2026 2pm-4pm", "Coming in December, date to follow");
  const r2 = pipeline("temecula", p);
  assert.equal(r2.stats.unparsed, 1);
  assert.equal(r2.records.length, 3);
  assert.equal(parseTvcoDate("Saturday, November 14, 2026 2pm-4pm").end, "2026-11-14T16:00:00-08:00");
  assert.deepEqual(parseTvcoDate("Friday, November 13, 2026 6pm").flags, ["no-end-time"]);
});

test("hand-typed times whose start has no am/pm (2-4pm, 11:30-1pm), noon; a time that cannot be read is reported, never guessed", () => {
  const d = (t) => parseTvcoDate(t);
  for (const t of ["Saturday, November 14, 2026 2-4pm", "Saturday, November 14, 2026 2 - 4 pm", "Saturday, November 14, 2026 2pm-4pm", "Saturday, November 14, 2026 2:00 to 4:00 PM"]) {
    assert.deepEqual([d(t).start, d(t).end], ["2026-11-14T14:00:00-08:00", "2026-11-14T16:00:00-08:00"], t);
  }
  assert.deepEqual([d("Saturday, November 14, 2026 11:30-1pm").start, d("Saturday, November 14, 2026 11:30-1pm").end], ["2026-11-14T11:30:00-08:00", "2026-11-14T13:00:00-08:00"]);
  assert.deepEqual([d("Saturday, November 14, 2026 10am-12").start, d("Saturday, November 14, 2026 10am-12").end], ["2026-11-14T10:00:00-08:00", "2026-11-14T12:00:00-08:00"]);
  assert.deepEqual(d("Saturday, November 14, 2026 noon"), { start: "2026-11-14T12:00:00-08:00", end: "", allDay: false, endDate: "", flags: ["no-end-time"] });
  for (const t of ["Saturday, November 14, 2026 6-9", "Saturday, November 14, 2026 9pm-1", "Saturday, November 14, 2026 @ 6"]) assert.equal(d(t), null, t);
  // an address after the date is not a time
  assert.deepEqual(d("Saturday, November 14, 2026 at 27732 Encanto Dr, Menifee"), { start: "2026-11-14", end: "", allDay: true, endDate: "2026-11-14", flags: [] });
  // the page: an entry whose time cannot be read is counted as unparsed, not made all-day
  const p = clone(page);
  p.content.rendered = p.content.rendered.replace("Saturday, December 19, 2026 2pm-4pm", "Saturday, December 19, 2026 2-4");
  const r2 = pipeline("temecula", p);
  assert.equal(r2.stats.unparsed, 1);
  assert.equal(r2.records.length, 3);
});

test("an entry's id never carries a contact detail (or a full name) from its title", () => {
  const p = clone(page);
  p.content.rendered = p.content.rendered.replace("Children&#8217;s Holiday Party", "Children&#8217;s Holiday Party – call (714) 555-0123");
  const r = pipeline("temecula", p).byTitle(/children/i);
  assert.ok(r, "the entry is still read");
  assert.match(r.id, /^co-temecula-e[a-p]{10}-20261219$/); // letters only: a hashed key never looks like a phone number
  assert.doesNotMatch(r.title, /555/);
  // a passcode written "PW:" (the id was co-temecula-…-pw-774411-20261219 before)
  const p2 = clone(page);
  p2.content.rendered = p2.content.rendered.replace("Children&#8217;s Holiday Party", "Children&#8217;s Holiday Potluck – PW: 774411");
  const r2 = pipeline("temecula", p2).byTitle(/children/i);
  assert.match(r2.id, /^co-temecula-e[a-p]{10}-20261219$/);
  assert.equal(r2.title, "Children’s Holiday Potluck");
  // ordinary titles keep their readable ids
  assert.equal(run.byTitle(/alcathon/i).id, "co-temecula-thanksgiving-alcathon-20261126");
});

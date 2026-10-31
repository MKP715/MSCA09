// NOCCO (aanoc.org): a static site; hand-typed dates on the event cards, descriptions from the RSS feed, venue and
// Spanish subtitle from the detail pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, fixture, fixtureFiles, NOW } from "./helpers.mjs";
import { aanocCards, parseAanocDate, filterRecords, adapters, hashKey } from "../../src/_lib/office-import.js";
import { contactHits } from "../../src/_lib/contact-rules.js";

const html = fixture("nocco", "events.html");
const rss = fixture("nocco", "index.xml");
const details = Object.fromEntries(
  fixtureFiles("nocco")
    .filter((f) => f.startsWith("detail-"))
    .map((f) => [`https://www.aanoc.org/events/${f.slice(7, -5)}/`, fixture("nocco", f)]),
);
const opts = { base: "https://www.aanoc.org/" };
const run = pipeline("nocco", { html, rss, details }, opts);

test("8 cards (the theme writes class=\"…\"href=\"…\" without a space), all dates read", () => {
  const cards = aanocCards(html, opts);
  assert.equal(cards.length, 8);
  assert.equal(run.stats.read, 8);
  assert.equal(run.stats.unparsed, 0);
  assert.equal(run.records.length, 8);
  for (const r of run.records) assert.match(r.src, /^https:\/\/www\.aanoc\.org\/events\/[^/]+\/$/);
});

test("the date formats typed on the cards", () => {
  const formats = new Set(aanocCards(html, opts).map((c) => c.dateText.replace(/\d+/g, "N").replace(/[A-Z][a-z]+/g, "M")));
  assert.ok(formats.size >= 3, [...formats].join(" | "));
  assert.deepEqual(parseAanocDate("October 30, 2026 @ 6:00 PM"), { start: "2026-10-30T18:00:00-07:00", end: "", allDay: false, endDate: "", flags: ["no-end-time"] });
  assert.equal(parseAanocDate("November 8, 2026 – November 8, 2026 @ 5:00pm").start, "2026-11-08T17:00:00-08:00");
  assert.deepEqual(parseAanocDate("December 4, 2026 – December 6, 2026"), { start: "2026-12-04", end: "", allDay: true, endDate: "2026-12-06", flags: [] });
  assert.deepEqual(parseAanocDate("December 12, 2026"), { start: "2026-12-12", end: "", allDay: true, endDate: "2026-12-12", flags: [] });
  assert.equal(parseAanocDate("Nov 14, 2026 @ 11 a.m. – 2 p.m.").end, "2026-11-14T14:00:00-08:00");
  assert.equal(parseAanocDate("Saturday, November 14, 2026 @ 11:00 AM").start, "2026-11-14T11:00:00-08:00");
  assert.equal(parseAanocDate("Date to be announced"), null);
  assert.equal(parseAanocDate("Every 4th Tuesday @ 6:00 PM"), null);
});

test("records: time without an end, multi-day all-day, the Spanish subtitle, venue and hybrid format", () => {
  const bingo = run.byTitle(/halloween bingo/i);
  assert.equal(bingo.start, "2026-10-30T18:00:00-07:00");
  assert.equal(bingo.end, "");
  assert.deepEqual(bingo.flags, ["no-end-time"]);
  assert.equal(bingo.venue, "Fullerton Free Church — Commons Room");
  assert.deepEqual([bingo.address, bingo.city, bingo.zip], ["2801 Brea Blvd", "Fullerton", "92835"]);
  const forum = run.byTitle(/regional forum/i);
  assert.deepEqual([forum.allDay, forum.start, forum.endDate, forum.type], [true, "2026-12-04", "2026-12-06", "Forum"]);
  const w = run.byTitle(/hispanic/i);
  assert.equal(w.title_es, "11vo Taller de Mujeres Hispanas de Alcohólicos Anónimos");
  assert.equal(w.lang, "Bilingual");
  assert.equal(w.venue, "My Safe Harbor");
  assert.equal(w.format, "Hybrid");
  assert.equal(w.type, "Workshop");
  assert.equal(run.byTitle(/practicing/i).flyers[0].url, "https://www.aanoc.org/images/events/practicing-principles.jpeg");
});

test("today's 6 pm event is kept on Oct 30 (no end time: it counts for its whole day) and dropped on Oct 31", () => {
  assert.ok(run.byTitle(/halloween bingo/i));
  const { kept, dropped } = filterRecords(run.raw, { now: "2026-10-31T09:00-07:00" });
  assert.ok(!kept.some((r) => /halloween bingo/i.test(r.title)));
  assert.equal(dropped.past, 1);
});

test("an RSS description with personal phone numbers and an e-mail address is left out whole (all or nothing)", () => {
  assert.match(rss, /Monica H\. — \(714\) 555-01\d\d/);
  const w = run.byTitle(/hispanic/i);
  assert.equal(w.summary, "");
  assert.equal(w.title, "11th Hispanic Women's A.A. Workshop");
  for (const r of run.records) assert.deepEqual(contactHits([r.title, r.summary, r.venue].join("\n")), [], r.id);
  // the Gratitude Dinner's speaker keeps first name + initial
  assert.match(run.byTitle(/gratitude/i).summary, /speaker Kay S\. of Sherman Oaks/);
});

test("a card whose date cannot be read is counted, never guessed, and reported by its place and a hash (never its title)", () => {
  const broken = html.replace("December 12, 2026", "Date to be announced");
  const got = adapters.aanoc({ html: broken, rss, details }, { office: "nocco", ...opts, now: NOW });
  assert.equal(got.stats.unparsed, 1);
  const n = aanocCards(broken, opts).findIndex((c) => /hispanic/i.test(c.title)) + 1;
  assert.deepEqual(got.stats.unparsedCards, [`card ${n} (${hashKey("11th Hispanic Women's A.A. Workshop")})`]);
  assert.match(got.stats.unparsedCards[0], /^card \d+ \(e[a-p]{10}\)$/);
  assert.equal(got.records.length, 7);
});

test("without a detail page, an unchanged card keeps the venue and subtitle read before", () => {
  const first = adapters.aanoc({ html, rss, details }, { office: "nocco", ...opts });
  const prev = new Map(first.records.map((r) => [r.id, r]));
  const again = adapters.aanoc({ html, rss, details: {} }, { office: "nocco", ...opts, prev });
  assert.deepEqual(again.records, first.records);
  // a changed card is not carried over (its detail page has to be read again)
  const changed = adapters.aanoc({ html: html.replace("Practicing Principles</span>", "Practicing Principles!</span>"), rss, details: {} }, { office: "nocco", ...opts, prev });
  assert.equal(changed.records.find((r) => /practicing/i.test(r.title)).venue, "");
});

test("hand-typed times whose start has no am/pm, noon and midnight; a time that cannot be read gives null (unparsed), never all day", () => {
  const d = (t) => parseAanocDate(t);
  assert.deepEqual([d("November 14, 2026 @ 6-9pm").start, d("November 14, 2026 @ 6-9pm").end], ["2026-11-14T18:00:00-08:00", "2026-11-14T21:00:00-08:00"]);
  assert.deepEqual([d("November 14, 2026 @ 6 - 9 PM").start, d("November 14, 2026 @ 6 - 9 PM").end], ["2026-11-14T18:00:00-08:00", "2026-11-14T21:00:00-08:00"]);
  assert.deepEqual([d("November 14, 2026 @ 11:30-1pm").start, d("November 14, 2026 @ 11:30-1pm").end], ["2026-11-14T11:30:00-08:00", "2026-11-14T13:00:00-08:00"]);
  assert.deepEqual([d("November 14, 2026 @ 6pm-9").start, d("November 14, 2026 @ 6pm-9").end], ["2026-11-14T18:00:00-08:00", "2026-11-14T21:00:00-08:00"]);
  assert.deepEqual(d("November 14, 2026 @ noon"), { start: "2026-11-14T12:00:00-08:00", end: "", allDay: false, endDate: "", flags: ["no-end-time"] });
  assert.deepEqual([d("November 14, 2026 @ noon-3pm").start, d("November 14, 2026 @ noon-3pm").end], ["2026-11-14T12:00:00-08:00", "2026-11-14T15:00:00-08:00"]);
  // a dance until midnight ends at 00:00 the next day, still one day (not a multi-day event)
  assert.deepEqual(d("November 14, 2026 @ 8pm-midnight"), { start: "2026-11-14T20:00:00-08:00", end: "2026-11-15T00:00:00-08:00", allDay: false, endDate: "", flags: [] });
  // the day daylight saving time ends: wall-clock times stay as typed
  assert.equal(d("November 1, 2026 @ 6-9pm").start, "2026-11-01T18:00:00-08:00");
  for (const t of ["November 14, 2026 @ 6-9", "November 14, 2026 @ 6", "November 14, 2026 @ 9pm-1", "November 14, 2026 @ 13pm", "November 14, 2026 at 6"]) assert.equal(d(t), null, t);
  // a card whose time cannot be read is counted as unparsed
  const broken = html.replace("October 30, 2026 @ 6:00 PM", "October 30, 2026 @ 6-9");
  assert.notEqual(broken, html);
  const got = adapters.aanoc({ html: broken, rss, details }, { office: "nocco", ...opts, now: NOW });
  assert.equal(got.stats.unparsed, 1);
  assert.ok(!got.records.some((r) => /halloween bingo/i.test(r.title)));
});

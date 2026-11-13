// All South Bay Central Office (asbco.org): usually only repeating service meetings, so an empty result is normal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, tribePages, clone } from "./helpers.mjs";
import { filterRecords } from "../../src/_lib/office-import.js";

const pages = tribePages("asbco");

test("every saved entry is a date of a repeating series: all read, none kept", () => {
  const run = pipeline("asbco", pages);
  assert.equal(run.stats.read, 54);
  assert.equal(run.stats.recurring, 54);
  assert.equal(run.records.length, 0);
});

// The one special event of the last year, the Sep 2025 Family Picnic (as the research saw it), as a single post.
const picnic = {
  id: 21058,
  url: "https://asbco.org/event/family-picnic-chili-cook-off-and-dessert-contest/",
  title: "All South Bay Central Office | Family Picnic, Chili Cook-off, and Dessert Contest",
  description: "<p>Bring the family! Chili and dessert contests, games and fellowship in the park.</p>",
  start_date: "2025-09-28 11:00:00",
  end_date: "2025-09-28 15:00:00",
  utc_start_date: "2025-09-28 18:00:00",
  utc_end_date: "2025-09-28 22:00:00",
  timezone: "UTC-7",
  all_day: false,
  cost: "$1 &#8211; $10",
  venue: { venue: "Wilson Park", address: "2200 Crenshaw Blvd", city: "Torrance", zip: "90501" },
  categories: [],
  image: false,
};

test("a one-off event is kept, with its cost ($1 – $10)", () => {
  const run = pipeline("asbco", [{ events: [...clone(pages[0].events), picnic] }]);
  // on 2026-10-30 the 2025 picnic is past; on 2025-09-01 it is the one event kept
  assert.equal(run.records.length, 0);
  const { kept } = filterRecords(run.raw, { now: "2025-09-01T12:00-07:00" });
  assert.deepEqual(kept.map((r) => r.id), ["co-asbco-21058"]);
  const rec = run.raw.find((r) => r.id === "co-asbco-21058");
  assert.ok(rec);
  assert.equal(rec.cost, "$1 – $10");
  assert.equal(rec.start, "2025-09-28T11:00:00-07:00");
  assert.equal(rec.venue, "Wilson Park");
  assert.equal(rec.city, "Torrance");
});

test("the fixed offset 'UTC-7' in `timezone` is ignored: a winter date without UTC fields is read in Pacific time (-08:00)", () => {
  const winter = { ...picnic, id: 21059, url: "https://asbco.org/event/winter-social/", title: "Winter Social", start_date: "2025-12-06 11:00:00", end_date: "2025-12-06 14:00:00", utc_start_date: "", utc_end_date: "" };
  const run = pipeline("asbco", [{ events: [winter] }]);
  const rec = run.raw[0];
  assert.equal(rec.start, "2025-12-06T11:00:00-08:00");
  assert.equal(rec.end, "2025-12-06T14:00:00-08:00");
  // and the UTC fields, when present, win: 19:00 UTC on Dec 6 is 11:00 Pacific
  const run2 = pipeline("asbco", [{ events: [{ ...winter, utc_start_date: "2025-12-06 19:00:00", utc_end_date: "2025-12-06 22:00:00", start_date: "2025-12-06 12:00:00" }] }]);
  assert.equal(run2.raw[0].start, "2025-12-06T11:00:00-08:00");
});

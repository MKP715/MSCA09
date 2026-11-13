// One office after a run (settleOffice) and the committed mirror (buildMirror, stableStringify): a failure keeps the
// earlier events, the shrink guard, and the same bytes when nothing changed. Then the importer itself
// (scripts/office-events.mjs), run offline in a scratch folder on the saved answers: folded events from one day to the
// next, flyer fingerprints, robots.txt, events held for a personal detail, NOCCO without cards, --check, and the crawl
// delay against the time budget (with a stand-in fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { settleOffice, buildMirror, stableStringify, blankRecord, recordDays, flyersOf, flyerFromState, foldedDetails, isPast, hashKey } from "../../src/_lib/office-import.js";
import { dedupeOffices } from "../../src/_lib/office-match.js";
import {
  pipeline, tribePages, fixture, fixtureJson, TODAY, NOW, importerSandbox, cacheOffice, cacheFlyer, fakeSha, fixtureFlyerUrls, aanocDetailPages, runImporter,
} from "./helpers.mjs";

const IMPORTER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "office-events.mjs");

const ev = (id, start, extra = {}) => blankRecord({ id: `co-oc-central-${id}`, office: "oc-central", title: `Event ${id}`, start, end: "", srcHash: `h${id}`, ...extra });
const old = [ev(1, "2026-10-29T18:00:00-07:00"), ev(2, "2026-11-07T11:00:00-08:00"), ev(3, "2026-12-01T11:00:00-08:00")];
const prevState = { adapter: "tribe", status: "ok", count: 3, unparsed: 0, lastChange: "2026-10-20", failingSince: "", errorKind: "", watchModified: "", pageModified: "" };

test("a failure keeps the earlier events (minus the past ones) and sets failingSince once", () => {
  const day1 = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old, result: { status: "error", errorKind: "http-5xx" }, today: TODAY });
  assert.deepEqual(day1.records.map((r) => r.id), ["co-oc-central-2", "co-oc-central-3"]);
  assert.equal(day1.state.status, "error");
  assert.equal(day1.state.errorKind, "http-5xx");
  assert.equal(day1.state.failingSince, TODAY);
  const day2 = settleOffice({ adapter: "tribe", prev: day1.state, prevRecords: day1.records, result: { status: "error", errorKind: "timeout" }, today: "2026-10-31" });
  assert.equal(day2.state.failingSince, TODAY);
  assert.equal(day2.state.errorKind, "timeout");
  assert.equal(day2.records.length, 2);
  // the next good read clears it
  const day3 = settleOffice({ adapter: "tribe", prev: day2.state, prevRecords: day2.records, result: { status: "ok", records: [old[1]] }, today: "2026-11-01" });
  assert.deepEqual([day3.state.status, day3.state.failingSince, day3.state.errorKind], ["ok", "", ""]);
});

test("shrink guard: an empty read keeps 2 or more earlier events for 3 days, then the empty list is accepted", () => {
  const d0 = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old, result: { status: "ok", records: [] }, today: TODAY });
  assert.equal(d0.state.status, "suspect");
  assert.equal(d0.records.length, 2);
  assert.equal(d0.state.failingSince, TODAY);
  const d2 = settleOffice({ adapter: "tribe", prev: d0.state, prevRecords: d0.records, result: { status: "ok", records: [] }, today: "2026-11-01" });
  assert.equal(d2.state.status, "suspect");
  assert.equal(d2.state.failingSince, TODAY);
  const d3 = settleOffice({ adapter: "tribe", prev: d2.state, prevRecords: d2.records, result: { status: "ok", records: [] }, today: "2026-11-02" });
  assert.equal(d3.state.status, "empty");
  assert.deepEqual(d3.records, []);
  assert.equal(d3.state.failingSince, "");
  // with only one earlier upcoming event, an empty list is normal (ASBCO usually has none)
  const one = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old.slice(0, 2), result: { status: "ok", records: [] }, today: TODAY });
  assert.equal(one.state.status, "empty");
});

test("lastChange moves only when the office's events (ids and sources) change; watched pages report their stamp", () => {
  const same = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old, result: { status: "ok", records: old.slice(1) }, today: TODAY });
  assert.equal(same.state.lastChange, "2026-10-20");
  const changed = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old, result: { status: "ok", records: [old[1], { ...old[2], srcHash: "new" }] }, today: TODAY });
  assert.equal(changed.state.lastChange, TODAY);
  const w1 = settleOffice({ adapter: "watch", prev: { watchModified: "2026-10-28T20:56:20", lastChange: "2026-10-01" }, result: { status: "watch", watchModified: "2026-10-30T08:00:00" }, today: TODAY });
  assert.deepEqual([w1.state.status, w1.state.watchModified, w1.state.lastChange], ["watch", "2026-10-30T08:00:00", TODAY]);
  const off = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old, result: { status: "off" }, today: TODAY });
  assert.deepEqual([off.state.status, off.records.length], ["off", 0]);
});

test("the mirror: offices by key, events by start then id, past ones out, counts with shared events", () => {
  const a = ev(5, "2026-11-07T11:00:00-08:00", { also: ["south-oc"] });
  const b = blankRecord({ id: "co-nocco-a", office: "nocco", title: "All day", start: "2026-11-07", allDay: true, endDate: "2026-11-07" });
  const m = buildMirror({ offices: { nocco: { status: "ok" }, "oc-central": { status: "ok" }, "south-oc": { status: "shared" } }, events: [a, old[0], b, old[1]], today: TODAY });
  assert.deepEqual(Object.keys(m.offices), ["nocco", "oc-central", "south-oc"]);
  assert.deepEqual(m.events.map((e) => e.id), ["co-nocco-a", "co-oc-central-2", "co-oc-central-5"]);
  assert.deepEqual([m.offices["oc-central"].count, m.offices["south-oc"].count, m.offices.nocco.count], [2, 1, 1]);
  assert.equal(m.v, 1);
  assert.equal(m.tz, "America/Los_Angeles");
});

test("the same data gives the same bytes: sorted keys, one-space indent, a final newline, no timestamps", () => {
  const recs = [...pipeline("oc-central", tribePages("oc-central")).records, ...pipeline("temecula", fixtureJson("temecula", "page.json")).records];
  const build = (list) => {
    const states = {};
    const events = [];
    for (const k of ["temecula", "oc-central"]) {
      const s = settleOffice({ adapter: "x", prev: {}, prevRecords: [], result: { status: "ok", records: list.filter((r) => r.office === k) }, today: TODAY });
      states[k] = s.state;
      events.push(...s.records);
    }
    return stableStringify(buildMirror({ offices: states, events: dedupeOffices(events, {}), today: TODAY }));
  };
  const first = build(recs);
  assert.equal(build([...recs].reverse()), first);
  assert.ok(first.endsWith("}\n"));
  assert.match(first, /^\{\n "events": \[\n  \{\n   "address": /);
  assert.doesNotMatch(first, /generated|"now"|timestamp/i);
  // the next day, nothing changed at the offices: the same bytes (lastChange stays, the past is still ahead)
  const mirror = JSON.parse(first);
  const states2 = {};
  const events2 = [];
  for (const k of ["oc-central", "temecula"]) {
    const s = settleOffice({ adapter: "x", prev: mirror.offices[k], prevRecords: mirror.events.filter((e) => e.office === k), result: { status: "ok", records: recs.filter((r) => r.office === k) }, today: TODAY });
    states2[k] = s.state;
    events2.push(...s.records);
  }
  assert.equal(stableStringify(buildMirror({ offices: states2, events: dedupeOffices(events2, {}), today: TODAY })), first);
});

test("shrink guard after a run of errors: the 3 days count from the first empty read, not from failingSince", () => {
  const failing = { ...prevState, status: "error", errorKind: "timeout", failingSince: "2026-10-25" };
  const d0 = settleOffice({ adapter: "tribe", prev: failing, prevRecords: old, result: { status: "ok", records: [] }, today: TODAY });
  assert.equal(d0.state.status, "suspect");
  assert.equal(d0.state.failingSince, TODAY);
  assert.deepEqual(d0.records.map((r) => r.id), ["co-oc-central-2", "co-oc-central-3"]);
  const d2 = settleOffice({ adapter: "tribe", prev: d0.state, prevRecords: d0.records, result: { status: "ok", records: [] }, today: "2026-11-01" });
  assert.deepEqual([d2.state.status, d2.records.length], ["suspect", 2]);
  const d3 = settleOffice({ adapter: "tribe", prev: d2.state, prevRecords: d2.records, result: { status: "ok", records: [] }, today: "2026-11-02" });
  assert.deepEqual([d3.state.status, d3.records.length], ["empty", 0]);
});

test("the office's own events (folded ones too) are kept in its state: sources and hashed flyers, carried while it fails", () => {
  const recs = [ev(2, "2026-11-07T11:00:00-08:00", { flyers: [{ url: "https://a.org/f.png", sha256: "ab12", w: 800, h: 1000 }, { url: "https://a.org/g.png", sha256: "" }] }), ev(3, "2026-12-01T11:00:00-08:00")];
  const ok = settleOffice({ adapter: "tribe", prev: prevState, prevRecords: old, result: { status: "ok", records: recs }, today: TODAY });
  assert.deepEqual(ok.state.sources, { "co-oc-central-2": "2026-11-07 h2", "co-oc-central-3": "2026-12-01 h3" });
  assert.deepEqual(ok.state.flyers, { "https://a.org/f.png": "ab12 800 1000" });
  const err = settleOffice({ adapter: "tribe", prev: ok.state, prevRecords: [], result: { status: "error", errorKind: "timeout" }, today: "2026-11-08" });
  assert.deepEqual(err.state.sources, { "co-oc-central-3": "2026-12-01 h3" }); // the past one aside
  assert.deepEqual(err.state.flyers, ok.state.flyers);
  assert.equal(err.state.lastChange, "2026-10-20");
});

test("two days, nothing changed at the offices, one event folded into another office's record: the same bytes", () => {
  // Temecula's ACYPAA is folded into OC's: it is not among Temecula's events in the mirror, and that must not move
  // Temecula's lastChange the next day
  const all = [...pipeline("oc-central", tribePages("oc-central")).records, ...pipeline("temecula", fixtureJson("temecula", "page.json")).records];
  const recs = all.filter((r) => recordDays(r)[1] >= "2026-10-31");
  const day = (prevMirror, today) => {
    const states = {};
    const events = [];
    for (const k of ["oc-central", "temecula"]) {
      const prev = prevMirror ? prevMirror.offices[k] : {};
      const prevRecords = prevMirror ? prevMirror.events.filter((e) => e.office === k) : [];
      const s = settleOffice({ adapter: "x", prev, prevRecords, result: { status: "ok", records: recs.filter((r) => r.office === k) }, today });
      states[k] = s.state;
      events.push(...s.records);
    }
    return stableStringify(buildMirror({ offices: states, events: dedupeOffices(events, {}), today }));
  };
  const first = day(null, TODAY);
  const mirror = JSON.parse(first);
  assert.ok(!mirror.events.some((e) => e.office === "temecula" && /ACYPAA/.test(e.title)), "Temecula's ACYPAA is folded");
  assert.ok(mirror.events.some((e) => e.office === "oc-central" && (e.also || []).includes("temecula")));
  assert.ok(Object.keys(mirror.offices.temecula.sources).some((id) => /acypaa/.test(id)));
  assert.equal(mirror.offices.temecula.lastChange, TODAY);
  const second = day(mirror, "2026-10-31");
  assert.equal(second, first);
});

test("the state's flyers keep the server's type; NOCCO's folded events keep what their detail page said, also while it fails", () => {
  const f = { url: "https://a.org/f.jpg", sha256: "ab12", w: 800, h: 1000, mime: "image/png" };
  assert.deepEqual(flyersOf([ev(2, "2026-11-07T11:00:00-08:00", { flyers: [f, { url: "https://a.org/g.pdf", sha256: "cd34", mime: "application/pdf" }] })]), {
    "https://a.org/f.jpg": "ab12 800 1000 image/png",
    "https://a.org/g.pdf": "cd34 0 0 application/pdf",
  });
  assert.deepEqual(flyerFromState("ab12 800 1000 image/png"), { sha256: "ab12", w: 800, h: 1000, mime: "image/png" });
  assert.deepEqual(flyerFromState("AB12 800 1000"), { sha256: "ab12", w: 800, h: 1000, mime: "" });
  assert.equal(flyerFromState("not-a-hash 1 2").sha256, "");
  const a = blankRecord({ id: "co-nocco-a", office: "nocco", title_es: "Taller", venue: "Salon Uno", format: "Hybrid" });
  const b = blankRecord({ id: "co-nocco-b", office: "nocco", venue: "Hall B" });
  const c = blankRecord({ id: "co-nocco-c", office: "nocco" });
  assert.deepEqual(foldedDetails([a, b, c], new Set(["co-nocco-b"])), { "co-nocco-a": { format: "Hybrid", title_es: "Taller", venue: "Salon Uno" } });
  const prev = { ...prevState, adapter: "aanoc", sources: { "co-nocco-a": "2026-11-07 h1", "co-nocco-old": "2026-10-01 h0" }, flyers: {}, details: { "co-nocco-a": { venue: "Salon Uno" }, "co-nocco-old": { venue: "Gone" } } };
  const err = settleOffice({ adapter: "aanoc", prev, prevRecords: [], result: { status: "error", errorKind: "timeout" }, today: TODAY });
  assert.deepEqual(err.state.details, { "co-nocco-a": { venue: "Salon Uno" } });
  assert.deepEqual(err.state.sources, { "co-nocco-a": "2026-11-07 h1" });
});

/* ------------------------------------------------------------------ the importer itself (scripts/office-events.mjs) */
// Run in a scratch folder with the saved, masked answers as its response cache (OFFICE_HTTP_OFFLINE=1: nothing is
// asked of any website). An answer taken out of the cache would make a run that asks for it lose a fingerprint or a
// place, so "the same bytes" also proves that nothing was downloaded or read again.

const NOW2 = "2026-10-31T12:00-07:00";
const lines = (out, re) => out.split("\n").filter((l) => re.test(l));
const officeLine = (out, key) => lines(out, new RegExp(`^${key}\\s`))[0] || "";
/** Run the importer on one day until nothing changes any more (every flyer fingerprinted, 3 per office per run). */
function settleDay(sb, now = NOW) {
  let text = "";
  for (let i = 0; i < 6; i++) {
    const r = runImporter(sb, ["--now", now]);
    assert.equal(r.status, 0, r.out);
    if (r.mirror === text) return { text, out: r.out };
    text = r.mirror;
  }
  assert.fail("the mirror kept changing");
}

test("importer: two days with nothing new, events folded into another office's record: the same bytes, nothing downloaded or read again", () => {
  const offices = ["oc-central", "nocco", "temecula"];
  const sb = importerSandbox(offices);
  try {
    for (const k of offices) cacheOffice(sb, k);
    const urls = offices.flatMap(fixtureFlyerUrls);
    for (const u of urls) cacheFlyer(sb, u);
    const day1 = settleDay(sb);
    const m1 = JSON.parse(day1.text);
    const ids = m1.events.map((e) => e.id);
    // NOCCO's YPAA party and ACYPAA and Temecula's ACYPAA are folded into OC's records: not among the events, but in
    // their office's state, with their flyers' fingerprints and (NOCCO) the places their detail pages gave
    for (const id of ["co-nocco-ypaa-halloween-party", "co-nocco-acypaa-54"]) {
      assert.ok(!ids.includes(id), id);
      assert.ok(id in m1.offices.nocco.sources, id);
      assert.ok(m1.offices.nocco.details[id] && m1.offices.nocco.details[id].venue, id);
    }
    const temeculaAcypaa = Object.keys(m1.offices.temecula.sources).find((id) => /acypaa/.test(id));
    assert.ok(temeculaAcypaa && !ids.includes(temeculaAcypaa));
    assert.deepEqual(m1.events.find((e) => e.id === "co-oc-central-70285").also, ["nocco", "temecula"]);
    for (const e of m1.events) for (const f of e.flyers) assert.equal(f.sha256, fakeSha(f.url), f.url);
    for (const u of fixtureFlyerUrls("temecula").filter((x) => /ACYPAA/i.test(x))) assert.match(m1.offices.temecula.flyers[u], new RegExp(`^${fakeSha(u)} `));

    // the flyers and NOCCO's detail pages are no longer answered: the same day again gives the same bytes
    for (const u of urls) sb.drop("flyer", u);
    for (const d of aanocDetailPages()) sb.drop("text", d.url);
    const again = runImporter(sb, ["--now", NOW]);
    assert.equal(again.mirror, day1.text);
    assert.match(again.out, /no change: data\/central-office-events\.json/);
    assert.deepEqual(lines(again.out, /flyer not read|detail page not read/), []);

    // the next day: only the events that are over go (NOCCO's Halloween Bingo of Oct 30); no office's lastChange moves
    cacheOffice(sb, "oc-central", { now: NOW2 });
    const d2 = runImporter(sb, ["--now", NOW2]);
    assert.equal(d2.status, 0, d2.out);
    assert.deepEqual(lines(d2.out, /flyer not read|detail page not read/), []);
    const m2 = JSON.parse(d2.mirror);
    assert.deepEqual(m2.events, m1.events.filter((e) => !isPast(e, "2026-10-31")));
    assert.ok(m2.events.length < m1.events.length);
    const bingoFlyer = m1.events.find((e) => e.id === "co-nocco-halloween-bingo").flyers[0].url;
    for (const k of offices) {
      assert.equal(m2.offices[k].lastChange, m1.offices[k].lastChange, k);
      for (const [u, v] of Object.entries(m2.offices[k].flyers)) assert.equal(v, m1.offices[k].flyers[u], u);
      assert.deepEqual(Object.keys(m1.offices[k].flyers).filter((u) => !(u in m2.offices[k].flyers)), k === "nocco" ? [bingoFlyer] : [], k);
      assert.deepEqual(m2.offices[k].details, m1.offices[k].details, k);
      assert.deepEqual(m2.offices[k].sources, Object.fromEntries(Object.entries(m1.offices[k].sources).filter(([, v]) => v.slice(0, 10) >= "2026-10-31")), k);
    }
    const d2b = runImporter(sb, ["--now", NOW2]);
    assert.equal(d2b.mirror, d2.mirror);
  } finally {
    sb.remove();
  }
});

test("importer: a flyer the check found changed is fingerprinted again; one still without a fingerprint gets its turn (round-robin)", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    cacheOffice(sb, "temecula");
    const urls = fixtureFlyerUrls("temecula");
    assert.equal(urls.length, 5);
    for (const u of urls) cacheFlyer(sb, u);
    const m1 = JSON.parse(settleDay(sb).text);
    const [bingo, alcathon] = urls.filter((u) => /Bingo|Alcathon/.test(u));
    // the flyer check: Bingo's file is not the one fingerprinted any more ("error: changed"); Alcathon's passed. Both
    // files were replaced at the office: only the one the check found changed is downloaded again by the importer
    sb.review([
      [bingo, fakeSha(bingo), "2026-10-29", "error: changed", "the file at this address is not the one in the events file any more"],
      [alcathon, fakeSha(alcathon), "2026-10-29", "clean", ""],
    ]);
    cacheFlyer(sb, bingo, 2);
    cacheFlyer(sb, alcathon, 2);
    const r = runImporter(sb, ["--now", NOW]);
    const m2 = JSON.parse(r.mirror);
    const shaOf = (m, u) => m.events.flatMap((e) => e.flyers).find((f) => f.url === u).sha256;
    assert.equal(shaOf(m2, bingo), fakeSha(bingo, 2));
    assert.equal(shaOf(m2, alcathon), fakeSha(alcathon));
    assert.equal(m2.offices.temecula.lastChange, m1.offices.temecula.lastChange);
    // Bingo's new file, the Children's party's and the 2 ACYPAA flyers have no row yet
    assert.match(r.output, /^new_flyers=4\nchanged=true\n$/);
    assert.equal(runImporter(sb, ["--now", NOW]).mirror, r.mirror); // its new file is carried over from now on
  } finally {
    sb.remove();
  }
  // flyers that cannot be downloaded (not in the cache) never hold up the others: 5 waiting, 3 a day, in turn
  const sb2 = importerSandbox(["temecula"]);
  try {
    cacheOffice(sb2, "temecula");
    const tried = (out) => lines(officeLine(out, "temecula").split(" · ").join("\n"), /^flyer not read/).map((l) => l.replace(/^.*: /, "").trim());
    const day1 = runImporter(sb2, ["--now", NOW]);
    assert.equal(tried(day1.out).length, 3);
    assert.match(officeLine(day1.out, "temecula"), /2 flyer\(s\) left for the next run/);
    const day2 = runImporter(sb2, ["--now", NOW2]);
    const day3 = runImporter(sb2, ["--now", "2026-11-01T12:00-08:00"]);
    assert.equal(tried(day2.out).length, 3);
    assert.equal(tried(day3.out).length, 3);
    // a flyer is named by its office and the hash of its address, never by its file name
    assert.deepEqual(new Set([...tried(day2.out), ...tried(day3.out)]), new Set(fixtureFlyerUrls("temecula").map((u) => `temecula ${hashKey(u)}`)));
    for (const u of fixtureFlyerUrls("temecula")) for (const out of [day1.out, day2.out, day3.out]) assert.ok(!out.includes(u.split("/").pop()), u);
    assert.equal(day3.mirror, day2.mirror); // a failed download changes nothing
  } finally {
    sb2.remove();
  }
});

test("importer: robots.txt that cannot be read (5xx) or whose group for our token disallows the feed: the office keeps its events", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    cacheOffice(sb, "temecula");
    const m1 = JSON.parse(runImporter(sb, ["--now", NOW]).mirror);
    assert.equal(m1.offices.temecula.status, "ok");
    // the next day robots.txt answers 503: nothing is read there today (RFC 9309: unreachable = disallow all)
    cacheOffice(sb, "temecula", { robots: { status: 503, body: "" } });
    const r = runImporter(sb, ["--now", NOW2]);
    const m2 = JSON.parse(r.mirror);
    assert.deepEqual([m2.offices.temecula.status, m2.offices.temecula.errorKind, m2.offices.temecula.failingSince], ["error", "robots", "2026-10-31"]);
    assert.deepEqual(m2.events, m1.events);
    assert.deepEqual(m2.offices.temecula.sources, m1.offices.temecula.sources);
    assert.match(r.out, /robots\.txt of temecula's website could not be read today/);
    // the group that names our product token (any version) wins over "*": it disallows the WordPress API
    cacheOffice(sb, "temecula", { robots: "User-agent: *\nDisallow:\n\nUser-agent: MSCA09-site-builder/2.0\nDisallow: /wp-json/\n" });
    const r3 = runImporter(sb, ["--now", NOW2]);
    assert.equal(JSON.parse(r3.mirror).offices.temecula.errorKind, "robots");
    assert.match(r3.out, /robots\.txt of temecula's website does not allow reading its events/);
    // a group for only part of the token ("site") or an empty User-agent names no one: "*" applies, the feed is read
    cacheOffice(sb, "temecula", { robots: "User-agent: site\nDisallow: /\n\nUser-agent:\nDisallow: /\n\nUser-agent: *\nDisallow: /wp-admin/\n" });
    const r4 = JSON.parse(runImporter(sb, ["--now", NOW2]).mirror);
    assert.deepEqual([r4.offices.temecula.status, r4.offices.temecula.errorKind, r4.offices.temecula.failingSince], ["ok", "", ""]);
  } finally {
    sb.remove();
  }
});

test("importer: an event whose title is only a personal detail is left out alone (held, named by id); a title with one is cut", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    const page = fixtureJson("temecula", "page.json");
    page.content.rendered +=
      "\n<p><strong>Zoom ID 812 3456 7890 Passcode 774411</strong><br />\nSaturday, November 21, 2026 6pm-8pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>" +
      "\n<p><strong>Online Workshop – Zoom ID 812 3456 7890 Passcode 774411</strong><br />\nSunday, November 22, 2026 6pm-8pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>" +
      "\n<p><strong>Potluck – PW: 774411</strong><br />\nMonday, November 23, 2026 6pm-8pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>" +
      "\n<p><strong>Workshop 812 3456 7890 (Zoom ID)</strong><br />\nTuesday, November 24, 2026 6pm-8pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>\n";
    cacheOffice(sb, "temecula", { override: { feed: JSON.stringify(page) } });
    const r = runImporter(sb, ["--now", NOW]);
    assert.equal(r.status, 0, r.out);
    const m = JSON.parse(r.mirror);
    const heldId = (/(\d+) held \(personal details\): (co-temecula-e[a-p]{10}-20261121)\b/.exec(officeLine(r.out, "temecula")) || [])[2];
    assert.ok(heldId, officeLine(r.out, "temecula"));
    assert.match(r.out, new RegExp(`::warning::Central-office events: 1 event\\(s\\) of temecula left out: their title has a personal detail \\(${heldId}\\)`));
    assert.ok(!m.events.some((e) => e.id === heldId) && !(heldId in m.offices.temecula.sources));
    assert.equal(m.events.find((e) => /-20261122$/.test(e.id)).title, "Online Workshop");
    // a title with a passcode or a meeting ID is cut, and its id is made from a hash (letters only), not from its words
    for (const [day, title] of [["20261123", "Potluck"], ["20261124", "Workshop"]]) {
      const e = m.events.find((x) => x.id.endsWith(`-${day}`));
      assert.equal(e.title, title, day);
      assert.match(e.id, new RegExp(`^co-temecula-e[a-p]{10}-${day}$`));
    }
    assert.equal(m.events.filter((e) => e.office === "temecula").length, 7);
    for (const text of [r.out, r.mirror]) for (const secret of ["812 3456", "774411", "Passcode", "PW", "pw-"]) assert.ok(!text.includes(secret), secret);
    assert.equal(runImporter(sb, ["--check"]).status, 0);
  } finally {
    sb.remove();
  }
});

test("importer: NOCCO's page without readable cards: one detail page is read as a sample, up to 12 only with --save-fixtures", () => {
  const sb = importerSandbox(["nocco"]);
  try {
    cacheOffice(sb, "nocco");
    const good = JSON.parse(runImporter(sb, ["--now", NOW]).mirror);
    assert.equal(good.events.length, 8);
    const pages = aanocDetailPages();
    const html = `<html><body><ul>\n${pages.map((d) => `<li><a href="${new URL(d.url).pathname}">event</a></li>`).join("\n")}\n</ul></body></html>`;
    cacheOffice(sb, "nocco", { override: { feed: html } });
    const fromCache = (out) => Number((/\((\d+) from the cache\)/.exec(out) || [])[1]);
    const r = runImporter(sb, ["--now", NOW]);
    const m = JSON.parse(r.mirror);
    assert.equal(m.offices.nocco.status, "suspect"); // the shrink guard keeps the 8 events
    assert.equal(m.events.length, 8);
    assert.match(officeLine(r.out, "nocco"), /no event cards found on the events page \(8 event link\(s\) on it\)/);
    // the sample page is named by its place among the links, not by its address (an address made from a title)
    assert.equal(lines(officeLine(r.out, "nocco").split(" · ").join("\n"), /^sample detail page \(event link 1\): its place can still be read/).length, 1);
    assert.ok(!/\/events\/[a-z0-9-]+\//.test(officeLine(r.out, "nocco")), officeLine(r.out, "nocco"));
    assert.equal(fromCache(r.out), 4); // robots.txt, the events page, the RSS feed, one detail page
    const fx = sb.file("fixtures-out");
    const s = runImporter(sb, ["--now", NOW, "--save-fixtures", fx]);
    assert.equal(fromCache(s.out), 3 + pages.length);
    assert.equal(fs.readdirSync(`${fx}/nocco`).filter((f) => /^detail-.*\.html$/.test(f)).length, pages.length);
  } finally {
    sb.remove();
  }
});

test("importer --check: the offices' states are checked too (folded events' ids, flyer addresses, NOCCO's details), naming no detail", () => {
  const sb = importerSandbox(["nocco"]);
  try {
    const write = (nocco) => fs.writeFileSync(sb.mirrorPath, stableStringify({ v: 1, tz: "America/Los_Angeles", offices: { nocco: { adapter: "aanoc", status: "ok", ...nocco } }, events: [] }));
    const base = { sources: { "co-nocco-a": "2026-11-07 h1" }, flyers: { "https://www.aanoc.org/images/events/a.png": "ab12 600 800 image/png" }, details: { "co-nocco-a": { venue: "Salon Uno" } } };
    write(base);
    assert.equal(runImporter(sb, ["--check"]).status, 0);
    write({ ...base, details: { "co-nocco-a": { venue: "Salon Uno, call (714) 555-0142" } } });
    let r = runImporter(sb, ["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /::error::offices\.nocco details\[0\]\.venue: phone/);
    assert.ok(!r.out.includes("555-0142"));
    write({ ...base, sources: { "co-nocco-call-714-555-0142": "2026-11-07 h1" } });
    r = runImporter(sb, ["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /::error::offices\.nocco sources\[0\]: phone/);
    assert.ok(!r.out.includes("555-0142"));
    write({ ...base, flyers: { "https://www.aanoc.org/images/events/name@example.org.png": "ab12 600 800 image/png" } });
    assert.equal(runImporter(sb, ["--check"]).status, 1);
    // an id is also read as words: "potluck-pw-774411" carries a passcode
    write({ ...base, sources: { "co-nocco-potluck-pw-774411-20261212": "2026-12-12 h1" } });
    r = runImporter(sb, ["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /::error::offices\.nocco sources\[0\]: password/);
    assert.ok(!r.out.includes("774411"));
    // a summary is all or nothing: --check reads it with summaryRisk too (a code label, a sobriety length, a long number)
    const ev = { id: "co-nocco-a", office: "nocco", also: [], title: "Picnic", title_es: "", venue: "", address: "", city: "", zip: "", cost: "", src: "", flyers: [] };
    for (const [summary, kind] of [["Bring a dish. Zoom link on the flyer.", "label"], ["Ana R. celebrates 30 years of sobriety.", "sobriety"], ["Doors at 6. 812 34 567", "digits"]]) {
      fs.writeFileSync(sb.mirrorPath, stableStringify({ v: 1, tz: "America/Los_Angeles", offices: { nocco: { adapter: "aanoc", status: "ok", ...base } }, events: [{ ...ev, summary }] }));
      r = runImporter(sb, ["--check"]);
      assert.equal(r.status, 1, summary);
      assert.match(r.out, new RegExp(`::error::co-nocco-a summary: summary \\(${kind}\\)`), summary);
      assert.ok(!/Zoom link|30 years|34 567/.test(r.out), summary);
    }
    fs.writeFileSync(sb.mirrorPath, stableStringify({ v: 1, tz: "America/Los_Angeles", offices: { nocco: { adapter: "aanoc", status: "ok", ...base } }, events: [{ ...ev, summary: "Bring a dish. Doors at 6 pm on 11/14/2026." }] }));
    assert.equal(runImporter(sb, ["--check"]).status, 0);
  } finally {
    sb.remove();
  }
});

test("importer: a summary with anything risky is left out whole; the report counts it (no-summary) and shows nothing of it", () => {
  const sb = importerSandbox(["oc-central"]);
  try {
    cacheOffice(sb, "oc-central");
    const r = runImporter(sb, ["--now", NOW]);
    assert.equal(r.status, 0, r.out);
    const header = lines(r.out, /^office\s+adapter\s+status/)[0] || "";
    const at = header.indexOf("no-summary");
    assert.ok(at > 0, header);
    assert.equal(officeLine(r.out, "oc-central").slice(at).trim().split(/\s+/)[0], "1");
    assert.match(r.out, /no-summary = summaries left out/);
    const m = JSON.parse(r.mirror);
    assert.equal(m.events.find((e) => /bowling/i.test(e.title)).summary, "");
    assert.match(m.events.find((e) => /open house/i.test(e.title)).summary, /^Come down and visit your Central Office\./);
    for (const text of [r.out, r.mirror]) assert.ok(!/Call or text|555-01/.test(text));
    assert.equal(runImporter(sb, ["--check"]).status, 0);
    // a second run changes nothing and drops nothing new from the mirror
    const again = runImporter(sb, ["--now", NOW]);
    assert.equal(again.mirror, r.mirror);
  } finally {
    sb.remove();
  }
});

test("importer: a robots.txt Crawl-delay counts up to 60 s, and the time budget is checked before waiting (stand-in fetch, no network)", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    const log = sb.file("requests.log");
    const preload = sb.file("stand-in-fetch.mjs");
    // every request is answered here: robots.txt asks for an hour between requests, anything else gets the saved page
    fs.writeFileSync(
      preload,
      `import fs from "node:fs";\n` +
        `const page = ${JSON.stringify(fixture("temecula", "page.json"))};\n` +
        `globalThis.fetch = async (url) => {\n` +
        `  const u = String(url && url.url ? url.url : url);\n` +
        `  fs.appendFileSync(${JSON.stringify(log)}, u + "\\n");\n` +
        `  if (u.endsWith("/robots.txt")) return new Response("User-agent: *\\nCrawl-delay: 3600\\n", { status: 200 });\n` +
        `  return new Response(page, { status: 200, headers: { "content-type": "application/json" } });\n` +
        `};\n`,
    );
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_|OFFICE_|CALENDAR_)/.test(k)));
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, IMPORTER, "--now", NOW], {
      cwd: sb.dir,
      encoding: "utf8",
      timeout: 90_000,
      env: { ...env, OFFICE_BUDGET_MIN: "0.25" },
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.equal(r.status, 0, out);
    // the feed's turn would come 60 s after robots.txt (not 3600 s): past the 15 s budget, so it is not waited for
    assert.ok(Date.now() - t0 < 45_000, `${Date.now() - t0} ms`);
    assert.match(out, /the time budget is used up \(this site's next turn would come in 60 s\)/);
    const m = JSON.parse(sb.mirror());
    assert.deepEqual([m.offices.temecula.status, m.offices.temecula.errorKind], ["error", "timeout"]);
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), ["https://www.temeculacentraloffice.org/robots.txt"]);
  } finally {
    sb.remove();
  }
});

test("importer: round-4 details in hand-typed titles are cut and their ids hashed; the run log and the step summary name no title", () => {
  const sb = importerSandbox(["temecula"]);
  try {
    const page = fixtureJson("temecula", "page.json");
    const add = (title, date) => `\n<p><strong>${title}</strong><br />\n${date}<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>`;
    page.content.rendered +=
      add("Potluck &#8211; PW is 774411", "Saturday, December 5, 2026 2pm-4pm") +
      add("Tom R. &#8211; Sobriety: 3/3/1989", "Sunday, December 6, 2026 2pm-4pm") +
      add("Online Workshop &#8211; 812 3456 7890 / 7788 (Zoom / PW)", "Sunday, December 13, 2026 2pm-4pm") +
      add("Ana R. &#8211; sober since &#8217;90", "Saturday, December 26, 2026 2pm-4pm") +
      add("Ana R. &#8211; AA birthday 3/3/1990", "Sunday, December 27, 2026 2pm-4pm") +
      // an entry whose time cannot be read, with a detail in its title: reported by its place and a hash only
      add("Joe&#8217;s sobriety date celebration, sober since 1990", "Saturday, December 12, 2026 6-9") +
      "\n";
    cacheOffice(sb, "temecula", { override: { feed: JSON.stringify(page) } });
    const stepFile = sb.file("step-summary.md");
    const r = runImporter(sb, ["--now", NOW], { GITHUB_STEP_SUMMARY: stepFile });
    assert.equal(r.status, 0, r.out);
    const m = JSON.parse(r.mirror);
    for (const [day, title] of [["20261205", "Potluck"], ["20261206", "Tom R."], ["20261213", "Online Workshop"], ["20261226", "Ana R."], ["20261227", "Ana R."]]) {
      const e = m.events.find((x) => x.id.endsWith(`-${day}`));
      assert.ok(e, day);
      assert.equal(e.title, title, day);
      assert.match(e.id, new RegExp(`^co-temecula-e[a-p]{10}-${day}$`), day);
    }
    const step = fs.readFileSync(stepFile, "utf8");
    assert.match(officeLine(r.out, "temecula"), /unparsed: temecula card \d+ \(e[a-p]{10}\)/);
    assert.match(step, /unparsed: temecula card \d+ \(e[a-p]{10}\)/);
    // the words of the events, never the hashes (a hash may hold any 4 digits)
    const shown = JSON.stringify([m.events.map((e) => [e.id, e.title, e.title_es, e.venue, e.src, e.summary]), Object.keys(m.offices.temecula.sources)]);
    for (const text of [r.out, step, shown]) {
      for (const secret of ["774411", "1989", "812 3456", "7788", "’90", "'90", "3/3/1990", "sobriety date", "sober since", "Joe", "PW is", "AA birthday"]) assert.ok(!text.includes(secret), secret);
    }
    assert.equal(runImporter(sb, ["--check", "--now", NOW]).status, 0);
  } finally {
    sb.remove();
  }
});

test("importer --check reads ids every way and titles with titleRisk, naming no detail", () => {
  const sb = importerSandbox(["nocco"]);
  try {
    const ev = { id: "co-nocco-a", office: "nocco", also: [], title: "Picnic", title_es: "", venue: "", address: "", city: "", zip: "", cost: "", summary: "", src: "", flyers: [] };
    const write = (e, sources = {}) =>
      fs.writeFileSync(sb.mirrorPath, stableStringify({ v: 1, tz: "America/Los_Angeles", offices: { nocco: { adapter: "aanoc", status: "ok", sources } }, events: [{ ...ev, ...e }] }));
    for (const id of ["co-nocco-ana-r-sobriety-date-3-3-1990", "co-nocco-potluck-p-w-774411", "co-nocco-ana-r-d-o-s-3-14-1989", "co-nocco-workshop-i-d-812-3456-7890"]) {
      write({ id });
      const r = runImporter(sb, ["--check", "--now", NOW]);
      assert.equal(r.status, 1, id);
      assert.match(r.out, /::error::events\[0\] id: (sobriety|password|zoom)/, id);
      assert.ok(!/1990|774411|1989|3456/.test(r.out), id);
      write({}, { [id]: "2026-12-12 h1" });
      assert.equal(runImporter(sb, ["--check", "--now", NOW]).status, 1, id);
    }
    for (const [field, value] of [["title", "Potluck PW is 774411"], ["title_es", "Ana R. – sober since ’90"], ["venue", "Online (812 3456 7890)"], ["src", "https://www.aanoc.org/events/potluck-p-w-774411/"]]) {
      write({ [field]: value });
      const r = runImporter(sb, ["--check", "--now", NOW]);
      assert.equal(r.status, 1, field);
      assert.ok(!/774411|90|3456/.test(r.out.replace(/::error::co-nocco-a [a-z_]+: [a-z, ()]+/g, "")), field);
    }
    write({ title: "2026 Sobriety Birthday Bash", venue: "Hilton – Suite 101-102, 1915 S Manchester Ave", src: "https://www.aanoc.org/events/2026-sobriety-birthday-bash/" });
    assert.equal(runImporter(sb, ["--check", "--now", NOW]).status, 0);
  } finally {
    sb.remove();
  }
});

test("importer, round 5: a flyer whose file name carries a detail is left out (never downloaded, never named); --check reads every field as cleanRecord does", () => {
  const sb = importerSandbox(["temecula"]);
  const SBC = ["sbcglobal", "net"].join(".");
  try {
    const page = fixtureJson("temecula", "page.json");
    const F = (n) => `https://www.temeculacentraloffice.org/wp-content/uploads/2026/10/${n}`;
    const risky = ["Ana-R-sober-since-3-3-1990.jpg", "Potluck-PW-774411.pdf", "Taller-Clave-Ab3x9Q.png"];
    page.content.rendered +=
      "\n<p><strong>Gratitude Potluck</strong><br />\nSaturday, December 5, 2026 2pm-4pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590<br />\n" +
      [...risky, "Gratitude-Potluck.jpg"].map((n) => `<a href="${F(n)}">Download flyer</a>`).join(" ") +
      "</p>\n";
    cacheOffice(sb, "temecula", { override: { feed: JSON.stringify(page) } });
    // even a flyer whose bytes could be read is not asked for
    for (const n of risky) cacheFlyer(sb, F(n));
    const stepFile = sb.file("step-summary.md");
    const r = runImporter(sb, ["--now", NOW], { GITHUB_STEP_SUMMARY: stepFile });
    assert.equal(r.status, 0, r.out);
    const m = JSON.parse(r.mirror);
    assert.deepEqual(m.events.find((x) => x.title === "Gratitude Potluck").flyers.map((f) => f.url), [F("Gratitude-Potluck.jpg")]);
    const step = fs.readFileSync(stepFile, "utf8");
    for (const n of risky) {
      for (const text of [r.mirror, r.out, step]) assert.ok(!text.includes(n) && !text.includes(hashKey(F(n))), n);
    }
    // the log names a flyer by its office and the hash of its address only
    for (const text of [r.out, step]) {
      for (const l of text.split(/ · |\n|\|/).map((x) => x.trim()).filter((x) => x.startsWith("flyer not read"))) assert.match(l, /^flyer not read \([^)]*\): temecula e[a-p]{10}$/);
      assert.doesNotMatch(text, /\.(?:jpe?g|png|pdf)\b/i);
    }
    assert.equal(runImporter(sb, ["--check", "--now", NOW]).status, 0);
    // --check: street address, city, price, page address, flyer file names (also a size and the office's state), titles
    const put = (change) => {
      const x = JSON.parse(r.mirror);
      change(x.events[0], x);
      fs.writeFileSync(sb.mirrorPath, stableStringify(x));
    };
    const fl = (url, sizes = []) => [{ url, sha256: "", w: 0, h: 0, mime: "image/jpeg", sizes, pdf: "" }];
    for (const [what, change] of [
      ["address", (e) => (e.address = "123 Main St – PW is 774411")],
      ["city", (e) => (e.city = "Temecula (Ana R., sober since ’90)")],
      ["cost", (e) => (e.cost = "$10 – Clave: 7 7 8 8")],
      ["src", (e) => (e.src = "https://www.temeculacentraloffice.org/event/ana-r-sober-since-90/")],
      ["flyer", (e) => (e.flyers = fl(F(risky[0])))],
      ["flyer size", (e) => (e.flyers = fl(F("Gratitude-Potluck.jpg"), [[300, F("Potluck-PW-774411-300x400.jpg")]]))],
      ["state flyer", (e, x) => (x.offices.temecula.flyers = { [F(risky[2])]: `${"a".repeat(64)} 600 800` })],
      ["title", (e) => (e.title = "Taller – Clave: Ab3x9Q")],
      ["title_es", (e) => (e.title_es = "Ana R. – soberversary 3/3/1990")],
      ["venue", (e) => (e.venue = `Picnic – RSVP anar1990 at ${SBC}`)],
    ]) {
      put(change);
      const c = runImporter(sb, ["--check", "--now", NOW]);
      assert.equal(c.status, 1, what);
      assert.doesNotMatch(c.out, /774411|’90|7 7 8 8|sober-since|Ana-R|Potluck-PW|Ab3x9Q|soberversary|anar1990|1990/, what);
    }
    // read as cleanRecord reads them, these are fine
    put((e) => {
      e.title = "Sober Since 1979 Group – 47th Anniversary";
      e.src = "https://www.temeculacentraloffice.org/event/zip-code-92590/";
      e.cost = "$25; table of 8 $180";
      e.flyers = fl(F("doc01079620260909101242-pdf.jpg"), [[300, F("20260927_210553-300x400.jpg")]]);
    });
    assert.equal(runImporter(sb, ["--check", "--now", NOW]).status, 0);
  } finally {
    sb.remove();
  }
});

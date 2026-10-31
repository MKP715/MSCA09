// Duplicates: an imported event that the Area calendar already has (matchArea), and one event listed by two offices
// (dedupeOffices). The Area items below are modelled on the Area calendar's entries of Oct 30, 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchArea, dedupeOffices, titleWords, flyerStem } from "../../src/_lib/office-match.js";
import { pipeline, tribePages, fixture, fixtureFiles, fixtureJson, officeHost } from "./helpers.mjs";

const details = Object.fromEntries(fixtureFiles("nocco").filter((f) => f.startsWith("detail-")).map((f) => [`https://www.aanoc.org/events/${f.slice(7, -5)}/`, fixture("nocco", f)]));
const recs = [
  ...pipeline("oc-central", tribePages("oc-central")).records,
  ...pipeline("nocco", { html: fixture("nocco", "events.html"), rss: fixture("nocco", "index.xml"), details }, { base: "https://www.aanoc.org/" }).records,
  ...pipeline("haco", tribePages("haco")).records,
  ...pipeline("sur-bahia", tribePages("sur-bahia")).records,
  ...pipeline("sureste-riverside", tribePages("sureste-riverside")).records,
  ...pipeline("temecula", fixtureJson("temecula", "page.json")).records,
];
const rec = (office, re) => {
  const r = recs.find((x) => x.office === office && re.test(x.title));
  assert.ok(r, `${office} ${re}`);
  return r;
};
const ctx = { officeHosts: Object.fromEntries(["oc-central", "nocco", "haco", "sur-bahia", "sureste-riverside", "temecula"].map((k) => [k, officeHost(k)])) };

const item = (o) => ({ title_es: "", end: "", allDay: false, city: "", web: "", links: [], about: "", hosts: [], ...o, date: o.date || o.start.slice(0, 10), endDate: o.endDate || o.date || o.start.slice(0, 10) });
const area = {
  chili: item({ slug: "chili", title: "South Orange County H&I Chili Cook-Off", start: "2026-10-31T11:00:00-07:00", end: "2026-10-31T14:00:00-07:00", city: "Mission Viejo", web: "https://www.oc-aa.org/event/south-county-h-i-chili-cook-off/", hosts: ["oc-aa.org"] }),
  ypaaParty: item({ slug: "ypaa-halloween", title: "YPAA Halloween Party", start: "2026-10-31T19:00:00-07:00", end: "2026-10-31T23:00:00-07:00", city: "Costa Mesa" }),
  bowling: item({ slug: "bowling", title: "Orange County Intergroup Bowling", start: "2026-11-01T12:30:00-08:00", end: "2026-11-01T14:00:00-08:00", city: "Irvine", hosts: ["oc-aa.org"] }),
  traditions: item({ slug: "traditions", title: "Traditions Day 2026 – District 12", start: "2026-11-07T11:00:00-08:00", end: "2026-11-07T15:00:00-08:00", city: "Laguna Woods", links: ["https://www.oc-aa.org/event/traditions-day-2026/"] }),
  gratitude: item({ slug: "gratitude", title: "42nd Annual Gratitude Dinner", start: "2026-11-08T17:00:00-08:00", end: "2026-11-08T20:30:00-08:00", city: "Palm Springs", hosts: ["aainthedesert.org"] }),
  openHouse: item({ slug: "open-house", title: "Orange County Central Office Open House", start: "2026-11-14T11:00:00-08:00", end: "2026-11-14T15:00:00-08:00", city: "Santa Ana", about: "Details: https://www.oc-aa.org/event/central-office-open-house-3/ and the flyer.", hosts: ["oc-aa.org"] }),
  servathon: item({ slug: "servathon", title: "MSCA Area 09 Panel 76 Servathon", start: "2026-11-14T10:00:00-08:00", end: "2026-11-14T14:00:00-08:00", city: "San Bernardino", hosts: ["msca09aa.org"] }),
  bingo: item({ slug: "tvco-bingo", title: "Temecula Valley Central Office Bingo", start: "2026-11-14T14:00:00-08:00", end: "2026-11-14T16:00:00-08:00", city: "Menifee", hosts: ["temeculacentraloffice.org"] }),
  iceCream: item({ slug: "ice-cream", title: "Ice Cream Social & Tradition Play", start: "2026-11-14T14:00:00-08:00", end: "2026-11-14T16:00:00-08:00", city: "Hemet" }),
  banquet: item({ slug: "banquet", title: "Harbor Area Central Office Traditions Banquet", start: "2026-11-21T18:30:00-08:00", end: "2026-11-21T22:00:00-08:00", city: "Long Beach", hosts: ["hacoaa.org"] }),
  forum: item({ slug: "forum", title: "2026 Pacific Regional Forum", start: "2026-12-04T00:00:00-08:00", allDay: true, date: "2026-12-04", endDate: "2026-12-06", city: "San Diego" }),
  women: item({ slug: "women", title: "11th Hispanic Women's Workshop", title_es: "11vo Taller de Mujeres Hispanas", start: "2026-12-12T09:00:00-08:00", end: "2026-12-12T16:00:00-08:00", city: "Anaheim", hosts: ["msca09aa.org"] }),
  acypaa: item({ slug: "acypaa", title: "ACYPAA LIV – All California Young People in A.A.", start: "2027-04-15T00:00:00-07:00", allDay: true, date: "2027-04-15", endDate: "2027-04-18", city: "Ontario" }),
};
const all = Object.values(area);

test("true twins are found, each with its reason", () => {
  const cases = [
    [rec("oc-central", /chili/i), "chili", /url/],
    [rec("oc-central", /^halloween party$/i), "ypaa-halloween", /2 words/],
    [rec("nocco", /ypaa halloween/i), "ypaa-halloween", /words/],
    [rec("oc-central", /bowling/i), "bowling", /host/],
    [rec("oc-central", /traditions day/i), "traditions", /url/],
    [rec("oc-central", /open house/i), "open-house", /url/],
    [rec("sureste-riverside", /servathon/i), "servathon", /1 word.*time/],
    [rec("nocco", /servathon/i), "servathon", /word/],
    [rec("temecula", /bingo/i), "tvco-bingo", /host/],
    [rec("haco", /banquet/i), "banquet", /2 words/],
    [rec("haco", /women/i), "women", /words/],
    [rec("nocco", /hispanic/i), "women", /words/],
    [rec("nocco", /gratitude/i), "gratitude", /words/],
    [rec("nocco", /regional forum/i), "forum", /words/],
    [rec("oc-central", /ACYPAA/), "acypaa", /words/],
    [rec("nocco", /ACYPAA/), "acypaa", /word/],
    [rec("temecula", /ACYPAA/), "acypaa", /word.*time/],
  ];
  for (const [r, slug, reason] of cases) {
    const m = matchArea(r, all, ctx);
    assert.equal(m.twin, true, r.title);
    assert.equal(m.slug, slug, r.title);
    assert.match(m.reason, reason, `${r.title}: ${m.reason}`);
  }
});

test("traps: same day and hour but not the same event", () => {
  // Practicing Principles (NOCCO) and OC's Open House: both Nov 14 at 11:00, no shared word, another office
  assert.equal(matchArea(rec("nocco", /practicing/i), [area.openHouse], ctx).twin, false);
  // the Ice Cream Social and Temecula's Bingo: both Nov 14 at 14:00, no shared word, not Temecula's
  assert.equal(matchArea(rec("temecula", /bingo/i), [area.iceCream], ctx).twin, false);
  // an office's events page linked from an Area entry is not an event's own page
  assert.equal(matchArea(rec("temecula", /children/i), [item({ slug: "x", title: "Family potluck", start: "2026-12-19T14:00:00-08:00", end: "2026-12-19T16:00:00-08:00", web: "https://www.temeculacentraloffice.org/aa-events/" })], ctx).twin, false);
  // another day never matches
  assert.equal(matchArea({ ...rec("haco", /banquet/i), start: "2026-11-22T18:30:00-08:00", end: "2026-11-22T22:00:00-08:00" }, [area.banquet], ctx).twin, false);
  // the rest of today's imports have no twin
  for (const r of [rec("nocco", /practicing/i), rec("oc-central", /dance of the dead/i), rec("sur-bahia", /aniversario/i), rec("temecula", /alcathon/i), rec("sureste-riverside", /congreso/i)]) {
    assert.equal(matchArea(r, all, ctx).twin, false, r.title);
  }
});

test("stop words and numbers do not count as shared words", () => {
  assert.deepEqual([...titleWords("Aniversario #39 grupo Buscando Sobriedad")].sort(), ["buscando", "sobriedad"]);
  assert.deepEqual([...titleWords("32 Aniversario del Grupo AA 12 Pasos")], ["paso"]);
  assert.deepEqual([...titleWords("ACYPAA LIV: 54th Annual Convention")].sort(), ["acypaa", "convention"]);
});

test("between offices: the same event once, the other offices in `also`; the two Nov 1 aniversarios stay apart", () => {
  const log = [];
  const sort = { "oc-central": 10, nocco: 30, haco: 60, "sur-bahia": 70, temecula: 90, "sureste-riverside": 100 };
  const out = dedupeOffices(recs, { officeSort: sort, log });
  const acy = out.filter((r) => /ACYPAA/.test(r.title));
  assert.equal(acy.length, 1);
  assert.equal(acy[0].office, "oc-central");
  assert.deepEqual(acy[0].also, ["nocco", "temecula"]);
  assert.equal(out.filter((r) => /halloween party/i.test(r.title)).length, 1);
  assert.equal(out.filter((r) => /hispanic women/i.test(r.title)).length, 1);
  assert.equal(out.filter((r) => /aniversario/i.test(r.title) && r.start.startsWith("2026-11-01")).length, 2);
  assert.ok(log.some((x) => x.dropped === "co-nocco-acypaa-54" && /flyer/.test(x.reason)));
  // the input is not changed
  assert.ok(recs.every((r) => !r.also.length));
  // a flyer that passed the check decides which record stays
  const okFlyer = (f) => /ACYPAA54_Flyer\.png$/.test(f.url) && /aanoc/.test(f.url);
  const out2 = dedupeOffices(recs, { officeSort: sort, flyerOk: okFlyer });
  const acy2 = out2.find((r) => /ACYPAA/.test(r.title));
  assert.equal(acy2.office, "nocco");
  assert.deepEqual(acy2.also, ["oc-central", "temecula"]);
});

test("the flyer signal: the same file name (sizes, -scaled and _v2 aside) or the same SHA-256", () => {
  assert.equal(flyerStem("https://a.org/wp-content/uploads/2026/09/ACYPAA54_Flyer-723x1024.png"), "acypaa54_flyer");
  assert.equal(flyerStem("https://b.org/images/events/YPAAHalloween_Party_Flyer2026_v2.png"), "ypaahalloween_party_flyer2026");
  assert.equal(flyerStem("https://c.org/x/Flyer-scaled.jpg"), "flyer");
  const a = { id: "co-a-1", office: "oc-central", also: [], title: "Sober Fest", start: "2026-12-05T12:00:00-08:00", end: "2026-12-05T18:00:00-08:00", allDay: false, city: "", flyers: [{ url: "https://a.org/up/sober-fest-2026.jpg", sha256: "" }] };
  const b = { ...a, id: "co-b-1", office: "nocco", title: "Celebration in the park", start: "2026-12-05T12:30:00-08:00", flyers: [{ url: "https://b.org/img/sober-fest-2026-768x1024.jpg", sha256: "" }] };
  assert.equal(dedupeOffices([a, b], {}).length, 1);
  const c = { ...b, flyers: [{ url: "https://b.org/img/other.jpg", sha256: "abc" }] };
  assert.equal(dedupeOffices([a, c], {}).length, 2);
  assert.equal(dedupeOffices([{ ...a, flyers: [{ url: "https://a.org/z.jpg", sha256: "abc" }] }, c], {}).length, 1);
});

test("two events of one office never end up in one group, even when both look like a third office's event", () => {
  const base = { also: [], end: "", allDay: false, city: "", src: "", flyers: [] };
  const party = { ...base, id: "co-oc-central-1", office: "oc-central", title: "Halloween Party", start: "2026-10-31T19:00:00-07:00" };
  const bingo = { ...base, id: "co-oc-central-2", office: "oc-central", title: "Halloween Bingo", start: "2026-10-31T19:30:00-07:00" };
  const both = { ...base, id: "co-nocco-1", office: "nocco", title: "YPAA Halloween Bingo Party", start: "2026-10-31T19:00:00-07:00" };
  const sort = { "oc-central": 10, nocco: 30 };
  for (const input of [[party, bingo, both], [both, bingo, party], [bingo, both, party]]) {
    const log = [];
    const out = dedupeOffices(input, { officeSort: sort, log });
    // both OC events stay; NOCCO's is folded into one of them, and the result does not depend on the input order
    assert.deepEqual(out.map((r) => r.id).sort(), ["co-oc-central-1", "co-oc-central-2"]);
    assert.deepEqual(out.find((r) => r.id === "co-oc-central-1").also, ["nocco"]);
    assert.deepEqual(out.find((r) => r.id === "co-oc-central-2").also, []);
    assert.deepEqual(log, [{ kept: "co-oc-central-1", dropped: "co-nocco-1", reason: "2 words + time" }]);
  }
  // a record joins a group only as a twin of the record the group keeps: a third office's "Bingo Night" (a twin of
  // OC's Bingo only through "bingo" + time) is not folded into OC's Halloween Party
  const night = { ...base, id: "co-haco-1", office: "haco", title: "Bingo Night", start: "2026-10-31T19:30:00-07:00" };
  const out = dedupeOffices([party, both, night], { officeSort: { ...sort, haco: 60 } });
  assert.deepEqual(out.map((r) => r.id).sort(), ["co-haco-1", "co-oc-central-1"]);
  assert.deepEqual(out.find((r) => r.id === "co-oc-central-1").also, ["nocco"]);
});

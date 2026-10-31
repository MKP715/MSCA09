// Central-office events: is an imported event already on the Area's Google Calendar (matchArea), and is it listed by
// two offices at once (dedupeOffices)? Pure functions, used by the importer's report (scripts/office-events.mjs) and
// by the site build (src/_data/officeEvents.js).
//
// An Area item (built by the site from its calendar occurrences and their series):
//   /** @typedef {{ slug: string, title: string, title_es?: string,
//    *    start: string,     // ISO with offset (an all-day item: its first day at 00:00 Pacific)
//    *    end?: string,      // ISO with offset, "" when unknown
//    *    allDay: boolean,
//    *    date: string,      // yyyy-mm-dd, Pacific: the first day
//    *    endDate?: string,  // yyyy-mm-dd, Pacific: the last day (inclusive)
//    *    city?: string, web?: string, links?: string[], about?: string,   // about: the plain "About" text
//    *    hosts?: string[]   // the websites (host names, without www.) of the organizers that hold it
//    * }} AreaItem */
//
// Signals between an imported record and a candidate (dates that overlap, in Pacific time; when either side has a
// start time only, the same first day):
//   url   the record's event page (host without www., path without the closing "/") is in the item's web, links or About
//   host  the item's organizers include the office's website (ctx.officeHosts[office])
//   words distinctive title words both share (accents, capitals, short words, numbers, ordinals, Roman numerals and
//         common words such as annual, central, office, district, group, anniversary dropped)
//   city  the same city
//   time  both timed and starting at most 60 minutes apart, or both all-day over the same days
// Twin when: url, or words ≥ 2, or (words ≥ 1 and (host or city or time)), or (host and time).
// Overrides (data/central-office-overrides.csv) are applied by the caller: same-as and show win over the matcher.
import { DateTime } from "luxon";

const TZ = "America/Los_Angeles";
const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const hostOf = (u) => String(u || "").toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:?#].*$/, "").replace(/^www\./, "");

const STOP = new Set(
  `annual anual central office oficina offices oficinas intergroup intergrupal intergrupo county condado orange district distrito area msca
   panel event evento events eventos group grupo grupos alcoholics alcoholicos anonymous anonimos anniversary aniversario celebration celebracion
   meeting meetings reunion reuniones junta the and for with from our your you all are this that its into will join come
   del las los una uno por para con que sus nuestra nuestro como mas annual`.split(/\s+/),
);
const ROMAN = /^m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const ORDINAL = /^\d+(?:st|nd|rd|th|vo|va|ro|ra|do|da|to|ta|er|o|a|°|º|ª)$/;

/** The distinctive words of a title (and its Spanish title). */
export function titleWords(...titles) {
  const out = new Set();
  for (const t of titles) {
    for (const w of fold(t).toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/)) {
      if (w.length < 3 || /^\d+$/.test(w) || ORDINAL.test(w) || ROMAN.test(w) || STOP.has(w)) continue;
      out.add(w.replace(/s$/, "")); // "parties" ~ "party" is beyond this; "workshops" ~ "workshop" is not
    }
  }
  return out;
}

/** A web address as "host/path" (no scheme, no www., no closing "/"), lower-case; "" when it is not one. */
export function normUrl(u) {
  try {
    const x = new URL(String(u || "").trim());
    return `${x.hostname.replace(/^www\./, "")}${decodeURI(x.pathname).replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

const dt = (iso) => DateTime.fromISO(String(iso || ""), { setZone: true }).setZone(TZ);
/** [first day, last day, timed start (DateTime or null), has a known end] of a record or an Area item. */
function span(x) {
  if (!x || !x.start) return ["", "", null, false];
  if (x.allDay) {
    const f = x.date || String(x.start).slice(0, 10);
    const l = x.endDate && x.endDate > f ? x.endDate : f;
    return [f, l, null, true];
  }
  const s = dt(x.start);
  if (!s.isValid) return ["", "", null, false];
  const f = x.date || s.toISODate();
  let l = x.endDate || "";
  if (!l && x.end) {
    const e = dt(x.end);
    if (e.isValid && e > s) l = e.minus({ minutes: 1 }).toISODate();
  }
  return [f, l && l > f ? l : f, s, !!(x.end || x.endDate)];
}

/** The signals between two entries (a record and an Area item, or two records). null when their dates do not overlap. */
export function signals(a, b, { hostA = [], hostB = [], flyer = false } = {}) {
  const [af, al, as, aEnd] = span(a);
  const [bf, bl, bs, bEnd] = span(b);
  if (!af || !bf) return null;
  if (!aEnd || !bEnd ? af !== bf : af > bl || bf > al) return null;
  const wa = titleWords(a.title, a.title_es);
  const wb = titleWords(b.title, b.title_es);
  const words = [...wa].filter((w) => wb.has(w)).length;
  const cityA = fold(a.city).toLowerCase().trim();
  const time = a.allDay && b.allDay ? af === bf && al === bl : !a.allDay && !b.allDay && as && bs ? Math.abs(as.diff(bs, "minutes").minutes) <= 60 : false;
  const city = !!cityA && cityA === fold(b.city).toLowerCase().trim();
  const host = hostA.length > 0 && hostA.some((h) => hostB.includes(h));
  return { words, city, time, host, flyer };
}

const isTwin = (s, url) => url || s.words >= 2 || (s.words >= 1 && (s.host || s.city || s.time || s.flyer)) || (s.host && s.time) || (s.flyer && s.time);
const reasonOf = (s, url) =>
  [url && "url", s.words && `${s.words} word${s.words > 1 ? "s" : ""}`, s.host && "host", s.city && "city", s.time && "time", s.flyer && "flyer"].filter(Boolean).join(" + ");
const score = (s, url) => (url ? 100 : 0) + s.words * 10 + (s.host ? 5 : 0) + (s.time ? 4 : 0) + (s.city ? 3 : 0) + (s.flyer ? 6 : 0);

/**
 * Is this imported record already on the Area calendar? → { twin, slug, reason } (the best candidate).
 * ctx = { officeHosts: { officeKey: "host" }, eventsPages: { officeKey: "url" } (optional) }.
 * @param {object} rec an imported event (data/central-office-events.json)
 * @param {AreaItem[]} areaItems
 */
export function matchArea(rec, areaItems, ctx = {}) {
  const hostsOf = ctx.officeHosts || {};
  const recHosts = [rec.office, ...(rec.also || [])].map((k) => hostOf(hostsOf[k])).filter(Boolean);
  // an office's events page ("…/aa-events/", Temecula's src for every event) is linked from many entries: as a url
  // signal only an event's own page counts
  let src = normUrl(rec.src);
  const listing = ctx.eventsPages && ctx.eventsPages[rec.office] ? normUrl(ctx.eventsPages[rec.office]) : "";
  if (src && (src === listing || /\/(?:[a-z-]*events?|eventos|calendar|calendario)$/.test(src) || !src.includes("/"))) src = "";
  let best = null;
  for (const it of areaItems || []) {
    const s = signals(rec, it, { hostA: recHosts, hostB: (it.hosts || []).map(hostOf) });
    if (!s) continue;
    let url = false;
    if (src) {
      const pool = [it.web, ...(it.links || [])].map(normUrl);
      const about = fold(it.about || "").toLowerCase().replace(/https?:\/\/(?:www\.)?/g, "");
      url = pool.includes(src) || about.includes(src + "/") || new RegExp(`${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`).test(about);
    }
    if (!isTwin(s, url)) continue;
    const sc = score(s, url);
    if (!best || sc > best.sc) best = { sc, slug: it.slug, reason: reasonOf(s, url) };
  }
  return best ? { twin: true, slug: best.slug, reason: best.reason } : { twin: false, slug: "", reason: "" };
}

/** A flyer's file name without WordPress's size, "-scaled" and "_v2" endings: "ACYPAA54_Flyer". */
export function flyerStem(url) {
  const name = decodeURIComponent(String(url || "").split(/[?#]/)[0].split("/").pop() || "").toLowerCase();
  return name.replace(/\.[a-z0-9]+$/, "").replace(/-\d+x\d+$/, "").replace(/-scaled$/, "").replace(/[_-]v\d+$/, "").replace(/-pdf$/, "");
}

/**
 * The same event listed by two offices (OC's and NOCCO's ACYPAA): one record stays, the other offices go into its
 * `also`. The same test as matchArea without the host signal, plus a flyer signal (the same file name, or the same
 * SHA-256). The record kept: the one with a flyer that passed the check (ctx.flyerOk(flyer)), then the one with an end
 * time, then the one of the office with the lower sort (ctx.officeSort), then the lower id. ctx.log (an array)
 * receives { kept, dropped, reason } for each record folded into another.
 *
 * Groups are built greedily, the strongest pairs first (score, then ids: the input order does not matter), and a
 * group never holds two records of the same office (two events of one office are two events, even when both look like
 * a third office's one), and every record folded into a group is a twin of the record the group keeps.
 */
export function dedupeOffices(records, ctx = {}) {
  const recs = (records || []).map((r) => ({ ...r, also: [...(r.also || [])] }));
  const ok = typeof ctx.flyerOk === "function" ? ctx.flyerOk : () => false;
  const sortOf = (k) => (ctx.officeSort && Number.isFinite(Number(ctx.officeSort[k])) ? Number(ctx.officeSort[k]) : 999);
  const rank = (r) => [(r.flyers || []).some(ok) ? 0 : 1, r.end || r.allDay ? 0 : 1, sortOf(r.office)];
  const better = (a, b) => {
    const x = rank(a);
    const y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
  // every pair of twins (records of two offices), with its score and reason
  const pairs = [];
  const twin = new Map();
  const key = (i, j) => (i < j ? `${i} ${j}` : `${j} ${i}`);
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i];
      const b = recs[j];
      if (a.office === b.office) continue;
      const fa = (a.flyers || []).map((f) => [flyerStem(f.url), f.sha256 || ""]);
      const fb = (b.flyers || []).map((f) => [flyerStem(f.url), f.sha256 || ""]);
      const flyer = fa.some(([n, h]) => fb.some(([n2, h2]) => (n && n === n2) || (h && h === h2)));
      const s = signals(a, b, { flyer });
      if (!s) continue;
      const url = !!a.src && normUrl(a.src) === normUrl(b.src) && normUrl(a.src).split("/").length > 2;
      if (!isTwin(s, url)) continue;
      const p = { i, j, sc: score(s, url), reason: reasonOf(s, url), ids: [a.id, b.id].sort().join(" ") };
      pairs.push(p);
      twin.set(key(i, j), p);
    }
  }
  pairs.sort((x, y) => y.sc - x.sc || (x.ids < y.ids ? -1 : x.ids > y.ids ? 1 : 0));
  // greedy grouping: a union only when the offices stay distinct and the group's best record is a twin of every other
  const groupOf = recs.map((_, i) => i);
  const members = recs.map((_, i) => [i]);
  for (const p of pairs) {
    const ga = groupOf[p.i];
    const gb = groupOf[p.j];
    if (ga === gb) continue;
    const all = [...members[ga], ...members[gb]];
    const offices = all.map((m) => recs[m].office);
    if (new Set(offices).size !== offices.length) continue;
    const lead = all.reduce((x, y) => (better(recs[x], recs[y]) <= 0 ? x : y));
    if (!all.every((m) => m === lead || twin.has(key(m, lead)))) continue;
    for (const m of members[gb]) groupOf[m] = ga;
    members[ga] = all;
    members[gb] = [];
  }
  const keep = new Set();
  for (const list of members) {
    if (!list.length) continue;
    if (list.length === 1) {
      keep.add(recs[list[0]]);
      continue;
    }
    const sorted = list.map((m) => recs[m]).sort(better);
    const [k, ...rest] = sorted;
    const ki = list.find((m) => recs[m] === k);
    k.also = [...new Set([...k.also, ...rest.flatMap((r) => [r.office, ...(r.also || [])])])].filter((o) => o && o !== k.office).sort();
    keep.add(k);
    if (Array.isArray(ctx.log)) {
      for (const r of rest) {
        const ri = list.find((m) => recs[m] === r);
        const p = twin.get(key(ki, ri));
        ctx.log.push({ kept: k.id, dropped: r.id, reason: p ? p.reason : "same event" });
      }
    }
  }
  return recs.filter((r) => keep.has(r));
}

/** Area items (see AreaItem) from the site's calendar data (src/_data/calendar.js): one-time and repeating events,
 *  not the regular meetings. */
export function areaItemsFromCalendar(cal) {
  const bySlug = (cal && cal.bySlug) || {};
  const out = [];
  for (const o of (cal && cal.occurrences) || []) {
    const s = bySlug[o.slug];
    if (!s || (s.recurring && s.isMeeting) || o.status === "cancelled") continue;
    const links = [s.web, ...(s.links || []).map((l) => l.url), ...(s.organizers || []).map((x) => x.url)].filter(Boolean);
    out.push({
      slug: s.slug, title: o.title, title_es: o.title_es || "", start: o.start, end: o.allDay ? "" : o.end || "", allDay: !!o.allDay,
      date: o.date, endDate: o.endDate || o.date, city: o.city || "", web: s.web || "", links, about: s.about_text || "",
      hosts: [...new Set([...(s.organizers || []).map((x) => hostOf(x.url)), hostOf(s.web)].filter(Boolean))],
    });
  }
  return out;
}

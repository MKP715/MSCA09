// The districts of Area 09, from data/districts.csv (one row per district).
//
// Volunteers edit data/districts.csv on github.com; this file only reshapes it.
//   - status: active | merged | inactive   (merged/inactive rows only get a redirect page)
//   - kind:   geographic | linguistic       (a row with kind "interdistrict" describes the
//             Spanish-speaking districts' Inter-District Meeting shown on /districts/)
//   - lists (cities, counties, neighbors, covers_districts, subdistricts) are separated by ";"
//
// The Google Calendar is the source for business-meeting times and places; the meeting_*
// columns are used when the calendar has nothing for a district, to fill in a venue name or
// ZIP the calendar leaves out, and — when meeting_override is "yes" — instead of a calendar
// entry that is known to be wrong (src/_lib/plugins/districts.js does the merging and logs
// every difference during the build).
//
// Also merged in here (each file is optional, the site still builds without it):
//   data/trusted-servants.csv   rows whose `district` column names this district
//   data/central-offices.csv    offices whose `districts` column lists this district's number
// Calendar series/events and documents are added in the page templates from the
// `calendar` and `documents` global data (other loaders' output is not visible here).
import { DateTime } from "luxon";
import { readCsv, list, num, yes } from "../_lib/csv.js";
import { LANGS } from "../_lib/i18n.js";

const TZ = "America/Los_Angeles";
const DAYS = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

/** "19:30" → { h, m } */
function hm(s) {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

/** "7:00–8:30 PM" / "7:00–8:30 p. m." from "19:00" + "20:30". */
function timeRange(start, end, lang = "en") {
  const a = hm(start);
  const b = hm(end);
  if (!a) return "";
  const es = lang === "es";
  const mer = (h) => (h >= 12 ? (es ? "p. m." : "PM") : es ? "a. m." : "AM");
  const clock = (t) => `${t.h % 12 || 12}:${String(t.m).padStart(2, "0")}`;
  if (!b) return `${clock(a)} ${mer(a.h)}`;
  if (mer(a.h) === mer(b.h)) return `${clock(a)}–${clock(b)} ${mer(b.h)}`;
  return `${clock(a)} ${mer(a.h)}–${clock(b)} ${mer(b.h)}`;
}

/** Next dates of a "2nd Tuesday" / "every Monday" / "1st, 2nd & 4th Wednesday" meeting. */
function nextDates(row, count = 6) {
  const weekday = DAYS[String(row.meeting_day || "").trim().toLowerCase()];
  const start = hm(row.meeting_start);
  if (!weekday || !start) return [];
  const end = hm(row.meeting_end) || { h: start.h + 1, m: start.m };
  const weekSpec = String(row.meeting_week || "").trim().toLowerCase();
  const weeks = weekSpec === "every" || weekSpec === "" ? null : list(weekSpec, /\s*[,;]\s*/).map(Number);
  const skip = list(row.meeting_skip_months, /\s*[,;]\s*/).map(Number);
  const now = DateTime.now().setZone(TZ);
  const out = [];
  let d = now.startOf("day");
  for (let i = 0; i < 400 && out.length < count; i++, d = d.plus({ days: 1 })) {
    if (d.weekday !== weekday) continue;
    if (skip.includes(d.month)) continue;
    const nth = Math.ceil(d.day / 7);
    const isLast = d.plus({ days: 7 }).month !== d.month;
    if (weeks && !weeks.includes(nth) && !(weeks.includes(5) && isLast) && !(weeks.includes(-1) && isLast)) continue;
    const s = d.set({ hour: start.h, minute: start.m });
    let e = d.set({ hour: end.h, minute: end.m });
    if (e <= s) e = s.plus({ hours: 1 });
    if (e < now) continue;
    out.push({ start: s.toISO(), end: e.toISO(), date: s.toISODate() });
  }
  return out;
}

const mapsUrl = (q) => (q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "");

/** "Hawthorne (south of Rosecrans Ave)" → { base: "Hawthorne", qual: "south of Rosecrans Ave" } */
function splitCity(s) {
  const m = String(s).match(/^(.*?)\s*\((.*)\)\s*$/);
  return m ? { base: m[1].trim(), qual: m[2].trim() } : { base: String(s).trim(), qual: "" };
}

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function numbersOf(v) {
  return (String(v || "").match(/\d+/g) || []).map(Number);
}

/** A trusted-servants.csv / central-offices.csv district cell → district slugs. */
function makeResolver(rows) {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const byNum = new Map();
  for (const r of rows) for (const n of r.nums) if (!byNum.has(n)) byNum.set(n, r.slug);
  return (cell) => {
    const out = new Set();
    for (const part of list(cell, /\s*[;|,/]\s*/)) {
      const p = part.trim().toLowerCase();
      if (bySlug.has(p)) {
        out.add(p);
        continue;
      }
      // "1 & 3", "d5", "District 20", "20"
      const ns = numbersOf(p);
      for (const n of ns) if (byNum.has(n)) out.add(byNum.get(n));
    }
    return [...out];
  };
}

// Same order as servantOrder in src/_lib/plugins/districts.js: DCMC, Alternate DCMC, DCMs (each
// sub-district's alternate right after them, by position_sort), Secretary, Treasurer, Registrar, the rest.
// "Alternate DCM Sub-District C" is an alternate DCM, not the Alternate DCMC: the DCMC pattern is anchored.
const PRIORITY = [
  /^(dcmc|cmcd|d\.c\.m\.c|coordinador)/i,
  /alt(ernate)?\.?\s*(dcmc|cmcd)\b|\b(dcmc|cmcd)\b.*\b(alt(ernate)?|suplente)\b/i,
  /^(alt(ernate)?\.?\s*)?(dcms?|mcds?)\b/i,
  /secretar/i,
  /treasurer|tesorer/i,
  /registrar|registrador/i,
];
function servantRank(s) {
  const role = `${s.role_en || ""}`;
  const i = PRIORITY.findIndex((re) => re.test(role));
  return i === -1 ? PRIORITY.length : i;
}

export default function () {
  const settings = Object.fromEntries(readCsv("settings.csv").map((r) => [r.key, r.value]));
  const panel = String(settings.panel || "").trim();

  const raw = readCsv("districts.csv");
  const rows = raw.map((r) => ({ ...r, slug: String(r.slug || "").trim().toLowerCase(), nums: numbersOf(r.nums || r.number) }));
  const districtRows = rows.filter((r) => r.slug && r.kind !== "interdistrict");
  const resolve = makeResolver(districtRows);

  // ---------------------------------------------------------------- people (optional file)
  const servantsBy = {};
  for (const s of readCsv("trusted-servants.csv")) {
    if (!s.district) continue;
    const status = String(s.status || "").toLowerCase();
    if (/^(previous|past|former|inactive|old)/.test(status)) continue;
    if (panel && s.panel && String(s.panel).trim() !== panel) continue;
    const person = {
      role_en: s.position_en || s.role_en || s.position || "",
      role_es: s.position_es || s.role_es || "",
      name: s.name || "",
      email: s.email || "",
      sort: num(s.position_sort, 999),
      vacant: /vacant|open/.test(status) || !s.name,
    };
    for (const slug of resolve(s.district)) (servantsBy[slug] ||= []).push(person);
  }
  for (const k of Object.keys(servantsBy)) {
    servantsBy[k].sort((a, b) => servantRank(a) - servantRank(b) || a.sort - b.sort);
  }

  // ---------------------------------------------------------------- central offices (optional file)
  const officesBy = {};
  for (const o of readCsv("central-offices.csv")) {
    const cell = o.districts || o.district || "";
    if (!cell) continue;
    const office = {
      ...Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_"))),
      name_en: o.name_en || o.name || "",
      name_es: o.name_es || "",
      url: o.website || o.url || "",
      phone: o.phone || "",
      sort: num(o.sort, 999),
    };
    for (const slug of resolve(cell)) (officesBy[slug] ||= []).push(office);
  }
  for (const k of Object.keys(officesBy)) officesBy[k].sort((a, b) => a.sort - b.sort);

  // ---------------------------------------------------------------- districts
  const all = districtRows.map((r) => {
    const cities = list(r.cities);
    const citiesEs = list(r.cities_es);
    const addressLine = [r.address, r.city ? `${r.city}, CA${r.zip ? " " + r.zip : ""}` : ""].filter(Boolean).join(", ");
    const fullAddress = [r.venue, addressLine].filter(Boolean).join(", ");
    const lat = num(r.lat, NaN);
    const lng = num(r.lng, NaN);
    return {
      slug: r.slug,
      number: r.number,
      number_es: String(r.number || "").replace(/\s*&\s*/g, " y "),
      nums: r.nums,
      sortNum: r.nums[0] || 999,
      status: (r.status || "active").toLowerCase(),
      merged_into: String(r.merged_into || "").trim().toLowerCase(),
      kind: (r.kind || "geographic").toLowerCase(),
      linguistic: (r.kind || "").toLowerCase() === "linguistic",
      language: r.language || "English",
      color: r.color || "",
      name_en: r.name_en,
      name_es: r.name_es,
      region_en: r.region_en,
      region_es: r.region_es,
      counties: list(r.counties),
      cities,
      cities_es: citiesEs.length === cities.length ? citiesEs : cities,
      subdistricts: list(r.subdistricts),
      subdistricts_es: list(r.subdistricts_es),
      covers: list(r.covers_districts).map((s) => s.toLowerCase()),
      neighbors: list(r.neighbors).map((s) => s.toLowerCase()),
      established: r.established,
      origin_en: r.origin_en,
      origin_es: r.origin_es,
      about_en: r.about_en,
      about_es: r.about_es,
      email: r.email,
      email_alt: r.email_alt,
      website: r.website,
      website_note_en: r.website_note_en,
      website_note_es: r.website_note_es,
      meetings_link: r.meetings_link,
      meetings_label_en: r.meetings_label_en,
      meetings_label_es: r.meetings_label_es,
      po_box: r.po_box,
      contribute_url: r.contribute_url,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      map_approx: yes(r.map_approx),
      calendar_uid: r.calendar_uid,
      interdistrict_table_en: r.interdistrict_table_en,
      interdistrict_table_es: r.interdistrict_table_es,
      notes: r.notes,
      meeting: {
        pattern_en: r.meeting_pattern_en,
        pattern_es: r.meeting_pattern_es,
        day: r.meeting_day,
        week: r.meeting_week,
        start: r.meeting_start,
        end: r.meeting_end,
        time_en: timeRange(r.meeting_start, r.meeting_end, "en"),
        time_es: timeRange(r.meeting_start, r.meeting_end, "es"),
        format: r.meeting_format,
        override: yes(r.meeting_override),
        venue: r.venue,
        room: r.room,
        address: r.address,
        city: r.city,
        zip: r.zip,
        addressLine,
        fullAddress,
        // directions only to a street address, never to a city centre
        mapsUrl: r.address ? mapsUrl(fullAddress) : "",
        zoomId: r.zoom_id,
        passcode: r.zoom_passcode,
        joinUrl: r.zoom_url,
        note_en: r.meeting_note_en,
        note_es: r.meeting_note_es,
        gsr_en: r.gsr_note_en,
        gsr_es: r.gsr_note_es,
        nextDates: nextDates(r),
      },
      servants: servantsBy[r.slug] || [],
      offices: officesBy[r.slug] || [],
    };
  });

  const byAll = Object.fromEntries(all.map((d) => [d.slug, d]));
  const active = all.filter((d) => d.status === "active").sort((a, b) => a.sortNum - b.sortNum);

  // Which Spanish-speaking districts serve the groups of each English-speaking district.
  for (const d of active) {
    d.spanish = active.filter((s) => s.linguistic && s.covers.includes(d.slug)).map((s) => s.slug);
    d.mergedHere = all.filter((x) => x.status !== "active" && x.merged_into === d.slug).map((x) => x.slug);
  }
  active.forEach((d, i) => {
    d.prev = i > 0 ? active[i - 1].slug : "";
    d.next = i < active.length - 1 ? active[i + 1].slug : "";
  });

  // "Which district am I in?" — every city, with the English and Spanish district that serves it.
  const cities = [];
  const groups = new Map();
  for (const d of active) {
    d.cities.forEach((c, i) => {
      const { base, qual } = splitCity(c);
      const qualEs = splitCity(d.cities_es[i] || c).qual;
      cities.push({ city: base, slug: d.slug, label: c });
      const key = fold(base);
      if (!groups.has(key)) groups.set(key, { c: base, k: key, d: [] });
      groups.get(key).d.push({ s: d.slug, q: qual, qes: qualEs });
    });
  }
  cities.sort((a, b) => a.city.localeCompare(b.city) || a.slug.localeCompare(b.slug));
  const cityIndex = [...groups.values()].sort((a, b) => a.c.localeCompare(b.c));
  for (const g of cityIndex) g.d.sort((a, b) => (byAll[a.s].linguistic - byAll[b.s].linguistic) || byAll[a.s].sortNum - byAll[b.s].sortNum);

  const geoJsonPoints = active
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => ({ lat: d.lat, lng: d.lng, label: d.name_en, url: `/districts/${d.slug}/`, color: d.color, num: d.number, slug: d.slug }));

  const counties = [...new Set(active.flatMap((d) => d.counties))].sort();

  const pages = [];
  for (const lang of LANGS) for (const item of active) pages.push({ lang, item });

  const redirects = [];
  for (const lang of LANGS)
    for (const item of all.filter((d) => d.status !== "active" && d.merged_into && byAll[d.merged_into]))
      redirects.push({ lang, item, to: byAll[item.merged_into] });

  // The Spanish-speaking districts' Inter-District Meeting (row with kind = interdistrict).
  const ir = rows.find((r) => r.kind === "interdistrict");
  const interdistrict = ir
    ? {
        name_en: ir.name_en,
        name_es: ir.name_es,
        region_en: ir.region_en,
        region_es: ir.region_es,
        about_en: ir.about_en,
        about_es: ir.about_es,
        email: ir.email,
        email_note_en: ir.website_note_en,
        email_note_es: ir.website_note_es,
        color: ir.color || "sun",
        districts: list(ir.covers_districts).map((s) => s.toLowerCase()).filter((s) => byAll[s]),
        pattern_en: ir.meeting_pattern_en,
        pattern_es: ir.meeting_pattern_es,
        time_en: timeRange(ir.meeting_start, ir.meeting_end, "en"),
        time_es: timeRange(ir.meeting_start, ir.meeting_end, "es"),
        note_en: ir.meeting_note_en,
        note_es: ir.meeting_note_es,
        extra_en: ir.gsr_note_en,
        extra_es: ir.gsr_note_es,
        tables: active
          .filter((d) => d.interdistrict_table_en || d.interdistrict_table_es)
          .map((d) => ({ slug: d.slug, en: d.interdistrict_table_en, es: d.interdistrict_table_es })),
      }
    : null;

  const english = active.filter((d) => !d.linguistic);
  const spanish = active.filter((d) => d.linguistic);

  return {
    list: active,
    all,
    bySlug: byAll,
    english,
    spanish,
    pages,
    redirects,
    cities,
    cityIndex,
    geoJsonPoints,
    counties,
    interdistrict,
    inactive: all.filter((d) => d.status !== "active"),
    stats: {
      active: active.length,
      english: english.length,
      spanish: spanish.length,
      counties: counties.length,
      cities: cityIndex.length,
    },
  };
}

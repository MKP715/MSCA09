// Filters used by the district pages (src/pages/districts.njk, district.njk).
// They join the districts data with the calendar and documents data, which are
// separate global data files, and cope with any of them being missing.
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { t, loc, lurl, code } from "../i18n.js";
import { formatDate, accentVars } from "../filters.js";

const INCLUDES = path.join(process.cwd(), "src", "_includes");
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "/districts/d05/" + "/repo/" → "/repo/districts/d05/" (for URLs that end up inside JavaScript). */
export function withBase(url, base = "/") {
  const u = String(url || "");
  if (!u.startsWith("/") || u.startsWith("//")) return u;
  return String(base || "/").replace(/\/+$/, "") + u;
}

/** The district's own business-meeting series exactly as the calendar has it, or null. */
function rawDistrictSeries(calendar, d) {
  if (!calendar || !d) return null;
  const series = calendar.series || [];
  if (d.calendar_uid) {
    const hit = series.find((s) => s && s.uid === d.calendar_uid);
    if (hit) return hit;
  }
  const own = (calendar.byDistrict && calendar.byDistrict[d.slug] && calendar.byDistrict[d.slug].series) || [];
  const candidates = own.filter((s) => s && s.recurring && (s.district === d.slug || !s.district));
  const typed = candidates.find((s) => /district/i.test(String(s.type || "")));
  return typed || candidates[0] || null;
}

// ---------------------------------------------------------------- calendar ↔ districts.csv
// The calendar is the source for the business meeting. data/districts.csv steps in where the
// calendar is known to be wrong or thin:
//   - meeting_override = yes  → the CSV format, place and times win (and the page says so);
//   - the calendar says "Virtual" with no place but the CSV has an in-person venue → the CSV
//     place and format are shown (a Virtual entry for a hybrid meeting is the usual mistake);
//   - the calendar has the street but no venue name or ZIP (or another ZIP) → filled from the CSV;
//   - the calendar has only a city → no "Directions" link (it would go to the city centre).
// Every difference is written to the build log once, so the calendar can be corrected.
const TZ = "America/Los_Angeles";
const warned = new Set();
const merged = new WeakMap();

function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[districts] ${msg}`);
}

const hhmm = (iso) => {
  const m = String(iso || "").match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
};
const pad = (s) => {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const fmtKey = (f) => {
  const s = String(f || "").toLowerCase();
  if (/hybrid|h[ií]brid/.test(s)) return "Hybrid";
  if (/virtual|online|zoom|en l[ií]nea/.test(s)) return "Virtual";
  if (/person|presencial/.test(s)) return "In person";
  return "";
};
/** "120 South Harvard St" and "120 S Harvard St, Suite 7" → "120 harvard" (house number + street name). */
function streetKey(s) {
  const words = String(s || "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const num = words.find((w) => /^\d+[a-z]?$/.test(w));
  if (!num) return "";
  const rest = words.slice(words.indexOf(num) + 1).filter((w) => !/^(n|s|e|w|north|south|east|west)$/.test(w));
  return rest.length ? `${num} ${rest[0]}` : "";
}
const mapsSearch = (q) => (q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "");

/** The same calendar dates with the CSV start and end time ("19:00", "20:30"). */
function retime(occ, start, end) {
  if (!occ || !occ.start) return occ;
  const day = DateTime.fromISO(occ.start, { zone: TZ });
  const at = (t) => {
    const [h, m] = t.split(":").map(Number);
    return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  };
  const s = start ? at(start) : DateTime.fromISO(occ.start, { zone: TZ });
  let e = end ? at(end) : DateTime.fromISO(occ.end || occ.start, { zone: TZ });
  if (e <= s) e = s.plus({ hours: 1 });
  return { ...occ, start: s.toISO({ suppressMilliseconds: true }), end: e.toISO({ suppressMilliseconds: true }) };
}

function mergeSeries(cal, d) {
  const m = (d && d.meeting) || {};
  const out = { ...cal, dxFixed: [] };
  const calFmt = fmtKey(cal.format);
  const csvFmt = fmtKey(m.format);
  const calStart = hhmm(cal.start);
  const calEnd = hhmm(cal.end);
  const csvStart = pad(m.start);
  const csvEnd = pad(m.end);
  const csvPlace = Boolean(m.venue || m.address);

  const diffs = [];
  if (csvFmt && calFmt && csvFmt !== calFmt) diffs.push("format");
  if (csvStart && calStart && csvStart !== calStart) diffs.push("start");
  if (csvEnd && calEnd && csvEnd !== calEnd) diffs.push("end");
  const calLine = `${cal.format || "?"} ${calStart}-${calEnd}`;
  const csvLine = `${m.format || "?"} ${csvStart}-${csvEnd}`;

  const virtualButVenue = calFmt === "Virtual" && !cal.location && csvPlace && (csvFmt === "Hybrid" || csvFmt === "In person");
  const useCsv = Boolean(m.override) || virtualButVenue;

  if (m.override && !diffs.length && cal.location && cal.location.name) {
    warnOnce(`${d.slug}: the Area calendar now agrees with data/districts.csv (${calLine}) — you can clear meeting_override for this district.`);
  } else if (diffs.length) {
    warnOnce(
      `${d.slug}: calendar ${calLine} vs data/districts.csv ${csvLine} (${diffs.join(", ")} differ) — ` +
        (m.override
          ? "the page shows the CSV (meeting_override = yes). Correct the Google Calendar entry."
          : useCsv
            ? "the calendar lists no place, so the page shows the CSV place and format. Correct the Google Calendar entry."
            : "the page shows the calendar. Correct whichever is wrong, or set meeting_override = yes in data/districts.csv.")
    );
  }

  // ---- format and times
  if (useCsv && csvFmt && csvFmt !== calFmt) {
    out.format = m.format;
    out.dxFixed.push("format");
  }
  if (m.override && (diffs.includes("start") || diffs.includes("end"))) {
    const start = csvStart || calStart;
    const end = csvEnd || calEnd;
    out.timeLabel_en = m.time_en || out.timeLabel_en;
    out.timeLabel_es = m.time_es || out.timeLabel_es;
    if (cal.rule_en) out.pattern_en = `${cal.rule_en} · ${out.timeLabel_en}`;
    if (cal.rule_es) out.pattern_es = `${cal.rule_es} · ${out.timeLabel_es}`;
    const re = (o) => {
      const x = retime(o, start, end);
      return x === o ? o : { ...x, timeLabel_en: out.timeLabel_en, timeLabel_es: out.timeLabel_es, format: out.format };
    };
    const first = retime({ start: cal.start, end: cal.end }, start, end);
    out.start = first.start;
    out.end = first.end;
    out.durationMin = Math.round((Date.parse(first.end) - Date.parse(first.start)) / 60000);
    out.upcomingDates = (cal.upcomingDates || []).map(re);
    out.next = cal.next ? re(cal.next) : cal.next;
    out.dxFixed.push("time");
  }

  // ---- place
  const loc = cal.location;
  if (useCsv && csvPlace && (!loc || m.override)) {
    const addr = [m.room, m.addressLine].filter(Boolean).join(", ");
    out.location = {
      raw: m.fullAddress,
      name: m.venue || null,
      address: addr || m.city || "",
      mapsUrl: m.address ? m.mapsUrl : "",
      city: m.city || "",
      street: m.address || null,
      zip: m.zip || null,
      tba: false,
      fromCsv: true,
    };
    out.dxFixed.push("place");
  } else if (loc && !loc.tba) {
    const next = { ...loc };
    const sameStreet = loc.street && m.address && streetKey(loc.street) && streetKey(loc.street) === streetKey(m.address);
    if (sameStreet) {
      if (!loc.name && m.venue) {
        next.name = m.venue;
        warnOnce(`${d.slug}: the calendar Location has no venue name; "${m.venue}" from data/districts.csv is shown.`);
      }
      // the ZIP follows the state ("…, CA 92705"); a five-digit house number is not a ZIP
      const z = String(next.address || "").match(/\b(?:CA|California)\.?\s+(\d{5})(?:-\d{4})?\b/i);
      if (m.zip && (!z || z[1] !== m.zip)) {
        if (z) {
          next.address = next.address.replace(z[0], z[0].replace(/\d{5}(?:-\d{4})?/, m.zip));
          warnOnce(`${d.slug}: calendar ZIP ${z[1]} vs data/districts.csv ${m.zip} for ${loc.street} — the CSV ZIP is shown.`);
        } else {
          next.address = /,\s*CA\s*$/i.test(next.address) ? `${next.address} ${m.zip}` : `${next.address}, ${m.zip}`;
          warnOnce(`${d.slug}: the calendar Location has no ZIP; ${m.zip} from data/districts.csv is shown.`);
        }
        next.zip = m.zip;
      }
      if (next.name !== loc.name || next.address !== loc.address) {
        next.mapsUrl = mapsSearch([next.name, next.address].filter(Boolean).join(", "));
        out.dxFixed.push("address");
      }
    }
    if (!loc.street) next.mapsUrl = ""; // only a city: no directions to the city centre
    out.location = next;
  }
  if (useCsv && !out.online && (m.zoomId || m.joinUrl)) {
    out.online = { zoomId: m.zoomId || "", passcode: m.passcode || "", joinUrl: m.joinUrl || "" };
  }
  out.dxOverride = useCsv && out.dxFixed.some((k) => k === "format" || k === "time" || k === "place");
  return out;
}

/** The district's business-meeting series: the calendar's, corrected from data/districts.csv (see above). */
export function districtSeries(calendar, d) {
  const cal = rawDistrictSeries(calendar, d);
  if (!cal) return null;
  let byCal = merged.get(calendar);
  if (!byCal) merged.set(calendar, (byCal = new Map()));
  if (!byCal.has(d.slug)) byCal.set(d.slug, mergeSeries(cal, d));
  return byCal.get(d.slug);
}

/** Upcoming occurrences this district hosts or co-hosts, without its own business meetings. */
export function districtEvents(calendar, d, series) {
  if (!calendar || !d) return [];
  const up = (calendar.byDistrict && calendar.byDistrict[d.slug] && calendar.byDistrict[d.slug].upcoming) || [];
  const skip = series && series.uid;
  return up.filter((o) => o && o.uid !== skip && !(o.recurring && o.district === d.slug && /district/i.test(String(o.type || ""))));
}

/** Up to `max` events this district hosted in the last year, newest first (one per series). */
export function districtRecent(calendar, d, series, max = 3) {
  if (!calendar || !d) return [];
  const now = Date.now();
  const from = now - 365 * 864e5;
  const skip = series && series.uid;
  const seen = new Set();
  const out = [];
  const all = calendar.occurrences || [];
  for (let i = all.length - 1; i >= 0 && out.length < max; i--) {
    const o = all[i];
    if (!o || o.status === "cancelled" || o.uid === skip) continue;
    const end = Date.parse(o.end || o.start);
    const start = Date.parse(o.start);
    if (!(end < now) || start < from) continue;
    const hosts = [o.district, ...(o.districts || []), ...(o.hosts || [])];
    if (!hosts.includes(d.slug)) continue;
    if (o.recurring && /district/i.test(String(o.type || ""))) continue; // business meetings
    if (seen.has(o.uid)) continue;
    seen.add(o.uid);
    out.push(o);
  }
  return out;
}

/** { pattern, time } of the business meeting, so the time range can be kept on one line. */
export function meetingParts(d, lang, series) {
  const L = code(lang);
  if (series && series.recurring) {
    const rule = L === "es" ? series.rule_es || series.rule_en : series.rule_en;
    const time = L === "es" ? series.timeLabel_es || series.timeLabel_en : series.timeLabel_en;
    if (rule) return { pattern: rule, time: time || "" };
  }
  if (!d || !d.meeting) return { pattern: "", time: "" };
  return { pattern: loc(d.meeting, "pattern", L), time: (L === "es" ? d.meeting.time_es : d.meeting.time_en) || "" };
}

/** Next meeting dates: from the calendar series, else computed from the CSV pattern. [{start,end}] */
export function nextMeetings(series, d) {
  const fromCal = (series && (series.upcomingDates || (series.next ? [series.next] : []))) || [];
  if (fromCal.length) return fromCal.map((o) => ({ start: o.start, end: o.end || o.start, cancelled: false }));
  return ((d && d.meeting && d.meeting.nextDates) || []).map((o) => ({ start: o.start, end: o.end }));
}

/** The next business meetings of all districts, soonest first: [{ d, start, end }]. */
export function upcomingDistrictMeetings(list, calendar, perDistrict = 3) {
  const out = [];
  for (const d of list || []) {
    const dates = nextMeetings(districtSeries(calendar, d), d).slice(0, perDistrict);
    for (const x of dates) if (x && x.start) out.push({ d, start: x.start, end: x.end || x.start });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 18);
}

/** The CSV meeting note, unless the calendar series already says the same thing. */
export function extraNote(d, series, lang) {
  const note = d && d.meeting ? loc(d.meeting, "note", lang) : "";
  if (!note) return "";
  return repeatsShownNote(note, series, d, lang) ? "" : note;
}

/** The CSV's GSR note (d.meeting.gsr_en / gsr_es), unless the meeting panel above already shows it. */
export function gsrNote(d, series, lang) {
  const note = d && d.meeting ? loc(d.meeting, "gsr", lang) : "";
  if (!note) return "";
  return repeatsShownNote(note, series, d, lang) ? "" : note;
}

/**
 * Spanish pages: meetingInfo's noteOverride. When the calendar has English Note lines but no Spanish
 * ones (no "Nota:" line and no calendar.note_es.<slug> row), the district's own Spanish notes from
 * data/districts.csv (meeting_note_es, gsr_note_es) are shown instead of the English marked "(en inglés)".
 */
export function noteOverride(d, series, lang) {
  if (code(lang) !== "es" || !series || !d || !d.meeting) return [];
  const en = series.notes_en || series.notes || [];
  if (!en.length || (series.notes_es || []).length) return [];
  return [d.meeting.note_es, d.meeting.gsr_es].map((x) => String(x || "").trim()).filter(Boolean);
}

/** The Note lines meetingInfo shows for this series on this page (same rule as the calNotes filter). */
function shownNotes(series, d, lang) {
  if (!series) return [];
  const en = series.notes_en || series.notes || [];
  if (code(lang) !== "es") return en;
  if ((series.notes_es || []).length) return series.notes_es;
  const ov = noteOverride(d, series, lang);
  return ov.length ? ov : en;
}

// Two notes say the same thing when most words of the shorter one are in the longer one
// ("No meeting in June: the district is at …" vs "No meeting in June: the district takes part in …").
const noteWords = (s) =>
  new Set(
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
  );
function sameNote(a, b) {
  const A = noteWords(a);
  const B = noteWords(b);
  if (!A.size || !B.size) return false;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  return hit / small.size >= 0.7;
}
function repeatsShownNote(note, series, d, lang) {
  return shownNotes(series, d, lang).some((n) => sameNote(note, n));
}

/** Upcoming Inter-District / Intradistrict meetings of the Spanish-speaking districts. */
export function interdistrictEvents(calendar) {
  const up = (calendar && calendar.upcoming) || [];
  return up.filter((o) => /inter-?distri|intra-?distri/i.test(`${o.title || ""} ${o.title_es || ""}`));
}

/** "2nd Monday of the month · 7:00–8:30 PM" — from the calendar series when there is one. */
export function meetingLine(d, lang, series) {
  const L = code(lang);
  if (series) {
    const p = L === "es" ? series.pattern_es || series.pattern_en : series.pattern_en;
    if (p) return p;
  }
  if (!d || !d.meeting) return "";
  const pattern = loc(d.meeting, "pattern", L);
  const time = L === "es" ? d.meeting.time_es : d.meeting.time_en;
  return [pattern, time].filter(Boolean).join(" · ");
}

/** Map pins (with a small popup) for the Leaflet map. */
export function districtPoints(list, lang, base, calendar) {
  const L = code(lang);
  return (list || [])
    .filter((d) => d && d.lat != null && d.lng != null)
    .map((d) => {
      const url = withBase(lurl(`/districts/${d.slug}/`, L), base);
      const name = loc(d, "name", L);
      const series = districtSeries(calendar, d);
      const line = meetingLine(d, L, series);
      const kind = t(d.linguistic ? "districts.kind.spanish" : "districts.kind.english", L);
      const where = series ? series.location : null;
      const place = (where ? [where.name, where.city] : [d.meeting.venue, d.meeting.city]).filter(Boolean).join(", ");
      const html =
        `<div style="min-width:12rem">` +
        `<p style="margin:0;font:600 11px/1.2 var(--font-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--color-${esc(d.color)}-700)">${esc(kind)}</p>` +
        `<p style="margin:.15rem 0 .35rem;font:800 17px/1.15 var(--font-display);color:var(--color-ink-950)">${esc(name)}</p>` +
        (line ? `<p style="margin:0;font-size:13px;color:var(--color-ink-600)">${esc(line)}</p>` : "") +
        (place ? `<p style="margin:.15rem 0 0;font-size:12px;color:var(--color-ink-500)">${esc(place)}</p>` : "") +
        `<a href="${esc(url)}" style="display:inline-block;margin-top:.5rem;font-weight:700;color:var(--color-${esc(d.color)}-700)">${esc(t("districts.card.open", L))} →</a>` +
        `</div>`;
      return { lat: d.lat, lng: d.lng, label: name, url, color: d.color, num: L === "es" ? d.number_es || d.number : d.number, html };
    });
}

/** Everything the "Which district am I in?" search needs, in the page's language. */
export function finderData(D, lang, base, calendar) {
  const L = code(lang);
  const districts = {};
  for (const d of (D && D.list) || []) {
    districts[d.slug] = {
      n: L === "es" ? d.number_es || d.number : d.number,
      nums: d.nums,
      name: loc(d, "name", L),
      kind: d.linguistic ? "es" : "en",
      kindLabel: t(d.linguistic ? "districts.finder.serves_es" : "districts.finder.serves_en", L),
      url: withBase(lurl(`/districts/${d.slug}/`, L), base),
      line: meetingLine(d, L, districtSeries(calendar, d)),
      style: accentVars(d.color),
    };
  }
  return { cities: (D && D.cityIndex) || [], districts };
}

/** [{ kind, counties }] per card, so the filter can count matches. */
export function cardMeta(list) {
  return (list || []).map((d) => ({ kind: d.kind, counties: d.counties }));
}

/** Documents grouped by year, newest first: [{ year, items }]. */
export function docsByYear(docs) {
  const map = new Map();
  for (const doc of docs || []) {
    if (!doc) continue;
    const y = String(doc.year || (doc.date ? String(doc.date).slice(0, 4) : "") || "—");
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(doc);
  }
  for (const items of map.values()) items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const undated = (y) => !/\d/.test(y);
  return [...map]
    .sort((a, b) => undated(a[0]) - undated(b[0]) || String(b[0]).localeCompare(String(a[0]), undefined, { numeric: true }))
    .map(([year, items]) => ({ year, items }));
}

/** Trusted servants with the DCMC first. Accepts rows from servants.byDistrict or districts.js. */
export function servantOrder(list) {
  const rank = (s) => {
    const r = `${s.role_en || s.position_en || s.position || ""}`;
    if (/^(dcmc|d\.c\.m\.c|cmcd)/i.test(r)) return 0;
    // the Alternate DCMC only: "Alternate DCM Sub-District C" is a sub-district alternate and sorts with the DCMs
    if (/alt(ernate)?\.?\s*(dcmc|cmcd)\b|\b(dcmc|cmcd)\b.*\b(alt(ernate)?|suplente)\b/i.test(r)) return 1;
    if (/^(alt(ernate)?\.?\s*)?(dcms?|mcds?)\b/i.test(r)) return 2;
    if (/secretar/i.test(r)) return 3;
    if (/treasurer|tesorer/i.test(r)) return 4;
    if (/registrar|registrador/i.test(r)) return 5;
    return 6;
  };
  return [...(list || [])].filter(Boolean).sort((a, b) => rank(a) - rank(b));
}

/** Does a template exist under src/_includes? (lets pages use another agent's macros only once they exist) */
export function templateExists(rel) {
  try {
    return fs.existsSync(path.join(INCLUDES, String(rel)));
  } catch {
    return false;
  }
}

export default function (eleventyConfig) {
  eleventyConfig.addFilter("dxBase", withBase);
  eleventyConfig.addFilter("dxSeries", districtSeries);
  eleventyConfig.addFilter("dxEvents", districtEvents);
  eleventyConfig.addFilter("dxRecent", districtRecent);
  eleventyConfig.addFilter("dxMeetingParts", meetingParts);
  // a new build (or a --serve rebuild) logs calendar/CSV differences again
  eleventyConfig.on("eleventy.before", () => warned.clear());
  eleventyConfig.addFilter("dxNextMeetings", nextMeetings);
  eleventyConfig.addFilter("dxInterEvents", interdistrictEvents);
  eleventyConfig.addFilter("dxUpcoming", upcomingDistrictMeetings);
  eleventyConfig.addFilter("dxExtraNote", extraNote);
  eleventyConfig.addFilter("dxGsrNote", gsrNote);
  eleventyConfig.addFilter("dxNoteOverride", noteOverride);
  eleventyConfig.addFilter("dxPoints", districtPoints);
  eleventyConfig.addFilter("dxMeetingLine", meetingLine);
  eleventyConfig.addFilter("dxFinderData", finderData);
  eleventyConfig.addFilter("dxCardMeta", cardMeta);
  eleventyConfig.addFilter("dxDocsByYear", docsByYear);
  eleventyConfig.addFilter("dxServantOrder", servantOrder);
  eleventyConfig.addFilter("dxTemplateExists", templateExists);
  // Servants whose position matches a pattern, e.g. servants.current | roleMatch("inter-?distri")
  eleventyConfig.addFilter("dxRoleMatch", (list, pattern) => {
    const re = new RegExp(pattern, "i");
    return (list || []).filter((s) => s && re.test(`${s.position_en || ""} ${s.role_en || ""} ${s.position || ""}`));
  });
  // "1 & 3" → "1 y 3" on Spanish pages.
  eleventyConfig.addFilter("dxNum", (d, lang) => (d ? (code(lang) === "es" ? d.number_es || d.number : d.number) : ""));
  // Short date label for a meeting date in the page's language ("Tue, Oct 6").
  eleventyConfig.addFilter("dxMeetDate", (iso, lang) => formatDate(iso, "date", lang));
  // Lookup helper: list of slugs → district objects.
  eleventyConfig.addFilter("dxFor", (slugs, bySlug) => (slugs || []).map((s) => bySlug && bySlug[s]).filter(Boolean));
}

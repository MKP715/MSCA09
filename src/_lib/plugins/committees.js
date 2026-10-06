// Filters used by the committee pages, the Panel directory and the contact page
// (src/pages/committees.njk, committee.njk, panel.njk, contact.njk).
// They join committees data with the calendar and the document library, which are
// separate global data files owned by other parts of the site, and cope with any of
// them being missing or half-built.
import fs from "node:fs";
import path from "node:path";
import { code, loc } from "../i18n.js";
import { formatDate } from "../filters.js";

const INCLUDES = path.join(process.cwd(), "src", "_includes");

const driveIdOf = (u) => {
  const s = String(u || "");
  const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || s.match(/^([A-Za-z0-9_-]{25,})$/);
  return m ? m[1] : "";
};
const fold = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const words = (s) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !["pdf", "the", "and", "msca", "msca09", "area", "for", "del", "las", "los", "english", "spanish", "final"].includes(w));

/** Does a template exist in src/_includes? (lets pages use other parts' macros only once they exist) */
export function cmExists(rel) {
  try {
    return fs.existsSync(path.join(INCLUDES, rel));
  } catch {
    return false;
  }
}

/** The calendar entry for a committee: { own, series, upcoming, events, past } — always arrays. */
export function cmCal(calendar, slug) {
  const x = (calendar && calendar.byCommittee && calendar.byCommittee[slug]) || {};
  return {
    own: (x.own || []).filter(Boolean),
    series: (x.series || []).filter(Boolean),
    upcoming: (x.upcoming || []).filter(Boolean),
    events: (x.events || []).filter(Boolean),
    past: (x.past || []).filter(Boolean),
  };
}

/** Active recurring meetings that belong to the committee (its own meetings first). */
export function cmMeetings(calendar, slug) {
  const x = cmCal(calendar, slug);
  const pool = x.own.length ? x.own : x.series;
  const seen = new Set();
  return pool.filter((s) => s && s.recurring && !s.ended && !seen.has(s.uid) && seen.add(s.uid));
}

/** Upcoming one-off events of the committee (workshops, open houses …), without its regular meetings. */
export function cmEvents(calendar, slug) {
  const x = cmCal(calendar, slug);
  const ups = x.upcoming.filter((o) => o && !o.recurring && o.status !== "cancelled");
  return ups;
}

/** Next date to show in the aside: next own meeting, else (break-out committees) the next Area meeting. */
export function cmNext(calendar, c) {
  const meetings = cmMeetings(calendar, c && c.slug);
  const nexts = meetings.map((s) => s.next).filter(Boolean).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (nexts.length) return { occ: nexts[0], kind: "own" };
  const ev = cmEvents(calendar, c && c.slug)[0];
  if (c && c.meets_at_area_meeting && calendar && calendar.nextAreaMeeting) return { occ: calendar.nextAreaMeeting, kind: "area" };
  if (ev) return { occ: ev, kind: "event" };
  return null;
}

/**
 * Join a committee's own resource rows with the document library.
 * Returns { guidelines, older, pending, extraGuidelines, reports }:
 *  - guidelines/older: the curated rows from committee-resources.csv
 *  - pending: rows whose file is not yet public — hidden once the library has a document with a matching title
 *  - extraGuidelines: guideline documents in the library that are not already listed
 *  - reports: the library's other documents for the committee, newest first
 */
export function cmLibrary(c, documents) {
  const docs = ((documents && documents.byCommittee && c && documents.byCommittee[c.slug]) || []).filter((d) => d && d.url);
  const ownIds = new Set((c.guidelines || []).concat(c.links || [], c.reports || []).map((r) => driveIdOf(r.url)).filter(Boolean));
  const isGuide = (d) => /guideline|bylaw/i.test(`${d.category || ""} ${d.kind || ""}`) || /guidelines?\b|gu[ií]as\b/i.test(`${d.title || ""}`);
  const notMine = docs.filter((d) => !ownIds.has(driveIdOf(d.url) || d.drive_id));
  const extraGuidelines = notMine.filter(isGuide);
  const reports = notMine
    .filter((d) => !isGuide(d))
    .sort((a, b) => String(b.date || b.year || "").localeCompare(String(a.date || a.year || "")));
  const docWords = docs.map((d) => new Set(words(`${d.title} ${d.title_es || ""} ${(d.drive_path || "").split("/").pop()}`)));
  const pending = (c.pending || []).filter((p) => {
    const file = (p.notes.match(/\(([^)]+\.(pdf|docx?|jpe?g|png))/i) || [])[1] || "";
    const want = words(file || p.title_en).filter((w) => !/^\d+$/.test(w)).slice(0, 6);
    if (!want.length) return true;
    return !docWords.some((set) => want.filter((w) => set.has(w)).length >= Math.max(2, Math.ceil(want.length * 0.75)));
  });
  const isGuidePending = (p) => /guideline|gu[ií]as?\b/i.test(`${p.title_en} ${p.title_es}`);
  return {
    pendingGuidelines: pending.filter(isGuidePending),
    pendingReports: pending.filter((p) => !isGuidePending(p) && p.status === "report"),
    pendingLinks: pending.filter((p) => !isGuidePending(p) && p.status !== "report"),
    guidelines: (c.guidelines || []).filter((g) => g.status !== "superseded"),
    older: (c.guidelines || []).filter((g) => g.status === "superseded"),
    pending,
    extraGuidelines,
    reports,
    reportCount: reports.length,
  };
}

/**
 * Text the in-page search looks through (both languages, so either works): names, the people the card
 * shows (servants and Area liaisons / organizers), e-mail addresses and, with the calendar, the places
 * and cities where the committee meets.
 */
export function cmSearch(c, calendar) {
  if (!c) return "";
  const person = (s) => `${s.name || ""} ${s.position_en || ""} ${s.position_es || ""}`;
  const people = (c.servants || []).concat(c.liaisons || []).map(person).join(" ");
  const places = (c.slug ? cmMeetings(calendar, c.slug) : [])
    .map((s) => (s.location ? `${s.location.name || ""} ${s.location.city || ""}` : ""))
    .join(" ");
  return fold(
    [c.name_en, c.name_es, c.short_en, c.short_es, (c.slug || "").replace(/-/g, " "), c.summary_en, c.summary_es, people, c.email, c.email_es, c.meets_en, c.meets_es, places].join(" ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Servant search text. */
export function cmPersonSearch(s, extra = "") {
  if (!s) return "";
  return fold([s.name, s.position_en, s.position_es, s.body_en, s.body_es, s.email, s.email_alt, s.district, s.committee, extra].join(" "))
    .replace(/\s+/g, " ")
    .trim();
}

/** "English" / "Spanish" / "" → short tag for filters. */
export function cmLangKey(v) {
  const g = String(v || "").toLowerCase();
  if (/span|esp/.test(g)) return "es";
  if (/eng|ingl/.test(g)) return "en";
  return "";
}

/** Group an array of resources by kind, keeping a fixed order. */
export function cmByKind(list, order) {
  const out = [];
  for (const k of order || []) {
    const items = (list || []).filter((r) => r.kind === k);
    if (items.length) out.push({ kind: k, items });
  }
  return out;
}

/** The URL for a person row's committee or district page. */
export function cmBodyUrl(s, bySlug) {
  if (!s) return "";
  if (s.district) return `/districts/${s.district}/`;
  if (s.committee && bySlug && bySlug[s.committee] && bySlug[s.committee].category !== "officer") return `/committees/${s.committee}/`;
  if (s.level === "area") return `/about/panel/#${s.committee || "officers"}`;
  return "";
}

/** Prefer the language-specific link of an aa.org resource. */
export function cmAaLink(r, lang) {
  if (!r) return "";
  return code(lang) === "es" ? r.url_es || r.url : r.url || r.url_es;
}

/** Is an ISO/YYYY-MM-DD date still in the future (or today)? */
export function cmLive(end) {
  if (!end) return true;
  return new Date().toISOString().slice(0, 10) <= String(end).slice(0, 10);
}

/** mailto: with a subject line. */
export function cmMailto(email, subject) {
  if (!email) return "";
  return `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

/** "2024-09-08" → "September 8, 2024" / "8 de septiembre de 2024"; "2015-01" → "January 2015"; "2000" stays. */
export function cmApproved(v, lang) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s, "full", lang);
  if (/^\d{4}-\d{2}$/.test(s)) return formatDate(`${s}-01`, "month", lang);
  return s;
}

export default function (eleventyConfig) {
  eleventyConfig.addFilter("cmApproved", cmApproved);
  eleventyConfig.addFilter("cmExists", cmExists);
  eleventyConfig.addFilter("cmCal", cmCal);
  eleventyConfig.addFilter("cmMeetings", cmMeetings);
  eleventyConfig.addFilter("cmEvents", cmEvents);
  eleventyConfig.addFilter("cmNext", cmNext);
  eleventyConfig.addFilter("cmLibrary", cmLibrary);
  eleventyConfig.addFilter("cmSearch", cmSearch);
  eleventyConfig.addFilter("cmPersonSearch", cmPersonSearch);
  eleventyConfig.addFilter("cmLangKey", cmLangKey);
  eleventyConfig.addFilter("cmByKind", cmByKind);
  eleventyConfig.addFilter("cmBodyUrl", cmBodyUrl);
  eleventyConfig.addFilter("cmAaLink", cmAaLink);
  eleventyConfig.addFilter("cmLive", cmLive);
  eleventyConfig.addFilter("cmMailto", cmMailto);
  eleventyConfig.addFilter("cmLoc", (obj, field, lang) => loc(obj, field, lang));
  eleventyConfig.addFilter("cmDriveId", driveIdOf);
  // committees that have someone (or an open seat, or an Area liaison) to show
  eleventyConfig.addFilter("cmWithPeople", (items) =>
    (items || []).filter((c) => c && ((c.servants || []).length || (c.category === "coordinate" && (c.liaisons || []).length)))
  );
  // district bodies → [{ key: "en", items }, { key: "es", items }] (English-speaking first)
  eleventyConfig.addFilter("cmDistrictGroups", (bodies) => {
    const es = (b) => /span/i.test((b.items[0] || {}).language || "");
    const out = [
      { key: "en", items: (bodies || []).filter((b) => !es(b)) },
      { key: "es", items: (bodies || []).filter(es) },
    ];
    return out.filter((g) => g.items.length);
  });
}

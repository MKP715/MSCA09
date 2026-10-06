// The Area calendar, as every page sees it ({{ calendar.… }}).
//
// Source: data/calendar.ics — the copy of the Area's Google Calendar that the build
// downloads every few hours (scripts/fetch-calendar.mjs). Edit meetings and events in
// Google Calendar, never here.
//
// Tables that steer it (all optional except event-types.csv):
//   data/event-types.csv   one row per calendar Type (label, colour, icon, meeting/event)
//   data/districts.csv     slug + number  → which district an entry belongs to
//   data/committees.csv    slug + calendar_match (";"-separated e-mails / title words,
//                          optionally "type:History" or "topic:Literature")
//
// Shape (BUILD-SPEC §9.1): generated, windowStart, windowEnd, types, typeMap, series, bySlug,
// occurrences, upcoming, upcomingMeetings, upcomingEvents, areaMeetings, nextAreaMeeting,
// byDistrict, byCommittee, pages, stats — plus a few extras documented inline.
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { readCsv, yes, num, DATA_DIR } from "../_lib/csv.js";
import { t, LANGS, dictionary } from "../_lib/i18n.js";
import {
  parseCalendar, expandOccurrences, AREA_TZ, ICS_URL, EMBED_URL, EMBED_URL_ES, SUBSCRIBE_URL, WEBCAL_URL,
  DEFAULT_TOPICS, DEFAULT_DISTRICTS, DEFAULT_COMMITTEES, committeeRulesFromCell, districtSlug, slugify,
  ruleLabel, timeRangeLabel, dateLabel, clockLabel, aboutHtml, tidyLinkLabel, driveImageUrl, driveThumbUrl, driveViewUrl,
  TYPO_FIXES,
} from "../_lib/calendar.js";

// Only the default export: Eleventy would otherwise publish the module's named exports as the data.
const ONE_OFF_NOINDEX_DAYS = 730; // one-time events that ended more than two years ago stay off search engines

const WINDOW_BEFORE_DAYS = 400;
const WINDOW_AFTER_DAYS = 550;
const AREA_MEETING_TYPES = ["Area", "Area Committee", "Assembly", "Foro", "Servathon", "Conference"];
const NEXT_AREA_TYPES = ["Area", "Area Committee", "Assembly", "Foro", "Servathon"];
const DEDUPE_AREA_BY = ["Area Committee", "Assembly", "Foro"];

const FALLBACK_COMMITTEE_NAMES = {
  delegate: ["Delegate", "Delegado(a)"], "alternate-delegate": ["Alternate Delegate", "Delegado(a) Alterno(a)"],
  chair: ["Area Chair", "Coordinador(a) del Área"], secretary: ["Secretary", "Secretario(a)"],
  "treasurer-ap": ["Treasurer – Accounts Payable", "Tesorero(a) – Cuentas por Pagar"],
  "treasurer-ar": ["Treasurer – Accounts Receivable", "Tesorero(a) – Cuentas por Cobrar"], registrar: ["Registrar", "Registrador(a)"],
  accessibilities: ["Accessibilities", "Accesibilidades"], archives: ["Archives", "Archivos Históricos"],
  communications: ["Communications", "Comunicaciones"], "convention-liaison": ["Convention Liaison", "Enlace de Convenciones"],
  cec: ["Cooperation with the Elder Community", "Cooperación con la Comunidad de la Tercera Edad"],
  cpc: ["Cooperation with the Professional Community", "Cooperación con la Comunidad Profesional"],
  corrections: ["Corrections", "Instituciones Correccionales"], "dcm-school": ["DCM School", "Escuela de MCD"], finance: ["Finance", "Finanzas"],
  "grapevine-la-vina": ["Grapevine / La Viña", "Grapevine / La Viña"], "gsr-school": ["GSR School", "Escuela de RSG"],
  "guidelines-policies": ["Guidelines & Policies", "Guías y Políticas"], literature: ["Literature", "Literatura"],
  "public-information": ["Public Information", "Información Pública"], registration: ["Registration", "Registro"],
  "remote-communities": ["Remote Communities", "Comunidades Remotas"], technology: ["Technology", "Tecnología"],
  treatment: ["Treatment Facilities", "Centros de Tratamiento"], ypaa: ["Young People in A.A.", "Jóvenes en A.A."],
  "hospitals-institutions": ["Hospitals & Institutions (H&I)", "Hospitales e Instituciones (H&I)"],
  intergroups: ["Intergroups & Central Offices", "Intergrupos y Oficinas Centrales"],
  "hispanic-womens": ["Hispanic Women's Committee", "Comité de Mujeres Hispanas"],
  "inter-district-hispanic": ["Inter-District Hispanic Chair", "Coordinador(a) Interdistrital Hispano(a)"],
};

/* ------------------------------------------------------------------ tables from data/ */

function loadTypes() {
  const rows = readCsv("event-types.csv");
  const types = rows
    .filter((r) => r.key)
    .map((r) => ({
      key: r.key,
      slug: slugify(r.key),
      label_en: r.label_en || r.key,
      label_es: r.label_es || r.label_en || r.key,
      group: r.group || "events",
      group_en: r.group_en || r.group || "",
      group_es: r.group_es || r.group_en || r.group || "",
      color: r.color || "slate",
      icon: r.icon || "calendar",
      is_meeting: yes(r.is_meeting),
      is_event: yes(r.is_event),
      sort: num(r.sort, 999),
      description_en: r.description_en || "",
      description_es: r.description_es || r.description_en || "",
      // "Bilingual" for Area business: used when an entry has no Language: line or says English
      default_language: normLanguage(r.default_language),
    }));
  if (!types.some((x) => x.key === "Other"))
    types.push({ key: "Other", slug: "other", label_en: "Other", label_es: "Otro", group: "events", group_en: "Events", group_es: "Eventos", color: "slate", icon: "calendar", is_meeting: true, is_event: true, sort: 999, description_en: "", description_es: "", default_language: "" });
  types.sort((a, b) => a.sort - b.sort);
  return types;
}
function normLanguage(v) {
  const n = String(v || "").trim().toLowerCase();
  if (/^(bilingual|biling[uü]e)$/.test(n)) return "Bilingual";
  if (/^(spanish|espa[nñ]ol)$/.test(n)) return "Spanish";
  if (/^(english|ingl[eé]s)$/.test(n)) return "English";
  return "";
}
const withDefaultLanguage = (typ, language) => (typ && typ.default_language && (!language || language === "English") ? typ.default_language : language || "");

/** data/flyer-holds.csv: Drive ids of flyers / PDFs that print personal contact details. */
function loadHolds() {
  const ids = new Set();
  for (const r of readCsv("flyer-holds.csv")) {
    const id = String(r.drive_id || "").trim();
    const m = /(?:\/d\/|id=|^)([A-Za-z0-9_-]{20,})/.exec(id);
    if (m) ids.add(m[1]);
    else if (id) console.warn(`[calendar] data/flyer-holds.csv row ${r._row}: "${id}" is not a Google Drive id`);
  }
  return ids;
}

function loadDistricts() {
  const rows = readCsv("districts.csv");
  const out = new Map(); // slug -> { slug, nums, label_en, label_es, active }
  for (const r of rows) {
    const numsRaw = r.nums || r.number || r.district || r.slug || "";
    const nums = [...String(numsRaw).matchAll(/\d+/g)].map((m) => +m[0]).filter((n) => n > 0 && n < 100);
    if (!nums.length) continue;
    const slug = r.slug || districtSlug(nums);
    const inactive = /inactive|merged|retired|closed/i.test(r.status || "");
    out.set(slug, {
      slug, nums, active: !inactive,
      number: r.number || nums.join(" & "),
      name_en: r.name_en || "", name_es: r.name_es || "",
    });
  }
  if (!out.size)
    for (const [slug, nums] of Object.entries(DEFAULT_DISTRICTS)) out.set(slug, { slug, nums, active: true, number: nums.join(" & "), name_en: "", name_es: "" });
  // the parser maps district numbers -> slug; active districts win over merged/inactive ones
  const parserMap = {};
  const ordered = [...out.values()].sort((a, b) => Number(a.active) - Number(b.active));
  const numToSlug = new Map();
  for (const d of ordered) for (const n of d.nums) numToSlug.set(n, d.slug);
  for (const [n, slug] of numToSlug) (parserMap[slug] ||= []).push(n);
  return { list: [...out.values()], parserMap };
}

function loadCommittees() {
  const rows = readCsv("committees.csv").filter((r) => r.slug);
  const hasMatch = rows.some((r) => "calendar_match" in r);
  if (rows.length && hasMatch) {
    const rules = {};
    const names = {};
    for (const r of rows) {
      // only calendar_match counts: the `email` column is a contact address and may be shared (e.g. the Alternate Delegate)
      rules[r.slug] = committeeRulesFromCell(r.calendar_match);
      names[r.slug] = { en: r.name_en || r.name || r.slug, es: r.name_es || r.name_en || r.name || r.slug };
    }
    return { rules, names, source: "data/committees.csv" };
  }
  const names = Object.fromEntries(Object.keys(DEFAULT_COMMITTEES).map((s) => [s, { en: (FALLBACK_COMMITTEE_NAMES[s] || [s])[0], es: (FALLBACK_COMMITTEE_NAMES[s] || [s, s])[1] }]));
  for (const r of rows) names[r.slug] = { en: r.name_en || names[r.slug]?.en || r.slug, es: r.name_es || names[r.slug]?.es || r.slug };
  return { rules: DEFAULT_COMMITTEES, names, source: "built-in rules" };
}

/* ------------------------------------------------------------------ helpers */

const la = (iso) => DateTime.fromISO(iso, { setZone: true }).setZone(AREA_TZ);
const isoLA = (dt) => dt.setZone(AREA_TZ).toISO({ suppressMilliseconds: true });
const dayStartIso = (ymd) => isoLA(DateTime.fromISO(ymd, { zone: AREA_TZ }).startOf("day"));

function cleanLocation(l) {
  if (!l || l.kind === "none" || l.kind === "online") return null;
  if (l.kind === "tba") return { raw: l.raw, name: null, address: null, mapsUrl: null, city: null, tba: true };
  const parts = [];
  for (const p of l.raw.split(",").map((x) => x.trim()).filter(Boolean))
    if (!parts.some((q) => q.toLowerCase().replace(/\.$/, "") === p.toLowerCase().replace(/\.$/, ""))) parts.push(p);
  const rest = (l.venue ? parts.slice(1) : parts).filter((p) => !/^(usa|united states)$/i.test(p));
  return {
    raw: l.raw, name: l.venue || null, address: rest.join(", ") || null,
    mapsUrl: l.mapUrl, city: l.city || null, street: l.street || null, zip: l.zip || null, tba: false,
  };
}
function cleanOnline(z) {
  if (!z || !(z.idDigits || z.joinUrl)) return null;
  return { zoomId: z.id || null, passcode: z.passcode || null, joinUrl: z.joinUrl || null };
}
const GENERIC_LINK = /^(click here|here|link|flyer|english|spanish|español|espanol|ingles|inglés|document|pdf|en|sp|es)$/i;
function cleanLinks(links) {
  return (links || []).map((k) => {
    let en = k.label, es = k.label;
    // labels that are really file names ("SP_35 Foro", "ASCFlyer_2023-12_English") become readable ones
    const tl = tidyLinkLabel(k.label);
    const lang = tl.lang || k.lang || "";
    const sufEn = lang === "en" ? ` (${t("language.english", "en")})` : lang === "es" ? ` (${t("language.spanish", "en")})` : "";
    const sufEs = lang === "en" ? ` (${t("language.english", "es").toLowerCase()})` : lang === "es" ? ` (${t("language.spanish", "es").toLowerCase()})` : "";
    if (GENERIC_LINK.test(k.label || "") || (tl.fileName && !tl.text)) {
      const key = tl.kind === "flyer" || /flyer/i.test(k.label) ? "calendar.link.flyer" : tl.kind === "program" ? "calendar.link.program" : "calendar.link.document";
      en = t(key, "en") + sufEn;
      es = t(key, "es") + sufEs;
    } else if (tl.fileName) {
      en = tl.text + sufEn;
      es = tl.text + sufEs;
    }
    return {
      label: en, label_en: en, label_es: es, url: k.url, isPdf: !!k.isPdf, lang: k.lang || "",
      driveId: k.driveId || "", thumb: k.driveId ? driveImageUrl(k.driveId, 480) : "",
    };
  });
}
// Title-ES is often typed without accents ("Comite de Servicio de Area"); restore the common ones.
const ES_ACCENTS = { Comite: "Comité", comite: "comité", Area: "Área", area: "área", Reunion: "Reunión", reunion: "reunión",
  Sesion: "Sesión", sesion: "sesión", Informacion: "Información", informacion: "información", Publica: "Pública", publica: "pública",
  Vina: "Viña", Tecnologia: "Tecnología", tecnologia: "tecnología", Mexico: "México" };
const fixAccents = (s) => String(s).replace(/[A-Za-z]+/g, (w) => ES_ACCENTS[w] || w);

function spanishTitle(e, committeeNames, slug) {
  if (e.titleEs) return fixAccents(e.titleEs);
  // editors can give any entry a Spanish title in data/text/calendar.csv: key calendar.title_es.<slug>
  const row = dictionary()[`calendar.title_es.${slug}`];
  if (row && row.es) return row.es;
  const m = /^\s*District\s+(\d{1,2})(?:\s*&\s*(\d{1,2}))?(\s*\(Spanish\))?\s*$/i.exec(e.summary);
  if (m) return `Distrito ${m[1]}${m[2] ? ` y ${m[2]}` : ""}${m[3] ? " (hispano)" : ""}`;
  if (e.type === "Committee" && e.committeeOwn && committeeNames[e.committeeOwn] && /committee/i.test(e.summary) && e.kind === "series")
    return `Comité de ${committeeNames[e.committeeOwn].es}`;
  return "";
}
// Spanish Note lines: the calendar's own "Nota:" lines, else a translation row calendar.note_es.<slug> in
// data/text/calendar.csv — used only while its English column still matches the calendar's Note lines.
const normNote = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
function spanishNotes(e, slug, stale) {
  if ((e.notesEs || []).length) return e.notesEs;
  const row = dictionary()[`calendar.note_es.${slug}`];
  if (!row || !row.es) return [];
  if (normNote(row.en) !== normNote((e.notes || []).join(" | "))) { stale.push(slug); return []; }
  return row.es.split(/\s*\|\s*/).filter(Boolean);
}

// "Registration: 8:00 AM" on a date -> ISO, and "Registration from 8:00 AM" / "Inscripción desde las 8:00 a. m."
const regStart = (ymd, hhmm) => isoLA(DateTime.fromISO(`${ymd}T${hhmm}`, { zone: AREA_TZ }));
const regLabel = (ymd, hhmm, lang) => t("calendar.registration", lang, { time: clockLabel(regStart(ymd, hhmm), lang) });

function timeLabels(start, end, allDay, days) {
  if (allDay) return { en: t("calendar.all_day", "en"), es: t("calendar.all_day", "es") };
  if (days > 1) return { en: t("calendar.starts_at", "en", { time: timeRangeLabel(start, null, "en") }), es: t("calendar.starts_at", "es", { time: timeRangeLabel(start, null, "es") }) };
  return { en: timeRangeLabel(start, end, "en"), es: timeRangeLabel(start, end, "es") };
}
function dateRangeLabel(startDate, endDate, lang) {
  if (!endDate || endDate === startDate) return dateLabel(startDate, lang);
  const a = DateTime.fromISO(startDate, { zone: AREA_TZ }), b = DateTime.fromISO(endDate, { zone: AREA_TZ });
  const short = { weekday: "short", month: "short", day: "numeric" };
  const first = a.year === b.year ? dateLabel(startDate, lang, short) : dateLabel(startDate, lang);
  return `${first} – ${dateLabel(endDate, lang)}`;
}

/* ------------------------------------------------------------------ main */

let memo = null;

async function loadCalendar() {
  const icsFile = process.env.CALENDAR_ICS ? path.resolve(process.env.CALENDAR_ICS) : path.join(DATA_DIR, "calendar.ics");
  const inputs = ["calendar.ics", "event-types.csv", "districts.csv", "committees.csv", "text/calendar.csv"].map((f) => {
    try { return fs.statSync(path.join(DATA_DIR, f)).mtimeMs; } catch { return 0; }
  });
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000)); // "now" moves on: rebuild at most every 10 minutes
  const key = inputs.join("|") + "|" + bucket + "|" + (process.env.CALENDAR_NOW || "") + "|" + (process.env.CALENDAR_ICS || "");
  if (memo && memo.key === key) return memo.value;
  const value = build(fs.existsSync(icsFile) ? fs.readFileSync(icsFile, "utf8") : "");
  memo = { key, value };
  return value;
}

// Other data files may `import calendar from "./calendar.js"` and `await calendar()`: the result is
// memoised, so the calendar is parsed once per build.
export default async function () {
  return loadCalendar();
}

function build(icsText) {
  const now = process.env.CALENDAR_NOW ? DateTime.fromISO(process.env.CALENDAR_NOW, { setZone: true }).setZone(AREA_TZ) : DateTime.now().setZone(AREA_TZ);
  const nowIso = isoLA(now);
  const nowMs = now.toMillis();
  const windowStart = now.minus({ days: WINDOW_BEFORE_DAYS }).startOf("day");
  const windowEnd = now.plus({ days: WINDOW_AFTER_DAYS }).startOf("day");

  const types = loadTypes();
  const typeMap = Object.fromEntries(types.map((x) => [x.key, x]));
  const districts = loadDistricts();
  const committees = loadCommittees();
  const holds = loadHolds();

  const empty = {
    generated: nowIso, windowStart: isoLA(windowStart), windowEnd: isoLA(windowEnd),
    types, typeMap, series: [], bySlug: {}, occurrences: [], upcoming: [], upcomingMeetings: [], upcomingEvents: [],
    areaMeetings: [], nextAreaMeeting: null, byDistrict: {}, byCommittee: {}, pages: [],
    stats: { series: 0, occurrencesNext30Days: 0, meetingsPerMonth: 0, eventsUpcoming: 0 },
    icsUrl: ICS_URL, webcalUrl: WEBCAL_URL, subscribeUrl: SUBSCRIBE_URL, embedUrl: EMBED_URL, embedUrlEs: EMBED_URL_ES,
    mirrorUrl: "/calendar.ics", mirrorUrlEs: "/calendar-es.ics", jsonUrl: "/assets/data/events.json",
    districts: [], committees: [], topics: [], cities: [], archive: [], directory: [], ok: false,
  };
  if (!icsText || !icsText.startsWith("BEGIN:VCALENDAR")) {
    console.warn("[calendar] data/calendar.ics is missing or empty — the calendar pages will be empty");
    return empty;
  }

  // the parser's type table: pages = meetings and/or events, straight from event-types.csv
  const parserTypes = Object.fromEntries(types.map((x) => [x.key, { group: x.group, pages: [x.is_meeting && "meetings", x.is_event && "events"].filter(Boolean) }]));
  for (const k of Object.keys(parserTypes)) if (!parserTypes[k].pages.length) parserTypes[k].pages = ["events"];

  // known spelling slips (unfold the long lines first so a word split across two lines is found too)
  let ics = icsText.replace(/\r?\n[ \t]/g, "");
  for (const [re, good] of TYPO_FIXES) ics = ics.replace(re, good);

  let cal;
  try {
    cal = parseCalendar(ics, { now: now.toJSDate(), types: parserTypes, topics: DEFAULT_TOPICS, districts: districts.parserMap, committees: committees.rules, holds });
  } catch (err) {
    console.warn(`[calendar] could not read data/calendar.ics: ${err.message}`);
    return empty;
  }
  const errors = cal.events.flatMap((e) => e.problems.filter((p) => p.severity === "error").map((p) => `${e.summary}: ${p.message}`));
  if (errors.length) console.warn(`[calendar] ${errors.length} problem(s) in calendar entries (run: node scripts/check-calendar.mjs)`);

  /* ---- series (one per master entry) */
  const committeeNames = committees.names;
  const ordered = [...cal.events].sort((a, b) => (a.time.startUtc || "").localeCompare(b.time.startUtc || "") || a.uid.localeCompare(b.uid));
  // page addresses: the title (plus the date for one-time entries). When two repeating entries share a
  // title, the newest gets the plain address and older ones get their start year added.
  const slugByUid = {};
  const usedSlugs = new Set();
  for (const e of [...ordered].reverse()) {
    const base = slugify(e.summary, 60) || "event";
    const plain = e.kind === "series" ? base : `${base}-${e.time.startDate}`;
    let slug = plain;
    if (usedSlugs.has(slug) && e.kind === "series") slug = `${base}-${e.time.startDate.slice(0, 4)}`;
    for (let i = 2; usedSlugs.has(slug); i++) slug = `${plain}-${i}`;
    usedSlugs.add(slug);
    slugByUid[e.uid] = slug;
  }
  const series = [];
  const byUid = {};
  const staleNoteRows = []; // calendar.note_es.<slug> rows whose English no longer matches the calendar
  for (const e of ordered) {
    const typ = typeMap[e.type] || typeMap.Other;
    const recurring = e.kind === "series";
    const isMeeting = recurring ? typ.is_meeting : typ.is_meeting && !typ.is_event;
    const isEvent = recurring ? typ.is_event && !typ.is_meeting : typ.is_event;
    const slug = slugByUid[e.uid];

    const allDay = !!e.time.allDay;
    const start = allDay ? dayStartIso(e.time.startDate) : e.time.start;
    const end = allDay ? dayStartIso(e.time.endDateExclusive) : e.time.end;
    const days = allDay ? e.time.days : Math.max(1, Math.round(e.time.days || 1));
    const tl = timeLabels(start, end, allDay, recurring ? 1 : days);
    const startLocal = la(start);
    const rule = recurring ? { en: ruleLabel(e.recurrence, "en", startLocal), es: ruleLabel(e.recurrence, "es", startLocal) } : null;
    const when = recurring
      ? { en: allDay ? rule.en : `${rule.en} · ${tl.en}`, es: allDay ? rule.es : `${rule.es} · ${tl.es}` }
      : {
          en: `${dateRangeLabel(e.time.startDate, e.time.endDate, "en")}${allDay && days > 1 ? "" : ` · ${tl.en}`}`,
          es: `${dateRangeLabel(e.time.startDate, e.time.endDate, "es")}${allDay && days > 1 ? "" : ` · ${tl.es}`}`,
        };

    const dref = e.districts || [];
    const own = dref.filter((d) => d.role === "own").map((d) => d.district);
    const hosts = dref.filter((d) => d.role === "host" || d.role === "mention").map((d) => d.district);
    const covers = dref.filter((d) => d.role === "covers").map((d) => d.district);
    const cref = e.committees || [];
    const flyers = (e.images || []).filter((i) => i.driveId).map((i) => ({
      id: i.driveId, view: driveViewUrl(i.driveId), img: driveImageUrl(i.driveId, 1200), thumb: driveImageUrl(i.driveId, 640), fallback: driveThumbUrl(i.driveId, 800),
    }));
    const lastDate = recurring ? e.recurrence.lastDate : e.time.endDate;
    const ended = recurring ? !!(e.recurrence.untilLocal && DateTime.fromISO(e.recurrence.untilLocal) < now) : DateTime.fromISO(e.time.endUtc) < now;
    // "Registration: 8:00 AM" -> "Registration from 8:00 AM" / "Inscripción desde las 8:00 a. m."
    const regIso = e.registration && !allDay ? regStart(e.time.startDate, e.registration) : "";
    const publicText = recurring && isMeeting ? "" : e.body || "";

    const s = {
      uid: e.uid, slug, url: `/events/${slug}/`, icsPath: `/events/${slug}.ics`,
      title: e.summary, title_es: spanishTitle(e, committeeNames, slug),
      type: typ.key, typeLabel_en: typ.label_en, typeLabel_es: typ.label_es, color: typ.color, icon: typ.icon, group: typ.group,
      format: e.format || "", language: withDefaultLanguage(typ, e.language), languageAsWritten: e.language || "",
      recurring, isMeeting, isEvent, status: e.status || "confirmed",
      rule_en: rule ? rule.en : "", rule_es: rule ? rule.es : "",
      pattern_en: when.en, pattern_es: when.es,
      dateLabel_en: recurring ? rule.en : dateRangeLabel(e.time.startDate, e.time.endDate, "en"),
      dateLabel_es: recurring ? rule.es : dateRangeLabel(e.time.startDate, e.time.endDate, "es"),
      start, end, allDay, startDate: e.time.startDate, endDate: e.time.endDate, endDateExclusive: e.time.endDateExclusive || null,
      days, multiDay: e.time.startDate !== e.time.endDate,
      durationMin: allDay ? days * 24 * 60 : e.time.durationMinutes || 0,
      timeLabel_en: tl.en, timeLabel_es: tl.es,
      rrule: recurring ? e.recurrence.rrule : "", exdates: recurring ? e.recurrence.exdates : [],
      firstDate: e.time.startDate, lastDate: lastDate || e.time.startDate, ended,
      location: cleanLocation(e.location),
      online: cleanOnline(e.zoom),
      email: (e.emails[0] || {}).address || "", emails: e.emails.map((x) => x.address),
      web: e.web || "", cost: e.cost || "",
      // Note: lines (English) and Nota: lines (Spanish); pages pick with the calNotes filter
      notes: e.notes || [], note: (e.notes || []).join(" "),
      notes_en: e.notes || [], notes_es: spanishNotes(e, slug, staleNoteRows),
      registration: e.registration || "", registrationStart: regIso,
      registration_en: regIso ? regLabel(e.time.startDate, e.registration, "en") : "",
      registration_es: regIso ? regLabel(e.time.startDate, e.registration, "es") : "",
      topics: e.topics || [],
      covers: e.covers ? { text: e.covers.text, cities: e.covers.cities, districts: covers } : null,
      hosts: [...new Set(hosts)], ownDistricts: own, coversDistricts: covers,
      district: own[0] || hosts[0] || "",
      districts: [...new Set([...own, ...hosts])],
      committee: (cref[0] || {}).committee || "", committeeRole: (cref[0] || {}).role || "",
      committees: cref.map((c) => c.committee), committeeRefs: cref.map((c) => ({ slug: c.committee, role: c.role })),
      flyers, hasFlyer: flyers.length > 0, links: cleanLinks(e.links),
      heldFiles: (e.held || []).length,
      about_html: aboutHtml(publicText),
      about_text: publicText,
      // one-time events long past: kept for the archive, but not offered to search engines
      noindex: !recurring && DateTime.fromISO(e.time.endUtc) < now.minus({ days: ONE_OFF_NOINDEX_DAYS }),
      areaKind: e.areaKind || "",
      next: null, upcomingDates: [], cancelledDates: [], related: [], pastDates: [],
    };
    series.push(s);
    byUid[e.uid] = s;
  }
  const bySlug = Object.fromEntries(series.map((s) => [s.slug, s]));
  // repeating entries that share a title get "– Every 3rd Sunday · 2023" in their page title (one-time
  // entries carry their date there anyway), so search results and tabs can tell them apart
  for (const L of ["en", "es"]) {
    const groups = {};
    for (const s of series) if (s.recurring) (groups[(L === "es" && s.title_es) || s.title] ||= []).push(s);
    for (const g of Object.values(groups)) {
      if (g.length < 2) continue;
      for (const s of g) {
        const y1 = s.firstDate.slice(0, 4), y2 = (s.lastDate || s.firstDate).slice(0, 4);
        s[`titleSuffix_${L}`] = `${L === "es" ? s.rule_es : s.rule_en} · ${y1 === y2 ? y1 : `${y1}–${y2}`}`;
      }
    }
  }

  /* ---- occurrences in the window */
  const raw = expandOccurrences(cal.events, windowStart.toISODate(), windowEnd.toISODate(), { includeCancelled: true });
  let occurrences = raw.map((o) => {
    const s = byUid[o.uid];
    const typ = typeMap[o.type] || typeMap[s.type] || typeMap.Other;
    const allDay = !!o.allDay;
    const start = allDay ? dayStartIso(o.startDate) : o.start;
    const end = allDay ? dayStartIso(DateTime.fromISO(o.endDate, { zone: AREA_TZ }).plus({ days: 1 }).toISODate()) : o.end || o.start;
    const days = DateTime.fromISO(o.endDate).diff(DateTime.fromISO(o.startDate), "days").days + 1;
    const tl = timeLabels(start, end, allDay, days);
    const ov = o.override && o.override.fields ? o.override.fields : null;
    const ovImages = ov && ov.images && ov.images.length ? ov.images : null;
    const flyerId = ovImages ? ovImages[0].driveId : s.flyers[0] && s.flyers[0].id;
    return {
      key: `${o.uid}@${la(start).toFormat("yyyyLLddHHmm")}`,
      uid: o.uid, slug: s.slug, url: s.url,
      title: o.summary || s.title, title_es: (ov && ov.titleEs) || s.title_es,
      type: typ.key, typeLabel_en: typ.label_en, typeLabel_es: typ.label_es, color: typ.color, icon: typ.icon, group: typ.group,
      start, end, allDay, date: o.startDate, endDate: o.endDate, multiDay: o.startDate !== o.endDate,
      timeLabel_en: tl.en, timeLabel_es: tl.es,
      format: o.format || s.format, language: withDefaultLanguage(typ, o.language || s.languageAsWritten),
      recurrenceId: o.recurrenceId || "", isOverride: !!o.isOverride,
      registration_en: s.registration && !allDay ? regLabel(o.startDate, s.registration, "en") : "",
      registration_es: s.registration && !allDay ? regLabel(o.startDate, s.registration, "es") : "",
      city: o.city || (s.location && s.location.city) || "", venue: o.venue || (s.location && s.location.name) || "",
      district: s.district, districts: s.districts, committee: s.committee, committees: s.committees,
      flyer: flyerId ? driveImageUrl(flyerId, 800) : "",
      hasZoom: !!(o.hasZoom || (s.online && (s.online.zoomId || s.online.joinUrl))),
      hasFlyer: !!flyerId,
      recurring: !!o.recurring, status: o.status || "confirmed",
      isMeeting: s.isMeeting, isEvent: s.isEvent,
      pattern_en: s.recurring ? s.rule_en : "", pattern_es: s.recurring ? s.rule_es : "",
    };
  });

  // one Sunday, one listing: hide an "Area" series date when a one-off ASC / Assembly / Foro is that day
  const areaOneOffDays = new Set(occurrences.filter((o) => !o.recurring && DEDUPE_AREA_BY.includes(o.type)).map((o) => o.date));
  occurrences = occurrences.filter((o) => !(o.type === "Area" && areaOneOffDays.has(o.date)));
  // compare instants, not strings with different offsets
  for (const o of occurrences) { o._s = Date.parse(o.start); o._e = Date.parse(o.end); }
  occurrences.sort((a, b) => a._s - b._s || a.title.localeCompare(b.title));

  const isUpcoming = (o) => o._e >= nowMs;
  const upcomingAll = occurrences.filter(isUpcoming);
  const upcoming = upcomingAll.filter((o) => o.status !== "cancelled");

  /* ---- per-series dates */
  const occBySlug = {};
  for (const o of occurrences) (occBySlug[o.slug] ||= []).push(o);
  for (const s of series) {
    const list = occBySlug[s.slug] || [];
    const fut = list.filter(isUpcoming);
    s.upcomingDates = fut.slice(0, 8);
    s.next = fut.find((o) => o.status !== "cancelled") || null;
    s.cancelledDates = list.filter((o) => o.status === "cancelled").map((o) => o.date);
    s.pastDates = list.filter((o) => !isUpcoming(o)).slice(-3).reverse();
    s.occurrenceCount = list.length;
    if (!s.recurring) s.ended = s.ended || (!fut.length && Date.parse(s.end) < nowMs);
  }

  /* ---- related upcoming events (same type first, then same group), one date per series */
  const nextBySeries = new Map();
  for (const o of upcoming) if (!nextBySeries.has(o.slug)) nextBySeries.set(o.slug, o);
  const nexts = [...nextBySeries.values()];
  for (const s of series) {
    const same = nexts.filter((o) => o.slug !== s.slug && o.type === s.type);
    const group = nexts.filter((o) => o.slug !== s.slug && o.type !== s.type && o.group === s.group);
    s.related = [...same, ...group].slice(0, 6);
  }

  /* ---- districts & committees */
  const byDistrict = {};
  const dEntry = (slug) => (byDistrict[slug] ||= { own: null, series: [], hosted: [], coveredBy: [], upcoming: [], events: [], past: [] });
  for (const d of districts.list) dEntry(d.slug);
  for (const s of series) {
    for (const d of s.ownDistricts) { const x = dEntry(d); if (!x.own || (s.recurring && !s.ended && (!x.own.recurring || x.own.ended))) x.own = s; }
  }
  for (const s of series) {
    for (const d of s.ownDistricts) { const x = dEntry(d); if (!x.series.includes(s)) x.series.push(s); }
    for (const d of s.hosts) { const x = dEntry(d); if (!x.series.includes(s)) x.series.push(s); x.hosted.push(s); if (!s.recurring && s.ended) x.past.push(s); }
    for (const d of s.coversDistricts) { const x = dEntry(d); if (s.recurring && !s.ended) x.coveredBy.push(s); }
  }
  for (const [slug, x] of Object.entries(byDistrict)) {
    // own meeting first, then active series, then the rest newest first
    x.series.sort((a, b) => (b === x.own) - (a === x.own) || Number(a.ended) - Number(b.ended) || b.startDate.localeCompare(a.startDate));
    x.past.sort((a, b) => b.startDate.localeCompare(a.startDate));
    const slugs = new Set(x.series.map((s) => s.slug));
    x.upcoming = upcoming.filter((o) => slugs.has(o.slug)).slice(0, 30);
    x.events = upcoming.filter((o) => slugs.has(o.slug) && !o.recurring).slice(0, 12);
  }
  const byCommittee = {};
  const cEntry = (slug) => (byCommittee[slug] ||= { own: [], series: [], upcoming: [], events: [], past: [] });
  for (const slug of Object.keys(committees.rules)) cEntry(slug);
  for (const s of series) {
    for (const ref of s.committeeRefs) {
      const x = cEntry(ref.slug);
      x.series.push(s);
      if (ref.role === "own") x.own.push(s);
      if (!s.recurring && s.ended) x.past.push(s);
    }
  }
  for (const x of Object.values(byCommittee)) {
    const rank = (s) => (x.own.includes(s) ? 0 : 1);
    x.series.sort((a, b) => rank(a) - rank(b) || Number(a.ended) - Number(b.ended) || b.startDate.localeCompare(a.startDate));
    x.own.sort((a, b) => Number(a.ended) - Number(b.ended) || b.startDate.localeCompare(a.startDate));
    x.past.sort((a, b) => b.startDate.localeCompare(a.startDate));
    const slugs = new Set(x.series.map((s) => s.slug));
    x.upcoming = upcoming.filter((o) => slugs.has(o.slug)).slice(0, 30);
    x.events = upcoming.filter((o) => slugs.has(o.slug) && !o.recurring).slice(0, 12);
  }

  /* ---- Area meetings */
  const areaMeetings = occurrences.filter((o) => AREA_MEETING_TYPES.includes(o.type));
  const nextAreaMeeting = upcoming.find((o) => NEXT_AREA_TYPES.includes(o.type)) || null;

  /* ---- lists for filters and indexes */
  const typeCounts = {};
  for (const o of upcoming) typeCounts[o.type] = (typeCounts[o.type] || 0) + 1;
  for (const x of types) { x.upcomingCount = typeCounts[x.key] || 0; x.seriesCount = series.filter((s) => s.type === x.key).length; }
  const usedDistricts = new Set(occurrences.flatMap((o) => o.districts));
  const districtList = districts.list
    .filter((d) => usedDistricts.has(d.slug) || d.active)
    .sort((a, b) => a.nums[0] - b.nums[0])
    .map((d) => ({
      slug: d.slug, number: d.number, nums: d.nums,
      label_en: d.name_en || t("calendar.district_n", "en", { n: d.nums.join(" & ") }),
      label_es: d.name_es || t("calendar.district_n", "es", { n: d.nums.join(" y ") }),
      short_en: t("calendar.district_n", "en", { n: d.nums.join(" & ") }),
      short_es: t("calendar.district_n", "es", { n: d.nums.join(" y ") }),
    }));
  const usedCommittees = new Set(occurrences.flatMap((o) => o.committees));
  const committeeList = Object.entries(committees.names)
    .filter(([slug]) => usedCommittees.has(slug))
    .map(([slug, n]) => ({ slug, name_en: n.en, name_es: n.es }))
    .sort((a, b) => a.name_en.localeCompare(b.name_en));
  const topicCounts = {};
  for (const s of series) for (const tp of s.topics) topicCounts[tp] = (topicCounts[tp] || 0) + 1;
  const topics = Object.keys(topicCounts).sort().map((tp) => ({ key: tp, slug: slugify(tp), count: topicCounts[tp] }));
  const cityCounts = {};
  for (const o of upcoming) if (o.city) cityCounts[o.city] = (cityCounts[o.city] || 0) + 1;
  const cities = Object.keys(cityCounts).sort().map((c) => ({ city: c, slug: slugify(c), count: cityCounts[c] }));

  // archive of past one-time entries by year; directory of the regular meetings by type
  const archiveMap = {};
  for (const s of series) if (!s.recurring && s.ended) (archiveMap[s.startDate.slice(0, 4)] ||= []).push(s);
  const archive = Object.keys(archiveMap).sort().reverse().map((y) => ({ year: y, items: archiveMap[y].sort((a, b) => b.startDate.localeCompare(a.startDate)) }));
  const directory = types
    .map((x) => ({ type: x, items: series.filter((s) => s.type === x.key && s.recurring && !s.ended).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })) }))
    .filter((g) => g.items.length);

  /* ---- stats */
  const in30 = nowMs + 30 * 864e5, in365 = nowMs + 365 * 864e5;
  const meetingsYear = upcoming.filter((o) => o.isMeeting && o._s <= in365).length;
  const eventsUpcoming = new Set(upcoming.filter((o) => o.isEvent).map((o) => o.slug)).size;
  const stats = {
    series: series.filter((s) => s.recurring && !s.ended).length,
    occurrencesNext30Days: upcoming.filter((o) => o._s <= in30).length,
    meetingsPerMonth: Math.round(meetingsYear / 12),
    eventsUpcoming,
    entries: series.length,
    pastEvents: series.filter((s) => !s.recurring && s.ended).length,
    districtsWithMeetings: Object.values(byDistrict).filter((x) => x.own && !x.own.ended).length,
  };

  // the coming week (for "This week" lists); the browser drops what has passed
  const soon = upcoming.filter((o) => o._s < nowMs + 8 * 864e5).slice(0, 60);
  // upcoming events, one date per entry (for flyer walls)
  const seenEv = new Set();
  const featuredEvents = upcoming.filter((o) => o.isEvent && !seenEv.has(o.slug) && seenEv.add(o.slug));
  for (const o of occurrences) { delete o._s; delete o._e; }
  // single dates of a repeating entry that were moved, retitled or cancelled (for the .ics files)
  const instancesBySlug = {};
  for (const o of occurrences) if (o.recurring && o.isOverride && o.recurrenceId) (instancesBySlug[o.slug] ||= []).push(o);

  return {
    ...empty,
    ok: true,
    calendarName: cal.calendar.name,
    committeeRules: committees.source,
    types, typeMap,
    series, bySlug,
    occurrences,
    upcoming,
    upcomingMeetings: upcoming.filter((o) => o.isMeeting),
    upcomingEvents: upcoming.filter((o) => o.isEvent),
    upcomingWithCancelled: upcomingAll,
    areaMeetings,
    nextAreaMeeting,
    nextAreaMeetings: upcoming.filter((o) => NEXT_AREA_TYPES.includes(o.type)).slice(0, 4),
    soon, featuredEvents,
    byDistrict, byCommittee,
    pages: LANGS.flatMap((lang) => series.map((item) => ({ lang, item }))),
    stats,
    districts: districtList, committees: committeeList, topics, cities,
    archive, directory,
    instancesBySlug,
    heldFiles: holds.size,
    staleNoteRows,
  };
}

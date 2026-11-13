// The central offices' own events, as every page sees them ({{ officeEvents.… }}).
//
// Source: data/central-office-events.json — the copy of the offices' event lists that scripts/office-events.mjs reads
// from their websites once a day (deploy.yml) and the keep job commits. Nothing here is typed by hand; editors steer it
// with three tables:
//   data/office-event-sources.csv     one row per central office: how its website is read (adapter, feed, import on/off),
//                                     its events page, and options (card=pictures|list: what its card says when it is
//                                     not read automatically)
//   data/central-office-overrides.csv id,action,value,until: hide an imported event, show it although the Area calendar
//                                     seems to have it, give it another type or title, or say which Area entry it is
//                                     (same-as = the Area event's page slug)
//   data/office-flyer-review.csv      the flyer check (scripts/check-media.mjs --office-flyers): an imported flyer is
//                                     shown only when its row says clean (or cleared, after an editor looked) for the
//                                     very file the mirror lists (same SHA-256)
//
// The Area calendar wins: an imported event that the Area's Google Calendar already has (same day and the office's
// address, two shared title words, one word and the same host / city / time …: src/_lib/office-match.js) is left out,
// at every build, so an entry the owner adds to Google Calendar replaces the office's copy at the next build. Area
// one-time events that an office holds (the entry names the office as organizer or website, or links the office's own
// page about the event) get its key (areaOffice), so the "Central offices" filter finds them too.
//
// Imported text was cleaned by the importer (no personal phone numbers or e-mail addresses, Zoom details, sobriety
// dates, full names); it is cleaned again here and an event that still trips a check is dropped, so scripts/check-site.mjs
// never stops a deploy over an office's text. A missing or broken file counts as empty: the site builds without them.
//
// Shape: { ok, offices, byKey, events, featured, months, types, officeList, twins, areaOffice, typeCounts, stats }
//   events      upcoming imported events, soonest first. Each is shaped like an Area occurrence (key, title, title_es,
//               type, typeLabel_*, color, icon, start, end, allDay, date, endDate, multiDay, timeLabel_*, venue, city,
//               format, language, status …) so the event macros can draw it, plus: id, office, also (other offices that
//               list it), offices ([office, …also]), src (the event's page on the office's website), address, zip,
//               cost, summary (plain text), noEnd (the office gives no end time: end = start + 2 h, or the end of the last day of
//               a multi-day event), noPlace ("flyer" | "site": the listing gives no place),
//               flyer ({ url, srcset, w, h, full, pdf } once checked, else null), pdf (a checked PDF flyer's link),
//               url ("/calendar/central-offices/#<id>": its card), and the flyer-wall fields typeSlug, formatKey,
//               langKey, search, dates, lastEnd.
//   offices     every office of data/central-offices.csv that is shown, in its order, with: short, events_page,
//               adapter, status (auto | pictures | list | none | shared | online | paused | off), sharedWith, count
//   officeList  the offices that have an upcoming event (the filters' choices), with their counts
//   twins       [{ id, slug, reason }]: imported events left out because the Area calendar has them (build log)
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import "../assets/js/search.js";
import { readCsv, DATA_DIR } from "../_lib/csv.js";
import { t } from "../_lib/i18n.js";
import { AREA_TZ, slugify, timeRangeLabel, dateLabel, compileLinkFixes } from "../_lib/calendar.js";
import { nameHits } from "../_lib/names.js";
import { loadAllow, contactHits, titleRisk, summaryRisk } from "../_lib/contact-rules.js";
import { cleanRecord, parseOptions as options } from "../_lib/office-import.js";
import { matchArea, areaItemsFromCalendar } from "../_lib/office-match.js";
import calendar from "./calendar.js";
import offices from "./offices.js";

// Only the default export: Eleventy would otherwise publish the module's named exports as the data.
const MIRROR = "central-office-events.json";
const NO_END_HOURS = 2; // an event without an end time is drawn this long (calendar grid); its card says "Starts …"
const PAUSED_DAYS = 3; // an office whose website could not be read for this long: its card says so
const FEATURED = 12; // cards in the strip under the Events page's calendar
const FORMAT_KEY = { "In person": "in-person", Hybrid: "hybrid", Virtual: "online" };
const LANG_KEY = { English: "en", Spanish: "es", Bilingual: "bi" };
const IMPORT_ADAPTERS = new Set(["tribe", "aanoc", "tvco"]);
const SEARCH_WORDS = "central office oficina central intergroup intergrupo";
// what scripts/check-site.mjs refuses in a central office's event (CO_REFUSED and coWords there too): a Zoom address, a
// passcode word, "PW" with its code, a Zoom meeting number — read after every dash, full-width sign and space is made plain
const CO_REFUSED = /zoom(?:gov)?\.us|\bpass[\s-]?codes?\b\s*(?:(?:is|es|[:=#-])\s*\S|\w*\d)|\bpasscode\w*\d|\bcontrase[nñ]as?\b\s*(?:(?:is|es|[:=#-])\s*\S|\w*\d)|\bp\s?[./]?\s?w\b\.?\s*[:=#.-]?\s*\w*\d|\bzoom\b[^\n]{0,20}\d{3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b(?:meeting|webinar|reuni[oó]n)\s*id\b[^\n]{0,10}\d{3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/i;
const coWords = (s) =>
  String(s || "")
    .normalize("NFC")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[  -   　]/g, " ")
    .replace(/[​-‍﻿]/g, "");

const la = (iso) => DateTime.fromISO(iso, { setZone: true }).setZone(AREA_TZ);
const isoLA = (dt) => dt.setZone(AREA_TZ).toISO({ suppressMilliseconds: true });
const dayStartIso = (ymd) => isoLA(DateTime.fromISO(ymd, { zone: AREA_TZ }).startOf("day"));
const hostOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
const httpsUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || "")) ? String(u) : "");
const mapsSearch = (q) => (q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "");

function readMirror() {
  const file = path.join(DATA_DIR, MIRROR);
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j || !Array.isArray(j.events)) throw new Error("no events list");
    return j;
  } catch (e) {
    if (fs.existsSync(file)) console.warn(`[officeEvents] data/${MIRROR} could not be read (${e.message}) — no central-office events this build`);
    return { v: 1, offices: {}, events: [] };
  }
}

// data/office-flyer-review.csv: "url|sha256" -> result, for the rows that let a flyer be shown
function readReviews() {
  const ok = new Set();
  for (const r of readCsv("office-flyer-review.csv")) {
    const res = String(r.result || "").trim().toLowerCase();
    if ((res === "clean" || res === "cleared") && r.url && r.sha256) ok.add(`${r.url.trim()}|${r.sha256.trim().toLowerCase()}`);
  }
  return ok;
}

// data/central-office-overrides.csv: id -> [{ action, value }], the rows still in force today
function readOverrides(today) {
  const out = new Map();
  for (const r of readCsv("central-office-overrides.csv")) {
    const id = String(r.id || "").trim();
    const action = String(r.action || "").trim().toLowerCase();
    if (!/^co-[a-z0-9-]+$/.test(id) || !action) continue;
    if (r.until && /^\d{4}-\d{2}-\d{2}$/.test(r.until.trim()) && r.until.trim() < today) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ action, value: String(r.value || "").trim() });
  }
  return out;
}


let memo = null;

export default async function () {
  const now = process.env.CALENDAR_NOW ? DateTime.fromISO(process.env.CALENDAR_NOW, { setZone: true }).setZone(AREA_TZ) : DateTime.now().setZone(AREA_TZ);
  const inputs = [MIRROR, "office-event-sources.csv", "central-office-overrides.csv", "office-flyer-review.csv", "central-offices.csv", "calendar.ics"].map((f) => {
    try { return fs.statSync(path.join(DATA_DIR, f)).mtimeMs; } catch { return 0; }
  });
  const key = inputs.join("|") + "|" + Math.floor(now.toMillis() / (10 * 60 * 1000));
  if (memo && memo.key === key) return memo.value;
  const value = build(now, await calendar(), offices());
  memo = { key, value };
  return value;
}

function build(now, cal, off) {
  const nowMs = now.toMillis();
  const today = now.toISODate();
  const mirror = readMirror();
  const reviewed = readReviews();
  const overrides = readOverrides(today);
  const allow = loadAllow();
  const typeMap = cal.typeMap || {};
  const sources = Object.fromEntries(readCsv("office-event-sources.csv").filter((r) => r.office && !r.office.startsWith("#")).map((r) => [r.office.trim(), r]));

  /* ---- the offices: every shown row of central-offices.csv, with how its events reach the site */
  const health = mirror.offices || {};
  const officeRows = off.list.map((o) => {
    const src = sources[o.key] || {};
    const h = health[o.key] || {};
    const opts = options(src.options);
    const adapter = String(src.adapter || "none").trim().toLowerCase();
    const on = /^(yes|y|true|1|on)$/i.test(String(src.import || "").trim());
    const failingDays = h.failingSince ? now.diff(DateTime.fromISO(h.failingSince, { zone: AREA_TZ }), "days").days : 0;
    return {
      key: o.key, name_en: o.name, name_es: o.name_es || o.name, short: String(src.short || "").trim() || o.name,
      color: o.color, region: o.region, website: o.website, website_es: o.website_es,
      events_page: httpsUrl(src.events_page) || "", adapter, status: "", sharedWith: opts.from || "", count: 0,
      host: hostOf(o.website),
      row: o, on, failingDays, card: ["pictures", "list"].includes(opts.card) ? opts.card : "",
    };
  });
  // what an office's card says about its events (calendar.offices.status.*), once its events are counted: read every
  // day; or, for an office posting none in a form that can be read (card=pictures|list in office-event-sources.csv),
  // where to find them
  const statusOf = (o) => {
    if (o.row.online) return "online";
    if (o.adapter === "shared") return "shared";
    if (IMPORT_ADAPTERS.has(o.adapter) && o.on && (o.count || !o.card)) return o.failingDays > PAUSED_DAYS ? "paused" : "auto";
    if (o.card) return o.card;
    if (o.adapter === "watch") return "list";
    return o.events_page ? "off" : "none";
  };
  const byKey = Object.fromEntries(officeRows.map((o) => [o.key, o]));
  // an office's website -> its key (South OC shares OC Intergroup's site: the first row wins)
  const officeByHost = {};
  for (const o of officeRows) if (o.host && !officeByHost[o.host]) officeByHost[o.host] = o.key;

  /* ---- the Area calendar's entries the imports are compared with: one-time and repeating events (not the regular
     meetings: an office's open house is never "the second Tuesday's intergroup meeting"), the same list the importer's
     daily report uses (areaItemsFromCalendar) */
  const bySlug = cal.bySlug || {};
  const yesterday = now.minus({ days: 1 }).toISODate();
  const areaItems = areaItemsFromCalendar(cal).filter((it) => (it.endDate || it.date) >= yesterday);
  // the Area's own entries marked cancelled: an office still listing the same event must not bring it back as live
  // (only a match on the office's page about it, or on shared title words, counts: not another event at the same hall)
  const cancelledItems = (cal.occurrences || [])
    .filter((o) => o.status === "cancelled" && bySlug[o.slug] && !(bySlug[o.slug].recurring && bySlug[o.slug].isMeeting) && (o.endDate || o.date) >= yesterday)
    .map((o) => {
      const s = bySlug[o.slug];
      return {
        slug: s.slug, title: o.title, title_es: o.title_es || "", start: o.start, end: o.allDay ? "" : o.end || "", allDay: !!o.allDay,
        date: o.date, endDate: o.endDate || o.date, city: o.city || "", web: s.web || "",
        links: [s.web, ...(s.links || []).map((l) => l.url), ...(s.organizers || []).map((x) => x.url)].filter(Boolean),
        about: s.about_text || "", hosts: [...new Set([...(s.organizers || []).map((x) => hostOf(x.url)), hostOf(s.web)].filter(Boolean))],
      };
    });
  // sites the whole site must not link or name (data/link-fixes.csv rows with an empty replace_with: a hacked site)
  const linkFixes = compileLinkFixes(readCsv("link-fixes.csv"));
  const banned = linkFixes.filter((f) => f.host && !f.to);
  const ctx = {
    officeHosts: Object.fromEntries(officeRows.map((o) => [o.key, o.host])),
    eventsPages: Object.fromEntries(officeRows.filter((o) => o.events_page).map((o) => [o.key, o.events_page])),
  };

  /* ---- Area one-time events an office holds: they count for that office in the filters */
  const areaOffice = {};
  for (const s of cal.series || []) {
    if (s.recurring || !s.isEvent) continue;
    const hosts = [...(s.organizers || []).map((x) => hostOf(x.url)), hostOf(s.web)].filter(Boolean);
    const k = hosts.map((h) => officeByHost[h]).find(Boolean);
    if (k) areaOffice[s.slug] = k;
  }

  /* ---- the imported events */
  const twins = [];
  const dropped = [];
  const events = [];
  const seen = new Set();
  for (const raw of mirror.events) {
    if (!raw || typeof raw !== "object" || !/^co-[a-z0-9-]+$/.test(String(raw.id || "")) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const office = byKey[raw.office];
    if (!office) continue; // an office hidden in central-offices.csv: its events too
    const ov = overrides.get(raw.id) || [];
    if (ov.some((x) => x.action === "hide")) continue;
    let rec;
    try {
      rec = cleanRecord(raw, { allow, officeHost: office.host, linkFixes, now: now.toISO(), eventsPage: office.events_page || office.website });
    } catch {
      // a record whose title itself carries a personal detail (the log names the id only, never the text)
      dropped.push(`${raw.id} (held)`);
      continue;
    }
    for (const x of ov) {
      if (x.action === "title" && x.value) rec.title = x.value;
      if (x.action === "type" && typeMap[x.value]) rec.type = x.value;
    }
    // the same rules once more, as a backstop: a summary with anything risky goes (summaryRisk); a title, place or price
    // with a personal detail (titleRisk), or anything that would stop the deploy (scripts/check-site.mjs), leaves the
    // event out
    const riskOpts = { allow, officeHost: office.host, now: now.toISO() };
    if (rec.summary && summaryRisk(rec.summary, riskOpts)) rec.summary = "";
    const text = [rec.title, rec.title_es, rec.venue, rec.address, rec.city, rec.cost, rec.summary].filter(Boolean).join(" \n ");
    const hits = contactHits(text, { allow, officeHost: office.host }).length + contactHits(String(rec.src || ""), { allow }).filter((h) => h.kind === "phone").length +
      [rec.title, rec.title_es, rec.venue, rec.address, rec.city, rec.cost].filter(Boolean).reduce((n, f) => n + titleRisk(f, riskOpts).length, 0);
    if (hits || nameHits(text).length) {
      dropped.push(`${raw.id} (personal details after cleaning)`);
      continue;
    }
    // what scripts/check-site.mjs refuses in a central office's event (a Zoom address or a passcode word, a banned site):
    // left out here, so an office's wording can never stop the deploy
    const all = [text, rec.src, ...(rec.flyers || []).flatMap((f) => [f.url, f.pdf, ...(f.sizes || []).map((x) => x && x[1])])].filter(Boolean).join(" \n ");
    if (CO_REFUSED.test(coWords(all)) || banned.some((f) => f.inText.test(all))) {
      dropped.push(`${raw.id} (Zoom details or a banned site)`);
      continue;
    }

    const ev = shape(rec, { office, offices: byKey, typeMap, reviewed, allow, now });
    if (!ev || Date.parse(ev.end) < nowMs) continue;

    // the Area calendar has it: the Area's entry is the one shown
    const same = ov.find((x) => x.action === "same-as" && x.value);
    if (same) {
      twins.push({ id: ev.id, slug: same.value, reason: "override" });
      continue;
    }
    if (!ov.some((x) => x.action === "show")) {
      let m = null;
      try {
        m = matchArea(rec, areaItems, ctx);
      } catch (e) {
        console.warn(`[officeEvents] could not compare ${ev.id} with the Area calendar: ${e.message}`);
      }
      if (!(m && m.twin) && cancelledItems.length) {
        let c = null;
        try { c = matchArea(rec, cancelledItems, ctx); } catch {}
        if (c && c.twin && /\b(url|words?)\b/.test(c.reason || "")) {
          twins.push({ id: ev.id, slug: c.slug, reason: `cancelled on the Area calendar: ${c.reason}` });
          continue;
        }
      }
      if (m && m.twin) {
        twins.push({ id: ev.id, slug: m.slug, reason: m.reason || "" });
        // the Area entry links this office (its organizer or website, or the office's own page about the event): the
        // office holds it. A match on the title alone says nothing about who holds it (NOCCO lists the Desert's dinner)
        if (bySlug[m.slug] && !bySlug[m.slug].recurring && /\b(host|url)\b/.test(m.reason || "")) areaOffice[m.slug] ||= ev.office;
        continue;
      }
    }
    events.push(ev);
  }
  if (dropped.length) console.warn(`[officeEvents] ${dropped.length} central-office event(s) left out: ${dropped.join("; ")}`);
  if (twins.length) console.log(`[officeEvents] ${twins.length} central-office event(s) already on the Area calendar: ${twins.map((x) => `${x.id} = ${x.slug}${x.reason ? ` (${x.reason})` : ""}`).join("; ")}`);

  events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  for (const ev of events) for (const k of ev.offices) if (byKey[k]) byKey[k].count++;
  for (const o of officeRows) o.status = statusOf(o);

  /* ---- lists for the page and its filters */
  const months = [...new Set(events.map((e) => e.date.slice(0, 7)))].sort().map((m) => ({ key: m, cards: events.filter((e) => e.date.slice(0, 7) === m) }));
  const typeCounts = {};
  for (const e of events) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  const types = Object.values(typeMap)
    .filter((x) => typeCounts[x.key])
    .sort((a, b) => a.sort - b.sort)
    .map((x) => ({ key: x.key, slug: slugify(x.key), label_en: x.label_en, label_es: x.label_es, icon: x.icon, color: x.color, count: typeCounts[x.key] }));
  const areaCounts = {};
  for (const k of Object.values(areaOffice)) areaCounts[k] = (areaCounts[k] || 0) + 1;
  const officeList = officeRows
    .filter((o) => o.count || areaCounts[o.key])
    .map((o) => ({ key: o.key, name_en: o.name_en, name_es: o.name_es, short: o.short, color: o.color, count: o.count }));
  const regions = (off.regions || [])
    .map((r) => ({ key: r.key, color: r.color, icon: r.icon, items: r.items.map((x) => byKey[x.key]).filter(Boolean) }))
    .filter((r) => r.items.length);

  return {
    ok: true,
    offices: officeRows.map(({ row, ...o }) => o),
    byKey: Object.fromEntries(officeRows.map(({ row, ...o }) => [o.key, o])),
    regions,
    events,
    featured: events.slice(0, FEATURED),
    months,
    types,
    officeList,
    twins,
    areaOffice,
    typeCounts,
    stats: { events: events.length, offices: officeRows.filter((o) => o.count).length, auto: officeRows.filter((o) => o.status === "auto").length },
  };
}

// One imported event as the pages use it (an Area occurrence's shape, plus the office's fields)
function shape(rec, { office, offices, typeMap, reviewed, allow, now }) {
  const typ = typeMap[rec.type] || typeMap.Event || typeMap.Other || { key: "Event", label_en: "Event", label_es: "Evento", color: "lilac", icon: "star", group: "events" };
  const allDay = !!rec.allDay;
  let start, end, date, endDate, noEnd = false;
  if (allDay) {
    date = String(rec.start || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    endDate = /^\d{4}-\d{2}-\d{2}$/.test(rec.endDate || "") && rec.endDate >= date ? rec.endDate : date;
    start = dayStartIso(date);
    end = dayStartIso(DateTime.fromISO(endDate, { zone: AREA_TZ }).plus({ days: 1 }).toISODate());
  } else {
    const s = la(String(rec.start || ""));
    if (!s.isValid) return null;
    let e = rec.end ? la(rec.end) : null;
    if (!e || !e.isValid || e <= s) {
      // no end time: a multi-day event (Dec 4 – 6 @ 7 PM) lasts to the end of its last day; a one-day one is drawn 2 h
      const last = /^\d{4}-\d{2}-\d{2}$/.test(rec.endDate || "") && rec.endDate > s.toISODate() ? rec.endDate : "";
      e = last ? DateTime.fromISO(last, { zone: AREA_TZ }).plus({ days: 1 }).startOf("day") : s.plus({ hours: NO_END_HOURS });
      noEnd = true;
    }
    start = isoLA(s);
    end = isoLA(e);
    date = s.toISODate();
    // an evening that runs past midnight (7 pm – 1 am) is still that evening's event
    const lastDay = e.minus({ minutes: 1 });
    endDate = /^\d{4}-\d{2}-\d{2}$/.test(rec.endDate || "") && rec.endDate > date ? rec.endDate : lastDay.hour < 6 && lastDay.toISODate() > date && lastDay.diff(s, "hours").hours < 24 ? date : lastDay.toISODate();
    if (endDate < date) endDate = date;
  }
  const multiDay = endDate !== date;
  const tl = (L) => {
    if (allDay) return t("calendar.all_day", L);
    if (noEnd || multiDay) return t("calendar.starts_at", L, { time: timeRangeLabel(start, null, L) });
    return timeRangeLabel(start, end, L);
  };
  const dateText = (L) => (multiDay ? `${dateLabel(date, L, { weekday: "short", month: "short", day: "numeric" })} – ${dateLabel(endDate, L)}` : dateLabel(date, L, { weekday: "long", month: "long", day: "numeric", year: "numeric" }));

  // flyers: shown only once the flyer check passed for this very file (data/office-flyer-review.csv); a link whose
  // address looks like a phone number (check-site reads every address in events.json) is left out
  const phoneFree = (u) => !contactHits(u, { allow }).some((h) => h.kind === "phone");
  const checked = (f) => f && httpsUrl(f.url) && f.sha256 && reviewed.has(`${f.url}|${String(f.sha256).toLowerCase()}`) && phoneFree(f.url);
  let flyer = null, pdf = "";
  for (const f of rec.flyers || []) {
    if (!checked(f)) continue;
    if (f.mime === "application/pdf") {
      if (!pdf) pdf = f.url;
      continue;
    }
    if (flyer) continue;
    const sizes = (Array.isArray(f.sizes) ? f.sizes : [])
      .filter((x) => Array.isArray(x) && +x[0] > 0 && httpsUrl(x[1]) && phoneFree(x[1]))
      .map((x) => [+x[0], x[1]])
      .sort((a, b) => a[0] - b[0]);
    const w = +f.w || 0, h = +f.h || 0;
    const all = [...sizes.filter((x) => !w || x[0] < w), ...(w ? [[w, f.url]] : [])];
    // the file shown by default: about 640 px wide (the original when no smaller copy is offered)
    const pick = (target) => (all.find((x) => x[0] >= target) || all[all.length - 1] || [w, f.url])[1];
    flyer = {
      url: all.length ? pick(640) : f.url,
      card: all.length ? pick(800) : f.url,
      srcset: all.length > 1 ? all.map((x) => `${x[1]} ${x[0]}w`).join(", ") : "",
      w, h, full: f.url,
      pdf: httpsUrl(f.pdf) && phoneFree(f.pdf) ? f.pdf : "",
    };
    if (flyer.pdf && !pdf) pdf = flyer.pdf;
  }

  const placeKnown = !!(rec.venue || rec.address || rec.city);
  const officeKeys = [office.key, ...(rec.also || []).filter((k) => offices[k] && k !== office.key)];
  const language = ["English", "Spanish", "Bilingual"].includes(rec.lang) ? rec.lang : office.row.spanish ? "Spanish" : "English";
  const format = ["In person", "Hybrid", "Virtual"].includes(rec.format) ? rec.format : "In person";
  // no place in the listing: "Place on the flyer" when the site shows its flyer, else "see the office's page";
  // an online event has no place line at all
  const noPlace = !placeKnown && format !== "Virtual" ? (flyer || pdf ? "flyer" : "site") : "";
  const ev = {
    id: rec.id, key: rec.id, slug: rec.id, url: `/calendar/central-offices/#${rec.id}`,
    office: office.key, also: officeKeys.slice(1), offices: officeKeys,
    src: httpsUrl(rec.src) || office.events_page || office.website,
    title: String(rec.title || "").slice(0, 120), title_es: String(rec.title_es || "").slice(0, 120),
    type: typ.key, typeLabel_en: typ.label_en, typeLabel_es: typ.label_es, color: typ.color, icon: typ.icon, group: typ.group,
    start, end, allDay, date, endDate, multiDay, noEnd,
    timeLabel_en: tl("en"), timeLabel_es: tl("es"), dateLabel_en: dateText("en"), dateLabel_es: dateText("es"),
    venue: rec.venue || "", address: rec.address || "", city: rec.city || "", zip: rec.zip || "",
    mapsUrl: rec.address ? mapsSearch([rec.venue, rec.address, rec.city, rec.zip].filter(Boolean).join(", ")) : "",
    noPlace, // "flyer" | "site" | "" (see above)
    format, language, cost: rec.cost || "", summary: rec.summary || "",
    flyer, pdf, hasFlyer: !!flyer,
    status: "confirmed", recurring: false, isEvent: true, isMeeting: false, districts: [], committees: [],
    flags: rec.flags || [],
  };
  ev.typeSlug = slugify(ev.type);
  ev.formatKey = FORMAT_KEY[format] || "";
  ev.langKey = LANG_KEY[language] || "";
  ev.dates = [{ start, end, allDay, multiDay, endDate, timeLabel_en: ev.timeLabel_en, timeLabel_es: ev.timeLabel_es }];
  ev.lastEnd = end;
  ev.search = globalThis.MSearch.index([
    ev.title, ev.title_es, ev.venue, ev.city, typ.label_en, typ.label_es,
    ...officeKeys.flatMap((k) => [offices[k].name_en, offices[k].name_es, offices[k].short]), SEARCH_WORDS,
  ]);
  return ev;
}

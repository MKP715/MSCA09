// Central-office events: the pure part of the importer (scripts/office-events.mjs). Everything here works on text
// that was already downloaded (or read from test/office-events/fixtures/), so it can be tested without a network.
//
//   adapters.tribe(json, opts)                 The Events Calendar REST API (oc-aa.org, asbco.org, hacoaa.org, …)
//   adapters.aanoc({ html, rss, details }, opts) NOCCO's static Hugo site: the card grid, its RSS feed, detail pages
//   adapters.tvco(pageJson, opts)              Temecula's hand-typed WordPress page (one <p> per event)
//   watchStamp(json)                           the "modified" stamp of a watched page or media list
//   filterRecords(records, { now })            drops past events, business meetings, ongoing listings and series
//   isBusiness(rec), mapType(rec, types)       the meetings filter and the event type
//   cleanRecord(rec, ctx)                      anonymity cleaning (idempotent): contact details, names, length caps
//   settleOffice(…), buildMirror(…)            failure handling, the shrink guard and the committed mirror
//   htmlToText, normTitle, recordId, stableStringify, cleanUrl, recordDays, isPast
//
// Every adapter returns { records, stats } where a record has the shape of an event in
// data/central-office-events.json (see blankRecord) and stats has { read, recurring, meetings, unparsed, … }.
// opts for every adapter: { office, host, now, lang, options, prev (Map id → previous record), state, force }.
//
// A record (one event; times in America/Los_Angeles):
//   start:   "2026-11-14T11:00:00-08:00" (timed) | "2026-11-14" (all day: its first day)
//   end:     ISO with offset | "" (all day, or no end time given: flag no-end-time)
//   endDate: the last day, inclusive: always set for all-day events; set for timed ones that run over several days
//            (not for one that ends in the small hours of the next day, such as a dance until 2 am); "" otherwise
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { decodeEntities, unwrapGoogleUrl, slugify, fixLinks } from "./calendar.js";
import { contactHits, titleRisk, slugRisk, slugForms, summaryRisk, normalizeText, loadAllow, ID_LABEL } from "./contact-rules.js";
import { shortenNames, nameHits } from "./names.js";

export const TZ = "America/Los_Angeles";
/** The types an imported event may get (each must exist in data/event-types.csv; otherwise it becomes Event). */
export const TYPES = ["YPAA", "Convention", "Forum", "History", "Workshop", "Social", "Event"];
export const FORMATS = ["In person", "Hybrid", "Virtual"];
export const LANGS = ["English", "Spanish", "Bilingual"];
export const SUMMARY_MAX = 300;
export const TITLE_MAX = 120;

/* ------------------------------------------------------------------ small helpers */

const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const sha1 = (s) => createHash("sha1").update(String(s)).digest("hex");
const one = (s) => decodeEntities(String(s ?? "")).replace(/[\s   ]+/g, " ").replace(/[​-‍﻿]/g, "").trim();
const lf = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
const squash = (s) => lf(s).replace(/\s+/g, " ").trim();
const uniq = (a) => [...new Set(a)];
export const hostOf = (u) => String(u || "").toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:?#].*$/, "").replace(/^www\./, "");

/** "k=v; k=v" (the options column of data/office-event-sources.csv) → { k: "v" }. */
export function parseOptions(cell) {
  const out = {};
  for (const part of String(cell || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) {
      if (part.trim()) out[part.trim().toLowerCase()] = "yes";
      continue;
    }
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}
const optList = (v) => String(v || "").split(/\s*,\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const optYes = (v) => /^(y|yes|true|1|on)$/i.test(String(v || "").trim());

/** A moment (ISO text, Date, Luxon DateTime or nothing = now) in Pacific time. */
export function toPT(now) {
  if (now == null || now === "") return DateTime.now().setZone(TZ);
  if (DateTime.isDateTime(now)) return now.setZone(TZ);
  if (now instanceof Date) return DateTime.fromJSDate(now).setZone(TZ);
  return DateTime.fromISO(String(now), { setZone: true }).setZone(TZ);
}
/** Today in Pacific time, yyyy-mm-dd. */
export const todayOf = (now) => toPT(now).toISODate();
const isoOut = (dt) => dt.setZone(TZ).toISO({ suppressMilliseconds: true });
const addDays = (day, n) => DateTime.fromISO(day, { zone: TZ }).plus({ days: n }).toISODate();
export const daysBetween = (a, b) => Math.round(DateTime.fromISO(b, { zone: TZ }).diff(DateTime.fromISO(a, { zone: TZ }), "days").days);

function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
/** JSON with every object's keys sorted, one space of indent and a final newline: the same data, the same bytes. */
export function stableStringify(x) {
  return JSON.stringify(sortKeys(x), null, 1) + "\n";
}

/** A key made from the hash of some text: "e" and 10 letters a-p (the hex digits 0-f as letters), so that an id made
 *  from it can never look like a phone number or any other personal detail. */
export const hashKey = (s) => `e${sha1(s).slice(0, 10).replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)])}`;

/** "co-<office>-<key>", the key made of a-z, 0-9 and "-". Ids are public (the mirror, the site's pages, override
 *  keys): a key that would read as a personal detail in any way it may be read as words (slugRisk: "co-x-714-555-0142",
 *  "potluck-pw-774411", "ana-r-sobriety-date-3-3-1990" as "… 3/3/1990", "p-w-774411" as "PW 774411") is replaced by
 *  its hashKey. now: which year is this year (a sobriety date is from 1940 to last year). */
export function recordId(office, key, { now } = {}) {
  let k = fold(String(key ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
  if (slugRisk(k, { now }).length) k = hashKey(k);
  return `co-${office}-${k}`;
}
// the parts of an address's path, decoded ("/event/ana-r-sober-since-90/" → ["event", "ana-r-sober-since-90"])
function pathParts(url) {
  let path = "";
  try {
    path = new URL(String(url || "")).pathname;
  } catch {
    path = String(url || "");
  }
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}
// a part's words with capitals, as a name is written ("maria-exampleton" → "Maria Exampleton")
const nameWords = (p) => p.replace(/[-_.+]+/g, " ").replace(/(^|\s)(\p{Ll})/gu, (m, s, ch) => s + ch.toUpperCase());
/** Does this page address carry a personal detail in its path, each part read as words as slugRisk reads an id (also
 *  as WordPress writes a title: its apostrophes and "@" dropped, "ana-r-sober-since-90", "picnic-rsvp-mariagmail-com"),
 *  or a full name? (An event page's address is made from its title: "…/events/ana-r-sobriety-date-3-3-1990/",
 *  "…/event/speaker-maria-exampleton/"; cleanRecord shortens the name in the title, not in the address.) */
export function addressRisky(url, { allow, officeHost, now } = {}) {
  return pathParts(url).some((p) => slugRisk(p, { allow, officeHost, now }).length > 0 || nameHits(nameWords(p)).length > 0);
}
/** What an event page's address carries, by kind ([] when it may be shown): its host, query and fragment read with
 *  contactHits; its path read with contactHits for phone numbers and e-mail addresses ("…/maria@gmail.com/") and as
 *  words every way (addressRisky: "address"). The words of a path are read as words, so "…/event/zip-code-92590/" is
 *  the title "Zip code: 92590", not a code. */
export function pageRisk(url, { allow, officeHost, now } = {}) {
  const u = String(url || "");
  const opts = { allow: allow || loadAllow(), officeHost, now };
  let rest = "";
  let path = u;
  try {
    const x = new URL(u);
    rest = `${x.protocol}//${x.host}/${x.search}${x.hash}`;
    path = x.pathname;
  } catch {
    /* not an address: all of it is read as a path */
  }
  const kinds = [...contactHits(rest, opts), ...contactHits(path, opts).filter((h) => h.kind === "phone" || h.kind === "email")].map((h) => h.kind);
  if (addressRisky(u, opts)) kinds.push("address");
  return kinds;
}
// what a flyer's file name (and folders) may not carry, read as words: a meeting number is not one of them, because
// camera and scanner names are long numbers ("doc01079620260909101242-pdf.jpg", "20260927_210553.jpg")
const FLYER_KINDS = new Set(["sobriety", "password", "email"]);
/** What a flyer's address carries, by kind ([] when it may be kept): the address read with contactHits (a phone
 *  number, a Zoom link…), and each part of its path read as words every way (slugForms) for a sobriety date, a code or
 *  an e-mail address ("…/Ana-R-sober-since-3-3-1990.jpg", "…/Potluck-PW-774411.pdf"), or a full name. */
export function flyerRisk(url, { allow, officeHost, now } = {}) {
  const opts = { allow: allow || loadAllow(), officeHost, now };
  const kinds = contactHits(String(url || ""), opts).map((h) => h.kind);
  for (const p of pathParts(url)) {
    for (const form of slugForms(p, opts)) for (const h of titleRisk(form, opts)) if (FLYER_KINDS.has(h.kind)) kinds.push(h.kind);
    if (nameHits(nameWords(p)).length) kinds.push("full name");
  }
  return kinds;
}

/** A title for comparisons: no accents, capitals, entities or punctuation. */
export function normTitle(t) {
  return fold(one(t)).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** HTML (an event description, an RSS item) → plain text, one line per paragraph or <br>. Links keep their text
 *  only (the only link an imported event carries is the office's own event page); pictures are dropped. */
export function htmlToText(html) {
  let t = lf(html);
  if (!/<[a-z!/][^>]*>/i.test(t)) return decodeEntities(t).split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  t = t.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/\n/g, " ");
  t = t.replace(/<img\b[^>]*>/gi, " ");
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|blockquote|pre|section|article|figure|figcaption|table|header|footer)>/gi, "\n");
  t = t.replace(/<li\b[^>]*>/gi, "\n• ").replace(/<\/t[dh]>/gi, " ").replace(/<[^>]+>/g, "");
  t = decodeEntities(t).replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A link as the office gave it, without trackers: Google's and Proofpoint's wrappers undone, utm_*, fbclid, gclid
 *  and mc_* removed. "" when it is not a web address. */
export function cleanUrl(u) {
  let s = decodeEntities(String(u ?? "").trim());
  if (!s) return "";
  s = unwrapGoogleUrl(s);
  const v3 = /^https?:\/\/urldefense\.com\/v3\/__(.+?)__;.*$/i.exec(s);
  if (v3) s = v3[1];
  const v2 = /^https?:\/\/urldefense\.proofpoint\.com\/v2\/url\?(.*)$/i.exec(s);
  if (v2) {
    const q = new URLSearchParams(v2[1]).get("u");
    // Proofpoint v2: "-" escapes a character as two hex digits, "_" stands for "/"
    if (q) s = q.replace(/_/g, "/").replace(/-([0-9A-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
  }
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    const x = new URL(s);
    const drop = [...x.searchParams.keys()].filter((k) => /^(utm_|mc_)|^(fbclid|gclid|dclid|msclkid|_hsenc|_hsmi)$/i.test(k));
    if (!drop.length) return s;
    for (const k of drop) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return "";
  }
}

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", pdf: "application/pdf" };
/** The media type a file name says. */
export function mimeOf(url) {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(url || ""));
  return MIME[(m ? m[1] : "").toLowerCase()] || "";
}
/** A flyer entry of the mirror. */
export function flyer(o) {
  return { url: o.url, sha256: o.sha256 || "", w: Number(o.w) || 0, h: Number(o.h) || 0, mime: o.mime || mimeOf(o.url), sizes: o.sizes || [], pdf: o.pdf || "" };
}
const sizesOf = (list, not) =>
  uniq(list.filter(([w, u]) => w > 0 && u && u !== not).map(([w, u]) => `${w} ${u}`))
    .map((x) => [Number(x.slice(0, x.indexOf(" "))), x.slice(x.indexOf(" ") + 1)])
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));

const httpsOf = (u) => cleanUrl(String(u ?? "").trim().replace(/^http:\/\//i, "https://"));
/** The Events Calendar's `image` object → a flyer (http:// addresses become https://: the site shows https only). A PDF
 *  flyer comes as WordPress's "-pdf.jpg" preview; its `pdf` is the original. */
export function wpImageFlyer(img) {
  if (!img || typeof img !== "object" || !img.url) return null;
  const url = httpsOf(img.url);
  if (!url) return null;
  if (/\.pdf$/i.test(url)) return flyer({ url, mime: "application/pdf", pdf: url });
  const ext = String(img.extension || "").toLowerCase();
  const isPdf = ext === "pdf" || /-pdf\.jpe?g$/i.test(url);
  const sizes = [];
  for (const k of ["medium", "medium_large", "large", "1536x1536"]) {
    const s = img.sizes && img.sizes[k];
    if (s && s.url && Number(s.width)) sizes.push([Number(s.width), httpsOf(s.url)]);
  }
  return flyer({
    url,
    w: img.width,
    h: img.height,
    mime: isPdf ? "image/jpeg" : mimeOf(url) || (img.sizes && img.sizes.full && img.sizes.full["mime-type"]) || "",
    sizes: sizesOf(sizes, url),
    pdf: isPdf ? url.replace(/-pdf\.jpe?g$/i, ".pdf") : "",
  });
}

// An attribute of a tag. NOCCO's theme writes class="…"href="…" with no space between, so the name may follow a quote.
function attrOf(tag, name) {
  const r = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return r ? decodeEntities(r[1] ?? r[2] ?? r[3] ?? "") : "";
}
const absolute = (u, base) => {
  try {
    return new URL(u, base).toString();
  } catch {
    return "";
  }
};

/** Every <img> of a description that is a file uploaded to the office's own WordPress (/wp-content/uploads/), in
 *  document order: the original (the src without "-WxH") plus its resized copies from srcset. Other hosts (mail
 *  proxies such as ecp.yusercontent.com) are skipped. */
export function descriptionFlyers(html, host) {
  const out = [];
  const own = hostOf(host);
  for (const m of lf(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attrOf(tag, "src") || attrOf(tag, "data-src");
    const abs = cleanUrl(absolute(src, `https://${own}/`).replace(/^http:/i, "https:"));
    if (!abs || hostOf(abs) !== own || !/\/wp-content\/uploads\//i.test(abs)) continue;
    const orig = abs.replace(/-\d+x\d+(?=\.[a-z0-9]+(?:[?#]|$))/i, "");
    if (out.some((f) => f.url === orig)) continue;
    const set = attrOf(tag, "srcset")
      .split(/,\s+/)
      .map((p) => /^(\S+)\s+(\d+)w$/i.exec(p.trim()))
      .filter(Boolean)
      .map((x) => [Number(x[2]), cleanUrl(absolute(x[1], `https://${own}/`).replace(/^http:/i, "https:"))])
      .filter(([, u]) => u && hostOf(u) === own);
    let w = Number(attrOf(tag, "width")) || 0;
    let h = Number(attrOf(tag, "height")) || 0;
    if (orig !== abs) {
      // the src was a resized copy: the original's width from srcset, the height by the same ratio
      const big = set.find(([, u]) => u === orig);
      if (big && w && h) {
        h = Math.round((h * big[0]) / w);
        w = big[0];
      } else w = h = 0;
    }
    out.push(flyer({ url: orig, w, h, sizes: sizesOf(set, orig) }));
  }
  return out;
}

/* ------------------------------------------------------------------ dates */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const monthNo = (s) => MONTHS.indexOf(String(s).slice(0, 3).toLowerCase()) + 1;
const ymd = (y, m, d) => {
  const dt = DateTime.fromObject({ year: Number(y), month: Number(m), day: Number(d) }, { zone: TZ });
  return dt.isValid ? dt.toISODate() : "";
};
const hour24 = (h, mer) => (Number(h) % 12) + (String(mer).toLowerCase() === "p" ? 12 : 0);
const at = (day, h, mi) => DateTime.fromISO(day, { zone: TZ }).set({ hour: h, minute: Number(mi || 0) });
/** endDate of a timed event (s, e: DateTimes): its last day when it runs over several days; "" when it ends the same
 *  day or in the small hours (up to 6 am) of the next. */
function timedEndDate(s, e) {
  if (!s || !e || e <= s) return "";
  const last = e.minus({ minutes: 1 }).setZone(TZ);
  const first = s.setZone(TZ).toISODate();
  if (last.toISODate() <= first) return "";
  if (last.toISODate() === addDays(first, 1) && e.setZone(TZ).hour * 60 + e.setZone(TZ).minute <= 6 * 60) return "";
  return last.toISODate();
}

// One hand-typed time: "6", "6:30", "6pm", "6:30 p.m.", "noon", "midnight", "mediodía".
const T_ONE = `(?:\\b(noon|midnight|mediod[ií]a|medianoche)\\b|(?<![\\w:])(\\d{1,2})(?::([0-5]\\d))?(?:\\s*([ap])\\.?\\s*m\\b\\.?)?)`;
// A time or a range of two ("2-4pm", "11:30 - 1 PM", "7am to 1am", "noon–3pm"). Global: matchAll.
const TIME_RANGE = new RegExp(`${T_ONE}(?:\\s*(?:[-–—]|to|until|till)\\s*${T_ONE})?`, "gi");
// Text that looks like a time even though it cannot be read ("@ 6-9", "@ 6", "at 6", "6:00"); not "at 27732 Encanto Dr"
const TIME_LIKE = /\d\s*(?:[-–—]|to\b)\s*\d|\b(?:noon|midnight|mediod[ií]a|medianoche)\b|\d\s*[ap]\.?\s*m\b|\d:\d\d|@\s*\d|\bat\s+\d{1,2}(?![\d,])(?!\s+[A-Z])/i;
const timePart = (word, h, mi, mer) =>
  word || h ? { word: (word || "").toLowerCase(), h: Number(h), mi: Number(mi || 0), colon: mi != null, mer: (mer || "").toLowerCase() } : null;
// minutes after midnight of a part whose half of the day is known (noon 720; midnight 0, or 1440 as an end); null when
// it is not known; NaN when it cannot be a time ("13pm")
function minutesOf(p, asEnd = false) {
  if (p.word) return /^(?:noon|mediod)/.test(p.word) ? 720 : asEnd ? 1440 : 0;
  if (p.mer) return p.h >= 1 && p.h <= 12 ? hour24(p.h, p.mer) * 60 + p.mi : NaN;
  if (p.colon && p.h >= 13 && p.h <= 23) return p.h * 60 + p.mi; // "18:00", a 24-hour time: nothing to guess
  return null;
}
// a part without am/pm next to one with it: first in the same half of the day as `other`, then in the other half; the
// first that keeps start < end. null when neither does ("9pm-1": the next day's 1 am or 1 pm? not guessed).
function settle(p, other, isStart) {
  if (!(p.h >= 1 && p.h <= 12)) return null;
  for (const half of other >= 720 ? [12, 0] : [0, 12]) {
    const m = ((p.h % 12) + half) * 60 + p.mi;
    if (isStart ? m < other : m > other) return m;
  }
  return null;
}
/**
 * The time (or times) typed after a date: undefined when there is none, null when something there looks like a time
 * but cannot be read (the entry is then counted as unparsed, never guessed, never made all-day), or { s, e } in minutes
 * after midnight (e = null without an end; e may be 1440 = midnight, and is the next day when e <= s). A start without
 * am/pm takes the end's half of the day, or the other half when that would put the start after the end ("2-4pm" →
 * 14:00–16:00, "11:30-1pm" → 11:30–13:00), and an end without it the start's; noon is 12 pm, midnight 12 am. Only when
 * both say am/pm may the end be earlier than the start: it is the next day ("7am-1am").
 */
export function readTimes(text) {
  const t = String(text || "");
  for (const m of t.matchAll(TIME_RANGE)) {
    const a = timePart(m[1], m[2], m[3], m[4]);
    const b = timePart(m[5], m[6], m[7], m[8]);
    let s = minutesOf(a);
    let e = b ? minutesOf(b, true) : null;
    if (s === null && !b) continue; // a bare number ("Ages 18", "Room 2"): TIME_LIKE decides below
    if (s === null && e === null) return null; // "6-9": am or pm?
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    if (!b) return { s, e: null };
    if (s === null) s = settle(a, e, true);
    else if (e === null) e = settle(b, s, false);
    if (s === null || e === null) return null;
    return { s, e };
  }
  return TIME_LIKE.test(t) ? null : undefined;
}
// a day (yyyy-mm-dd) at a number of minutes after its midnight (1440 and more: the next day), in Pacific time
const atMinutes = (day, min) => (min >= 1440 ? at(addDays(day, 1), Math.floor((min - 1440) / 60), (min - 1440) % 60) : at(day, Math.floor(min / 60), min % 60));

/** [first day, last day] of a record in Pacific time (yyyy-mm-dd), ["", ""] when it has no start. */
export function recordDays(rec) {
  if (!rec || !rec.start) return ["", ""];
  if (rec.allDay) {
    const f = String(rec.start).slice(0, 10);
    return [f, rec.endDate && rec.endDate > f ? rec.endDate : f];
  }
  const s = DateTime.fromISO(rec.start, { setZone: true }).setZone(TZ);
  if (!s.isValid) return ["", ""];
  const f = s.toISODate();
  let l = rec.endDate || "";
  if (!l && rec.end) {
    const e = DateTime.fromISO(rec.end, { setZone: true }).setZone(TZ);
    if (e.isValid && e > s) l = e.minus({ minutes: 1 }).toISODate();
  }
  return [f, l && l > f ? l : f];
}
/** Has the record ended before `today` (yyyy-mm-dd, Pacific)? An event earlier today still counts as today's. */
export const isPast = (rec, today) => {
  const [, last] = recordDays(rec);
  return !last || last < today;
};
const startMs = (rec) => (rec.allDay ? DateTime.fromISO(String(rec.start).slice(0, 10), { zone: TZ }) : DateTime.fromISO(rec.start, { setZone: true })).toMillis() || 0;
/** Events in the mirror's order: by start (as an instant), then by id. */
export const byStart = (a, b) => startMs(a) - startMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/* ------------------------------------------------------------------ the record */

/** An empty event record with every field of the mirror. */
export function blankRecord(o = {}) {
  return {
    id: "", office: "", also: [], src: "", title: "", title_es: "", lang: "English", type: "Event", cats: [],
    start: "", end: "", allDay: false, endDate: "", venue: "", address: "", city: "", zip: "",
    format: "In person", cost: "", summary: "", flyers: [], flags: [], srcHash: "",
    ...o,
  };
}
const RECORD_KEYS = Object.keys(blankRecord());

/* ------------------------------------------------------------------ meetings filter and type */

// "Inventario de Grupo" / "Group Inventory" (a group's business inventory) is a meeting; a step-four inventory
// workshop ("Taller de Inventario", "Inventory Workshop") is not caught here and EVENT_RE keeps it anyway. So are the
// intergroup, GSR and district meetings, in both languages ("Reunión de Intergrupo", "GSR Meeting", "Reunión de RSG",
// "District 12 Meeting", "Distrito 12 reunión"); "District 12 Traditions Day" is an event.
export const BUSINESS_RE =
  /\b(business|steering|board|committee|comit[eé]|service (board|committee|meeting)|intergroup (?:rep(?:resentative)?s? )?meeting|igr meeting|csr|gsr school|escuela de rsg|study and sharing|junta( de servicio)?|reuni[oó]n de (servicio|interoficinas|negocios|trabajo)|inter ?oficinas|cambio de mesa|planificadas?|ro[il] de visitas?|group conscience|conciencia (?:de )?grupo|conciencia grupal|group inventory|inventario (?:de(?:l)? )?grupo|inventario grupal|reuni[oó]n (?:mensual )?(?:de(?:l)? |de los )?(?:intergrupo|intergrupal|rsgs?|distrito)|gsr'?s? (?:monthly )?meeting|district(?: \d+)? (?:business |monthly |service |general )?meeting|distrito \d+:? (?:reuni[oó]n|junta))\b/i;
export const EVENT_RE =
  /workshop|taller|banquet|dinner|picnic|party|fiesta|dance|baile|convention|convenci|congreso|round-?up|anniversary|aniversario|bingo|cook-?off|social|open house|servathon|retreat|forum|foro|heritage|al[ck]athon|marat/i;
const titleText = (rec) => [rec.title, rec.title_es].filter(Boolean).join(" ");

/** A service business meeting (not an event): its title says so and does not also name an event. */
export function isBusiness(rec) {
  const t = titleText(rec);
  const f = fold(t);
  return (BUSINESS_RE.test(t) || BUSINESS_RE.test(f)) && !EVENT_RE.test(t) && !EVENT_RE.test(f);
}

const TYPE_RULES = [
  ["YPAA", /ypaa|young people|jovenes/i, []],
  ["Convention", /convenci|convention|congreso|round-?up|conference|conferencia|retreat|retiro|workshop weekend/i, ["conventions", "convention", "conference", "roundup", "retreats", "workshop-weekend"]],
  ["Forum", /forum|foro/i, []],
  ["History", /heritage|history|historia|archiv/i, []],
  // "panel" alone would make "MSCA Area 09 Panel 79 Servathon" a workshop: a panel number is not a panel discussion
  ["Workshop", /workshop|taller|traditions? day|step study|seminar|panel discussion|\bpanel\b(?! \d)|mesas de trabajo/i, ["workshops", "panel"]],
  ["Social", /banquet|dinner|cena|picnic|bingo|party|fiesta|dance|baile|bowling|chili|cook-?off|ice cream|holiday|navidad|christmas|thanksgiving|halloween|al[ck]athon|marat|aniversario|anniversary|open house|casa abierta|social|potluck|convivio/i, []],
];
/** The event type: the first rule that matches the title or the source categories; Event when none does, or when the
 *  type is not one of `types` (the keys of data/event-types.csv). */
export function mapType(rec, types = TYPES) {
  const keys = types instanceof Set ? types : new Set(Array.isArray(types) ? types : Object.keys(types || {}));
  const t = fold(titleText(rec));
  const cats = (rec.cats || []).map((c) => String(c).toLowerCase());
  for (const [type, re, catList] of TYPE_RULES) {
    if (re.test(t) || cats.some((c) => catList.includes(c))) return keys.has(type) ? type : "Event";
  }
  return "Event";
}

/* ------------------------------------------------------------------ titles */

const KEEP_CAPS = /^(?:AA|A\.A\.?|MSCA|H&I|HI|YPAA|[A-Z]*YPAA|NOCCO|HACO|ASBCO|TVCO|OIAA|OC|CA|USA|EE\.?UU\.?|DCM|DCMC|GSR|RSG|MCD|CMCD|PRAASA|IGR|PI|CPC|LGBTQ\+?|BBQ)$/;
const ROMAN = /^(?=[MDCLXVI]{2,})M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const NOT_ROMAN = new Set(["MI", "DI", "LI", "MID", "DIM", "MIX", "CIVIL", "LID", "VID"]);
const SMALL = new Set("a al and at by con de del e el en for in la las los of on or para por the to y".split(" "));
/** Is (nearly) every letter of the title a capital? */
export function isAllCaps(t) {
  const letters = String(t || "").match(/\p{L}/gu) || [];
  if (letters.length < 4) return false;
  return letters.filter((c) => /\p{Lu}/u.test(c)).length / letters.length > 0.85;
}
/** "32 ANIVERSARIO DEL GRUPO AA 12 PASOS" → "32 Aniversario del Grupo AA 12 Pasos" (AA, MSCA, H&I, YPAA and Roman numerals stay). */
export function titleCase(t) {
  let first = true;
  return String(t || "")
    .split(/(\s+)/)
    .map((tok) => {
      if (!tok || /^\s+$/.test(tok)) return tok;
      return tok
        .split(/([:/–—-])/)
        .map((piece) => {
          if (/^[:/–—-]$/.test(piece)) {
            if (piece === ":") first = true;
            return piece;
          }
          const m = /^([^\p{L}\d]*)([\p{L}\d][\p{L}\d.&'’+]*?)([^\p{L}\d]*)$/u.exec(piece);
          if (!m) return piece;
          const [, pre, word, post] = m;
          let w;
          if (KEEP_CAPS.test(word) || (ROMAN.test(word) && !NOT_ROMAN.has(word))) w = word;
          else if (!first && SMALL.has(word.toLowerCase())) w = word.toLowerCase();
          else w = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          first = false;
          return pre + w + post;
        })
        .join("");
    })
    .join("");
}

const MONTHS_ES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const MES = MONTHS_ES.split("|").filter((m) => m !== "setiembre");
const TITLE_TAILS = [
  /\s+\d{1,2}\/\d{1,2}\/\d{2,4}.*$/,
  /\s+(?:de|from)\s+(?:la\s+)?[Il\d]{1,2}:\d{2}.*$/i,
  new RegExp(`\\s+\\d{1,2}(?:\\s*,\\s*\\d{1,2})*\\s+de\\s+(?:${MONTHS_ES}).*$`, "i"),
];
// The dates a title's tail states ("11/01/2026", "27,28,29 de noviembre del 2026") → [yyyy-mm-dd …]
function tailDates(tail, year) {
  const out = [];
  for (const m of tail.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    out.push(ymd(y, m[1], m[2]));
  }
  const es = new RegExp(`(\\d{1,2}(?:\\s*,\\s*\\d{1,2})*)\\s+de\\s+(${MONTHS_ES})(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "i").exec(tail);
  if (es) {
    const month = /setiembre/i.test(es[2]) ? 9 : MES.indexOf(es[2].toLowerCase()) + 1;
    for (const d of es[1].split(/\s*,\s*/)) out.push(ymd(es[3] || year, month, d));
  }
  return out.filter(Boolean);
}
/**
 * Riverside's titles carry their own date and time ("… 11/01/2026 DE LA 1:00PM 9:00pm"): the tail is cut off, an
 * ALL-CAPS title gets title case, and `mismatch` says whether the dates in the tail contradict the structured dates
 * [first, last] (the structured date is trusted; the flag is for the report only).
 */
export function cleanupTitle(title, first = "", last = "") {
  let t = one(title);
  let tail = "";
  for (const re of TITLE_TAILS) {
    const m = re.exec(t);
    if (m && m.index > 0) {
      tail = m[0] + " " + tail;
      t = t.slice(0, m.index);
    }
  }
  t = t.replace(/[\s,;:–—-]+$/, "").trim() || one(title);
  if (isAllCaps(t)) t = titleCase(t);
  const dates = tail ? tailDates(tail, (first || "").slice(0, 4) || DateTime.now().year) : [];
  const mismatch = dates.length > 0 && !!first && (dates[0] !== first || dates[dates.length - 1] !== (last || first));
  return { title: t, mismatch };
}

/* ------------------------------------------------------------------ filters */

/**
 * The records the site may show: drops what has ended (before today, Pacific), business meetings (isBusiness),
 * ongoing listings (a timed entry over more than 7 days, such as a weekly meeting posted as one long event) and
 * series (a title that appears 3 times or more). → { kept, dropped: { past, meetings, ongoing, series } }
 */
export function filterRecords(records, { now } = {}) {
  const today = todayOf(now);
  const dropped = { past: 0, meetings: 0, ongoing: 0, series: 0 };
  const counts = new Map();
  for (const r of records) counts.set(normTitle(r.title), (counts.get(normTitle(r.title)) || 0) + 1);
  const kept = [];
  for (const r of records) {
    if (isPast(r, today)) dropped.past++;
    else if (isBusiness(r)) dropped.meetings++;
    else if (!r.allDay && r.end && DateTime.fromISO(r.end, { setZone: true }).diff(DateTime.fromISO(r.start, { setZone: true }), "days").days > 7) dropped.ongoing++;
    else if (counts.get(normTitle(r.title)) >= 3) dropped.series++;
    else kept.push(r);
  }
  return { kept, dropped };
}

/* ------------------------------------------------------------------ places */

const sameish = (a, b) => {
  const x = fold(a).toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = fold(b).toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!x && !!y && (x === y || y.startsWith(x) || x.startsWith(y));
};
/** "2220 Winston Rd, Anaheim, CA 92806" → { venue, address, city, zip }; "Unity Hall, 27732 Encanto Dr., Menifee" gives
 *  the venue too. A line it cannot split stays whole in address. */
export function splitAddress(line) {
  let s = one(line).replace(/,?\s*(?:United States|USA)$/i, "");
  let venue = "";
  const lead = /^([^,\d]+),\s*(\d.*)$/.exec(s);
  if (lead && /,/.test(lead[2])) {
    venue = lead[1].trim();
    s = lead[2];
  }
  if (!s) return { venue, address: "", city: "", zip: "" };
  const m = /^(.*?),\s*([^,]+?),?\s+(?:CA|California)\.?(?:\s+(\d{5}))?(?:-\d{4})?$/i.exec(s);
  if (m) return { venue, address: m[1].trim(), city: m[2].trim(), zip: m[3] || "" };
  const n = /^(.*?),\s*([^,\d]+?)$/.exec(s);
  if (n && /\d/.test(n[1])) return { venue, address: n[1].trim(), city: n[2].trim(), zip: "" };
  return { venue, address: s, city: "", zip: "" };
}
const HYBRID = /\bh[ií]brid[oa]?\b|\bhybrid\b/i;
/** "My Safe Harbor – Hybrid Event" → { venue: "My Safe Harbor", hybrid: true } */
function venueFormat(venue) {
  const v = one(venue);
  if (!HYBRID.test(v)) return { venue: v, hybrid: false };
  return { venue: v.replace(/\s*[–—(-]?\s*\(?\s*(?:a\s+)?h[ií]brid[oa]?(?:\s+event[o]?)?\s*\)?\s*$/i, "").replace(/\s*[–—-]\s*hybrid event\s*/i, " ").trim(), hybrid: true };
}

/* ------------------------------------------------------------------ adapter: The Events Calendar (tribe) */

const sourceHash = (o) => sha1(stableStringify(o));
function wpTime(utc, local) {
  if (utc) {
    const d = DateTime.fromSQL(String(utc), { zone: "utc" });
    if (d.isValid) return d.setZone(TZ);
  }
  if (local) {
    // never the feed's `timezone`: ASBCO's is the fixed offset "UTC-7" all year
    const d = DateTime.fromSQL(String(local), { zone: TZ });
    if (d.isValid) return d;
  }
  return null;
}

function tribeRecord(ev, opts) {
  const o = opts.options || {};
  const flags = [];
  const allDay = ev.all_day === true || ev.all_day === "true" || ev.all_day === 1;
  let start = "";
  let end = "";
  let endDate = "";
  if (allDay) {
    start = String(ev.start_date || "").slice(0, 10);
    endDate = String(ev.end_date || ev.start_date || "").slice(0, 10);
    if (!endDate || endDate < start) endDate = start;
  } else {
    const s = wpTime(ev.utc_start_date, ev.start_date);
    const e = wpTime(ev.utc_end_date, ev.end_date);
    if (s) start = isoOut(s);
    if (s && e && e > s) {
      end = isoOut(e);
      endDate = timedEndDate(s, e);
    }
    if (s && !end) flags.push("no-end-time");
  }
  const v = ev.venue && typeof ev.venue === "object" && !Array.isArray(ev.venue) ? ev.venue : {};
  let venue = one(v.venue);
  let address = one(v.address);
  let city = one(v.city);
  let zip = one(v.zip);
  const place = [venue, address, city].filter(Boolean).join(" ");
  if (!place || /^(?:ca|california)$/i.test(place)) {
    venue = address = city = zip = "";
    flags.push("place-on-flyer");
  }
  if (venue && address && sameish(venue, address)) venue = "";
  const vf = venueFormat(venue);
  venue = vf.venue;
  const virtual = ev.is_virtual === true || ev.is_virtual === "true";
  const format = virtual ? (venue || address ? "Hybrid" : "Virtual") : vf.hybrid ? "Hybrid" : "In person";
  let cost = one(ev.cost);
  const sym = one(ev.cost_details && ev.cost_details.currency_symbol);
  if (!cost && /^\$\s?\d/.test(sym)) cost = sym;
  let summary = String(o.description || "").toLowerCase() === "off" ? "" : htmlToText(ev.description || "");
  if (summary.replace(/\s+/g, "").length < 20) summary = "";
  const flyers = [];
  const fi = wpImageFlyer(ev.image);
  if (fi) flyers.push(fi);
  if (String(o.flyers || "").toLowerCase() === "description") {
    for (const f of descriptionFlyers(ev.description || "", opts.host)) if (!flyers.some((x) => x.url === f.url)) flyers.push(f);
  }
  let title = one(ev.title);
  const rec = blankRecord({
    id: recordId(opts.office, ev.id, { now: opts.now }),
    office: opts.office,
    src: cleanUrl(ev.url),
    lang: opts.lang || "English",
    cats: opts.cats || [],
    start, end, allDay, endDate, venue, address, city, zip, format, cost, summary, flyers,
  });
  const [first, last] = recordDays(rec);
  if (optYes(o.title_cleanup)) {
    const c = cleanupTitle(title, first, last);
    title = c.title;
    if (c.mismatch) flags.push("title-date-mismatch");
  } else if (optYes(o.title_case) && isAllCaps(title)) title = titleCase(title);
  rec.title = title;
  rec.flags = flags;
  rec.srcHash = sourceHash({
    id: ev.id, url: ev.url || "", title: ev.title || "", description: o.description === "off" ? "" : lf(ev.description || ""),
    start_date: ev.start_date || "", end_date: ev.end_date || "", utc_start_date: ev.utc_start_date || "", utc_end_date: ev.utc_end_date || "",
    all_day: !!allDay, venue: { venue: v.venue || "", address: v.address || "", city: v.city || "", zip: v.zip || "" },
    cost: ev.cost || "", cost_symbol: sym, image: (ev.image && ev.image.url) || "", categories: opts.cats || [], is_virtual: !!virtual,
  });
  return rec;
}

// Sur de la Bahía stores a 3-day convention as 3 entries with the same title: one record, first start to last end.
function mergeDays(recs) {
  const out = [];
  for (const r of [...recs].sort(byStart)) {
    const key = normTitle(r.title);
    const prev = [...out].reverse().find((x) => normTitle(x.title) === key);
    if (prev) {
      const [, pl] = recordDays(prev);
      const [rf, rl] = recordDays(r);
      if (rf === pl || rf === addDays(pl, 1)) {
        if (prev.allDay && r.allDay) prev.endDate = rl > pl ? rl : pl;
        else {
          if (r.allDay) prev.end = isoOut(DateTime.fromISO(rl, { zone: TZ }).endOf("day").startOf("minute"));
          else if (r.end) prev.end = r.end;
          prev.endDate = rl > recordDays(prev)[0] ? rl : "";
          if (prev.end) prev.flags = prev.flags.filter((f) => f !== "no-end-time");
        }
        for (const f of r.flyers) if (!prev.flyers.some((x) => x.url === f.url)) prev.flyers.push(f);
        if (!prev.summary) prev.summary = r.summary;
        for (const k of ["venue", "address", "city", "zip", "cost"]) if (!prev[k]) prev[k] = r[k];
        prev.flags = uniq([...prev.flags, ...r.flags]);
        if (prev.address || prev.city) prev.flags = prev.flags.filter((f) => f !== "place-on-flyer");
        prev.cats = uniq([...prev.cats, ...r.cats]).sort();
        prev.srcHash = sha1(prev.srcHash + r.srcHash);
        continue;
      }
    }
    out.push({ ...r, flyers: [...r.flyers], flags: [...r.flags], cats: [...r.cats] });
  }
  return out;
}

function tribe(json, opts = {}) {
  const o = opts.options || {};
  const pages = (Array.isArray(json) ? json : [json]).filter((p) => p && typeof p === "object");
  const events = pages.flatMap((p) => (Array.isArray(p.events) ? p.events : []));
  const host = hostOf(opts.host || (events[0] && events[0].url) || "");
  const stats = { read: events.length, recurring: 0, meetings: 0, unparsed: 0 };
  const dropCats = optList(o.drop_categories);
  const dropOnly = optList(o.drop_only);
  let recs = [];
  const seen = new Set();
  for (const ev of events) {
    if (!ev || typeof ev !== "object" || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const url = String(ev.url || "");
    // a date of a repeating series (Events Calendar Pro): its id is an occurrence id, its address ends in the date
    if (Number(ev.id) >= 10000000 || /\/\d{4}-\d{2}-\d{2}\/?(?:[?#].*)?$/.test(url)) {
      stats.recurring++;
      continue;
    }
    const cats = uniq((ev.categories || []).map((c) => String((c && c.slug) || "").toLowerCase()).filter(Boolean)).sort();
    if (ev.hide_from_listings || cats.some((c) => dropCats.includes(c)) || (dropOnly.length && cats.length && cats.every((c) => dropOnly.includes(c)))) {
      stats.meetings++;
      continue;
    }
    const rec = tribeRecord(ev, { ...opts, host, cats });
    if (!rec.start) {
      stats.unparsed++;
      continue;
    }
    recs.push(rec);
  }
  if (optYes(o.merge_days)) recs = mergeDays(recs);
  return { records: recs, stats };
}

/* ------------------------------------------------------------------ adapter: NOCCO (aanoc) */

const urlKey = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return String(u || "").toLowerCase();
  }
};

/** The cards of NOCCO's /events/ page: [{ slug, url, title, img, w, h, dateText, address, raw }]. */
export function aanocCards(html, { base = "https://www.aanoc.org/" } = {}) {
  const src = lf(html);
  const cards = [];
  for (const m of src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    if (!/\bclass\s*=\s*["'][^"']*\bhextra-card\b/i.test(attrs)) continue;
    const url = absolute(attrOf(attrs, "href"), base);
    const pm = /^https?:\/\/[^/]+\/events\/([^/?#]+)\/?$/i.exec(url);
    if (!pm) continue;
    const inner = m[2];
    const imgTag = (/<img\b[^>]*\bhextra-card-image\b[^>]*>/i.exec(inner) || /<img\b[^>]*>/i.exec(inner) || [""])[0];
    const sub = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bhextra-card-subtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(inner);
    const iconAt = inner.search(/<[a-z]+\b[^>]*\bhextra-card-icon\b/i);
    let title = "";
    if (iconAt >= 0) title = htmlToText(inner.slice(iconAt, sub ? sub.index : undefined)).replace(/\s+/g, " ").trim();
    if (!title) title = one(attrOf(imgTag, "alt"));
    const lines = sub ? sub[1].split(/<br\s*\/?>/i).map((l) => htmlToText(l).replace(/\s+/g, " ").trim()).filter(Boolean) : [];
    cards.push({
      slug: decodeURIComponent(pm[1]),
      url: url.replace(/\/?$/, "/"),
      title,
      img: imgTag ? absolute(attrOf(imgTag, "src"), base) : "",
      w: Number(attrOf(imgTag, "width")) || 0,
      h: Number(attrOf(imgTag, "height")) || 0,
      dateText: lines[0] || "",
      address: lines.slice(1).join(", "),
      raw: squash(m[0]),
    });
  }
  return cards;
}

const AANOC_DATE = new RegExp(
  `^(?:[a-z]+day,?\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})` +
    `(?:\\s*(?:[–—-]|to)\\s*(?:[a-z]+day,?\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4}))?`,
  "i",
);
/** A card's hand-typed date line → { start, end, allDay, endDate, flags } or null when it does not parse. Formats:
 *  "October 30, 2026 @ 6:00 PM", "November 8, 2026 – November 8, 2026 @ 5:00pm", "December 4, 2026 – December 6, 2026",
 *  "December 12, 2026" (no time: all day), "November 14, 2026 @ 6-9pm", "… @ noon"; a start time without an end gives
 *  end "" and the flag no-end-time. A time that cannot be read ("@ 6-9", "@ 6") gives null: never guessed, never all day. */
export function parseAanocDate(text) {
  const t = one(text);
  const m = AANOC_DATE.exec(t);
  if (!m) return null;
  const first = ymd(m[3], monthNo(m[1]), m[2]);
  const last = m[4] ? ymd(m[6], monthNo(m[4]), m[5]) : first;
  if (!first || !last || last < first) return null;
  const times = readTimes(t.slice(m[0].length));
  if (times === null) return null;
  if (!times) return { start: first, end: "", allDay: true, endDate: last, flags: [] };
  const s = atMinutes(first, times.s);
  if (!s.isValid) return null;
  if (times.e === null) return { start: isoOut(s), end: "", allDay: false, endDate: last > first ? last : "", flags: ["no-end-time"] };
  let e = atMinutes(last, times.e);
  if (e <= s) e = e.plus({ days: 1 });
  return { start: isoOut(s), end: isoOut(e), allDay: false, endDate: last > first ? last : timedEndDate(s, e), flags: [] };
}

/** The items of an RSS feed by their link: Map(urlKey → { link, title, html, raw }). */
export function rssItems(xml) {
  const items = new Map();
  const tag = (body, name) => {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(body);
    if (!m) return "";
    const c = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
    return c ? c[1] : decodeEntities(m[1]);
  };
  for (const m of lf(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const link = tag(m[1], "link").trim();
    if (link) items.set(urlKey(link), { link, title: one(tag(m[1], "title")), html: tag(m[1], "description"), raw: squash(m[1]) });
  }
  return items;
}

const SPANISH = /[áéíóúñ¿¡]|\b(?:de|del|las?|los|el|y|para|con|taller|mujeres|hispan[ao]s?|aniversario|convivencia|baile|cena|alcoh[oó]licos|an[oó]nimos|reuni[oó]n|evento)\b/i;
/** A NOCCO detail page → { title_es, venue, street }: the Spanish subtitle right after the <h1>, and the <b> with "Venue<br>street". */
export function aanocDetail(html, title = "") {
  const s = lf(html);
  let title_es = "";
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(s);
  if (h1) {
    const p = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(s.slice(h1.index + h1[0].length));
    if (p) {
      const t = htmlToText(p[1]).replace(/\s+/g, " ").replace(/^\((.*)\)$/, "$1").trim();
      if (t && t.length <= 160 && SPANISH.test(t) && normTitle(t) !== normTitle(title) && !/\d{4}/.test(t)) title_es = t;
    }
  }
  let venue = "";
  let street = "";
  for (const m of s.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)) {
    const parts = m[1].split(/<br\s*\/?>/i).map((x) => htmlToText(x).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (parts.length >= 2 && /\d/.test(parts[1])) {
      venue = parts[0];
      street = parts.slice(1).join(", ");
      break;
    }
  }
  return { title_es, venue, street };
}

function aanoc({ html = "", rss = "", details = {} } = {}, opts = {}) {
  const office = opts.office || "nocco";
  const base = opts.base || (opts.host ? `https://${opts.host}/` : "https://www.aanoc.org/");
  const cards = aanocCards(html, { base });
  const items = rssItems(rss);
  const prev = opts.prev instanceof Map ? opts.prev : new Map();
  const detailOf = (url) => details[url] ?? details[url.replace(/\/$/, "")] ?? details[urlKey(url)] ?? null;
  const records = [];
  const unparsedCards = [];
  const seen = new Set();
  const risk = { officeHost: opts.host, now: opts.now };
  let n = 0;
  for (const c of cards) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    n++;
    const item = items.get(urlKey(c.url));
    const srcHash = sha1(c.raw + "\n" + (item ? item.raw : ""));
    const d = parseAanocDate(c.dateText);
    if (!d) {
      // reported by its place on the page and the hash of its title, never by its words
      unparsedCards.push(`card ${n} (${hashKey(c.title || c.slug)})`);
      continue;
    }
    // ids are public: a page address or a title with a personal detail (or a full name) in it, read every way
    // (slugRisk: "3-3-1990" as "3/3/1990", "p-w-774411" as "PW 774411", "d-o-s" as "DOS"), gives a key made from its hash
    const words = c.slug.replace(/[-_]+/g, " ");
    const named = nameHits(c.title || "").length || nameHits(words.replace(/(^|\s)(\p{Ll})/gu, (m, s, ch) => s + ch.toUpperCase())).length;
    const risky = titleRisk(c.title || "", risk).length || slugRisk(c.slug, risk).length;
    const id = recordId(office, risky || named ? hashKey(c.slug) : c.slug, { now: opts.now });
    const dh = detailOf(c.url);
    const det = dh ? aanocDetail(dh, c.title) : null;
    const old = prev.get(id);
    const carry = !det && old && old.srcHash === srcHash ? old : null;
    const vf = venueFormat(det ? det.venue : carry ? carry.venue : "");
    const addr = splitAddress(c.address || (det && det.street) || "");
    const title_es = det ? det.title_es : carry ? carry.title_es : "";
    const flags = [...d.flags];
    if (!addr.address && !addr.city) flags.push("place-on-flyer");
    const flyers = [];
    if (c.img) flyers.push(flyer({ url: cleanUrl(c.img), w: c.w, h: c.h }));
    let summary = item ? htmlToText(item.html) : "";
    if (summary.replace(/\s+/g, "").length < 20) summary = "";
    const venue = vf.venue || addr.venue;
    records.push(
      blankRecord({
        id, office, src: c.url, title: c.title, title_es,
        lang: title_es ? "Bilingual" : opts.lang || "English",
        start: d.start, end: d.end, allDay: d.allDay, endDate: d.endDate,
        venue: venue && !sameish(venue, addr.address) ? venue : "",
        address: addr.address, city: addr.city, zip: addr.zip,
        format: vf.hybrid || (carry && carry.format === "Hybrid") ? "Hybrid" : "In person",
        summary, flyers, flags, srcHash,
      }),
    );
  }
  return { records, stats: { read: cards.length, recurring: 0, meetings: 0, unparsed: unparsedCards.length, unparsedCards } };
}

/* ------------------------------------------------------------------ adapter: Temecula (tvco) */

const TV_DATE = new RegExp(`(?:[a-z]+day,?\\s*)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*[-–]\\s*(\\d{1,2}))?,?\\s*(\\d{4})`, "i");
const VENUE_WORDS = /\b(?:hall|center|centre|church|club|room|park|hotel|lodge|library|clubhouse|alano|chapel|auditorium|community)\b/i;

/** One date line of Temecula's page → { start, end, allDay, endDate, flags } or null. "Saturday, November 14, 2026
 *  2pm-4pm"; "… 2-4pm" (14:00–16:00); "… 11:30-1pm" (11:30–13:00); "Thursday, November 26, 2026 7am-1am" (ends the
 *  next day); "April 15-18 2027" (all day; a time typed after a range of days is not used). A time that cannot be read
 *  ("… 6-9", "… 9pm-1") gives null: the entry is reported as unparsed, never guessed, never made all-day. */
export function parseTvcoDate(text) {
  const t = one(text);
  const m = TV_DATE.exec(t);
  if (!m) return null;
  const first = ymd(m[4], monthNo(m[1]), m[2]);
  const last = m[3] ? ymd(m[4], monthNo(m[1]), m[3]) : first;
  if (!first || !last || last < first) return null;
  const times = readTimes(t.slice(m.index + m[0].length));
  if (times === null) return null;
  if (times && last === first) {
    const s = atMinutes(first, times.s);
    if (!s.isValid) return null;
    if (times.e === null) return { start: isoOut(s), end: "", allDay: false, endDate: "", flags: ["no-end-time"] };
    let e = atMinutes(first, times.e);
    if (e <= s) e = e.plus({ days: 1 }); // 7am–1am: ends the next day
    return { start: isoOut(s), end: isoOut(e), allDay: false, endDate: timedEndDate(s, e), flags: [] };
  }
  return { start: first, end: "", allDay: true, endDate: last, flags: [] };
}

const lineText = (h) => htmlToText(h).replace(/\s+/g, " ").trim();
// The id of a Temecula entry is made from its title, and ids are public (the mirror, the site's data): a title with a
// full name or any personal detail (a Zoom ID, a passcode, a sobriety date, a phone number, an e-mail address), in the
// title as typed (titleRisk) or in its slug read as words every way (slugRisk), gets a key made from its hash (letters
// only) instead of its words; recordId checks the words of the key once more.
const tvcoKey = (title, host, now) => {
  const slug = slugify(title, 60);
  const risky = titleRisk(title, { officeHost: host, now }).length || slugRisk(slug, { officeHost: host, now }).length || nameHits(one(title)).length;
  return risky ? hashKey(normTitle(title)) : slug;
};

function tvco(page, opts = {}) {
  const office = opts.office || "temecula";
  // The page is parsed again even when its "modified" stamp is unchanged: the same text gives the same records, and an
  // event that another office also lists (folded into that office's record in the mirror) is found again.
  const modified = String((page && (page.modified_gmt || page.modified)) || "");
  const html = lf((page && page.content && (page.content.rendered ?? page.content)) || "");
  const src = opts.eventsPage || "";
  const records = [];
  const unparsedCards = [];
  // an entry that cannot be read is reported by its place on the page and the hash of its name, never by its words
  const unparsed = (name) => unparsedCards.push(`card ${n} (${hashKey(name)})`);
  let read = 0;
  let n = 0;
  for (const pm of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const block = pm[1];
    const text = htmlToText(block);
    if (!text.replace(/\s/g, "")) continue;
    n++;
    // the leading bold run: "<strong>Serenity Circle Hall </strong><b>Thanksgiving Alcathon</b><br />": each bold
    // element (and each line inside one) is a name
    const run = /^\s*((?:<(strong|b|em)\b[^>]*>[\s\S]*?<\/\2>\s*(?:<br\s*\/?>\s*)*)+)/i.exec(block);
    const names = [];
    if (run) for (const el of run[1].matchAll(/<(strong|b|em)\b[^>]*>([\s\S]*?)<\/\1>/gi)) for (const part of el[2].split(/<br\s*\/?>/i)) if (lineText(part)) names.push(lineText(part));
    const restLines = (run ? block.slice(run[0].length) : block).split(/<br\s*\/?>/i).map(lineText).filter(Boolean);
    const links = [...block.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)]
      .map((x) => decodeEntities(x[1]).trim())
      .filter((u) => /\.(?:pdf|png|jpe?g|webp)(?:[?#].*)?$/i.test(u));
    const datedName = names.findIndex((n) => TV_DATE.test(n));
    const dateAt = restLines.findIndex((l) => TV_DATE.test(l));
    const dateLine = datedName >= 0 ? names[datedName] : dateAt >= 0 ? restLines[dateAt] : "";
    const titleNames = names.filter((n, i) => i !== datedName);
    if (!dateLine) {
      // a note ("See the latest Gratitude Gazette"), not an event; an entry with a flyer but no date is reported
      if (titleNames.length && links.length && !/gazette/i.test(text)) unparsed(titleNames.join(" "));
      continue;
    }
    read++;
    const d = parseTvcoDate(dateLine);
    let title = "";
    let venue = "";
    if (titleNames.length > 1) {
      const v = titleNames.findIndex((n) => VENUE_WORDS.test(n));
      if (v >= 0 && titleNames.some((n, i) => i !== v && !VENUE_WORDS.test(n))) {
        venue = titleNames[v];
        title = titleNames.filter((_, i) => i !== v).join(" ");
      } else title = titleNames.join(" – ");
    } else title = titleNames[0] || "";
    // a subtitle typed between the name and the date ("ACYPAA LIV" / "State of Mental Goose Flesh")
    const between = dateAt > 0 && datedName < 0 ? restLines.slice(0, dateAt).filter((l) => !/\d/.test(l) && !/download|more information|flier|flyer/i.test(l)) : [];
    if (title && between.length) title = `${title}: ${between.join(" ")}`;
    if (!d || !title) {
      unparsed(title || dateLine);
      continue;
    }
    const after = dateAt >= 0 ? restLines.slice(dateAt + 1) : restLines;
    const addrLine = after.find((l) => /\d/.test(l) && /,/.test(l) && !/download|more information|flier|flyer/i.test(l)) || "";
    const addr = splitAddress(addrLine);
    if (!venue) venue = addr.venue;
    if (!venue) {
      const at2 = / at (.+)$/i.exec(title);
      if (at2 && VENUE_WORDS.test(at2[1])) venue = at2[1].trim();
    }
    const flyers = uniq(links.map((u) => cleanUrl(u.replace(/^http:\/\//i, "https://"))))
      .filter(Boolean)
      .map((u) => (/\.pdf(?:[?#]|$)/i.test(u) ? flyer({ url: u, mime: "application/pdf", pdf: u }) : flyer({ url: u })));
    const flags = [...d.flags];
    if (!addr.address && !addr.city && !venue) flags.push("place-on-flyer");
    records.push(
      blankRecord({
        id: recordId(office, `${tvcoKey(title, opts.host, opts.now)}-${d.start.slice(0, 10).replace(/-/g, "")}`, { now: opts.now }),
        office, src, title, lang: opts.lang || "English",
        start: d.start, end: d.end, allDay: d.allDay, endDate: d.endDate,
        venue: venue && !sameish(venue, addr.address) ? venue : "",
        address: addr.address, city: addr.city, zip: addr.zip,
        flyers, flags, srcHash: sha1(squash(block)),
      }),
    );
  }
  return { records, stats: { read, recurring: 0, meetings: 0, unparsed: unparsedCards.length, unparsedCards }, pageModified: modified };
}

/* ------------------------------------------------------------------ watched pages */

/** The "modified" stamp of a watched page (or the date of the newest file of a media list): "" when there is none. */
export function watchStamp(json) {
  let best = "";
  for (const x of Array.isArray(json) ? json : [json]) {
    if (!x || typeof x !== "object") continue;
    const v = String(x.modified_gmt || x.modified || x.date_gmt || x.date || "");
    if (v > best) best = v;
  }
  return best;
}

export const adapters = { tribe, aanoc, tvco };

/* ------------------------------------------------------------------ cleaning (anonymity) */

/** Cut to `max` characters on a sentence (or else a word) boundary, ending with "…". */
export function cutText(s, max = SUMMARY_MAX) {
  if (s.length <= max) return s;
  const room = s.slice(0, max - 2);
  const sentence = /^[\s\S]*[.!?](?=\s)/.exec(room + " ");
  if (sentence && sentence[0].length >= max * 0.5) return sentence[0].trim() + " …";
  return room.replace(/\s+\S*$/, "").replace(/[\s,;:·–—-]+$/, "") + "…";
}
const capTitle = (s) => (s.length <= TITLE_MAX ? s : s.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, "").replace(/[\s,;:–—-]+$/, "") + "…");
// a Zoom link anywhere in a summary (its text is left out)
const ZOOM_LINK = /\bzoom(?:gov)?\.us\//i;
// web addresses typed into the text, with or without https:// ("book.passkey.com/go/…"); never part of an e-mail address
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+|(?<![\w@.-])www\.[^\s<>"]+|(?<![\w@.-])(?:[a-z0-9-]+\.)+(?:com|org|net|us|info|edu|gov|io|co|me|app|link|ly)\/[^\s<>"]*/gi;

// The kinds of detail whose match is only a label ("Passcode", "Zoom ID 8", "sober since"): the detail itself follows
// it, so taking out the matched text would leave the detail behind.
const SECRET_KINDS = new Set(["zoom", "password", "sobriety"]);
const letterCount = (s) => (String(s).match(/\p{L}/gu) || []).length;
const tidyField = (t) => t.replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").trim();
// A title cut before a Zoom ID, passcode or sobriety date, without what would dangle at its end: the label ("Zoom",
// "Meeting ID", "PW"), a joining word ("on", "with", "en") or sign ("&", "+"), an open bracket or separator.
function cutBefore(t, at) {
  let s = t.slice(0, at);
  let prev;
  do {
    prev = s;
    s = s
      .replace(ID_LABEL, "")
      .replace(/[\s,;:·•|/([{<«“"'‘–—&+@#*-]+$/u, "")
      .replace(/(?:^|\s+)(?:on|via|with|at|in|and|or|by|for|the|a|an|en|por|con|y|o|de|del|el|la|los|las|un|una)$/i, "");
    s = s.trim();
  } while (s !== prev);
  return s;
}
/** The error cleanRecord throws for a record that must be left out (err.code = OFFICE_RECORD_DROPPED, err.id): its
 *  title has a Zoom ID, passcode, sobriety date, phone number or e-mail address and less than 3 letters without it. */
export const RECORD_DROPPED = "OFFICE_RECORD_DROPPED";

/**
 * Anonymity cleaning of one record; running it again gives the same record. ctx = { allow (loadAllow()), officeHost
 * (the office's website: its e-mail addresses may stay), names (shortenNames, or { shortenNames }), linkFixes
 * (compileLinkFixes(data/link-fixes.csv)), eventsPage (used when `src` cannot be kept), now (which year is this year:
 * a sobriety date is from 1940 to last year, a code is not this year or a later one; default today), onSummaryDropped
 * ({ id, kind } → anything: told when the summary is left out, and why, without its text) }.
 *  - every text field is read normalised first (normalizeText, the office's dashes kept) and stored that way;
 *  - summary: optional extra text (every card links to the office's own page), so ALL OR NOTHING: it is left out whole
 *    when summaryRisk finds anything (a contact detail, a word that labels a code or a meeting, a sobriety date or
 *    length, a long number) or a Zoom link was in it; otherwise web addresses go, full names become first name +
 *    initial, and it becomes one paragraph of at most 300 characters;
 *  - title, title_es, venue: names shortened, a phone number or e-mail address taken out; titles at most 120 characters;
 *  - title, title_es with a Zoom ID or meeting number, passcode or code, password or sobriety date (titleRisk: the
 *    explicit details and the structural rules): cut before the first one (its match may start at its label); a title
 *    with less than 3 letters left THROWS an Error with code RECORD_DROPPED (the caller leaves the record out); a
 *    Spanish title with less than 3 letters left is emptied;
 *  - venue with such a detail: emptied, and flagged place-on-flyer when no address or city is left;
 *  - address, city, cost: emptied when titleRisk finds anything in them (a code, a meeting number, a sobriety date, a
 *    phone number, an e-mail address), zip when contactHits does;
 *  - src and flyer addresses: trackers removed (cleanUrl), link fixes applied;
 *  - a flyer is left out (not kept, so never downloaded) when its address carries a detail (flyerRisk: a phone number
 *    in it, or its file name or folders read as words with a sobriety date, a code, an e-mail address or a full name;
 *    "…/Ana-R-sober-since-3-3-1990.jpg"); a long number alone is a camera's file name, not a meeting number;
 *  - src: the event's own page only when its title and Spanish title came through unchanged (nothing cut, emptied,
 *    shortened or taken out), its venue was not emptied, its id is not made from a hash and its address reads clean
 *    (pageRisk: "…/event/ana-r-sober-since-90/", "…/event/picnic-rsvp-mariagmail-com/", a full name); otherwise the
 *    office's events page (ctx.eventsPage), or else its website (https://<officeHost>/).
 */
export function cleanRecord(rec, ctx = {}) {
  const allow = ctx.allow || loadAllow();
  const officeHost = ctx.officeHost;
  const shorten = typeof ctx.names === "function" ? ctx.names : (ctx.names && ctx.names.shortenNames) || shortenNames;
  const now = ctx.now;
  const opts = { allow, officeHost, now };
  const hits = (s) => contactHits(s, opts);
  const risky = (s) => titleRisk(s, opts);
  const r = blankRecord(rec);
  const fixUrl = (u) => {
    let x = cleanUrl(u);
    if (x && ctx.linkFixes && ctx.linkFixes.length) x = fixLinks(x, ctx.linkFixes).text.trim();
    return x;
  };
  // the office's events page; a flyer (its file name and folders read as words, pageRisk's rules without the meeting
  // number one); an event's own page (its address is made from its title, so its words are read as an id's are)
  const fixPage = (u) => {
    const x = fixUrl(u);
    return x && !hits(x).length ? x : "";
  };
  const fixFlyer = (u) => {
    const x = fixUrl(u);
    return x && !flyerRisk(x, opts).length ? x : "";
  };
  const fixSrc = (u) => {
    const x = fixUrl(u);
    return x && !pageRisk(x, opts).length ? x : "";
  };
  let venueGone = false;
  // a title or a Spanish title that lost anything (cut, emptied, a name shortened, a phone number or an address taken
  // out): its page's address, made from the same words, is not shown
  let titleChanged = false;
  // which: "title" | "title_es" | "venue"
  const field = (s, which) => {
    const given = normalizeText(one(s), { dashes: false });
    let t = shorten(given);
    let touched = t !== given;
    const found = risky(t);
    const secret = found.filter((h) => SECRET_KINDS.has(h.kind));
    if (secret.length) {
      if (which === "venue") {
        venueGone = true;
        return "";
      }
      const at = Math.min(...secret.map((h) => (Number.isInteger(h.index) ? h.index : Math.max(0, t.indexOf(h.value)))));
      t = cutBefore(t, at);
      touched = true;
    }
    // phone numbers and e-mail addresses: the value itself goes
    for (let i = 0; i < 3; i++) {
      const left = risky(t).filter((h) => !SECRET_KINDS.has(h.kind));
      if (!left.length) break;
      touched = true;
      for (const h of left) t = t.split(h.value).join(" ");
    }
    t = tidyField(t);
    if (risky(t).length || (found.length && letterCount(t) < 3)) {
      if (which === "title") throw Object.assign(new Error("personal details in the title"), { code: RECORD_DROPPED, id: String(r.id || "") });
      if (which === "venue") venueGone = true;
      else titleChanged = true;
      return "";
    }
    if (touched && which !== "venue") titleChanged = true;
    return t;
  };
  const out = {};
  out.id = String(r.id || "");
  out.office = String(r.office || "");
  out.also = uniq((r.also || []).map(String).filter((k) => k && k !== out.office)).sort();
  out.title = capTitle(field(r.title, "title"));
  out.title_es = capTitle(field(r.title_es, "title_es"));
  if (normTitle(out.title_es) === normTitle(out.title)) out.title_es = "";
  out.venue = field(r.venue, "venue");
  // an event's own page is shown only when its title came through whole, its venue was not emptied, its id is not made
  // from a hash ("…-e" and 10 letters: its title or page address carries a detail) and its address reads clean
  // (pageRisk); otherwise the office's events page (ctx.eventsPage), or else the office's website
  const hashedId = /-e[a-p]{10}(?:-\d{8})?$/.test(out.id);
  const host = hostOf(Array.isArray(officeHost) ? officeHost[0] : officeHost);
  const fallback = (ctx.eventsPage ? fixPage(ctx.eventsPage) : "") || (host ? `https://${host}/` : "");
  out.src = (!hashedId && !titleChanged && !venueGone ? fixSrc(r.src) : "") || fallback;
  out.lang = LANGS.includes(r.lang) ? r.lang : "English";
  out.type = TYPES.includes(r.type) ? r.type : "Event";
  out.cats = uniq((r.cats || []).map((c) => String(c).toLowerCase()).filter(Boolean)).sort();
  out.start = String(r.start || "");
  out.end = String(r.end || "");
  out.allDay = !!r.allDay;
  out.endDate = String(r.endDate || "");
  // the street address, the city and the price are read as a venue is (titleRisk): any detail empties the field
  for (const k of ["address", "city", "zip", "cost"]) {
    const v = normalizeText(one(r[k]), { dashes: false });
    out[k] = v && !(k === "zip" ? hits(v) : risky(v)).length ? v : "";
  }
  const extraFlags = venueGone && !out.address && !out.city ? ["place-on-flyer"] : [];
  out.format = FORMATS.includes(r.format) ? r.format : "In person";
  // summary: all or nothing (see above). Web addresses go first (a link's long number or path is not shown); a Zoom
  // link means the text carries joining details. Then one paragraph: a line break inside a sentence becomes a space,
  // between two lines that are not sentences a " · ". What the joins made is read again.
  const summaryIn = normalizeText(lf(r.summary), { dashes: false });
  const noLinks = summaryIn.replace(URL_IN_TEXT, " ");
  let risk = ZOOM_LINK.test(summaryIn) ? "zoom" : summaryRisk(noLinks, { allow, officeHost, now });
  let para = "";
  if (!risk) {
    const lines = shorten(noLinks)
      .split("\n")
      .map((l) =>
        l
          .replace(/[ \t]+/g, " ")
          .replace(/^[•·*-]\s+/, "")
          // a word left pointing at a link that went ("Tickets at", "Book online at (Group Code …)")
          .replace(/\s+(?:at|on|via|here|en|aqu[ií])(?=\s*(?:[(.,;:]|$))/gi, "")
          .trim(),
      )
      .filter(Boolean);
    for (const line of lines) {
      para = !para ? line : /[.!?:;…,·]$/.test(para) || /^[\p{Ll}(]/u.test(line) ? `${para} ${line}` : `${para} · ${line}`;
    }
    para = para.replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
    risk = summaryRisk(para, { allow, officeHost, now });
    if (risk) para = "";
  }
  if (risk && typeof ctx.onSummaryDropped === "function") ctx.onSummaryDropped({ id: out.id, kind: risk });
  out.summary = cutText(para);
  out.flyers = [];
  for (const f of r.flyers || []) {
    const url = fixFlyer(f && f.url);
    if (!url || out.flyers.some((x) => x.url === url)) continue;
    out.flyers.push(
      flyer({
        ...f,
        url,
        sizes: (f.sizes || []).map(([w, u]) => [Number(w) || 0, fixFlyer(u)]).filter(([w, u]) => w > 0 && u),
        pdf: f.pdf ? fixFlyer(f.pdf) : "",
      }),
    );
  }
  out.flags = uniq([...(r.flags || []), ...extraFlags].map(String).filter(Boolean)).sort();
  out.srcHash = String(r.srcHash || "");
  return Object.fromEntries(RECORD_KEYS.map((k) => [k, out[k]]));
}

/* ------------------------------------------------------------------ one office's state, and the mirror */

const isMap = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const sortedEntries = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
/** An office's own events as it listed them (before dedupeOffices folds some into another office's record): id →
 *  "<last day yyyy-mm-dd> <srcHash>". Kept in the office's state as `sources`. */
export function sourcesOf(records) {
  return sortedEntries(Object.fromEntries((records || []).map((r) => [String(r.id), `${recordDays(r)[1]} ${r.srcHash || ""}`])));
}
/** The flyers of an office's own events whose bytes were read: url → "<sha256> <w> <h> <mime>" (the mime type the
 *  office's server gave, which may differ from the address's extension). Kept in the office's state as `flyers`, so a
 *  flyer of an event folded into another office's record is not downloaded again. */
export function flyersOf(records) {
  const out = {};
  for (const r of records || []) {
    for (const f of r.flyers || []) {
      if (f && f.url && f.sha256 && !out[f.url]) out[f.url] = [f.sha256, Number(f.w) || 0, Number(f.h) || 0, ...(f.mime ? [String(f.mime)] : [])].join(" ");
    }
  }
  return sortedEntries(out);
}
/** "<sha256> <w> <h> <mime>" (flyersOf) → { sha256, w, h, mime } ({ sha256: "" } when it is not one). */
export function flyerFromState(v) {
  const [sha256 = "", w = "0", h = "0", mime = ""] = String(v ?? "").trim().split(/\s+/);
  return /^[0-9a-f]+$/i.test(sha256) ? { sha256: sha256.toLowerCase(), w: Number(w) || 0, h: Number(h) || 0, mime } : { sha256: "", w: 0, h: 0, mime: "" };
}
/**
 * NOCCO (aanoc): what the detail pages said about the office's own events that are not in the mirror's events because
 * dedupeOffices folded them into another office's record: id → { title_es, venue, format } (cleaned values, only the
 * ones that say something). Kept in the office's state as `details`: the importer reads a detail page again only when
 * its card changes, and a folded event that comes back (the other office's record went) keeps its place and subtitle.
 */
export function foldedDetails(records, keptIds) {
  const kept = keptIds instanceof Set ? keptIds : new Set(keptIds || []);
  const out = {};
  for (const r of records || []) {
    if (!r || kept.has(r.id)) continue;
    const d = {};
    if (r.title_es) d.title_es = String(r.title_es);
    if (r.venue) d.venue = String(r.venue);
    if (r.format === "Hybrid") d.format = "Hybrid";
    if (Object.keys(d).length) out[String(r.id)] = d;
  }
  return sortedEntries(out);
}
const upcomingSources = (src, today) => sortedEntries(Object.fromEntries(Object.entries(src).filter(([, v]) => String(v).slice(0, 10) >= today)));

/**
 * One office after a run. result = { status: "ok"|"error"|"off"|"none"|"watch"|"shared", records, errorKind,
 * unparsed, watchModified, pageModified }, records = the office's own events of this run, cleaned (and their flyers
 * hashed), BEFORE dedupeOffices. prev = the office's entry in the old mirror, prevRecords = its old events (the mirror's
 * events with office = this office: an event folded into another office's record is not among them).
 *  - error: the old events are kept (minus the past ones); failingSince is set on the first failure;
 *  - shrink guard: a read with no events while the old copy had 2 or more upcoming ones keeps them (status suspect),
 *    until 3 days have passed since the first empty read (the clock starts at the first empty read, also after a run
 *    of errors); then the empty list is accepted;
 *  - state.sources (sourcesOf) = the office's own events, folded ones included; state.flyers (flyersOf) = their hashed
 *    flyers. Both are carried over (sources minus the past ones) while the office fails or is suspect, and so is
 *    state.details (NOCCO: foldedDetails, which the importer sets after dedupeOffices), for the ids still in sources;
 *  - lastChange: the day the office's own events (ids and sources, past ones aside) last changed, compared with
 *    prev.sources (or, for an old mirror without it, with prevRecords): folding does not move it.
 * → { state, records, note }
 */
export function settleOffice({ adapter = "", prev = {}, prevRecords = [], result = {}, today }) {
  const upcomingPrev = prevRecords.filter((r) => !isPast(r, today));
  const prevSources = isMap(prev.sources) ? upcomingSources(prev.sources, today) : sourcesOf(upcomingPrev);
  const state = {
    adapter, status: "ok", count: 0, unparsed: Number(result.unparsed) || 0,
    lastChange: prev.lastChange || "", failingSince: "", errorKind: "",
    watchModified: result.watchModified || prev.watchModified || "",
    pageModified: result.pageModified || prev.pageModified || "",
    sources: {}, flyers: {},
  };
  const carry = () => {
    state.sources = prevSources;
    state.flyers = isMap(prev.flyers) ? sortedEntries(prev.flyers) : flyersOf(upcomingPrev);
    if (isMap(prev.details)) state.details = sortedEntries(Object.fromEntries(Object.entries(prev.details).filter(([id]) => id in prevSources)));
  };
  let records = [];
  let note = "";
  const status = result.status || "ok";
  if (status === "error") {
    records = upcomingPrev;
    state.status = "error";
    state.errorKind = result.errorKind || "parse";
    state.failingSince = prev.failingSince || today;
    state.unparsed = Number(prev.unparsed) || 0;
    carry();
    note = `kept ${records.length} earlier event(s)`;
  } else if (status !== "ok") {
    state.status = status; // off, none, watch, shared
  } else {
    records = result.records || [];
    if (!records.length && upcomingPrev.length >= 2) {
      // the 3 days count from the first empty read: failingSince of an error streak does not count
      const since = prev.status === "suspect" && prev.failingSince ? prev.failingSince : today;
      if (daysBetween(since, today) >= 3) {
        state.status = "empty";
        note = `no events for ${daysBetween(since, today)} days: the empty list is accepted`;
      } else {
        records = upcomingPrev;
        state.status = "suspect";
        state.failingSince = since;
        carry();
        note = `read 0 events but had ${upcomingPrev.length}: kept them`;
      }
    } else state.status = records.length ? "ok" : "empty";
    if (state.status !== "suspect") {
      state.sources = sourcesOf(records);
      state.flyers = flyersOf(records);
    }
  }
  if (status !== "watch" && stableStringify(state.sources) !== stableStringify(prevSources)) state.lastChange = today;
  if (status === "watch" && result.watchModified && prev.watchModified && result.watchModified !== prev.watchModified) state.lastChange = today;
  return { state, records, note };
}

/** The mirror (data/central-office-events.json): offices by key, events by (start, id), only upcoming or ongoing ones;
 *  each office's count = its events, its own or shared (also). */
export function buildMirror({ offices = {}, events = [], today }) {
  const evs = events.filter((e) => !today || !isPast(e, today)).sort(byStart);
  const out = {};
  for (const k of Object.keys(offices).sort()) {
    out[k] = { ...offices[k], count: evs.filter((e) => e.office === k || (e.also || []).includes(k)).length };
  }
  return { v: 1, tz: TZ, offices: out, events: evs };
}

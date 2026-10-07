// src/_lib/calendar.js — parse, normalise and expand the Area's Google Calendar feed.
//
// Volunteers never need to edit this file. The calendar itself is edited in Google
// Calendar (see README "Adding something to the calendar"); the tables that steer it
// (event types, districts, committees) are CSV files in data/.
//
// Ported from the tested research parser (msca09-calendar.mjs: 1,790/1,790 occurrences
// identical to an independent Python expansion). Pure ESM, Node >= 18.
// Dependencies: ical.js 2.x, luxon 3.x.
//
//   import { parseCalendar, expandOccurrences } from "../_lib/calendar.js";
//   const cal = parseCalendar(icsText, { now: new Date(), types, districts, committees });
//   const occ = expandOccurrences(cal.events, "2026-10-01", "2027-04-01");
//
// The site-specific helpers at the end of the file (time labels in English and Spanish,
// "Every 2nd Tuesday" patterns, iCalendar output, Google/Outlook links, safe "About"
// HTML) are used by src/_data/calendar.js and src/_lib/plugins/calendar.js.

import ICAL from 'ical.js';
import { DateTime } from 'luxon';

/* ------------------------------------------------------------------ constants */

export const AREA_TZ = 'America/Los_Angeles';
export const CALENDAR_ID =
  'd750fd36f80cbdca09aefaa2310a3e2710790cd2f9c73d09d293bb23bbb052db@group.calendar.google.com';
export const ICS_URL =
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;
export const EMBED_URL =
  `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(CALENDAR_ID)}` +
  `&ctz=${encodeURIComponent(AREA_TZ)}`;
export const SUBSCRIBE_URL =
  `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(CALENDAR_ID)}`;

// type -> { group, pages } — mirrors data/kinds.csv set=calendar (pages: meetings/events)
export const DEFAULT_TYPES = {
  'Area':           { group: 'area',     pages: ['meetings'] },
  'Area Committee': { group: 'area',     pages: ['meetings', 'events'] },
  'Assembly':       { group: 'area',     pages: ['meetings', 'events'] },
  'Conference':     { group: 'area',     pages: ['events'] },
  'Foro':           { group: 'area',     pages: ['events'] },
  'Servathon':      { group: 'area',     pages: ['events'] },
  'District':       { group: 'meetings', pages: ['meetings'] },
  'Committee':      { group: 'meetings', pages: ['meetings'] },
  'H&I':            { group: 'meetings', pages: ['meetings'] },
  'Intergroup':     { group: 'meetings', pages: ['meetings'] },
  'Service School': { group: 'learning', pages: ['meetings', 'events'] },
  'Workshop':       { group: 'learning', pages: ['events'] },
  'History':        { group: 'learning', pages: ['events'] },
  'Convention':     { group: 'events',   pages: ['events'] },
  'Forum':          { group: 'events',   pages: ['events'] },
  'YPAA':           { group: 'events',   pages: ['events'] },
  'Social':         { group: 'events',   pages: ['events'] },
  'Event':          { group: 'events',   pages: ['events'] },
  'Other':          { group: 'events',   pages: ['meetings', 'events'] },
};
export const DEFAULT_TOPICS = [
  'Steps', 'Traditions', 'Concepts', 'Sponsorship', 'Group service', 'Literature',
  'Grapevine & La Viña', 'H&I & corrections', 'Public information', 'Accessibility',
  'Women', 'Technology', 'Archives & history',
];
export const FORMATS = ['In person', 'Hybrid', 'Virtual'];
// Spelling slips in the calendar that the site corrects while it waits for a fix in Google Calendar
// (scripts/check-calendar.mjs keeps reporting them).
export const TYPO_FIXES = [[/\bSan Bernadino\b/g, 'San Bernardino']];
export const LANGUAGES = ['English', 'Spanish', 'Bilingual'];

// district slug (as in data/districts.csv "slug" column) -> district numbers it covers.
// Used only when data/districts.csv is missing. Slug = "d" + numbers padded to 2, joined by "-".
export const DEFAULT_DISTRICTS = {
  'd01-03': [1, 3], d02: [2], d04: [4], d05: [5], d06: [6], d07: [7], d08: [8], d09: [9],
  d10: [10], d12: [12], d14: [14], d15: [15], d17: [17], d18: [18], d19: [19],
  d20: [20], d21: [21], d22: [22], d23: [23], d24: [24], d25: [25], d30: [30],
};
export function districtSlug(nums) {
  return 'd' + [...nums].sort((a, b) => a - b).map(n => String(n).padStart(2, '0')).join('-');
}

// committee slug -> matching rules. Used only when data/committees.csv is missing; the CSV's
// `calendar_match` column (";"-separated) replaces it. Mirrors research/committees.json.
//   emails   an entry whose "Email:" line is one of these belongs to the committee ("own")
//   keywords words in the title (ALL-CAPS words match whole words, case-sensitive; others any part, any case)
//   types    calendar types that relate to the committee (e.g. History -> archives)
//   topics   "Topic:" values that relate to the committee
export const DEFAULT_COMMITTEES = {
  delegate: { emails: ['delegate@msca09aa.org'], types: ['Conference', 'Forum'], keywords: ['delegate', 'delegado', 'shareback', 'pre-conference', 'preconference', 'mock conference', 'general service conference'] },
  'alternate-delegate': { emails: ['delegatealt@msca09aa.org'], types: ['Foro', 'Servathon'], keywords: ['servathon', 'servatón', 'foro', 'sharing session', 'service study', 'dcmc orientation'] },
  chair: { emails: ['chair@msca09aa.org'], types: ['Area', 'Area Committee', 'Assembly'], keywords: [] },
  secretary: { emails: ['secretary@msca09aa.org'], keywords: ['minutes', 'actas'] },
  'treasurer-ap': { emails: ['treasurerap@msca09aa.org'], keywords: ['budget', 'presupuesto'] },
  'treasurer-ar': { emails: ['treasurerar@msca09aa.org'], keywords: ['contribution', 'contribuci'] },
  registrar: { emails: ['registrar@msca09aa.org'], keywords: ['registrar'] },
  accessibilities: { emails: ['accessibilitieschair@msca09aa.org', 'accessibilitieschair-es@msca09aa.org'], topics: ['Accessibility'], keywords: ['accessib', 'accesib', 'ASL', 'sign language', 'lenguaje de señas'] },
  archives: { emails: ['archiveschair@msca09aa.org', 'archivist@msca09aa.org', 'archives@msca09aa.org'], topics: ['Archives & history'], types: ['History'], keywords: ['archiv', 'heritage day', 'open house', 'historia'] },
  communications: { emails: ['communicationschair@msca09aa.org', 'communicationschair-es@msca09aa.org', 'editor@msca09aa.org'], keywords: ['newsletter', 'boletín', 'communications', 'comunicaciones'] },
  'convention-liaison': { emails: ['conventionliaison@msca09aa.org', 'conventionliaison-es@msca09aa.org'], types: ['Convention'], keywords: ['convention', 'convención', 'round-up', 'roundup'] },
  cec: { emails: ['cecchair@msca09aa.org'], keywords: ['CEC', 'elder', 'older alcoholic', 'tercera edad'] },
  cpc: { emails: ['cpcchair@msca09aa.org', 'cpcchair-es@msca09aa.org'], topics: ['Public information'], keywords: ['CPC', 'CCP', 'professional community', 'comunidad profesional'] },
  corrections: { emails: ['correctionschair@msca09aa.org'], topics: ['H&I & corrections'], keywords: ['correction', 'correccion', 'behind the walls'] },
  'dcm-school': { emails: ['dcmschoolchair@msca09aa.org', 'dcmschoolchair-es@msca09aa.org'], keywords: ['DCM School', 'DCMC School', 'DCM Sharing', 'Escuela de MCD'] },
  finance: { emails: ['financechair@msca09aa.org'], keywords: ['budget', 'presupuesto', 'finance', 'finanzas'] },
  'grapevine-la-vina': { emails: ['grapevinechair@msca09aa.org', 'lavinachair@msca09aa.org'], topics: ['Grapevine & La Viña'], keywords: ['grapevine', 'la viña', 'la vina', 'lavina', 'writing workshop', 'taller de escritura'] },
  'gsr-school': { emails: ['gsrschoolchair@msca09aa.org', 'gsrschoolchair-es@msca09aa.org'], topics: ['Group service'], keywords: ['GSR School', 'Escuela de RSG', 'service manual'] },
  'guidelines-policies': { emails: ['gapchair@msca09aa.org'], keywords: ['guidelines', 'bylaws', 'third legacy', 'tercer legado'] },
  literature: { emails: ['literaturechair@msca09aa.org', 'literaturechair-es@msca09aa.org'], topics: ['Literature'], keywords: ['literature', 'literatura', 'big book', 'libro grande'] },
  'public-information': { emails: ['pichair@msca09aa.org', 'pichair-es@msca09aa.org'], topics: ['Public information'], keywords: ['public information', 'información pública', 'PI Forum'] },
  registration: { emails: ['registrationchair@msca09aa.org'], keywords: ['Registration Committee', 'Comité de Registro'] },
  'remote-communities': { emails: ['remotecommunitieschair@msca09aa.org', 'remotecommunitieschair-es@msca09aa.org'], keywords: ['remote communit', 'comunidades remotas'] },
  technology: { emails: ['technologychair@msca09aa.org'], topics: ['Technology'], keywords: ['technology', 'tecnología'] },
  treatment: { emails: ['treatmentchair@msca09aa.org'], keywords: ['treatment', 'tratamiento', 'bridging the gap', 'BTG'] },
  ypaa: { emails: ['ypchair@msca09aa.org'], types: ['YPAA'], keywords: ['YPAA', 'young people', 'jóvenes'] },
  'hospitals-institutions': { types: ['H&I'], keywords: ['H&I', 'hospitals and institutions', 'hospitales e instituciones'] },
  intergroups: { types: ['Intergroup'], keywords: ['central office', 'oficina central', 'intergroup'] },
  'hispanic-womens': { topics: ['Women'], keywords: ['hispanic wom', 'mujeres hispanas'] },
  'inter-district-hispanic': { keywords: ['interdistrict', 'interdistrital', 'intradistrict'] },
};

/** Turn a committees.csv `calendar_match` cell into rules: "x@msca09aa.org; Archives; type:History; topic:Literature". */
export function committeeRulesFromCell(cell, email) {
  const rules = { emails: [], keywords: [], types: [], topics: [] };
  const parts = String(cell || '').split(/\s*;\s*/).map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = /^(type|topic|email|keyword)\s*:\s*(.+)$/i.exec(p);
    if (m) { const k = m[1].toLowerCase(); (k === 'type' ? rules.types : k === 'topic' ? rules.topics : k === 'email' ? rules.emails : rules.keywords).push(m[2].trim()); }
    else if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(p)) rules.emails.push(p.toLowerCase());
    else rules.keywords.push(p);
  }
  for (const e of String(email || '').split(/[;,\s]+/)) if (/@/.test(e) && !rules.emails.includes(e.toLowerCase())) rules.emails.push(e.toLowerCase());
  return rules;
}
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
function keywordMatcher(k) {
  const kw = String(k || '').trim();
  if (!kw) return () => false;
  const esc = fold(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // acronyms (GSR, CEC, H&I, BTG) match whole words and only in capitals
  const re = /^[A-Z0-9&.]{2,}$/.test(kw) || /^[A-Z]{2,}\s/.test(kw) ? new RegExp(`(^|[^A-Za-z0-9])${esc}(?![A-Za-z0-9])`) : new RegExp(esc, 'i');
  return s => re.test(fold(s));
}

// Field keys. Canonical spelling first; aliases are accepted (with a warning).
const FIELD_ALIASES = {
  language: 'Language', lang: 'Language', idioma: 'Language',
  zoomid: 'ZoomID', meetingid: 'ZoomID', zoommeetingid: 'ZoomID',
  passcode: 'Passcode', password: 'Passcode', pw: 'Passcode', pc: 'Passcode', codigo: 'Passcode',
  zoomlink: 'ZoomLink', zoomurl: 'ZoomLink', joinlink: 'ZoomLink',
  web: 'Web', website: 'Web', site: 'Web', url: 'Web',
  email: 'Email', mail: 'Email', correo: 'Email',
  covers: 'Covers', cities: 'Covers',
  host: 'Host', hosts: 'Host', hostedby: 'Host',
  topic: 'Topic', topics: 'Topic', tema: 'Topic',
  titlees: 'Title-ES', titulo: 'Title-ES', titletitlees: 'Title-ES',
  cost: 'Cost', price: 'Cost', donation: 'Cost',
  img: 'IMG', image: 'IMG', flyer: 'IMG', imagen: 'IMG',
  link: 'Link', doc: 'Link', document: 'Link',
  note: 'Note', notes: 'Note', noteen: 'Note',
  // Spanish note lines ("Nota: …") are shown on the Spanish pages instead of the English ones
  nota: 'Nota', notas: 'Nota', notees: 'Nota', notaes: 'Nota',
  // "Registration: 8:00 AM" — when doors / registration open before the start time
  registration: 'Registration', registro: 'Registration', inscripcion: 'Registration', checkin: 'Registration',
};
// Spellings that are as good as the canonical one (no "read as" warning)
const QUIET_ALIASES = new Set(['nota', 'titulo', 'inscripcion', 'notes']);
const CANONICAL_FIELDS = new Set(Object.values(FIELD_ALIASES));
const REPEATABLE = new Set(['IMG', 'Link', 'Note', 'Nota', 'Email']);

/* ------------------------------------------------------------------ small utils */

export function slugify(s, max = 80) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/g, '');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ntilde: 'ñ', Ntilde: 'Ñ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Undo Google's click-tracking wrapper: https://www.google.com/url?q=<real>&sa=D... */
export function unwrapGoogleUrl(u) {
  const m = /^https?:\/\/(?:www\.)?google\.com\/url\?(.*)$/i.exec(u);
  if (!m) return u;
  const q = new URLSearchParams(m[1]).get('q');
  return q || '';
}

/** Google Calendar's web editor stores rich descriptions as HTML. Turn it into plain text
 *  with one line per <br>/<p>/<div>/<li>, links rendered as "label url" (or just url). */
export function htmlToText(s) {
  if (!/<\/?[a-z][a-z0-9-]*\b[^>]*>/i.test(s)) return s;
  let t = s.replace(/\r\n?/g, '\n');
  // Google: newlines inside HTML are not significant except inside <pre>; keep them as spaces
  t = t.replace(/\n/g, ' ');
  t = t.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (m, _q, h1, h2, inner) => {
    const href = unwrapGoogleUrl(decodeEntities(h1 ?? h2 ?? ''));
    const label = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    if (!href) return label;
    if (!label || label === href || label.replace(/^https?:\/\//, '') === href.replace(/^https?:\/\//, '')) return href;
    if (/^mailto:/i.test(href)) return label.includes('@') ? label : `${label} ${href.slice(7)}`;
    return `${label} ${href}`;
  });
  t = t.replace(/<br\s*\/?>/gi, '\n')
       .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|blockquote|pre)>/gi, '\n')
       .replace(/<li\b[^>]*>/gi, '• ')
       .replace(/<\/?(html-blob|span|b|strong|i|em|u|font|p|div|ul|ol|h[1-6]|table|tbody|tr|td|th|blockquote|pre|small|sup|sub)\b[^>]*>/gi, '')
       .replace(/<[^>]+>/g, '');
  return decodeEntities(t);
}

function normaliseText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n');
}

export function driveId(url) {
  const m = /(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/.exec(url || '');
  return m ? m[1] : null;
}
/** Public image URL for a Drive file id.  lh3 serves image/* without auth for
 *  files shared "Anyone with the link"; width in px. See calendar-spec.md §7. */
export function driveImageUrl(id, width = 1200) {
  return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
}
export function driveThumbUrl(id, width = 640) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
}
export function driveViewUrl(id) { return `https://drive.google.com/file/d/${id}/view`; }

function withScheme(u) {
  u = (u || '').trim();
  if (!u) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}

/* ------------------------------------------------------------------ e-mail / phone */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FREEMAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|aol|icloud|outlook|comcast|sbcglobal|live|msn|me|att|verizon|cox|charter|earthlink|protonmail|proton)\./i;
const ROLE_LOCAL = /msca|area|district|dist\d|^d\d+|dcm|delegate|intergroup|handi|hni|ypaa|committee|chair|service|office|archiv|registrar|treasurer|secretary|gsr|webservant|webmaster|info|contact|hotline|panel/i;
/** 'role' (service address, may be published) or 'personal' (must not be published). */
export function classifyEmail(addr) {
  const a = addr.toLowerCase();
  if (/@msca09aa\.org$/.test(a)) return 'role';
  const local = a.split('@')[0];
  if (FREEMAIL.test(a)) return ROLE_LOCAL.test(local) ? 'role' : 'personal';
  // a district / intergroup / area domain: service unless it looks like firstname.lastname
  return /^[a-z]+[._][a-z]+$/.test(local) && !ROLE_LOCAL.test(local) ? 'personal' : 'role';
}
const PHONE_RE = /(?<![\d-])(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\d-])/g;
const NOT_A_PHONE_BEFORE = /(zoom|meeting|webinar|reuni[oó]n)\s*(id|#)?\s*:?\s*$|\b(id|passcode|password|pc|pw|code|c[oó]digo( de acceso)?)\s*:?\s*$|\/j\/$/i;

/* ------------------------------------------------------------------ description */

const HEADER_RE = /^\s*MSCA\s*-?\s*0?9\s*\|(.*)$/i;
const SEPARATOR_RE = /^\s*(?:-{2,}|[–—]{1,}|_{2,}|-\s*-)\s*$/;           // "--", "—", "–", "__"
// field names may carry accents ("Título:", "Inscripción:")
const FIELD_RE = /^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 _-]{0,18}?)\s*:\s*(.*)$/;
const keyNorm = (k) => fold(k).toLowerCase().replace(/[\s_-]+/g, '');

function canonicalKey(k) {
  const n = keyNorm(k);
  if (FIELD_ALIASES[n]) return FIELD_ALIASES[n];
  return null;
}

/**
 * Parse the description micro-format.
 *   MSCA09|<Type>|<Format>
 *   Key: value            (0..n lines)
 *   --
 *   free text
 * Returns { header:{raw,type,format}, fields:{Key:[values]}, body, problems[] }.
 */
export function parseDescription(desc) {
  const problems = [];
  const raw = String(desc || '');
  const isHtml = /<\/?[a-z][a-z0-9-]*\b[^>]*>/i.test(raw);
  let text = normaliseText(isHtml ? htmlToText(raw) : raw);
  if (/\(https?:\/\/(?:www\.)?google\.com\/url\?q=\)/i.test(text)) {
    problems.push(P('W_GOOGLE_REDIRECT_ARTIFACT', 'warn', 'description contains an empty Google redirect "(https://www.google.com/url?q=)"'));
    text = text.replace(/\s*\(https?:\/\/(?:www\.)?google\.com\/url\?q=\)/gi, '');
  }
  text = text.replace(/https?:\/\/(?:www\.)?google\.com\/url\?[^\s)]+/gi, m => unwrapGoogleUrl(m) || m);
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  const out = { isHtml, header: null, type: null, format: null, fields: {}, fieldOrder: [], body: '', problems };
  const hm = i < lines.length ? HEADER_RE.exec(lines[i]) : null;
  if (!hm) {
    problems.push(P('E_NO_HEADER', 'error', 'first line is not "MSCA09|<Type>|<Format>"'));
  } else {
    out.header = lines[i].trim();
    const parts = hm[1].split('|').map(s => s.trim());
    out.type = parts[0] || null;
    out.format = parts[1] || null;
    if (parts.length > 2 && parts.slice(2).some(Boolean))
      problems.push(P('W_HEADER_EXTRA', 'warn', `header has extra parts: "${parts.slice(2).join('|')}"`));
    i++;
  }

  // locate the "--" separator
  let sep = -1;
  for (let j = i; j < lines.length; j++) if (SEPARATOR_RE.test(lines[j])) { sep = j; break; }
  let fieldEnd;
  if (sep >= 0) {
    fieldEnd = sep;
    if (lines[sep].trim() !== '--')
      problems.push(P('I_SEPARATOR_VARIANT', 'info', `separator written as "${lines[sep].trim()}" (accepted)`));
  } else {
    // no separator: fields are the run of recognised "Key: value" lines right after the header
    fieldEnd = i;
    while (fieldEnd < lines.length && (lines[fieldEnd].trim() === '' || isFieldLine(lines[fieldEnd]))) fieldEnd++;
    if (out.header) problems.push(P('W_NO_SEPARATOR', 'warn', 'no "--" line between the fields and the text'));
  }

  for (let j = i; j < fieldEnd; j++) {
    const l = lines[j];
    if (!l.trim()) continue;
    const fm = FIELD_RE.exec(l);
    const key = fm && !/^\/\//.test(fm[2]) ? canonicalKey(fm[1]) : null;
    if (key) {
      if (fm[1].trim() !== key && keyNorm(fm[1]) !== keyNorm(key) && !QUIET_ALIASES.has(keyNorm(fm[1])))
        problems.push(P('W_FIELD_ALIAS', 'warn', `field "${fm[1].trim()}" read as "${key}"`));
      const v = fm[2].trim();
      if (!v) { problems.push(P('W_EMPTY_FIELD', 'warn', `empty "${key}:" line`)); continue; }
      (out.fields[key] ||= []).push(v);
      out.fieldOrder.push(key);
    } else if (fm && fm[1].trim().length <= 18 && !/^https?$/i.test(fm[1].trim())) {
      (out.fields['x:' + fm[1].trim()] ||= []).push(fm[2].trim());
      problems.push(P('W_UNKNOWN_FIELD', 'warn', `unknown field "${fm[1].trim()}:" (kept as extra)`));
    } else {
      problems.push(P('W_TEXT_IN_FIELDS', 'warn', `text above the "--" line is not a field: "${l.trim().slice(0, 60)}"`));
    }
  }
  for (const [k, v] of Object.entries(out.fields))
    if (v.length > 1 && !REPEATABLE.has(k) && !k.startsWith('x:'))
      problems.push(P('W_DUP_FIELD', 'warn', `"${k}:" appears ${v.length} times (first one used)`));

  const bodyStart = sep >= 0 ? sep + 1 : fieldEnd;
  out.body = lines.slice(bodyStart).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
function isFieldLine(l) {
  const fm = FIELD_RE.exec(l);
  return !!(fm && !/^\/\//.test(fm[2]) && canonicalKey(fm[1]));
}
function P(code, severity, message, extra) { return { code, severity, message, ...(extra || {}) }; }

/* ------------------------------------------------------------------ field values */

function parseLanguage(v, problems) {
  if (!v) return null;
  const n = v.trim().toLowerCase();
  const map = { english: 'English', ingles: 'English', 'inglés': 'English', spanish: 'Spanish', 'español': 'Spanish',
    espanol: 'Spanish', bilingual: 'Bilingual', bilingue: 'Bilingual', 'bilingüe': 'Bilingual',
    'english & spanish': 'Bilingual', 'english and spanish': 'Bilingual', 'english/spanish': 'Bilingual' };
  if (map[n]) { if (map[n] !== v.trim()) problems.push(P('W_LANGUAGE_SPELLING', 'warn', `Language "${v}" read as ${map[n]}`)); return map[n]; }
  problems.push(P('E_BAD_LANGUAGE', 'error', `Language "${v}" is not English, Spanish or Bilingual`));
  return null;
}
function parseFormat(v, problems) {
  if (!v) { problems.push(P('E_NO_FORMAT', 'error', 'no format on the first line (In person, Hybrid or Virtual)')); return null; }
  const n = v.toLowerCase().replace(/[\s-]+/g, ' ').trim();
  const map = { 'in person': 'In person', inperson: 'In person', presencial: 'In person', hybrid: 'Hybrid',
    hibrida: 'Hybrid', 'híbrida': 'Hybrid', virtual: 'Virtual', online: 'Virtual', zoom: 'Virtual', 'en linea': 'Virtual' };
  if (map[n]) { if (map[n] !== v) problems.push(P('W_FORMAT_SPELLING', 'warn', `format "${v}" read as ${map[n]}`)); return map[n]; }
  problems.push(P('E_BAD_FORMAT', 'error', `format "${v}" is not In person, Hybrid or Virtual`));
  return null;
}
function parseType(v, types, problems) {
  if (!v) { problems.push(P('E_NO_TYPE', 'error', 'no type on the first line')); return null; }
  if (types[v]) return v;
  const hit = Object.keys(types).find(k => k.toLowerCase() === v.toLowerCase());
  if (hit) { problems.push(P('W_TYPE_CASE', 'warn', `type "${v}" read as "${hit}"`)); return hit; }
  problems.push(P('E_UNKNOWN_TYPE', 'error', `unknown type "${v}"`));
  return null;
}
function splitList(v) {
  // comma/semicolon list that ignores separators inside parentheses
  const out = []; let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseCovers(v) {
  if (!v) return null;
  const m = /^(?:spanish-speaking groups in\s+)?districts?\s+(.*)$/i.exec(v.trim()) ||
            /^.*?\bdistricts?\s+([\d,\s&and]+.*)$/i.exec(v.trim());
  if (m && /\d/.test(m[1])) {
    const nums = [...m[1].matchAll(/\d{1,2}/g)].map(x => +x[0]);
    return { text: v, cities: [], districts: [...new Set(nums)] };
  }
  return { text: v, cities: splitList(v).map(s => s.replace(/\.$/, '')), districts: [] };
}
function parseHost(v, problems) {
  if (!v) return [];
  if (!/^D\d+( & D\d+)*$/.test(v.trim()))
    problems.push(P('W_HOST_FORMAT', 'warn', `Host "${v}" is not written "D5" or "D6 & D12"`));
  return [...v.matchAll(/(\d{1,2})/g)].map(m => +m[1]);
}
function parseTopics(v, topics, problems) {
  if (!v) return [];
  return splitList(v).map(t => {
    const hit = topics.find(x => x.toLowerCase() === t.toLowerCase());
    if (!hit) problems.push(P('W_UNKNOWN_TOPIC', 'warn', `Topic "${t}" is not one of the topics in data/kinds.csv`));
    return hit || t;
  });
}
/** "8:00 AM", "8 am", "8:30 a. m.", "08:00" -> "08:00" (24-hour, Pacific wall clock). */
function parseClock(v, problems) {
  if (!v) return null;
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s*m\.?)?/i.exec(v);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) { problems.push(P('W_REGISTRATION_TIME', 'warn', `Registration "${v}" is not a time like 8:00 AM`)); return null; }
  let h = +m[1];
  if (m[3]) { h = h % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0); }
  return `${pad(h)}:${m[2] || '00'}`;
}
function parseImage(v, problems) {
  const url = (/(https?:\/\/\S+)/.exec(v) || [])[1] || v.trim();
  const id = driveId(url);
  if (!id) problems.push(P('W_IMG_NOT_DRIVE', 'warn', `IMG is not a Google Drive link: ${url.slice(0, 80)}`));
  return id
    ? { driveId: id, view: driveViewUrl(id), src: driveImageUrl(id, 1200), thumb: driveImageUrl(id, 640), full: driveImageUrl(id, 2000), fallback: driveThumbUrl(id, 1200) }
    : { driveId: null, view: url, src: url, thumb: url, full: url, fallback: url };
}
const GENERIC_LABELS = /^(click here|here|link|flyer|english|spanish|español|ingles|inglés|document|pdf|en|sp|es)$/i;
function parseLink(v, problems) {
  const m = /^(.*?)\s*(https?:\/\/\S+)\s*$/.exec(v.trim());
  if (!m) { problems.push(P('W_LINK_NO_URL', 'warn', `Link without a URL: "${v.slice(0, 60)}"`)); return null; }
  let label = m[1].trim().replace(/[:\-–—]\s*$/, '').trim();
  const isPdf = /\(pdf\)\s*$/i.test(label) || /\.pdf$/i.test(label);
  label = label.replace(/\s*\(pdf\)\s*$/i, '').replace(/\.pdf$/i, '').trim();
  const id = driveId(m[2]);
  if (!id) problems.push(P('I_LINK_NOT_DRIVE', 'info', `Link is not a Google Drive address: ${m[2].slice(0, 70)}`));
  if (!label) problems.push(P('W_LINK_NO_LABEL', 'warn', 'Link has no label'));
  else if (GENERIC_LABELS.test(label)) problems.push(P('I_LINK_GENERIC_LABEL', 'info', `Link label "${label}" says nothing about the document`));
  return { raw: v.trim(), label: label || 'Document', url: m[2], driveId: id, isPdf, lang: /\b(spanish|español|espanol|sp|es)\b|_sp\b|\bsp\b/i.test(label) ? 'es' : (/\b(english|en)\b/i.test(label) ? 'en' : null) };
}

/* ------------------------------------------------------------------ location / zoom */

const STATE_RE = /^(CA|California|NV|Nevada|AZ|UT|NY|HI|AK|TX|OR|WA|BC|NM)\.?(?:\s+(\d{5})(?:-\d{4})?)?$/i;
export function parseLocation(raw) {
  const s = (raw || '').trim();
  if (!s) return { kind: 'none', raw: '' };
  if (/^https?:\/\//i.test(s)) return { kind: 'online', raw: s, url: s, zoom: parseZoomUrl(s) };
  if (/\b(TBA|TBD|to be announced|por anunciar)\b/i.test(s)) return { kind: 'tba', raw: s };
  let parts = s.split(',').map(x => x.trim()).filter(Boolean);
  // Google "place" autocompletes sometimes repeat the street ("6820 Airport Road, 6820 Airport Road, #C, …")
  const dedup = [];
  for (const p of parts) if (!dedup.some(q => q.toLowerCase().replace(/\.$/, '') === p.toLowerCase().replace(/\.$/, ''))) dedup.push(p);
  const repeated = dedup.length !== parts.length;
  parts = dedup;
  let stateIdx = parts.findIndex(p => STATE_RE.test(p));
  let state = null, zip = null, city = null, country = null;
  if (stateIdx >= 0) {
    const m = STATE_RE.exec(parts[stateIdx]);
    state = m[1].length === 2 ? m[1].toUpperCase() : ({ california: 'CA', nevada: 'NV' }[m[1].toLowerCase()] || m[1]);
    zip = m[2] || null;
    city = stateIdx > 0 ? parts[stateIdx - 1] : null;
  } else {
    const zi = parts.findIndex(p => /^\d{5}$/.test(p));
    if (zi > 0) { zip = parts[zi]; city = parts[zi - 1]; stateIdx = zi; }
  }
  if (!zip) { const z = parts.map(p => /\b(9\d{4})\b/.exec(p)).find(Boolean); if (z) zip = z[1]; }
  if (parts.length > stateIdx + 1 && stateIdx >= 0) country = parts.slice(stateIdx + 1).join(', ');
  const firstStreet = parts.findIndex(p => /^\d+[\w-]*\s+\S/.test(p) || /^\d+[-/]\d+/.test(p));
  const venue = parts.length > 1 && firstStreet !== 0 && !(stateIdx === 1 && firstStreet < 0) ? parts[0] : null;
  const street = firstStreet >= 0 ? parts[firstStreet] : null;
  if (!city && parts.length === 1 && !/\d/.test(parts[0])) city = parts[0];
  if (city && /^\d/.test(city)) city = null;
  return {
    kind: 'address', raw: s, venue, street, city, state, zip, country, repeated,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s)}`,
  };
}
export function parseZoomUrl(u) {
  const m = /^https?:\/\/([a-z0-9.-]*zoom\.(?:us|com))\/(?:j|w|s|my)\/(\d{9,11})(?:\?([^#\s]*))?/i.exec(u || '');
  if (!m) return null;
  const pwd = new URLSearchParams(m[3] || '').get('pwd');
  return { host: m[1], id: m[2], pwd: pwd || null, pwdEmpty: m[3] != null && /(^|&)pwd=($|&)/.test(m[3]) };
}
function zoomDigits(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 9 && d.length <= 11 ? d : null; }
function formatZoomId(d) {
  if (!d) return null;
  return d.length === 11 ? `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` :
         d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` :
                           `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

/* ------------------------------------------------------------------ recurrence */

const DAY_EN = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
const DAY_ES = { SU: 'domingo', MO: 'lunes', TU: 'martes', WE: 'miércoles', TH: 'jueves', FR: 'viernes', SA: 'sábado' };
const ORD_EN = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'Last', '-2': '2nd-to-last' };
const ORD_ES = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º', 5: '5.º', '-1': 'último', '-2': 'penúltimo' };

export function parseRRule(str) {
  if (!str) return null;
  const o = {};
  for (const part of str.split(';')) { const [k, v] = part.split('='); if (k) o[k.toUpperCase()] = v; }
  const r = { raw: str, freq: o.FREQ || null, interval: +(o.INTERVAL || 1), until: o.UNTIL || null,
    count: o.COUNT ? +o.COUNT : null, wkst: o.WKST || null, byday: [], bymonthday: null, bymonth: null, bysetpos: null };
  if (o.BYDAY) r.byday = o.BYDAY.split(',').map(x => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x); return m ? { n: m[1] ? +m[1] : null, day: m[2] } : { n: null, day: x }; });
  if (o.BYMONTHDAY) r.bymonthday = o.BYMONTHDAY.split(',').map(Number);
  if (o.BYMONTH) r.bymonth = o.BYMONTH.split(',').map(Number);
  if (o.BYSETPOS) r.bysetpos = o.BYSETPOS.split(',').map(Number);
  const known = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'WKST', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS']);
  r.unsupported = Object.keys(o).filter(k => !known.has(k));
  return r;
}
function joinList(arr, and) { return arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ` ${and} ` + arr[arr.length - 1]; }
/** "2nd Tuesday of the month" / "2.º martes de cada mes" */
export function describeRRule(r, dtstartLocal) {
  if (!r) return null;
  const every = r.interval > 1;
  if (r.freq === 'WEEKLY') {
    const days = (r.byday.length ? r.byday.map(b => b.day) : [dtstartLocal ? ['MO','TU','WE','TH','FR','SA','SU'][dtstartLocal.weekday - 1] : null]).filter(Boolean);
    return {
      en: every ? `Every ${r.interval} weeks on ${joinList(days.map(d => DAY_EN[d]), '&')}` : `Every ${joinList(days.map(d => DAY_EN[d]), '&')}`,
      es: every ? `Cada ${r.interval} semanas, ${joinList(days.map(d => DAY_ES[d]), 'y')}` : `Todos los ${joinList(days.map(d => DAY_ES[d].endsWith('s') ? DAY_ES[d] : DAY_ES[d] + 's'), 'y')}`,
    };
  }
  if (r.freq === 'MONTHLY' && r.byday.length && r.byday.every(b => b.n != null)) {
    const sameDay = r.byday.every(b => b.day === r.byday[0].day);
    if (sameDay) {
      const ords = r.byday.map(b => b.n);
      return {
        en: `${joinList(ords.map(n => ORD_EN[n] || `${n}th`), '&')} ${DAY_EN[r.byday[0].day]} of ${every ? `every ${r.interval} months` : 'the month'}`,
        es: `${joinList(ords.map(n => ORD_ES[n] || `${n}.º`), 'y')} ${DAY_ES[r.byday[0].day]} de ${every ? `cada ${r.interval} meses` : 'cada mes'}`,
      };
    }
    return {
      en: `${joinList(r.byday.map(b => `${ORD_EN[b.n] || b.n + 'th'} ${DAY_EN[b.day]}`), '&')} of the month`,
      es: `${joinList(r.byday.map(b => `${ORD_ES[b.n] || b.n + '.º'} ${DAY_ES[b.day]}`), 'y')} de cada mes`,
    };
  }
  if (r.freq === 'MONTHLY' && r.bymonthday) return { en: `Day ${r.bymonthday.join(', ')} of the month`, es: `Día ${r.bymonthday.join(', ')} de cada mes` };
  if (r.freq === 'MONTHLY' && dtstartLocal) return { en: `Day ${dtstartLocal.day} of the month`, es: `Día ${dtstartLocal.day} de cada mes` };
  if (r.freq === 'DAILY') return { en: every ? `Every ${r.interval} days` : 'Every day', es: every ? `Cada ${r.interval} días` : 'Todos los días' };
  if (r.freq === 'YEARLY') return { en: 'Every year', es: 'Cada año' };
  return { en: r.raw, es: r.raw };
}
/** Does a local date match the RRULE's BYDAY pattern (MONTHLY nth-weekday / WEEKLY)? */
function matchesPattern(r, dt) {
  if (!r || !r.byday.length) return true;
  const dow = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][dt.weekday - 1];
  return r.byday.some(b => {
    if (b.day !== dow) return false;
    if (b.n == null || r.freq !== 'MONTHLY') return true;
    if (b.n > 0) return Math.ceil(dt.day / 7) === b.n;
    return Math.ceil((dt.daysInMonth - dt.day + 1) / 7) === -b.n;
  });
}

/* ------------------------------------------------------------------ time helpers */

function icalTimeInfo(t) {
  // t: ICAL.Time. Returns { allDay, utc: luxon|undefined, date: 'YYYY-MM-DD'|undefined, tzid }
  if (!t) return null;
  if (t.isDate) return { allDay: true, date: `${t.year}-${pad(t.month)}-${pad(t.day)}`, tzid: null };
  // ical.js gives UTC values the zone "UTC"; floating values "floating" (Google never emits those)
  const tzid = t.zone && t.zone.tzid && !['floating', 'UTC', 'Z'].includes(t.zone.tzid) ? t.zone.tzid : null;
  if (t.zone && t.zone.tzid === 'floating') {
    // floating = wall-clock time with no zone: interpret in the Area's zone
    const dt = DateTime.fromObject({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second }, { zone: AREA_TZ });
    return { allDay: false, utc: dt.toUTC(), tzid: null, floating: true };
  }
  const unix = t.toUnixTime();
  return { allDay: false, utc: DateTime.fromSeconds(unix, { zone: 'utc' }), tzid };
}
function pad(n) { return String(n).padStart(2, '0'); }
function localISO(dt) { return dt.setZone(AREA_TZ).toISO({ suppressMilliseconds: true }); }
function addDays(dateStr, n) { return DateTime.fromISO(dateStr, { zone: AREA_TZ }).plus({ days: n }).toISODate(); }

/* ------------------------------------------------------------------ main parse */

/**
 * Parse an ICS string into normalised master events.
 * opts: { now: Date, types, topics, districts, committees }
 * returns { calendar:{name,tz,prodid}, events:[...], stats, problems:[{uid,summary,...}] }
 */
export function parseCalendar(icsText, opts = {}) {
  const types = opts.types || DEFAULT_TYPES;
  const topics = opts.topics || DEFAULT_TOPICS;
  const districts = opts.districts || DEFAULT_DISTRICTS;
  const committees = opts.committees || DEFAULT_COMMITTEES;
  // Drive ids that must not be published (data/flyer-holds.csv): flyers or PDFs that print personal contact details
  const holds = opts.holds instanceof Set ? opts.holds : new Set(opts.holds || []);
  const now = DateTime.fromJSDate(opts.now || new Date()).setZone(AREA_TZ);

  const jcal = ICAL.parse(icsText);
  const vcal = new ICAL.Component(jcal);
  for (const vtz of vcal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(vtz);
  // Google always ships the VTIMEZONE; if it ever did not, ical.js would treat TZID times as floating.
  if (!ICAL.TimezoneService.has(AREA_TZ)) throw new Error('feed has no VTIMEZONE for ' + AREA_TZ);

  const calendar = {
    name: vcal.getFirstPropertyValue('x-wr-calname') || null,
    tz: vcal.getFirstPropertyValue('x-wr-timezone') || null,
    prodid: vcal.getFirstPropertyValue('prodid') || null,
  };

  const vevents = vcal.getAllSubcomponents('vevent');
  const masters = new Map(); const overrides = [];
  for (const ve of vevents) {
    const uid = ve.getFirstPropertyValue('uid');
    if (ve.hasProperty('recurrence-id')) overrides.push(ve);
    else if (masters.has(uid)) masters.get(uid).dups.push(ve);   // duplicate UID without RECURRENCE-ID
    else masters.set(uid, { ve, dups: [] });
  }

  const events = [];
  for (const [uid, { ve, dups }] of masters) {
    const ev = new ICAL.Event(ve);
    const myOverrides = overrides.filter(o => o.getFirstPropertyValue('uid') === uid);
    for (const o of myOverrides) ev.relateException(new ICAL.Event(o));
    const norm = normaliseEvent(ve, ev, { types, topics, districts, committees, now, holds });
    if (dups.length) norm.problems.push(P('E_DUPLICATE_UID', 'error', `${dups.length} more VEVENT(s) share this UID without RECURRENCE-ID`));
    norm.overrides = myOverrides.map(o => normaliseOverride(o, norm, { types, topics, districts, committees, now, holds }));
    // "Ended on" = the date of the last real meeting. The UNTIL bound itself is usually 23:59 Pacific
    // stored in UTC, which would read as the next day.
    if (norm.recurrence && norm.recurrence.untilLocal) {
      const it = ev.iterator(); let next, last = null, guard = 0;
      while ((next = it.next()) && guard++ < 5000) {
        const st = icalTimeInfo(ev.getOccurrenceDetails(next).startDate);
        last = st.allDay ? st.date : st.utc.setZone(AREA_TZ).toISODate();
      }
      if (last) norm.recurrence.lastDate = last;
    }
    scanEntry([ve, ...dups, ...myOverrides], norm.problems);
    norm._ical = ev;   // non-enumerable below
    Object.defineProperty(norm, '_ical', { enumerable: false });
    events.push(norm);
  }
  // overrides whose master is missing (Google can export these when the series was deleted but one instance kept)
  for (const o of overrides) {
    const uid = o.getFirstPropertyValue('uid');
    if (!masters.has(uid)) {
      const ev = new ICAL.Event(o);
      const norm = normaliseEvent(o, ev, { types, topics, districts, committees, now, holds });
      norm.problems.push(P('W_ORPHAN_OVERRIDE', 'warn', 'a moved/edited instance whose series is not in the feed — treated as a one-off'));
      scanEntry([o], norm.problems);
      norm.recurrence = null;
      Object.defineProperty(norm, '_ical', { value: ev, enumerable: false });
      events.push(norm);
    }
  }
  crossChecks(events);
  events.sort((a, b) => (a.time.startUtc || '').localeCompare(b.time.startUtc || '') || a.uid.localeCompare(b.uid));
  return { calendar, events, stats: stats(events, vevents.length, overrides.length) };
}

function prop(ve, name) { const v = ve.getFirstPropertyValue(name); return v == null ? null : v; }

function normaliseEvent(ve, ev, ctx) {
  const problems = [];
  const uid = prop(ve, 'uid');
  const summaryRaw = (prop(ve, 'summary') || '').trim();
  const status = (prop(ve, 'status') || 'CONFIRMED').toUpperCase();
  const d = parseDescription(prop(ve, 'description') || '');
  problems.push(...d.problems);

  const type = d.header ? parseType(d.type, ctx.types, problems) : null;
  const format = d.header ? parseFormat(d.format, problems) : null;
  const f1 = k => (d.fields[k] || [])[0] || null;
  const language = parseLanguage(f1('Language'), problems);
  if (d.header && !f1('Language')) problems.push(P('W_NO_LANGUAGE', 'warn', 'no "Language:" line'));

  /* ---- time */
  const s = icalTimeInfo(ev.startDate);
  let e = ev.endDate ? icalTimeInfo(ev.endDate) : null;
  const hasEnd = ve.hasProperty('dtend') || ve.hasProperty('duration');
  const time = { allDay: s.allDay, tzid: s.tzid, storedAs: s.allDay ? 'date' : (s.tzid ? 'tzid' : 'utc'),
    dtstartRaw: ve.getFirstProperty('dtstart').toICALString().replace(/^DTSTART/, '') };
  if (s.allDay) {
    const endEx = e && e.allDay ? e.date : addDays(s.date, 1);
    time.startDate = s.date; time.endDateExclusive = endEx; time.endDate = addDays(endEx, -1);
    time.days = Math.max(1, Math.round(DateTime.fromISO(endEx).diff(DateTime.fromISO(s.date), 'days').days));
    time.startUtc = DateTime.fromISO(s.date, { zone: AREA_TZ }).toUTC().toISO({ suppressMilliseconds: true });
    time.endUtc = DateTime.fromISO(endEx, { zone: AREA_TZ }).toUTC().toISO({ suppressMilliseconds: true });
  } else {
    const st = s.utc; const en = e && !e.allDay ? e.utc : st;
    time.start = localISO(st); time.end = localISO(en);
    time.startUtc = st.toISO({ suppressMilliseconds: true }); time.endUtc = en.toISO({ suppressMilliseconds: true });
    time.durationMinutes = Math.round(en.diff(st, 'minutes').minutes);
    const ls = st.setZone(AREA_TZ), le = en.setZone(AREA_TZ);
    time.startDate = ls.toISODate(); time.endDate = le.toISODate();
    time.localStart = ls.toFormat('HH:mm'); time.localEnd = le.toFormat('HH:mm');
    time.weekday = ls.toFormat('cccc');
    time.days = le.startOf('day').diff(ls.startOf('day'), 'days').days + 1;
    if (!hasEnd) problems.push(P('I_NO_END', 'info', 'no DTEND/DURATION — shown with a start time only'));
    if (time.durationMinutes < 0) problems.push(P('E_END_BEFORE_START', 'error', 'ends before it starts'));
    if (time.durationMinutes === 0 && hasEnd) problems.push(P('I_ZERO_DURATION', 'info', 'zero-length entry'));
    if (time.durationMinutes > 24 * 60) problems.push(P('I_LONG_TIMED', 'info', `timed entry spans ${Math.round(time.durationMinutes / 60)} h — multi-day event?`));
    const h = ls.hour;
    if (h < 6 || h >= 23) problems.push(P('W_ODD_HOUR', 'warn', `starts at ${ls.toFormat('h:mm a')} Pacific — check the time zone it was entered in`));
  }

  /* ---- recurrence */
  let recurrence = null;
  if (ve.hasProperty('rrule')) {
    const rrProps = ve.getAllProperties('rrule');
    const rstr = rrProps[0].getFirstValue().toString();
    const r = parseRRule(rstr);
    if (rrProps.length > 1) problems.push(P('W_MULTI_RRULE', 'warn', 'more than one RRULE'));
    if (r.unsupported.length) problems.push(P('W_RRULE_PARTS', 'warn', `RRULE uses ${r.unsupported.join(', ')}`));
    const startLocal = s.allDay ? DateTime.fromISO(s.date, { zone: AREA_TZ }) : s.utc.setZone(AREA_TZ);
    let untilLocal = null;
    if (r.until) {
      const u = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(r.until);
      if (u) {
        untilLocal = u[4] ? DateTime.fromObject({ year: +u[1], month: +u[2], day: +u[3], hour: +u[4], minute: +u[5], second: +u[6] }, { zone: u[7] ? 'utc' : AREA_TZ }).setZone(AREA_TZ)
                          : DateTime.fromObject({ year: +u[1], month: +u[2], day: +u[3] }, { zone: AREA_TZ }).endOf('day');
      }
    }
    const exdates = [];
    for (const p of ve.getAllProperties('exdate')) for (const v of p.getValues()) {
      const ti = icalTimeInfo(v); exdates.push(ti.allDay ? ti.date : localISO(ti.utc));
    }
    const rdates = [];
    for (const p of ve.getAllProperties('rdate')) for (const v of p.getValues()) {
      if (v && v.year) { const ti = icalTimeInfo(v); rdates.push(ti.allDay ? ti.date : localISO(ti.utc)); }
    }
    recurrence = {
      rrule: rstr, freq: r.freq, interval: r.interval,
      byday: r.byday.map(b => (b.n != null ? String(b.n) : '') + b.day),
      bymonthday: r.bymonthday, bymonth: r.bymonth, count: r.count, wkst: r.wkst,
      until: r.until, untilLocal: untilLocal ? untilLocal.toISO({ suppressMilliseconds: true }) : null,
      lastDate: untilLocal ? untilLocal.toISODate() : null,
      exdates, rdates,
      text: describeRRule(r, startLocal),
      active: !untilLocal || untilLocal >= ctx.now,
      startsInFuture: startLocal > ctx.now,
    };
    if (!r.until && !r.count) problems.push(P('E_RRULE_NO_END', 'error', 'repeats forever — give it an end date (Ends on…)'));
    if (!matchesPattern(r, startLocal))
      problems.push(P('W_DTSTART_OFF_PATTERN', 'warn', `first date ${startLocal.toISODate()} (${startLocal.toFormat('ccc')}) is not a "${recurrence.text.en}" — Google shows it as an extra occurrence`));
    if (untilLocal && untilLocal < startLocal) problems.push(P('E_UNTIL_BEFORE_START', 'error', 'repeat ends before it starts'));
    if (!s.allDay && !s.tzid) problems.push(P('W_RRULE_UTC', 'warn', 'repeating entry stored in UTC — times will shift by an hour at DST changes'));
  }

  /* ---- location, zoom, web, email */
  const location = parseLocation(prop(ve, 'location') || '');
  const zfield = f1('ZoomID'); const zd = zoomDigits(zfield);
  if (zfield && !zd) problems.push(P('W_ZOOMID_SHAPE', 'warn', `ZoomID "${zfield}" is not 9–11 digits`));
  const zlink = f1('ZoomLink'); const zlinkParsed = zlink ? parseZoomUrl(zlink) : null;
  if (zlink && !/^https?:\/\//i.test(zlink)) problems.push(P('W_ZOOMLINK_SHAPE', 'warn', `ZoomLink is not a URL: ${zlink}`));
  const locZoom = location.kind === 'online' ? location.zoom : null;
  const zoomIdDigits = zd || (zlinkParsed && zlinkParsed.id) || (locZoom && locZoom.id) || null;
  let joinUrl = zlink || (location.kind === 'online' ? location.url : null) || null;
  let joinSource = zlink ? 'ZoomLink' : (location.kind === 'online' ? 'LOCATION' : null);
  if (!joinUrl && zoomIdDigits) { joinUrl = `https://zoom.us/j/${zoomIdDigits}`; joinSource = 'derived'; }
  for (const zp of [zlinkParsed, locZoom].filter(Boolean)) {
    if (zd && zp.id !== zd) problems.push(P('W_ZOOM_MISMATCH', 'warn', `ZoomID ${zfield} does not match the link's meeting ${zp.id}`));
    if (zp.pwdEmpty) problems.push(P('W_ZOOM_PWD_EMPTY', 'warn', 'Zoom link ends in "?pwd=" with nothing after it'));
  }
  const zoom = zoomIdDigits || joinUrl ? {
    id: zoomIdDigits ? formatZoomId(zoomIdDigits) : null, idDigits: zoomIdDigits,
    idAsWritten: zfield, passcode: f1('Passcode'), joinUrl, joinSource,
  } : (f1('Passcode') ? { id: null, idDigits: null, passcode: f1('Passcode'), joinUrl: null, joinSource: null } : null);
  if (f1('Passcode') && !zoomIdDigits && !joinUrl) problems.push(P('W_PASSCODE_ONLY', 'warn', 'Passcode without a ZoomID or link'));

  const emails = (d.fields.Email || []).flatMap(v => v.match(EMAIL_RE) || []).map(a => ({ address: a.toLowerCase(), kind: classifyEmail(a) }));
  for (const em of emails) if (em.kind === 'personal') problems.push(P('E_PERSONAL_EMAIL', 'error', `personal e-mail in Email: field — ${em.address}`));

  /* ---- body (public "About" text) with anonymity scrub */
  const bodyScan = scanBody(d.body);
  problems.push(...bodyScan.problems);

  /* ---- other fields */
  // flyers and documents on hold (data/flyer-holds.csv) never reach the site, its JSON or its .ics files
  const holds = ctx.holds || new Set();
  const held = [];
  const keep = (field) => (x) => {
    if (x && x.driveId && holds.has(x.driveId)) {
      held.push({ id: x.driveId, field });
      problems.push(P('W_HELD_FILE', 'warn', `${field} ${x.driveId} is on hold in data/flyer-holds.csv (it prints personal contact details) and is not shown — ask the host for a copy with role contacts only`, { driveId: x.driveId }));
      return false;
    }
    return !!x;
  };
  const allLinks = (d.fields.Link || []).map(v => parseLink(v, problems)).filter(Boolean);
  const images = (d.fields.IMG || []).map(v => parseImage(v, problems)).filter(keep('IMG'));
  const links = allLinks.filter(keep('Link'));
  // public text: no links to held files, no lines that only repeat an attachment's name ("SP_35 Foro")
  if (bodyScan.publicText) {
    let tx = bodyScan.publicText;
    for (const id of holds) if (tx.includes(id)) {
      tx = tx.replace(new RegExp(`\S*${id.replace(/[-]/g, '\-')}\S*`, 'g'), '');
      if (!held.some(h => h.id === id)) { held.push({ id, field: 'text' }); problems.push(P('W_HELD_FILE', 'warn', `the text links to ${id}, which is on hold in data/flyer-holds.csv — link removed`, { driveId: id })); }
    }
    const names = new Set(allLinks.map(k => k.label.trim().toLowerCase()).filter(Boolean));
    for (const k of allLinks) { const raw = (/^(.*?)\s*https?:\/\//.exec(k.raw || '') || [])[1]; if (raw) names.add(raw.trim().toLowerCase()); }
    tx = tx.split('\n').filter(l => !names.has(l.trim().toLowerCase())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    bodyScan.publicText = tx;
  }
  const hosts = parseHost(f1('Host'), problems);
  const topicList = parseTopics(f1('Topic'), ctx.topics, problems);
  const covers = parseCovers(f1('Covers'));
  const web = f1('Web') ? withScheme(f1('Web')) : null;
  const extra = Object.fromEntries(Object.entries(d.fields).filter(([k]) => k.startsWith('x:')).map(([k, v]) => [k.slice(2), v]));
  for (const u of [...(d.fields.IMG || []), ...(d.fields.Link || []), web || '', location.raw])
    if (/msca09aa\.org\/(wp-content|event|wp-json)/i.test(u)) problems.push(P('W_OLD_SITE_LINK', 'warn', 'links to the old WordPress site'));

  /* ---- cancellation / postponement markers */
  const cancelled = status === 'CANCELLED' || /^\s*\(?(cancel+ed|cancelad[oa]|suspendid[oa])\b/i.test(summaryRaw);
  const postponed = /^\s*\(?(postponed|pospuest[oa]|rescheduled)\b/i.test(summaryRaw);

  const out = {
    uid,
    slug: recurrence ? slugify(uid) : `${slugify(summaryRaw, 60)}-${time.startDate}`,
    kind: recurrence ? 'series' : 'single',
    status: cancelled ? 'cancelled' : postponed ? 'postponed' : status.toLowerCase(),
    summary: summaryRaw,
    titleEs: f1('Title-ES'),
    type, typeRaw: d.type, format, formatRaw: d.format, language,
    group: type ? ctx.types[type].group : null,
    pages: type ? ctx.types[type].pages : [],
    isMeeting: !!(type && ctx.types[type].pages.includes('meetings') && (recurrence || ctx.types[type].pages.length === 1)),
    isEvent: !!(type && ctx.types[type].pages.includes('events') && (!recurrence || ctx.types[type].pages.length === 1)),
    time, recurrence,
    location, zoom, web, emails: emails.filter(x => x.kind === 'role'), personalEmailsDropped: emails.filter(x => x.kind === 'personal').length,
    covers, hosts, topics: topicList, cost: f1('Cost'), images, links,
    notes: d.fields.Note || [], notesEs: d.fields.Nota || [], extraFields: extra,
    registration: parseClock(f1('Registration'), problems),
    held,
    body: bodyScan.publicText, bodyRaw: d.body,
    descriptionWasHtml: d.isHtml,
    meta: {
      created: iso(prop(ve, 'created')), lastModified: iso(prop(ve, 'last-modified')),
      sequence: +(prop(ve, 'sequence') || 0), class: prop(ve, 'class'), transp: prop(ve, 'transp'),
      icalStatus: status,
    },
    problems,
  };
  classify(out, ctx);
  formatChecks(out, ctx);
  return out;
}

function iso(t) { if (!t) return null; try { return DateTime.fromSeconds(t.toUnixTime(), { zone: 'utc' }).toISO({ suppressMilliseconds: true }); } catch { return null; } }

function normaliseOverride(o, master, ctx) {
  const ev = new ICAL.Event(o);
  const n = normaliseEvent(o, ev, ctx);
  const rid = icalTimeInfo(o.getFirstPropertyValue('recurrence-id'));
  // An override that lost its header (edited in a client that dropped the description) inherits the master's fields.
  const inherit = !n.type;
  return {
    recurrenceId: rid.allDay ? rid.date : localISO(rid.utc),
    status: n.status, time: n.time, summary: n.summary || master.summary,
    location: n.location.kind === 'none' && inherit ? master.location : n.location,
    inheritsFields: inherit,
    fields: inherit ? null : n,
    problems: inherit ? n.problems.filter(p => p.code !== 'E_NO_HEADER') : n.problems,
  };
}

/* ------------------------------------------------------------------ body scrub */

function scanBody(body) {
  const problems = [];
  let text = body || '';
  // maintainers' provenance lines are not for the public page
  text = text.split('\n').filter(l => !/^\s*Source\s*:/i.test(l)).join('\n');
  // passwords for (old) protected web pages are not for the public site, in English or Spanish
  // ("Password protected: …", "Protegido por contraseña: …"); Zoom passcodes stay.
  // The password ends at a space or a closing bracket, so "(… Password protected: X)." keeps its ")".
  text = text.replace(/[;,.]?\s*(?:Password[\s-]*Protected|Protegid[oa]\s+(?:por|con)\s+contrase[nñ]a)\s*:?\s*[^\s)\]]+/gi, '');
  let dropped = 0;
  text = text.replace(EMAIL_RE, a => {
    if (classifyEmail(a) === 'personal') { dropped++; problems.push(P('E_PERSONAL_EMAIL_BODY', 'error', `personal e-mail in the text — ${a}`)); return '[e-mail removed]'; }
    return a;
  });
  for (const m of (body || '').matchAll(PHONE_RE)) {
    const before = body.slice(Math.max(0, m.index - 28), m.index);
    if (NOT_A_PHONE_BEFORE.test(before) || /zoom\.us\/j\/\d*$/.test(before)) continue;
    if (['800', '833', '844', '855', '866', '877', '888'].includes(m[1])) continue;
    problems.push(P('W_PHONE_BODY', 'warn', `phone number in the text — ${m[0].trim()} (allowed only for a public office line)`));
  }
  if (/Ş/.test(body || '')) problems.push(P('W_MOJIBAKE', 'warn', 'garbled character "Ş" (an "ñ" that was pasted badly?)'));
  const zoomIdsInBody = [...(body || '').matchAll(/(?:meeting\s*id|zoom\s*(?:meeting\s*)?id|id de reuni[oó]n|ID dereunion|\bID)\s*:?\s*(\d{3}[\s-]?\d{3,4}[\s-]?\d{3,4})/gi)].map(m => m[1].replace(/\D/g, ''));
  return { publicText: text.trim(), personalDropped: dropped, problems, zoomIdsInBody: [...new Set(zoomIdsInBody)] };
}

/* ------------------------------------------------------------------ whole-entry anonymity scan */

// Properties that hold dates, ids and settings, not text that people type.
const NOT_TYPED = new Set(['uid', 'dtstamp', 'dtstart', 'dtend', 'due', 'duration', 'created', 'last-modified', 'sequence',
  'status', 'transp', 'class', 'rrule', 'rdate', 'exdate', 'recurrence-id', 'priority']);
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);

/**
 * Personal e-mail addresses and phone numbers anywhere in an entry as it is stored — every typed property of the
 * entry, of a duplicate copy and of its edited occurrences — that the field and text checks above have not reported:
 * an unknown "Questions:" field, a Note: line, the place, the title, a line above "--" that is not a field …
 * The site does not show all of those, but the copy of the calendar kept in the repository (data/calendar.ics,
 * public history) keeps every word, so scripts/check-calendar.mjs and the calendar-mirror check in
 * .github/workflows/deploy.yml must see them: a personal e-mail is E_PERSONAL_EMAIL (anonymity), a phone number
 * W_PHONE_ENTRY (like W_PHONE_BODY: allowed only for a public office line).
 */
function scanEntry(components, problems) {
  const seenMail = new Set(problems.filter(p => /^E_PERSONAL_EMAIL/.test(p.code)).flatMap(p => (p.message.match(EMAIL_RE) || []).map(a => a.toLowerCase())));
  const seenPhone = new Set(problems.filter(p => p.code === 'W_PHONE_BODY').flatMap(p => [...p.message.matchAll(PHONE_RE)].map(m => m[1] + m[2] + m[3])));
  for (const comp of components) {
    for (const pr of comp.getAllProperties()) {
      if (NOT_TYPED.has(pr.name)) continue;
      for (const v of pr.getValues()) {
        const s = String(v == null ? '' : v);
        for (const a of s.match(EMAIL_RE) || []) {
          const addr = a.toLowerCase();
          if (seenMail.has(addr) || classifyEmail(addr) !== 'personal') continue;
          seenMail.add(addr);
          problems.push(P('E_PERSONAL_EMAIL', 'error', `personal e-mail in the entry (${pr.name.toUpperCase()}) — ${addr}`));
        }
        // web addresses carry long ids (Drive, Zoom, forms) that can look like phone numbers
        const text = s.replace(/\bhttps?:\/\/\S+/gi, ' ');
        for (const m of text.matchAll(PHONE_RE)) {
          const before = text.slice(Math.max(0, m.index - 28), m.index);
          if (NOT_A_PHONE_BEFORE.test(before) || TOLL_FREE.has(m[1])) continue;
          const digits = m[1] + m[2] + m[3];
          if (seenPhone.has(digits)) continue;
          seenPhone.add(digits);
          problems.push(P('W_PHONE_ENTRY', 'warn', `phone number in the entry (${pr.name.toUpperCase()}) — ${m[0].trim()} (allowed only for a public office line)`));
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ classification */

const DISTRICT_MENTION = /\b(?:Districts?|Distritos?|D)\s*0?(\d{1,2})((?:\s*(?:,|&|and|y|\/)\s*(?:D(?:istrict)?\s*)?0?\d{1,2}(?!\d))*)/gi;
function numsFromMention(m) { return [m[1], ...[...(m[2] || '').matchAll(/(\d{1,2})/g)].map(x => x[1])].map(Number); }

const ruleCache = new WeakMap();
function normaliseCommitteeRule(c) {
  if (ruleCache.has(c)) return ruleCache.get(c);
  const emails = [...(c.emails || []), ...(c.email ? [c.email] : [])].map(x => String(x).toLowerCase());
  const keywords = c.keywords || [];
  const matchers = keywords.map(keywordMatcher);
  if (c.match instanceof RegExp) matchers.push(s => c.match.test(s));
  const r = { emails, types: c.types || [], topics: c.topics || [], matchers };
  ruleCache.set(c, r);
  return r;
}

function classify(e, ctx) {
  const known = new Map(); // number -> district key
  for (const [key, nums] of Object.entries(ctx.districts)) for (const n of nums) known.set(n, key);
  const refs = new Map(); // key -> role (own > host > covers > mention)
  const rank = { own: 4, host: 3, covers: 2, mention: 1 };
  const add = (n, role, src) => {
    const key = known.get(n);
    if (!key) { e.problems.push(P('I_UNKNOWN_DISTRICT', 'info', `District ${n} (from ${src}) is not in data/districts.csv`)); return; }
    const cur = refs.get(key);
    if (!cur || rank[role] > rank[cur.role]) refs.set(key, { district: key, role, source: src });
  };
  const um = /^msca09-d(\d{2})(?:-(\d{2}))?@msca09\.local$/i.exec(e.uid);
  if (um) { add(+um[1], 'own', 'uid'); if (um[2]) add(+um[2], 'own', 'uid'); }
  for (const em of e.emails) { const m = /^d(\d{1,2})dcmc@msca09aa\.org$/.exec(em.address); if (m) add(+m[1], e.type === 'District' ? 'own' : 'host', 'email'); }
  const sm = /^\s*(?:District|Distrito)\s+(\d{1,2})(?:\s*&\s*(\d{1,2}))?(?:\s*\((?:Spanish|Español)\))?\s*$/i.exec(e.summary);
  if (sm && e.type === 'District') { add(+sm[1], 'own', 'summary'); if (sm[2]) add(+sm[2], 'own', 'summary'); }
  for (const n of e.hosts) add(n, 'host', 'Host');
  for (const m of e.summary.matchAll(DISTRICT_MENTION)) for (const n of numsFromMention(m)) if (!/area\s*$/i.test(e.summary.slice(0, m.index))) add(n, 'mention', 'summary');
  const hb = /hosted by:?\s*((?:districts?|distritos?|D)\s*[\d\s,&/and]+)/i.exec(e.bodyRaw || '');
  if (hb) for (const m of hb[1].matchAll(DISTRICT_MENTION)) for (const n of numsFromMention(m)) add(n, 'host', 'body "Hosted by"');
  if (e.covers && e.covers.districts.length && e.type === 'District')
    for (const n of e.covers.districts) { const key = known.get(n); if (key && !refs.has(key)) refs.set(key, { district: key, role: 'covers', source: 'Covers' }); }
  e.districts = [...refs.values()];
  e.districtOwn = e.districts.find(x => x.role === 'own')?.district || null;

  // committees: own (Email: line, or a Committee entry whose title names it) > related (title) > type > topic
  const crefs = new Map();
  const crank = { own: 4, related: 3, type: 2, topic: 1 };
  const cadd = (slug, role, src) => { const cur = crefs.get(slug); if (!cur || crank[role] > crank[cur.role]) crefs.set(slug, { committee: slug, role, source: src }); };
  const titles = [e.summary, e.titleEs].filter(Boolean);
  for (const [slug, c0] of Object.entries(ctx.committees)) {
    const c = normaliseCommitteeRule(c0);
    for (const em of e.emails) if (c.emails.includes(em.address)) cadd(slug, 'own', 'email');
    if (e.type !== 'District' && c.matchers.some(m => titles.some(t => m(t)))) cadd(slug, e.type === 'Committee' ? 'own' : 'related', 'summary');
    if (e.type && c.types.includes(e.type)) cadd(slug, 'type', 'type');
    for (const t of e.topics) if (c.topics.some(x => x.toLowerCase() === String(t).toLowerCase())) cadd(slug, 'topic', 'Topic');
  }
  e.committees = [...crefs.values()].sort((a, b) => crank[b.role] - crank[a.role]);
  e.committeeOwn = e.committees.find(x => x.role === 'own')?.committee || null;

  // Area business
  e.isAreaBusiness = ['Area', 'Area Committee', 'Assembly'].includes(e.type);
  e.areaKind = e.type === 'Area' ? 'area-meeting'
    : e.type === 'Area Committee' ? (/budget/i.test(e.summary) ? 'budget' : /orientation/i.test(e.summary) ? 'orientation' : 'asc')
    : e.type === 'Assembly' ? (/election/i.test(e.summary) ? 'election-assembly' : /pre-?conference/i.test(e.summary) ? 'pre-conference' : /share ?back|report back/i.test(e.summary) ? 'delegate-shareback' : 'asa')
    : e.type === 'Foro' ? 'foro' : e.type === 'Servathon' ? 'servathon'
    : e.type === 'Conference' ? 'conference-cycle' : null;
}

function formatChecks(e, ctx) {
  const pr = e.problems;
  const upcoming = (e.recurrence ? e.recurrence.active : e.time.endUtc >= ctx.now.toUTC().toISO());
  if (!upcoming) return;
  const hasJoin = !!(e.zoom && (e.zoom.idDigits || e.zoom.joinUrl)) || !!e.web || e.emails.length > 0;
  if ((e.format === 'Virtual' || e.format === 'Hybrid') && !hasJoin)
    pr.push(P('W_NO_JOIN_INFO', 'warn', `${e.format.toLowerCase()}, but nothing says how to join (ZoomID, ZoomLink, Email or Web)`));
  if ((e.format === 'In person' || e.format === 'Hybrid') && e.location.kind === 'none' && !(e.notes.join(' ').match(/website|ask|place/i)))
    pr.push(P('W_NO_PLACE', 'warn', `${e.format.toLowerCase()}, but Location is empty`));
  if (e.format === 'Virtual' && e.location.kind === 'address')
    pr.push(P('W_VIRTUAL_WITH_ADDRESS', 'warn', 'Virtual, but Location is a street address'));
  if (e.format === 'In person' && e.location.kind === 'online')
    pr.push(P('W_INPERSON_WITH_URL', 'warn', 'In person, but Location is a web link'));
  if (e.format === 'In person' && e.zoom && e.zoom.idDigits)
    pr.push(P('W_INPERSON_WITH_ZOOM', 'warn', 'In person, but it has Zoom details — Hybrid?'));
  if ((e.format === 'In person' || e.format === 'Hybrid') && e.location.kind === 'address' && !e.location.street)
    pr.push(P('W_LOCATION_NO_STREET', 'warn', `Location "${e.location.raw}" has no street address — people cannot find the room`));
  // anonymity safety net: a bare street address could be someone's home
  if ((e.format === 'In person' || e.format === 'Hybrid') && e.location.kind === 'address' && e.location.street && !e.location.venue && /^\s*\d/.test(e.location.raw))
    pr.push(P('W_LOCATION_NO_VENUE', 'warn', `Location "${e.location.raw}" starts with a street address and names no place — put the venue first ("Alano Club, 123 Main St, …"); never use a private home`));
}

function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function crossChecks(events) {
  // date written in the title vs the entry's date
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  for (const e of events) {
    if (e.kind !== 'single') continue;
    const [y, mo, da] = e.time.startDate.split('-').map(Number);
    const found = [];
    for (const m of e.summary.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) found.push({ mo: +m[1], d: +m[2], txt: m[0] });
    for (const m of e.summary.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi)) found.push({ mo: MONTHS[m[1].toLowerCase()], d: +m[2], txt: m[0] });
    for (const f of found) if (f.mo >= 1 && f.mo <= 12 && f.d >= 1 && f.d <= 31 && !(f.mo === mo && (f.d === da || (e.time.days > 1 && f.d >= da && f.d < da + e.time.days)))) {
      e.problems.push(P('W_TITLE_DATE_MISMATCH', 'warn', `title says "${f.txt}" but the entry is on ${e.time.startDate}`)); break;
    }
    if (/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(e.summary) || /\b\d{1,5}\s+[NSEW]?\.?\s*\w+\s+(St|Rd|Ave|Blvd|Dr)\b/i.test(e.summary))
      e.problems.push(P('I_TITLE_HAS_DETAILS', 'info', 'title carries a time or an address — the page shows those already'));
    const stated = statedTime(e.summary) || statedTime(e.bodyRaw);
    if (e.time.allDay && e.time.days === 1 && stated)
      e.problems.push(P('W_ALLDAY_WITH_TIME', 'warn', `all-day entry, but the text gives a time (${stated.text}) — make it a timed entry so the site can show it`));
  }
  // likely duplicates: same local date + same type + overlapping title words or same location
  const singles = events.filter(e => e.kind === 'single');
  for (let i = 0; i < singles.length; i++) for (let j = i + 1; j < singles.length; j++) {
    const a = singles[i], b = singles[j];
    if (a.time.startDate !== b.time.startDate || a.type !== b.type) continue;
    const sameLoc = a.location.raw && a.location.raw === b.location.raw;
    const wa = new Set(slugify(a.summary).split('-').filter(w => w.length > 3)), wb = slugify(b.summary).split('-').filter(w => w.length > 3);
    const overlap = wb.filter(w => wa.has(w)).length;
    if (sameLoc || overlap >= 2) {
      for (const [x, y] of [[a, b], [b, a]]) x.problems.push(P('W_POSSIBLE_DUPLICATE', 'warn', `same day and type as "${y.summary}" (${y.uid}) — one entry, or Title-ES on one?`));
    }
  }
  // city spelling: a city used once that is 1-2 letters away from one used more often (or in a Covers list)
  const cityCount = {};
  for (const e of events) {
    if (e.location.city) cityCount[e.location.city] = (cityCount[e.location.city] || 0) + 1;
    for (const c of (e.covers && e.covers.cities) || []) cityCount[c] = (cityCount[c] || 0) + 2;
  }
  for (const e of events) {
    const c = e.location.city; if (!c || cityCount[c] > 1 || (e.location.state && e.location.state !== 'CA')) continue;
    const better = Object.keys(cityCount).find(o => o !== c && cityCount[o] >= 2 && lev(o.toLowerCase(), c.toLowerCase()) <= 2 && o.toLowerCase() !== c.toLowerCase());
    const caseOnly = Object.keys(cityCount).find(o => o !== c && o.toLowerCase() === c.toLowerCase());
    if (better || caseOnly) e.problems.push(P('W_CITY_SPELLING', 'warn', `city "${c}" in Location — did you mean "${better || caseOnly}"? (the City filter treats them as different places)`));
  }
  // body Zoom ID that is not in the fields
  for (const e of events) {
    const ids = scanBody(e.bodyRaw).zoomIdsInBody;
    if (!ids.length) continue;
    if (!e.zoom || !e.zoom.idDigits) e.problems.push(P('W_ZOOM_ONLY_IN_TEXT', 'warn', `the text has Zoom meeting ID ${ids.map(formatZoomId).join(', ')} but there is no ZoomID: line`));
    else if (!ids.includes(e.zoom.idDigits)) e.problems.push(P('W_ZOOM_TEXT_DIFFERS', 'warn', `the text's Zoom ID ${ids.map(formatZoomId).join(', ')} differs from ZoomID ${e.zoom.id}`));
  }
}

/** First clock time written in free text: "7-9PM" -> 19:00, "9:00 – 3:00pm" -> 09:00, "6:00 to 9:00pm" -> 18:00,
 *  "3 pm EST/1 pm PST" -> 15:00 (first mention).  Returns { hhmm, text } or null.  Heuristic, for checks only. */
export function statedTime(s) {
  if (!s) return null;
  const range = /\b(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i.exec(s);
  const single = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i.exec(s);
  let h, mi, text;
  if (range && (!single || range.index <= single.index)) {
    const endMer = range[6].toLowerCase(); let mer = (range[3] || '').toLowerCase();
    if (!mer) { const a = +range[1] % 12, b = +range[4] % 12; mer = a <= b ? endMer : (endMer === 'p' ? 'a' : 'p'); }
    h = +range[1] % 12 + (mer === 'p' ? 12 : 0); mi = +(range[2] || 0); text = range[0];
  } else if (single) {
    h = +single[1] % 12 + (single[3].toLowerCase() === 'p' ? 12 : 0); mi = +(single[2] || 0); text = single[0];
  } else return null;
  if (h > 23 || mi > 59) return null;
  return { hhmm: `${pad(h)}:${pad(mi)}`, text: text.trim() };
}

function stats(events, vevents, overrides) {
  const by = (f) => events.reduce((m, e) => { const k = f(e) ?? '(none)'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    vevents, masters: events.length, overrides,
    series: events.filter(e => e.kind === 'series').length,
    singles: events.filter(e => e.kind === 'single').length,
    byType: by(e => e.type), byFormat: by(e => e.format), byLanguage: by(e => e.language),
    byStoredAs: by(e => e.time.storedAs),
  };
}

/* ------------------------------------------------------------------ expansion */

/**
 * Expand master events into occurrences overlapping [from, to) (dates in America/Los_Angeles,
 * 'YYYY-MM-DD' or ISO).  EXDATE removes instances, RECURRENCE-ID overrides replace them,
 * STATUS:CANCELLED overrides are kept with status 'cancelled' (filter them in the UI).
 */
export function expandOccurrences(events, from, to, { includeCancelled = true } = {}) {
  const winStart = DateTime.fromISO(from, { zone: AREA_TZ });
  const winEnd = DateTime.fromISO(to, { zone: AREA_TZ });
  const out = [];
  for (const e of events) {
    if (e.kind === 'single') {
      if (overlaps(e.time, winStart, winEnd)) out.push(occurrence(e, e.time, null, null));
      continue;
    }
    const ev = e._ical;
    const it = ev.iterator();
    let next, guard = 0;
    const ovByRid = new Map((e.overrides || []).map(o => [o.recurrenceId, o]));
    while ((next = it.next()) && guard++ < 10000) {
      const det = ev.getOccurrenceDetails(next);
      const rid = icalTimeInfo(det.recurrenceId);
      const ridKey = rid.allDay ? rid.date : localISO(rid.utc);
      const ov = ovByRid.get(ridKey) || null;
      const st = icalTimeInfo(det.startDate), en = icalTimeInfo(det.endDate);
      const t = timeObj(st, en);
      // stop once the *original* slot is well past the window (an override may move an
      // instance from just after the window into it, so look 60 days further)
      const ridDT = rid.allDay ? DateTime.fromISO(rid.date, { zone: AREA_TZ }) : rid.utc;
      if (ridDT > winEnd.plus({ days: 60 })) break;
      if (!overlaps(t, winStart, winEnd)) continue;
      const o = occurrence(e, t, ridKey, ov);
      if (o.status === 'cancelled' && !includeCancelled) continue;
      out.push(o);
    }
  }
  out.sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.summary.localeCompare(b.summary));
  return out;
}
function timeObj(st, en) {
  if (st.allDay) {
    const endEx = en && en.allDay ? en.date : addDays(st.date, 1);
    return { allDay: true, startDate: st.date, endDateExclusive: endEx, endDate: addDays(endEx, -1),
      startUtc: DateTime.fromISO(st.date, { zone: AREA_TZ }).toUTC().toISO({ suppressMilliseconds: true }),
      endUtc: DateTime.fromISO(endEx, { zone: AREA_TZ }).toUTC().toISO({ suppressMilliseconds: true }) };
  }
  const ls = st.utc.setZone(AREA_TZ), le = (en && !en.allDay ? en.utc : st.utc).setZone(AREA_TZ);
  return { allDay: false, start: ls.toISO({ suppressMilliseconds: true }), end: le.toISO({ suppressMilliseconds: true }),
    startUtc: st.utc.toISO({ suppressMilliseconds: true }), endUtc: (en && !en.allDay ? en.utc : st.utc).toISO({ suppressMilliseconds: true }),
    startDate: ls.toISODate(), endDate: le.toISODate(), localStart: ls.toFormat('HH:mm'), localEnd: le.toFormat('HH:mm') };
}
function overlaps(t, ws, we) {
  const s = DateTime.fromISO(t.startUtc), e = DateTime.fromISO(t.endUtc);
  if (e <= s) return s >= ws && s < we;     // zero-length: point in window
  return e > ws && s < we;
}
// An occurrence is deliberately slim: everything a list row / month cell / filter needs, and a
// `uid` to join to the master event for the detail view.  When the instance was edited in Google
// (RECURRENCE-ID override) the changed master-level data travels in `override`.
function occurrence(e, t, ridKey, ov) {
  const f = ov && ov.fields ? ov.fields : e;
  const loc = ov ? ov.location : e.location;
  return {
    id: ridKey ? `${e.slug}/${t.startDate}` : e.slug,
    uid: e.uid, recurrenceId: ridKey, isOverride: !!ov,
    status: ov ? ov.status : e.status,
    summary: (ov && ov.summary) || e.summary, titleEs: f.titleEs ?? e.titleEs,
    type: f.type || e.type, format: f.format || e.format, language: f.language || e.language,
    allDay: t.allDay, start: t.start || null, end: t.end || null, startDate: t.startDate, endDate: t.endDate,
    startUtc: t.startUtc, endUtc: t.endUtc, localStart: t.localStart || null, localEnd: t.localEnd || null,
    weekday: DateTime.fromISO(t.startDate, { zone: AREA_TZ }).toFormat('cccc'),
    multiDay: t.startDate !== t.endDate,
    recurring: e.kind === 'series',
    locationKind: loc.kind, venue: loc.venue || null, city: loc.city || null,
    districts: e.districts.map(d => d.district), committees: e.committees.map(c => c.committee),
    topics: f.topics || e.topics,
    hasFlyer: (f.images || e.images).length > 0, hasDocs: (f.links || e.links).length > 0, hasZoom: !!((f.zoom || e.zoom) && (f.zoom || e.zoom).idDigits),
    override: ov ? { location: loc, fields: ov.fields ? publicSubset(ov.fields) : null } : null,
  };
}
function publicSubset(n) {
  const { bodyRaw, problems, meta, personalEmailsDropped, overrides, ...rest } = n;
  return rest;
}

/* ================================================================== site helpers
   Everything below is used by src/_data/calendar.js and src/_lib/plugins/calendar.js:
   time labels and "Every 2nd Tuesday" patterns in both languages, iCalendar output for
   the "Add to calendar" download, Google / Outlook links, and the safe "About" HTML. */

export const WEBCAL_URL = ICS_URL.replace(/^https:/, 'webcal:');
export const EMBED_URL_ES = `${EMBED_URL}&hl=es`;

const NB = '\u00a0';
const MER = { en: ['AM', 'PM'], es: [`a.${NB}m.`, `p.${NB}m.`] };
const lc = (lang) => (lang === 'es' || (lang && lang.code === 'es') ? 'es' : 'en');
const toLA = (iso) => DateTime.fromISO(iso, { setZone: true }).setZone(AREA_TZ);

/** "7:00 PM" / "7:00 p. m." (Pacific). */
export function clockLabel(iso, lang, meridiem = true) {
  const d = toLA(iso);
  const L = lc(lang);
  const s = `${d.hour % 12 || 12}:${pad(d.minute)}`;
  return meridiem ? `${s}${NB}${MER[L][d.hour < 12 ? 0 : 1]}` : s;
}

/** "7:00–8:00 PM", "10:00 AM–2:00 PM", "7:00 PM" (no end) — Spanish "7:00–8:00 p. m.". */
export function timeRangeLabel(startIso, endIso, lang) {
  if (!startIso) return '';
  const s = toLA(startIso);
  const e = endIso ? toLA(endIso) : null;
  if (!e || +e <= +s) return clockLabel(startIso, lang);
  const sameHalf = (s.hour < 12) === (e.hour < 12) && s.toISODate() === e.toISODate();
  return `${sameHalf ? clockLabel(startIso, lang, false) : clockLabel(startIso, lang)}–${clockLabel(endIso, lang)}`;
}

/** "Sat, Nov 14, 2026" / "sáb, 14 de nov de 2026". */
export function dateLabel(isoOrDate, lang, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate) ? DateTime.fromISO(isoOrDate, { zone: AREA_TZ }) : toLA(isoOrDate);
  return d.setLocale(lc(lang) === 'es' ? 'es-US' : 'en-US').toLocaleString(opts);
}

const DAY_EN_PL = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
const ORD_EN2 = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last', '-2': '2nd-to-last' };
const ORD_ES2 = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º', 5: '5.º', '-1': 'último', '-2': 'penúltimo' };
const joinWords = (arr, and) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ` ${and} ` + arr[arr.length - 1]);

/** "Every 2nd Tuesday" / "Cada 2.º martes"; "Every Friday" / "Todos los viernes"; "Every 1st & 3rd Sunday" / "Cada 1.er y 3.er domingo". */
export function ruleLabel(rec, lang, startLocal) {
  if (!rec) return '';
  const L = lc(lang);
  const byday = (rec.byday || [])
    .map((x) => {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x);
      return m ? { n: m[1] ? +m[1] : null, day: m[2] } : null;
    })
    .filter(Boolean);
  const plural = (d) => (DAY_ES[d].endsWith('s') ? DAY_ES[d] : DAY_ES[d] + 's');
  const every = (rec.interval || 1) > 1 ? rec.interval : 0;
  if (rec.freq === 'WEEKLY') {
    const days = byday.length ? byday.map((b) => b.day) : startLocal ? [['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][startLocal.weekday - 1]] : [];
    if (L === 'es') return every ? `Cada ${every} semanas, los ${joinWords(days.map(plural), 'y')}` : `Todos los ${joinWords(days.map(plural), 'y')}`;
    return every ? `Every ${every} weeks on ${joinWords(days.map((d) => DAY_EN_PL[d]), '&')}` : `Every ${joinWords(days.map((d) => DAY_EN_PL[d]), '&')}`;
  }
  if (rec.freq === 'MONTHLY' && byday.length && byday.every((b) => b.n != null)) {
    const sameDay = byday.every((b) => b.day === byday[0].day);
    const tailEn = every ? ` (every ${every} months)` : '';
    const tailEs = every ? ` (cada ${every} meses)` : '';
    if (sameDay) {
      const ords = byday.map((b) => b.n);
      if (L === 'es') return `Cada ${joinWords(ords.map((n) => ORD_ES2[n] || `${n}.º`), 'y')} ${DAY_ES[byday[0].day]}${tailEs}`;
      return `Every ${joinWords(ords.map((n) => ORD_EN2[n] || `${n}th`), '&')} ${DAY_EN_PL[byday[0].day]}${tailEn}`;
    }
    if (L === 'es') return `Cada ${joinWords(byday.map((b) => `${ORD_ES2[b.n] || b.n + '.º'} ${DAY_ES[b.day]}`), 'y')}${tailEs}`;
    return `Every ${joinWords(byday.map((b) => `${ORD_EN2[b.n] || b.n + 'th'} ${DAY_EN_PL[b.day]}`), '&')}${tailEn}`;
  }
  const t = rec.text || {};
  return (L === 'es' ? t.es : t.en) || '';
}

/** Plain-text details for "Add to calendar" and the .ics files: Zoom, registration time, Note lines,
 *  website, (with `about`) the public text of a one-time event, and the link back to the page.
 *  Only cleaned, public fields of a Series are used — never the raw calendar description. */
function publicDetails(s, lang, siteUrl, { about = false, bilingual = false } = {}) {
  const L = lc(lang);
  const lines = [];
  if (s.online && s.online.joinUrl) lines.push(`Zoom: ${s.online.joinUrl}`);
  if (s.online && s.online.zoomId) lines.push(`${L === 'es' ? 'ID de reunión' : 'Meeting ID'}: ${s.online.zoomId}`);
  if (s.online && s.online.passcode) lines.push(`${L === 'es' ? 'Código de acceso' : 'Passcode'}: ${s.online.passcode}`);
  const reg = L === 'es' ? s.registration_es : s.registration_en;
  if (reg) lines.push(reg);
  const notesEs = s.notes_es || [];
  const notes = L === 'es' && notesEs.length ? notesEs : s.notes || [];
  for (const n of notes) lines.push(n);
  if (bilingual && L !== 'es') for (const n of notesEs) lines.push(n);
  if (s.web) lines.push(s.web);
  if (about && s.about_text) lines.push('', s.about_text, '');
  if (siteUrl) lines.push(`${siteUrl}${L === 'es' ? '/es' : ''}${s.url}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const gstamp = (iso) => DateTime.fromISO(iso, { setZone: true }).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
const gdate = (ymd) => String(ymd || '').replace(/-/g, '');

/** Google Calendar "add this event" link: a series with its repeat rule, or one date. */
export function googleAddUrl(s, occ, lang, siteUrl = '') {
  const L = lc(lang);
  const o = occ || s.next || null;
  const start = o ? o.start : s.start;
  const end = o ? o.end : s.end;
  const allDay = o ? o.allDay : s.allDay;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: (L === 'es' && s.title_es) || s.title });
  if (allDay) p.set('dates', `${gdate(o ? o.date : s.startDate)}/${gdate(toLA(end).toISODate())}`);
  else p.set('dates', `${gstamp(start)}/${gstamp(end)}`);
  p.set('ctz', AREA_TZ);
  const det = publicDetails(s, L, siteUrl);
  if (det) p.set('details', det);
  const where = s.location ? s.location.raw : (s.online && s.online.joinUrl) || '';
  if (where) p.set('location', where);
  if (s.recurring && s.rrule && !occ) p.set('recur', `RRULE:${s.rrule}`);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Outlook.com "add" link for one date (Outlook links cannot carry a repeat rule). */
export function outlookAddUrl(s, occ, lang, siteUrl = '') {
  const L = lc(lang);
  const o = occ || s.next || null;
  const start = o ? o.start : s.start;
  const end = o ? o.end : s.end;
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: (L === 'es' && s.title_es) || s.title });
  p.set('startdt', toLA(start).toISO({ suppressMilliseconds: true }));
  p.set('enddt', toLA(end).toISO({ suppressMilliseconds: true }));
  if (o ? o.allDay : s.allDay) p.set('allday', 'true');
  const det = publicDetails(s, L, siteUrl);
  if (det) p.set('body', det);
  const where = s.location ? s.location.raw : (s.online && s.online.joinUrl) || '';
  if (where) p.set('location', where);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p.toString()}`;
}

/* ---- iCalendar output (one file per series, for "Add to calendar → Download") */
function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsFold(line) {
  // fold at 75 octets without splitting a UTF-8 sequence (RFC 5545 §3.1)
  const out = [];
  let buf = Buffer.from(line, 'utf8');
  while (buf.length > (out.length ? 74 : 75)) {
    let cut = out.length ? 74 : 75;
    while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
    out.push(buf.subarray(0, cut).toString('utf8'));
    buf = buf.subarray(cut);
  }
  out.push(buf.toString('utf8'));
  return out.map((l, i) => (i ? ' ' + l : l)).join('\r\n');
}
const LA_VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:America/Los_Angeles', 'X-LIC-LOCATION:America/Los_Angeles',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'TZNAME:PST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const laLocal = (iso) => toLA(iso).toFormat("yyyyLLdd'T'HHmmss");

const icsStamp = (stamp) => DateTime.fromISO(stamp || new Date().toISOString(), { setZone: true }).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
const icsWhen = (prop, iso, allDay, ymd) => (allDay ? `${prop};VALUE=DATE:${gdate(ymd)}` : `${prop};TZID=America/Los_Angeles:${laLocal(iso)}`);

/** The VEVENT lines for one Series (its RRULE, EXDATEs and moved / cancelled single dates kept).
 *  Built only from the Series' public fields (title, place, Zoom, Note lines, public text of a one-time
 *  event) — never from the raw description, so maintainer lines and held flyers cannot leak.
 *  `instances`: the Series' occurrences that were edited one by one in Google Calendar. */
export function seriesToVevents(s, { siteUrl = '', stamp, instances = [], lang = 'en' } = {}) {
  const out = [];
  const es = lc(lang) === 'es';
  const where = s.location ? s.location.raw : (s.online && s.online.joinUrl) || '';
  const title = (es && s.title_es) || s.title;
  const det = publicDetails(s, lang, siteUrl, { about: !(s.recurring && s.isMeeting), bilingual: true });
  const common = () => {
    const L = [];
    if (where) L.push(`LOCATION:${icsEscape(where)}`);
    if (det) L.push(`DESCRIPTION:${icsEscape(det)}`);
    if (siteUrl) L.push(`URL:${siteUrl}${es ? '/es' : ''}${s.url}`);
    return L;
  };
  out.push('BEGIN:VEVENT', `UID:${s.uid}`, `DTSTAMP:${icsStamp(stamp)}`);
  if (s.allDay) out.push(icsWhen('DTSTART', s.start, true, s.startDate), icsWhen('DTEND', s.end, true, s.endDateExclusive || s.startDate));
  else out.push(icsWhen('DTSTART', s.start, false), icsWhen('DTEND', s.end || s.start, false));
  if (s.recurring && s.rrule) out.push(`RRULE:${s.rrule}`);
  for (const x of s.exdates || []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) out.push(`EXDATE;VALUE=DATE:${gdate(x)}`);
    else out.push(`EXDATE;TZID=America/Los_Angeles:${laLocal(x)}`);
  }
  out.push(`SUMMARY:${icsEscape(title)}`, ...common());
  out.push(`STATUS:${s.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  // one date that was moved, retitled or cancelled in Google Calendar
  if (s.recurring) for (const o of instances) {
    if (!o.recurrenceId) continue;
    const ridDate = /^\d{4}-\d{2}-\d{2}$/.test(o.recurrenceId);
    out.push('BEGIN:VEVENT', `UID:${s.uid}`, `DTSTAMP:${icsStamp(stamp)}`,
      ridDate ? `RECURRENCE-ID;VALUE=DATE:${gdate(o.recurrenceId)}` : `RECURRENCE-ID;TZID=America/Los_Angeles:${laLocal(o.recurrenceId)}`);
    if (o.allDay) out.push(icsWhen('DTSTART', o.start, true, o.date), icsWhen('DTEND', o.end, true, toLA(o.end).toISODate()));
    else out.push(icsWhen('DTSTART', o.start, false), icsWhen('DTEND', o.end || o.start, false));
    out.push(`SUMMARY:${icsEscape((es && o.title_es) || o.title || title)}`, ...common());
    out.push(`STATUS:${o.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  return out;
}
const icsHead = (name, desc) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MSCA09//Area calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  `X-WR-CALNAME:${icsEscape(name)}`, ...(desc ? [`X-WR-CALDESC:${icsEscape(desc)}`] : []), 'X-WR-TIMEZONE:America/Los_Angeles', ...LA_VTIMEZONE];

/** A complete .ics file for one series (RRULE and EXDATE kept) or one-off. */
export function seriesToIcs(s, { siteUrl = '', stamp, instances = [] } = {}) {
  const L = [...icsHead(s.title), ...seriesToVevents(s, { siteUrl, stamp, instances }), 'END:VCALENDAR'];
  return L.map(icsFold).join('\r\n') + '\r\n';
}

/** The whole Area calendar as one .ics file (/calendar.ics), built from the cleaned Series list.
 *  opts: { name, description, siteUrl, stamp, lang, instancesBySlug: { slug: [Occ] } } */
export function calendarToIcs(seriesList, { name = 'MSCA09', description = '', siteUrl = '', stamp, lang = 'en', instancesBySlug = {} } = {}) {
  const L = [...icsHead(name, description)];
  for (const s of seriesList) L.push(...seriesToVevents(s, { siteUrl, stamp, lang, instances: instancesBySlug[s.slug] || [] }));
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}

/* ---- link labels that are really file names ("SP_35 Foro", "MSCA09 ASC_2023-08-13_English-FINAL") */
const LBL_LANG_EN = /(?:^|[\s_()-])(?:EN|ENG|English|Ingl[eé]s)(?=$|[\s_()\d-])/i;
const LBL_LANG_ES = /(?:^|[\s_()-])(?:SP|ES|SPA|Spanish|Espa\S{0,2}ol)(?=$|[\s_()\d-])/i;
/** { text, lang: 'en'|'es'|'', kind: 'flyer'|'program'|'document', fileName: bool } — text is a readable label
 *  without the language, version and date clutter, or '' when nothing meaningful is left. */
export function tidyLinkLabel(label) {
  const raw = String(label || '').trim();
  const fileName = /_|\.(pptx?|pdf|docx?|jpe?g|png)\b|\b(FINAL|Rev\d*)\b|[a-z][A-Z][a-z]|\(\d\)\s*$/.test(raw);
  const lang = LBL_LANG_ES.test(raw) ? 'es' : LBL_LANG_EN.test(raw) ? 'en' : '';
  const kind = /fl(y|i)er|fly(?=[\s_]|$)/i.test(raw) ? 'flyer' : /program|agenda|schedule/i.test(raw) ? 'program' : 'document';
  if (!fileName) return { text: raw, lang, kind, fileName };
  let t = raw
    .replace(/\.(pptx?|pdf|docx?|jpe?g|png)\b/gi, ' ')
    .replace(/\(\d\)/g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/(\d)([A-Za-z]{3,})/g, '$1 $2')
    .replace(/\b(FINAL|Final|final|Rev\d*|rev\d*|v\d+|EN\d|SP\d|copy|\d{3})\b/g, ' ')
    .replace(/(^|[\s-])(EN|ENG|English|Ingl[eé]s|SP|ES|SPA|Spanish|Espa\S{0,2}ol)(?=$|[\s-])/gi, ' ')
    .replace(/\bfly\b/gi, 'flyer')
    .replace(/\b\d{4}-\d{2}(-\d{2})?\b/g, ' ')
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s?\d{6,8}\b/gi, ' ')
    .replace(/(\s[-–])+(?=\s|$)/g, ' ')
    .replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^(flyer|fly|program|document|doc|\d+)$/i.test(t)) t = '';
  return { text: t, lang, kind, fileName };
}

/* ---- the public "About" text as safe HTML: escaped, with links and role e-mails made clickable */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const LINKABLE = /(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?'\u2019\u201d_])|(\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>()"]*[^\s<>()".,;:!?'\u2019\u201d])?)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
export function aboutHtml(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const linkify = (line) => {
    let out = '';
    let last = 0;
    for (const m of line.matchAll(LINKABLE)) {
      out += escHtml(line.slice(last, m.index));
      if (m[3]) {
        out += classifyEmail(m[3]) === 'role' ? `<a href="mailto:${escHtml(m[3].toLowerCase())}">${escHtml(m[3])}</a>` : '[e-mail removed]';
      } else {
        const href = m[1] || `https://${m[2]}`;
        const label = m[0].length > 60 ? m[0].replace(/^https?:\/\//, '').slice(0, 56) + '…' : m[0];
        out += `<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(label)}</a>`;
      }
      last = m.index + m[0].length;
    }
    return out + escHtml(line.slice(last));
  };
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${p.split('\n').map((l) => linkify(l.trim())).filter(Boolean).join('<br>')}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('\n');
}

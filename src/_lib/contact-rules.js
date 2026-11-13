// Contact and anonymity rules shared by the central-office events importer (scripts/office-events.mjs), the site
// build (src/_data/officeEvents.js) and, later, the site checks. The patterns started from scripts/check-site.mjs
// (phone numbers, free-mail addresses, role mailboxes, Zoom ID labels) and scripts/check-media.mjs (sobriety dates),
// which keep their own copies for now.
//
//   normalizeText(text, { dashes })                       → the text as the rules read it (see below)
//   loadAllow()                                           → { phones: Set<10 digits>, emails: Set<lower-case address> }
//   contactHits(text, { phones, allow, officeHost, now }) → [{ kind: "phone"|"email"|"sobriety"|"zoom"|"password", value, index }]
//   titleRisk(text, { allow, officeHost, now })           → contactHits(…) plus the structural rules for titles, venues, ids
//   slugRisk(slug, { allow, officeHost, now })            → titleRisk of a page address or an id read as words, every way
//   summaryRisk(text, { allow, officeHost, now })         → "" or why an imported summary must be left out (a kind, no value)
//   summaryRisky(text, { allow, officeHost, now })        → summaryRisk(…) !== ""
//   scrubText(text, { allow, officeHost })                → the text without every sentence (or line) that has a hit
//   maskText(text, { allow, officeHost })                 → personal details replaced by look-alikes (test fixtures)
//
// Every rule reads the text normalised first (normalizeText): HTML entities decoded (also "&colon;", "&ensp;"…), Unicode
// NFC (an accent typed as a separate mark is one letter again), letters and digits that NFKC makes plain as plain ones
// ("𝟕𝟕𝟒𝟒𝟏𝟏", "𝐒𝐨𝐛𝐞𝐫", "²", "①"), every dash, hyphen and minus sign as "-", typographic
// apostrophes and quotes as ' and ", full-width signs as ASCII ("PW：774411", "＠"), Cyrillic and Greek look-alike
// letters as Latin ones, every Unicode space as a space, no zero-width characters, and "P.W." / "P/W" / "P W" / "P-W"
// as "PW", "I.D." as "ID".
//
// Three levels:
//  - contactHits finds explicit personal details only. It is used for zip codes, links, the deploy gate (--check) and
//    the site build:
//      phone numbers (not the allowed office lines, not toll-free numbers; also "714 · 555 · 0123", "714_555_0123",
//      "714 555 01 23"); e-mail addresses (not the Area's role domains, the allowed mailboxes or the office's own
//      domain; also "José@…", "name at domain dot net", "name @ gmail dot com", "name at sbcglobal.net" (a free-mail
//      service, any ending), "RSVP name at example.net" (another domain after e-mail, correo, RSVP, contact or write),
//      "email name at gmail");
//      Zoom links and meeting IDs: a meeting-ID label with a number ("Meeting ID – 812 3456 7890", "Zoom ID 7788…"),
//      or a 9 to 11-digit number next to a label, in either order ("Zoom: 812-3456-7890", "812 3456 7890 (Zoom ID)");
//      passcodes: PW, PIN, clave, código (also "de la reunión", "de Zoom", "de acceso"), "Pass" / "Code" with no word
//      before, "Zoom/door/access code", each with a value that has digits ("PW – 774411", "PIN-1234", "Clave: 7788",
//      "Pass: 7788"; "PW: serenity" too); the words passcode, password and contraseña on their own, "Pass code: …";
//      sobriety DATES: a date or a year after "sobriety date", "sober since", "sobrio desde", "fecha de sobriedad",
//      "sobriety birthday" or "DOS", or a date before them ("Ana R. 3/3/1990 sobriety birthday").
//    Not hits: a sobriety length ("Sober 30 Years Club"), a year before 1940 ("Sober Since 1935: A.A. History"), an
//    event's own year after a birthday label or DOS ("2026 Sobriety Birthday Bash"), a year alone before a label, a
//    year followed by Group, Grupo or Club ("Sober Since 1979 Group"), Spanish "dos", a group's name ("Grupo Sobrios
//    Desde 1985"), "La Clave es la Humildad", "Taller Código 12", "Pass: 7th Tradition", "Weekend Pass: $60", "Group
//    Code: AA022026SD".
//  - titleRisk is contactHits plus structural rules, for titles, Spanish titles, venues, street addresses, cities,
//    prices and ids (an event title must come through whole when it is ordinary, and lose everything from its first
//    detail on when it is not):
//      meeting numbers: a run of 9 digits or more with spaces, dots, dashes, "/", "_", "·", "|", "," or line breaks
//      between ("Teams: 312 456 789 012", "Zoom: 812/3456/7890", "Online (812 3456 7890)"), not an allowed or
//      toll-free phone number, not dates, times or prices (every group 1-2 digits or a year; a "$" before);
//      codes: PW, PIN, passcode, password, pwd, contraseña, clave, código, code, key/access/gate/door code, then within
//      about 25 characters (signs and short words only: is, was, es, para entrar, for Zoom, →, », |, quotes,
//      brackets) a token with 3 digits or more that is not this year or a later one ("PW is 774411", "PIN is 1234",
//      "Clave para entrar: 7788", "Code is 7788"), single digits with spaces ("Clave: 7 7 8 8", "PIN 1 2 3 4"), or,
//      after ":" or "is", 5 or more letters and digits mixed ("Clave: Ab3x9Q", "Code: 8Hk2pX"); not "Code of Conduct",
//      "Dress Code", "Group Code: AA022026SD", "Promo code SOBER26";
//      sobriety dates: a sobriety word within about 25 characters, on the same line, of a date from 1940 to last
//      year, each kind of word with the dates it may go with: a word on its own (sober, sobriety, sobriedad,
//      sobrio/a) needs a date with its day or month ("Ana R. – sober 3/3/1990", "sober March 1990", "sober 3/90"),
//      never a year alone ("Since 1988 – Proud & Sober.", "Sober in the Sun 2025 Recap", "Grupo Nueva Vida 1985 –
//      Sobriedad"); a label (sober since, sobriety date, fecha de sobriedad, sobrio desde, DOS, clean date, clean
//      time since, last drink, sin beber / sin alcohol / libre de alcohol desde, no drinking since, recovery date)
//      also an apostrophe year, and right after it a year alone ("sober since 1990", "sober since 90" as a page
//      address writes it), not one followed by Group, Grupo or Club ("Sober Since 1979 Group – 47th Anniversary");
//      soberversary and AA / A.A. anniversary a date or an apostrophe year (AA birthday is a label: "Tom R. (AA
//      birthday 1989)", not "AA Birthday 2025 Recap"); "birthday" a full past date
//      ("Ana R. – birthday 3/3/1990"). This year and later ones are the event's own ("2026 Sobriety Birthday Bash",
//      "Los DOS 12/12/2026 Talleres"), a length is not a date ("91 Years and Still Sober!").
//  - summaryRisk is broad. An imported summary is optional extra text (every card links to the office's own page),
//    so it is left out whole when it has a titleRisk hit, a word that labels a code or a meeting (zoom, meeting ID,
//    passcode, password, contraseña, clave, código, PW, PIN…), any sobriety date or length wording, or a run of 7 or
//    more digits (spaces, dots, dashes, "/", "_", "·" or "|" between them; not an allowed or toll-free phone number, a
//    $ price, a time or a date).
//
// contactHits and titleRisk report each hit in the text they were given: index and value are mapped back from the
// normalised text. now (an ISO time, a Date, a Luxon DateTime or a year; default: today) says which year is "this year".
import { readCsv } from "./csv.js";

/* ------------------------------------------------------------------ the text as the rules read it */

const ZERO_WIDTH = /[­᠎​-‍⁠﻿]/;
const DASH = /[‐-―−⸺⸻﹘﹣]/;
const SPACE = /[   -   　]/;
// small and look-alike signs: line separators, small colon/comma/@ (U+FE50…), ratio "∶", division and fraction slashes
const LOOKALIKE = {
  " ": "\n", " ": "\n", "﹐": ",", "﹒": ".", "﹔": ";", "﹕": ":", "﹖": "?", "﹗": "!",
  "﹟": "#", "﹫": "@", "∶": ":", "꞉": ":", "∕": "/", "⁄": "/",
};
// typographic apostrophes and quotes (read as ' and "): ’ ‘ ʼ ′ ` ´ ‛ and “ ” „ ″
const QUOTE = { "’": "'", "‘": "'", "ʼ": "'", "′": "'", "`": "'", "´": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "″": '"' };
// letters of other alphabets that look like Latin ones ("РW: 774411" with a Cyrillic Р, "Pаsscode" with a Cyrillic а)
const HOMOGLYPH = Object.fromEntries(
  [
    ["\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u0406\u0408\u0405\u0423", "ABEKMHOPCTXIJSY"],
    ["\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u0501\u051d", "aeopcyxijsdw"],
    ["\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7", "ABEZHIKMNOPTYX"],
    ["\u03bf\u03b9\u03ba\u03bd", "oikv"],
  ].flatMap(([from, to]) => [...from].map((c, i) => [c, to[i]])),
);
// HTML entities that the HTML readers (calendar.js decodeEntities) do not know, and the usual ones: "PW&colon; 774411",
// "PW&ensp;774411", "&rsquo;90"; numeric ones too. Read again until nothing changes ("&amp;colon;").
const ENTITY = {
  colon: ":", ensp: " ", emsp: " ", emsp13: " ", emsp14: " ", thinsp: " ", hairsp: " ", numsp: " ", puncsp: " ",
  nbsp: " ", NonBreakingSpace: " ", ndash: "–", mdash: "—", dash: "‐", hyphen: "‐", minus: "−", horbar: "―",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", apos: "'", quot: '"', prime: "′", Prime: "″",
  period: ".", comma: ",", sol: "/", bsol: "\\", num: "#", commat: "@", lowbar: "_", UnderBar: "_", verbar: "|", vert: "|", VerticalLine: "|",
  ast: "*", midast: "*", excl: "!", quest: "?", semi: ";", equals: "=", plus: "+", percnt: "%", dollar: "$", grave: "`", acute: "´", Hat: "^",
  lpar: "(", rpar: ")", lsqb: "[", rsqb: "]", lbrack: "[", rbrack: "]", lcub: "{", rcub: "}", lbrace: "{", rbrace: "}",
  amp: "&", AMP: "&", lt: "<", gt: ">", middot: "·", centerdot: "·", CenterDot: "·", bull: "•", bullet: "•",
  rarr: "→", rightarrow: "→", RightArrow: "→", raquo: "»", laquo: "«", rsaquo: "›", lsaquo: "‹", hellip: "…",
  Tab: "\t", NewLine: "\n", shy: "­", ZeroWidthSpace: "​", zwj: "‍", zwnj: "‌", NoBreak: "⁠",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", iexcl: "¡", iquest: "¿",
};
const ENTITY_RE = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi;
const entityOf = (m, e) => {
  if (e[0] === "#") {
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : null;
  }
  return ENTITY[e] ?? ENTITY[e.toLowerCase()] ?? null;
};
// "P.W." / "P/W" / "P W" / "P-W" / "P_W" → "PW", "I.D." → "ID" (not inside "A.I.D.S."): the signs inside go, the letters stay
const FOLD = /(?<!\p{L}\.)\b[Pp](?:\.[ \t]?|[ \t]?\/[ \t]?|[ \t]|[ \t]?-[ \t]?|_)[Ww]\b\.?|(?<!\p{L}\.)\b[Ii]\.[ \t]?[Dd]\b\.?/gu;
const PLAIN = /^[\t\n\x20-\x7e]*$/;
// a letter or sign with the marks typed after it (one NFC unit)
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

// a letter or digit that NFKC makes plain: mathematical bold and italic ("𝐒𝐨𝐛𝐞𝐫", "𝟕𝟕𝟒𝟒𝟏𝟏"), superscripts, circled
// digits, ligatures; "" when it is not one (the office's other signs are left as they are)
function compatOf(c) {
  if (c.charCodeAt(0) < 0x80) return "";
  const k = c.normalize("NFKC");
  return k !== c && /^[A-Za-z0-9]+$/.test(k) ? k : "";
}
/** The text with every letter or digit that NFKC makes plain written plainly ("𝟏𝟗𝟗𝟎" → "1990"); nothing else changes. */
export const compatFold = (s) => String(s ?? "").replace(/[^\x00-\x7f]/gu, (c) => compatOf(c) || c);

function unitOf(c, read) {
  if (ZERO_WIDTH.test(c)) return "";
  const code = c.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return unitOf(String.fromCharCode(code - 0xfee0), read);
  if (read && compatOf(c)) return compatOf(c);
  if (read && DASH.test(c)) return "-";
  if (SPACE.test(c)) return " ";
  if (read && QUOTE[c]) return QUOTE[c];
  if (read && HOMOGLYPH[c]) return HOMOGLYPH[c];
  return LOOKALIKE[c] || c;
}

// A text and, for each of its characters (UTF-16 units), where it came from in the given text: [start, end) (start
// null: nothing moved yet, character i came from i).
const fromOf = (n, i) => (n.start ? n.start[i] : i);
const toOf = (n, i) => (n.end ? n.end[i] : i + 1);
/** One step of the normalisation: every match of `re` (global) replaced by fn(match) (null: kept); each new character
 *  comes from the whole match. */
function step(n, re, fn) {
  const t = n.text;
  let out = "";
  const start = [];
  const end = [];
  let last = 0;
  let changed = false;
  const keep = (i) => {
    out += t[i];
    start.push(fromOf(n, i));
    end.push(toOf(n, i));
  };
  for (const m of t.matchAll(re)) {
    const rep = fn(m);
    if (rep == null || rep === m[0]) continue;
    changed = true;
    for (let i = last; i < m.index; i++) keep(i);
    const a = fromOf(n, m.index);
    const b = m[0].length ? toOf(n, m.index + m[0].length - 1) : a;
    for (let k = 0; k < rep.length; k++) {
      out += rep[k];
      start.push(a);
      end.push(b);
    }
    last = m.index + m[0].length;
  }
  if (!changed) return n;
  for (let i = last; i < t.length; i++) keep(i);
  return { src: n.src, text: out, start, end };
}

/** The normalised text and, for each of its characters, where it came from in the given text. read = true: the text
 *  as the rules read it (every dash "-", quotes ' and ", look-alike letters as Latin ones); false: the office's
 *  typography is kept (what cleanRecord stores). */
function normalized(input, read = true) {
  const src = String(input ?? "");
  let n = { src, text: src, start: null, end: null };
  // HTML entities, until nothing changes ("&amp;colon;" → "&colon;" → ":")
  for (let k = 0; k < 4 && n.text.includes("&"); k++) {
    const next = step(n, ENTITY_RE, (m) => entityOf(m[0], m[1]));
    if (next === n) break;
    n = next;
  }
  // character by character: NFC, zero-width, full-width, dashes, spaces, quotes, look-alikes
  if (!PLAIN.test(n.text)) n = step(n, CLUSTER, (m) => {
    const seg = m[0];
    const nf = seg.length > 1 ? seg.normalize("NFC") : seg;
    let out = "";
    for (const ch of nf) out += unitOf(ch, read);
    return out;
  });
  return step(n, FOLD, (m) => [...m[0]].filter((c) => /\p{L}/u.test(c)).join(""));
}

/**
 * The text as the rules read it: HTML entities decoded (also the ones the HTML readers do not know: "&colon;",
 * "&ensp;", "&rsquo;"…); NFC; every dash, hyphen and minus sign (‐ ‑ ‒ – — ― − ﹘ ﹣ －) as "-", the typographic
 * apostrophes and quotes (’ ‘ ʼ ′ ` ´ “ ” „ ″) as ' and ", Cyrillic and Greek letters that look like Latin ones as
 * those (unless dashes: false: cleanRecord keeps the office's typography in what it stores, "Dinner — Dance",
 * "Children’s"); full-width signs as ASCII ("：" ":", "＠" "@", "７" "7"); non-breaking, narrow, figure and other
 * Unicode spaces as " "; zero-width characters and soft hyphens removed; "P.W.", "P/W", "P W", "P-W" and "P_W" as
 * "PW"; "I.D." as "ID". Running it twice gives the same text.
 */
export function normalizeText(text, { dashes = true } = {}) {
  return normalized(text, dashes).text;
}

// [start, end) in the given text of the normalised characters [i, i + len)
function spanOf(n, i, len) {
  if (!n.start) return [i, i + len];
  const a = i < n.start.length ? n.start[i] : n.src.length;
  return [a, len > 0 ? n.end[Math.min(i + len, n.end.length) - 1] : a];
}

/* ------------------------------------------------------------------ patterns (read on the normalised text) */

/** Phone-like numbers (check-site's pattern; up to 3 separators — spaces, dots, "/", hyphens, "·", "•", "_" and "|",
 *  Unicode dashes included, for maskText, which reads text that is not normalised). Global: use matchAll. */
export const PHONE = /(?<![\d#])(?:\+?1[\s.\/\-‐-―−·•_|]{0,2})?\(?([2-9]\d{2})\)?[\s.\/\-‐-―−·•_|]{0,3}(\d{3})[\s.\/\-‐-―−·•_|]{0,3}(\d{4})(?!\d)/g;
// A phone number written 3-3-2-2 ("714 555 01 23"; a separator between every group). Global.
const PHONE_3322 = /(?<![\d#])(?:\+?1[\s.\/\-·•_|]{1,2})?\(?([2-9]\d{2})\)?[\s.\/\-·•_|]{1,3}(\d{3})[\s.\/\-·•_|]{1,3}(\d{2})[\s.\/\-·•_|]{1,3}(\d{2})(?![\d])/g;
/** E-mail addresses (a name may have accents: "José@…"). Global: use matchAll. (The address patterns start at the
 *  start of a word: the same matches, and a long word without one is read once, not once per letter.) */
export const EMAIL = /(?<![\p{L}\p{M}\p{N}_.+\-])[\p{L}\p{M}\p{N}_.+\-]+@[\p{L}\p{M}\p{N}\-]+(?:\.[\p{L}\p{M}\p{N}\-]+)+/gu;
// Addresses written so robots cannot read them: Cloudflare's "[email protected]", "name (at) gmail (dot) com", "maria
// arroba gmail punto com", "maria arroba gmail.com" (the full-width "＠" is an "@" once normalised).
const EMAIL_HIDDEN = /\[\s*email(?:\s|&#160;|&nbsp;)+protected\s*\]|(?<![\w.+-])[\w.+-]+\s*(?:\(at\)|\[at\]|\{at\})\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\{dot\}|\.)\s*[a-z]{2,}|(?<![\w.+-])[\w.+-]+\s+at\s+(?:gmail|yahoo|hotmail|outlook|aol|icloud|live|msn)\s*(?:\.|\s+dot\s+)\s*com\b|(?:(?<![\w.+-])[\w.+-]+\s+)?\barroba\b.{0,30}?\bpunto\b(?:\s+[a-z]{2,4}\b)?|(?<![\w.+-])[\w.+-]+\s+arroba\s+[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/i;
// An address with a space before or after its "@" ("maria @ gmail.com", "maria@ gmail.com", "maria @gmail.com"; also
// "maria @ gmail . com", "maria @ gmail dot com"). Not "Dinner @ 6. Dance" or "Meet @ St. Mary's" (the part after the
// dot must be a domain ending), and not "@ www.example.org" (a website). The word before it may have accents ("Más
// información @ …" is not "n @ …"). Checked against the allowed addresses like any other. Global.
const EMAIL_SPACED = /(?<![\p{L}\p{N}_.+\-])[\p{L}\p{N}_.+\-]+(?:\s+@\s*|@\s+)(?!www\.)[\w\-]+(?:(?:\.[\w\-]+)*\.[a-z]{2,24}\b|(?:\s*\.\s*[\w\-]+)*\s*\.\s*(?:com|net|org|edu|gov|us|info|me|mx)\b|(?:\s+dot\s+[\w\-]+)*\s+dot\s+[a-z]{2,24}\b)/giu;
// An address with its dots spelled out, for any domain: "ana.r at cox dot net", "ana.r@gmail dot com", "ana arroba
// example punto org". Group 1: the name, 2: the domain with " dot " between its parts. Global.
const EMAIL_SPELLED = /(?<![\p{L}\p{N}_.+\-])([\p{L}\p{N}_.+\-]+)(?:\s*@\s*|\s+(?:at|arroba)\s+)((?:[\w\-]+\s+(?:dot|punto)\s+)+[a-z]{2,24})\b/giu;
// …but a website after an ordinary word is not an address: "Tickets available @ eventbrite.com", "More info @
// scypaa.org", "Sign up @ signupgenius.com", "Más información @ aanoc.org", "Follow us @ instagram.com/…" (a path
// follows). Never for a free-mail domain: "maria @ gmail.com" and "us @ gmail.com" are always addresses.
const SPACED_NOT_MAILBOX =
  /^(?:available|disponibles?|register|registration|reg[ií]str(?:ate|ese|o)|inscr[ií]b(?:ete|ase|irse)|inscripci[oó]n(?:es)?|tickets?|tix|boletos?|entradas|book|buy|purchase|order|follow|us|nos|visit|vis[ií]t(?:anos|enos)|s[ií]gu(?:enos|anos)|find|online|here|aqu[ií]|room|rooms|lodging|hotels?|stay|reserve|reservations?|reservaciones|more|info|information|informaci[oó]n|m[aá]s|details|detalles|rsvp|up|signup|yours|it|out|website|site|web|page|p[aá]gina|now|today|hoy|events?|eventos?|flyers?|volantes?|shop|store|merch|donate|donations?|apply|menu|join|meet|held|located|hosted|online)$/iu;

// Pieces of the patterns below (String.raw: one backslash each).
const alt = (flags, ...parts) => new RegExp(parts.join("|"), flags);
const MONTHS_EN = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?`;
const MONTHS_ES = String.raw`enero|febrero|marzo|abril|mayo|junio|julio|agosto|sep?tiembre|octubre|noviembre|diciembre`;
const MONTH_EN = String.raw`\b(?:${MONTHS_EN})\b\.?`;
const MONTH_ES = String.raw`\b(?:${MONTHS_ES})\b`;
// a count: 30, thirty, twenty-five
const COUNT = String.raw`\d+|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen`;
const YEAR = String.raw`(?:19|20)\d{2}`;
// a date with its year: 3/14/1989, 3-14-89, 1989-03-14, 3 de marzo de 1990, marzo de 1990, March 3, 1990, March 1990
const DATE_Y = [
  String.raw`\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})(?!\d)`,
  String.raw`${YEAR}-\d{1,2}-\d{1,2}(?!\d)`,
  String.raw`\d{1,2}\s+de\s+(?:${MONTHS_ES})\s+(?:de|del)\s+\d{4}`,
  String.raw`${MONTH_ES}\s+(?:de|del)\s+\d{4}`,
  String.raw`${MONTH_EN}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`,
  String.raw`${MONTH_EN},?\s+(?:of\s+)?\d{4}`,
].join("|");
// …or without it, right after a sobriety label: "sober since March 3", "sobria desde el 3 de marzo"
const DATE_D = String.raw`\d{1,2}\s+de\s+(?:${MONTHS_ES})\b|${MONTH_EN}\s+\d{1,2}(?:st|nd|rd|th)?\b`;
// a year after a label that may also name an event ("Sobriety Birthday 2026 Celebration"): only at the end of its
// phrase ("Tom R. (sobriety birthday 1989)")
const YEAR_AT_END = String.raw`(?:${YEAR}|'\d{2})(?=[ \t]*(?:$|[\n).,;:!?\]]))`;
// what may stand between a sobriety label and its date: "Sobriety Date: March 3", "sober since 1999", "sobria desde el
// 3 de marzo", "su fecha de sobriedad es el 3/4/90"
const SOBER_CONN = String.raw`[\s:=#,()\-]{0,4}(?:(?:is|was|es|fue|el|la|on|of|from|desde|since|en|in)[\s:,]+){0,2}`;
// a letter (and spaces) right before a word: "Weekend Pass: $60", "Zip code: 92590" and "Group Code: AA022026SD" are
// not passcodes; "Pass: 7788", "| Code: 7788" are
const NO_WORD_BEFORE = String.raw`(?<![a-zà-ÿ][ \t]*)`;
const NOT_A_YEAR = String.raw`(?!(?:19|20)\d\d\b)`;
// between a code or meeting-ID label and its value: spaces, ":", "#", "=", ".", "-" (every dash, once normalised)
const SEP = String.raw`[\s:#=.\-]{0,6}`;
// a code with a digit: 7788, panel76, PLBB12345 (a bracket may open it)
const CODE_VALUE = String.raw`\(?[A-Za-zÀ-ɏ*#!@_]{0,20}\d`;
// …with 3 digits or more: 7788, AB123 (not "Código 12", "Clave 1 – La Rendición")
const CODE_VALUE3 = String.raw`\(?[A-Za-zÀ-ɏ*#!@_]{0,20}\d(?:[A-Za-zÀ-ɏ*#!@_]{0,3}\d){2}`;
// a 9 to 11-digit number in up to three groups: a Zoom meeting ID (812 3456 7890, 812-3456-7890, 81234567890)
const MEETING_NUMBER = String.raw`(?<!\d)\(?\d{3}\)?[ .\-]{0,3}\d{3,4}[ .\-]{0,3}\d{3,4}(?!\d)`;
// "de la reunión", "de Zoom", "de acceso" after clave / código
const CODE_OF = String.raw`(?:\s+(?:de|del|para)\s+(?:la\s+|el\s+)?(?:reuni[oó]n|zoom|acceso|entrada|junta|sesi[oó]n|meeting|sala))?`;
// a group's name is not a person's sobriety ("Grupo Sobrios Desde 1985", "Sobriety Group")
const NOT_A_GROUP = String.raw`(?<!\b(?:grupo|group|club)\s+(?:de\s+)?(?:la\s+)?)`;

const SOBER_LABEL = String.raw`${NOT_A_GROUP}\b(?:sobriety\s+date|sober\s+(?:since|date)|fecha\s+de\s+sobriedad|sobri[oa]s?\s+desde)\b`;
const SOBER_LABEL_START = new RegExp(`^${SOBER_LABEL}`, "i");
const BIRTHDAY_LABEL = String.raw`\b(?:(?:sobriety|sober)\s+(?:birthday|b-?day)|cumplea[ñn]os\s+de\s+sobriedad)\b`;
const SOBRIETY_AFTER_SRC =
  String.raw`${SOBER_LABEL}${SOBER_CONN}(?:${DATE_Y}|${DATE_D}|(?:${YEAR}|'\d{2})(?![\d\/.\-]\d))` +
  String.raw`|${BIRTHDAY_LABEL}${SOBER_CONN}(?:${DATE_Y}|${DATE_D}|${YEAR_AT_END})`;
/** A sobriety DATE after its label: "sober since 1999", "Sobriety Date: March 3, 1989", "sobria desde el 3 de marzo de
 *  1990", "fecha de sobriedad: 3/4/90", "sobriety birthday 3/3/1990" (contactHits also skips a year before 1940:
 *  "Sober Since 1935: A.A. History Workshop", and an event's own year after a birthday label). A sobriety length is not
 *  a date ("Sober 30 Years Club", "sobrio desde hace 20 años"): summaryRisk finds those. See also SOBRIETY_BEFORE and
 *  SOBRIETY_DOS. */
export const SOBRIETY = new RegExp(SOBRIETY_AFTER_SRC, "i");
const SOBRIETY_AFTER = new RegExp(SOBRIETY_AFTER_SRC, "gi");
// A date written BEFORE its label: "Ana R. 3/3/1990 sobriety birthday", "March 3, 1990 Sobriety Date", "3 de marzo de
// 1990 (fecha de sobriedad)". Within 25 characters, no number or "grupo"/"group"/"club" between. The hit is the date. A
// year alone before a label is not one ("2025 Sobriety Birthday Recap": last year's event). Global.
const SOBRIETY_BEFORE = new RegExp(
  String.raw`(?<![\w\/.,\-])(?:${DATE_Y})` +
    String.raw`(?=(?:(?!\b(?:grupo|group|club)\b)[^\n\d]){0,25}?\b(?:(?:sobriety|sober)\s+(?:date|birthday|b-?day)|fecha\s+de\s+sobriedad|cumplea[ñn]os\s+de\s+sobriedad)\b)`,
  "gi",
);
// "DOS 3/14/1989", "DOS: 3/14/89", "D.O.S. 1989" (date of sobriety). Capitals only (contactHits keeps the matches whose
// label is in capitals: Spanish "dos" is "two"), not after a Spanish word that goes with "dos" ("Los DOS 12/12/2026
// Talleres"), and a year alone only at the end of its phrase ("DOS 2026 Aniversarios" is not one). Global.
const SOBRIETY_DOS = new RegExp(
  String.raw`(?<!\b(?:los|las|de|del|y|e|a|o|u|en|con|sus|unos|unas|entre|nuestros|nuestras|mis|tus|ambos|ambas|cada|son)\s+)\bD\.?O\.?S\b\.?[\s:=\-]{0,4}(?:${DATE_Y}|${YEAR_AT_END})`,
  "gi",
);
// right after a year: the name of a group ("Sober Since 1979 Group", "Sobrios desde 1985 Grupo", "… 1990 Club")
const GROUP_NEXT = /^[ \t]*(?:group|grupo|club)\b/i;

/** Zoom join details: a Zoom link; a meeting-ID label with a number ("Meeting ID – 812 3456 7890", "Zoom ID 7788…", "ID
 *  de reunión: …"); a 9 to 11-digit number right after zoom (within 15 characters), ID, PMI, meeting, webinar or
 *  reunión ("Zoom: 812-3456-7890", "Join on Zoom - 81234567890", "ID# 714 555 0142"; not the office's line or a
 *  toll-free number: "Join by Zoom or call 800-555-0199"). The word Zoom alone is not a hit (summaryRisk counts it).
 *  See also ZOOM_BEFORE. */
export const ZOOM = alt(
  "i",
  String.raw`\bzoom(?:gov)?\.us\/(?:j|s|w|my|wc)\b`,
  String.raw`\b(?:zoom\s*)?(?:meeting|webinar|reuni[oó]n|junta)\s*(?:id|#|number|n[uú]mero)${SEP}(?:is\s+|es\s+)?\(?\d`,
  String.raw`\bzoom\s*(?:id|#|number|n[uú]mero)${SEP}(?:is\s+|es\s+)?\(?\d`,
  String.raw`\b(?:id|n[uú]mero)\s+de\s+(?:la\s+)?(?:reuni[oó]n|zoom|junta)${SEP}(?:es\s+)?\(?\d`,
  String.raw`\bzoom\b[^\n\d]{0,15}?${MEETING_NUMBER}`,
  String.raw`\b(?:id|pmi|meeting|webinar|reuni[oó]n)${SEP}(?:is\s+|es\s+)?${MEETING_NUMBER}`,
);
const ZOOM_ALL = new RegExp(ZOOM.source, "gi");
// A meeting ID written BEFORE its label: a 9 to 11-digit number in groups, or a 10-digit phone-shaped one, followed
// within 25 characters (no other number between) by zoom, meeting ID, ID, passcode, password, contraseña, clave, PW,
// PIN or PMI: "Online Workshop 812 3456 7890 (Zoom ID)", "81234567890 passcode 7788". "Photo ID required" after a
// number is not a label. contactHits skips the allowed and toll-free phone numbers. Global.
const ZOOM_BEFORE = new RegExp(
  String.raw`(?<![\d#])(?:\(\d{3}\)\s?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]?\d{3,4}[\s.-]?\d{3,4})(?!\d)` +
    String.raw`(?=[^\n\d]{0,25}?(?:\bzoom\b|\b(?:meeting|webinar|reuni[oó]n)\s*(?:id|#)|\bid\b(?![ \t]*[a-z])|\bi\.d\.|\bid\s+de\s+(?:la\s+)?reuni[oó]n|\bpass[\s-]?code|\bpasswords?\b|\bcontrase[nñ]a|\bclave\b|\bpw\b|\bpin\b|\bpmi\b))`,
  "gi",
);
/** Passcodes and passwords. The words passcode, password, passwd, pwd and contraseña on their own ("Passcode7788",
 *  "Password Protected: …", the old page passwords); "pass code" / "pass-code" with a value after ":", "=", "#" or
 *  "is" ("Pass-code: serenity") or a number ("Pass code 7788"; not "Pass Code Workshop for Secretaries");
 *  "clave/código de acceso", "clave de Zoom";
 *  clave and código (also "de la reunión", "de Zoom", "de entrada") with a value that has 3 digits or more ("Clave:
 *  7788", "clave es 7788", "código de la reunión: 7788"; not "La Clave es la Humildad", "Código postal 92590",
 *  "Taller Código 12"); PW with a value that has a digit ("PW – 774411", "pw774411") or after ":" ("PW: serenity"),
 *  not a year ("PW 2026 Forum"); PIN with 4 digits or more ("PIN-1234", "PIN #1234"; not "Lapel Pin: $5", "Pin
 *  2026"); "Pass" and "Code" with 4 digits or more when no word stands right before them ("Pass: 7788", "Code 7788";
 *  not "Pass: 7th Tradition", "Pass: Free admission", "Weekend Pass: $60", "Zip code: 92590", "Group Code:
 *  AA022026SD", "Dress code"); "Zoom / meeting / access / entry / door / gate / security / keypad / lockbox code" with
 *  a value that has a digit. titleRisk adds the other ways to write them ("PW is 774411", "Clave para entrar: 7788"). */
export const PASSWORD = alt(
  "i",
  String.raw`\b(?:passcodes?|passwords?|passwd|pwd|contrase[nñ]as?)(?![a-zà-ÿ])`,
  String.raw`\bpass[\s-]codes?\s*(?:[:=#]|\b(?:is|es)\b)\s*\S`,
  String.raw`\bpass[\s-]codes?${SEP}${NOT_A_YEAR}\d{3,}`,
  String.raw`\b(?:clave|c[oó]digo)\s+de\s+acceso\b`,
  String.raw`\bclave\s+de\s+(?:zoom|la\s+reuni[oó]n)\b`,
  String.raw`\b(?:clave|c[oó]digo)${CODE_OF}${SEP}(?:es\s+)?${NOT_A_YEAR}${CODE_VALUE3}`,
  String.raw`\bpw\s*[:#=]\s*\S`,
  String.raw`\bpw${SEP}${NOT_A_YEAR}${CODE_VALUE}`,
  String.raw`\bpin\b(?:\s*(?:#|number|code|n[uú]mero))?${SEP}${NOT_A_YEAR}\d{4,}(?!\d)`,
  String.raw`${NO_WORD_BEFORE}\b(?:pass|code)${SEP}${NOT_A_YEAR}\d{4,}(?!\d)`,
  String.raw`\b(?:zoom|meeting|webinar|access|entry|door|gate|security|keypad|lockbox|key)\s+(?:pass\s*code|pass|code)${SEP}(?:is\s+)?${CODE_VALUE}`,
);

export const TOLL_FREE = /^8(00|33|44|55|66|77|88)/;
export const FREE_MAIL =
  /@(gmail|googlemail|yahoo|ymail|rocketmail|icloud|me|mac|hotmail|outlook|live|msn|aol|att|sbcglobal|bellsouth|comcast|cox|verizon|earthlink|charter|frontier|protonmail|proton|gmx|mail|zoho|juno|netzero|roadrunner|twc|q)\.(com|net|me)$/i;
// the free-mail services of FREE_MAIL by name ("gmail", "sbcglobal", "proton"…), whatever the ending
const FREE_MAIL_NAMES = /@\(([^)]*)\)/.exec(FREE_MAIL.source)[1];
const FREE_SERVICE = new RegExp(`^(?:${FREE_MAIL_NAMES})$`, "i");
// …the ones whose name is never an ordinary word ("email anar1990 at gmail" with no ending; not "live", "me", "charter")
const FREE_NAMED_LIST = "gmail|googlemail|yahoo|ymail|rocketmail|icloud|hotmail|outlook|aol|sbcglobal|bellsouth|comcast|verizon|earthlink|protonmail|proton|gmx|roadrunner|netzero";
const FREE_SERVICE_NAMED = new RegExp(`^(?:${FREE_NAMED_LIST})$`, "i");
// An address written with the word "at": "anar1990 at sbcglobal.net", "anar1990 at proton.me" (a free-mail service,
// any ending: always), "RSVP anar1990 at example.net" (another domain: only when the text says e-mail, correo, RSVP,
// contact or write before it on its line; not "Join us at aanoc.org"), "email anar1990 at gmail" (a free-mail service
// with no ending, after such a word, not before a capital: "at Verizon Amphitheater"). Group 1: the name, 2: the
// domain, 3: a service with no ending. Global.
const EMAIL_AT = /(?<![\p{L}\p{N}_.+\-])([\p{L}\p{N}_.+\-]+)\s+at\s+(?:((?:[a-z0-9\-]+\.)+[a-z]{2,24})\b|([a-z]+)\b(?![ \t]*dot\b|\.[a-z0-9]))/giu;
const EMAIL_SAID = /(?:^|[^\p{L}])(?:e-?mails?|correo|rsvp|contact\p{L}*|write|escrib\p{L}*)(?!\p{L})/iu;
// A free-mail address may be published only when its name says which service role it belongs to.
export const ROLE_NAME =
  /district|dist\d|^d\d|dcm|chair|secretary|registrar|treas|delegate|gsr|grapevine|vina|cpc|literature|archiv|area|msca|handi|ypaa|webmaster|website|newcomer|accessib|cec|committee|intergroup|office|corrections|treatment|registration|(^|[._-]|\d)(pi|hi|sec|pio)([._-]|\d|$)/i;
export const ROLE_DOMAINS = [/@msca09aa\.org$/i, /@aa\.org$/i, /@aagrapevine\.org$/i, /@area9btg\.org$/i];
// A number right after one of these is a Zoom meeting ID (or a passcode), not a phone number. (Also the labels that
// cleanRecord takes off the end of a title cut before its detail; not "Pass", "Code" or "Pin", which end real titles:
// "Weekend Pass", "Dress Code", "Lapel Pin".)
export const ID_LABEL =
  /(?:\bzoom\s*(?:meeting\s*)?(?:id|#|number)?|(?:meeting|webinar|reuni[oó]n)\s*(?:id|#|number|n[uú]mero)|\b(?:id|n[uú]mero)\s*(?:de\s+(?:la\s+)?(?:reuni[oó]n|zoom)|zoom)?|\bi\.d\.?|\bpmi|pass[\s-]?code|password|contrase[nñ]a|c[oó]digo(?:\s+de\s+(?:la\s+)?(?:acceso|reuni[oó]n|zoom|entrada))?|\bclave(?:\s+de\s+(?:la\s+)?(?:acceso|reuni[oó]n|zoom))?|pwd|\bpw)\s*(?:is|es)?\s*[:#=\-–—.]?\s*$/i;
const ZOOM_URL_BEFORE = /zoom(?:gov)?\.us\/(?:j|s|w|my|wc(?:\/join)?)\/$/i;

/** The 10 digits of a North American number ("+1 (714) 555-0123" → "7145550123"). */
export const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const hostOf = (h) => String(h || "").toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "").replace(/^www\./, "");
/** An allowed office line or a toll-free number (10 digits). */
const officeLine = (d, al) => d.length === 10 && (al.phones.has(d) || TOLL_FREE.test(d));

let cached = null;
/** The allowed phone numbers and e-mail addresses (read once; { fresh: true } reads the files again). */
export function loadAllow({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  const rows = readCsv("contact-allowlist.csv");
  const phones = new Set(rows.filter((r) => r.kind === "phone").map((r) => digits(r.value)));
  // Public office lines published on the resources pages are allowed by definition.
  for (const file of ["central-offices.csv", "resources.csv"]) {
    for (const row of readCsv(file)) {
      for (const v of Object.values(row)) {
        for (const m of String(v).matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) phones.add(digits(m[0]));
      }
    }
  }
  // kind email only (never email-approved: a servant's own address is shown on that servant's card alone), and a
  // free-mail address only when its name says which role it serves (as check-site requires)
  const emails = new Set(
    rows
      .filter((r) => r.kind === "email")
      .map((r) => String(r.value).trim().toLowerCase())
      .filter((a) => a && (!FREE_MAIL.test(a) || ROLE_NAME.test(a.split("@")[0]))),
  );
  cached = { phones, emails };
  return cached;
}

/** Is this e-mail address allowed in imported text? (a role domain, the allow list, or the office's own domain) */
export function emailAllowed(addr, { allow, officeHost } = {}) {
  const a = String(addr || "").toLowerCase().replace(/[.,;:]+$/, "");
  const al = allow || loadAllow();
  if (ROLE_DOMAINS.some((re) => re.test(a)) || al.emails.has(a)) return true;
  const domain = a.split("@")[1] || "";
  const hosts = (Array.isArray(officeHost) ? officeHost : [officeHost]).map(hostOf).filter(Boolean);
  return hosts.some((h) => domain === h || domain.endsWith("." + h));
}

/** This year: the year of `now` (an ISO time, whose own date counts; a Date; a Luxon DateTime; a year); today's when
 *  there is none. */
export function yearOf(now) {
  const today = () => new Date().getFullYear();
  if (now == null || now === "") return today();
  if (typeof now === "number") return now >= 1000 && now < 10000 ? Math.trunc(now) : today();
  if (typeof now === "string") {
    const m = /^\s*(\d{4})-/.exec(now);
    if (m) return Number(m[1]);
    const d = new Date(now);
    return Number.isNaN(d.getTime()) ? today() : d.getFullYear();
  }
  if (now instanceof Date) return Number.isNaN(now.getTime()) ? today() : now.getFullYear();
  if (typeof now.year === "number") return now.year;
  return today();
}
// a 2-digit year: up to 5 years ahead is this century ("12/12/27" is 2027), the rest the last one ("3/3/90" is 1990)
const fullYear = (yy, year) => (yy <= (year % 100) + 5 ? 2000 + yy : 1900 + yy);
/** The year a date (or a year) names: "3/14/1989", "March 3, 1990", "1990" → its 4 digits; "3/3/90", "'90" → 1990;
 *  0 when it names none ("March 3"). */
function yearIn(s, year) {
  const t = String(s);
  const four = [...t.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => Number(m[1]));
  if (four.length) return four[four.length - 1];
  const two = /'(\d{2})(?!\d)|\d{1,2}[\/.\-]\d{1,2}[\/.\-](\d{2})(?!\d)/.exec(t);
  return two ? fullYear(Number(two[1] ?? two[2]), year) : 0;
}
// A sobriety date is a person's when its year is from 1940 to last year: a year before 1940 is history ("Sober Since
// 1935: A.A. History Workshop"); this year or a later one is the event's own ("2026 Sobriety Birthday Bash", "Los DOS
// 12/12/2026 Talleres"). Right after an explicit label ("sober since", "sobriety date", "fecha de sobriedad", "sobrio
// desde") this year counts too. A date without a year ("sober since March 3") counts.
const personalDate = (text, year, labelled = false) => {
  const y = yearIn(text, year);
  return !y || (y >= 1940 && (labelled ? y <= year : y < year));
};

/**
 * Explicit personal details in a piece of text (the precise rules: see the top of this file): [{ kind, value, index }],
 * kind = phone | email | sobriety | zoom | password, one hit per phone number and e-mail address, and one hit (the
 * earliest) per kind for sobriety, zoom and password. value = the text that matched (for sobriety, zoom and password
 * often only the start: "Passcode", "sober since 1999", the date before "sobriety birthday"), index = where it starts.
 * Both are positions in the given text (\r removed), mapped back from the normalised text the rules read. phones: false
 * skips phone numbers (the owner's rule for flyers). officeHost: the office's website (its e-mail addresses are
 * allowed), one host or a list. now: which year is this year (default: today).
 */
export function contactHits(text, { phones = true, allow, officeHost, now } = {}) {
  const src = String(text ?? "").replace(/\r/g, "");
  if (!src.trim()) return [];
  const n = normalized(src);
  const t = n.text;
  const al = allow || loadAllow();
  const year = yearOf(now);
  const hits = [];
  const add = (kind, at, len) => {
    const [a, b] = spanOf(n, at, len);
    hits.push({ kind, value: src.slice(a, b), index: a });
  };
  if (phones) {
    const phoneAt = new Set();
    for (const re of [PHONE, PHONE_3322]) {
      for (const m of t.matchAll(re)) {
        const d = m.slice(1).filter(Boolean).join("");
        if (officeLine(d, al)) continue;
        const lead = m[0].length - m[0].trimStart().length;
        if (phoneAt.has(m.index + lead)) continue;
        phoneAt.add(m.index + lead);
        const before = t.slice(Math.max(0, m.index - 40), m.index);
        const kind = ZOOM_URL_BEFORE.test(before) || ID_LABEL.test(before.replace(/["'{}[\],\\]/g, " ")) ? "zoom" : "phone";
        add(kind, m.index + lead, m[0].trim().length);
      }
    }
  }
  const mailAt = new Set();
  const mail = (addr, at, len, spaced) => {
    if (mailAt.has(at)) return;
    if (spaced && !FREE_MAIL.test(addr) && SPACED_NOT_MAILBOX.test(addr.split("@")[0])) return;
    if (emailAllowed(addr, { allow: al, officeHost })) return;
    mailAt.add(at);
    add("email", at, len);
  };
  for (const m of t.matchAll(EMAIL)) mail(m[0].replace(/[.,;:]+$/, ""), m.index, m[0].replace(/[.,;:]+$/, "").length, false);
  for (const m of t.matchAll(EMAIL_SPACED)) {
    if (t[m.index + m[0].length] === "/") continue;
    mail(m[0].replace(/\s+dot\s+/gi, ".").replace(/\s+/g, ""), m.index, m[0].length, true);
  }
  for (const m of t.matchAll(EMAIL_SPELLED)) mail(`${m[1]}@${m[2].replace(/\s+(?:dot|punto)\s+/gi, ".")}`, m.index, m[0].length, true);
  for (const m of t.matchAll(EMAIL_AT)) {
    const local = m[1];
    const said = EMAIL_SAID.test(t.slice(t.lastIndexOf("\n", m.index) + 1, m.index));
    let domain;
    let free;
    if (m[2]) {
      domain = m[2].toLowerCase();
      free = domain.split(".").slice(0, -1).some((p) => FREE_SERVICE.test(p));
    } else {
      if (!said || !FREE_SERVICE_NAMED.test(m[3]) || /^[ \t]+\p{Lu}/u.test(t.slice(m.index + m[0].length))) continue;
      domain = `${m[3].toLowerCase()}.com`;
      free = true;
    }
    if (!free && (!said || SPACED_NOT_MAILBOX.test(local))) continue;
    mail(`${local}@${domain}`, m.index, m[0].length, false);
  }
  const hidden = EMAIL_HIDDEN.exec(t);
  if (hidden && !mailAt.has(hidden.index)) add("email", hidden.index, hidden[0].length);
  // one hit per kind: the earliest of its patterns (cleanRecord cuts a title there)
  const first = (re, keep = () => true) => {
    for (const m of t.matchAll(re)) if (keep(m)) return m;
    return null;
  };
  // a group named after its year is not a person's date ("Sober Since 1979 Group – 47th Anniversary")
  const notGroup = (m) => !GROUP_NEXT.test(t.slice(m.index + m[0].length));
  const sober = [
    first(SOBRIETY_AFTER, (m) => personalDate(m[0], year, SOBER_LABEL_START.test(m[0])) && notGroup(m)),
    first(SOBRIETY_BEFORE, (m) => personalDate(m[0], year)),
    first(SOBRIETY_DOS, (m) => /^D\.?O\.?S/.test(m[0]) && personalDate(m[0], year) && notGroup(m)),
  ];
  const zoom = [
    // the number after "zoom": not the office's line or a toll-free number ("Join by Zoom or call 800-555-0199")
    first(ZOOM_ALL, (m) => !officeLine(digits((/\(?\d[\d\s().\-]*$/.exec(m[0]) || [""])[0]), al)),
    first(ZOOM_BEFORE, (m) => {
      const d = digits(m[0]);
      return d.length !== 10 || !officeLine(d, al);
    }),
  ];
  for (const [kind, found] of [["sobriety", sober], ["zoom", zoom], ["password", [PASSWORD.exec(t)]]]) {
    const m = found.filter(Boolean).sort((a, b) => a.index - b.index)[0];
    if (m) add(kind, m.index, m[0].length);
  }
  return hits;
}

/* ------------------------------------------------------------------ titles, venues and ids: the structural rules */

// A run of digits with spaces, dashes, "/", "_", "·", "•", "|" or line breaks between (1 to 3 of them), or a dot or a
// comma right between two digits ("812.3456.7890", "812,3456,7890"; a comma and a space make a list: "Suite 101-102,
// 1915 S Manchester Ave"; a full stop and a space end a sentence: "Doors at 6. 812 people"). Group 1: a "$" before it
// (a price). Global.
const NUMBER_RUN = /(\$\s?)?(?<!\d)\d+(?:(?:[\s\-\/_·•|]{1,3}|[.,])\d+)*/g;
const RUN_GROUPS = /[\s.\-\/_·•|,]+/;
const YEAR_GROUP = /^(?:19|20)\d{2}$/;
// prices and times written with 2 decimals: "125.00 – 150.00", "7.30 - 9.30"
const DECIMALS = /^\d{1,5}\.\d{2}(?:[\s\-\/_·•|,]{1,3}\d{1,5}\.\d{2})*$/;
// a ZIP+4 code: "92590-1234"
const ZIP4 = /^\d{5}-\d{4}$/;

/** Is this run of digits exactly one phone number (3-3-4, 3-3-2-2, with or without +1)? */
function phoneShaped(run) {
  for (const re of [PHONE, PHONE_3322]) for (const p of run.matchAll(re)) if (p.index === 0 && p[0].length === run.length) return true;
  return false;
}

/**
 * A meeting number (rule 2): the first run of 9 digits or more (separators: see NUMBER_RUN) that is not an allowed or
 * toll-free phone number (those are taken out first), not exactly one phone number (contactHits reports a personal
 * one), not a price ("$" before it, or 2 decimals), not a ZIP+4 code, and not dates and times (every group 1-2 digits
 * or a year, or with a year a 24-hour time: "11/14/2026 – 11/16/2026", "Dec 24–25, 2026", "7.30 - 9.30", "2026-11-14
 * 1730"). → { at, len } or null.
 */
const HHMM = /^(?:[01]\d|2[0-3])[0-5]\d$/;
function meetingNumber(t, al) {
  const s = t.replace(PHONE, (m, a, b, c) => (officeLine(a + b + c, al) ? "x".repeat(m.length) : m));
  for (const m of s.matchAll(NUMBER_RUN)) {
    if (m[1]) continue;
    const run = m[0];
    const groups = run.split(RUN_GROUPS).filter(Boolean);
    if (groups.join("").length < 9) continue;
    const dated = groups.some((g) => YEAR_GROUP.test(g));
    if (groups.every((g) => g.length <= 2 || YEAR_GROUP.test(g) || (dated && HHMM.test(g)))) continue;
    if (DECIMALS.test(run) || ZIP4.test(run) || phoneShaped(run)) continue;
    return { at: m.index, len: run.length };
  }
  return null;
}

// Rule 3, codes. The labels: PW, PIN, passcode, pass code, password, passwd, pwd, contraseña, clave, código, code, and
// key / access / gate / door / entry / security / keypad / lockbox / alarm / Zoom / meeting code. Global.
const CODE_LABEL =
  /\b(?:pw|pins?|pass[\s-]?codes?|passwords?|passwd|pwd|contrase[nñ]as?|claves?|c[oó]digos?|(?:key|access|gate|door|entry|security|keypad|lockbox|alarm|zoom|meeting)\s+codes?|codes?)(?![\p{L}\p{N}])/giu;
// …between the label and its value: signs and spaces, and these short words only ("PW is 774411", "Clave para entrar:
// 7788", "PW for Zoom: 774411", "PIN → 1234"; in a page address, "and colon" is what slugify made of "&colon;"); not
// "of" ("Code of Conduct"), not "$" (a price), not a line break.
const CODE_GAP = new RegExp(
  String.raw`^(?:[^\p{L}\p{N}$\n]|(?:is|was|are|es|era|ser[aá]|for|para|por|entrar|ingresar|acceder|enter|to|the|de|del|la|el|en|zoom|meeting|reuni[oó]n|sala|junta|sesi[oó]n|session|acceso|entrada|number|n[uú]mero|no|n[ºo°]|code|c[oó]digo|word|here|aqu[ií]|and|y|amp|colon|ensp|emsp|nbsp|thinsp|ndash|mdash|dash|hyphen|num)(?![\p{L}\p{N}]))*`,
  "iu",
);
// a value: up to a space, a quote, a bracket or a separator sign
const CODE_TOKEN = /^[^\s"'()[\]{}<>,;|·•→»«]+/u;
const NUMBER_WORD = /^(?:cero|zero|oh|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine)$/i;
// a word before a bare "code" that makes it some other code ("Dress code", "Group Code: AA022026SD", "Zip code",
// "Area Code", "Promo code"); an article or "our" does not ("The code is 7788")
const CODE_WORD_BEFORE = /(?<![\p{L}\p{N}])(\p{L}+)[ \t]*$/u;
const CODE_ARTICLE = /^(?:the|our|your|its|this|new|el|la|su|sus|nuestro|nuestra|tu|este|esta|nuevo|nueva)$/i;
// …and the words before "code" that name a public code even with a letters-and-digits value ("Group Code: AA022026SD",
// a hotel's; "Promo code: SOBER26"): "Workshop code: 8Hk2pX" is a passcode, those are not
const PUBLIC_CODE = /^(?:group|groups|promo|promotional|promotion|discount|coupon|voucher|referral|booking|reservation|registration|hotel|rate|ticket|tickets|offer|zip|postal|area|country|dress|bar|qr|tax|color|colour|style|course|class|source|event|access)$/i;
// a value of letters and digits mixed, 5 or more (a Zoom passcode: "Ab3x9Q", "8Hk2pX"), counted after ":" or "is" / "es"
const MIXED_VALUE = /^(?=[\p{L}\d]*\d)(?=[\p{L}\d]*\p{L})[\p{L}\d]{5,}$/u;
// a value typed as single digits with spaces between: "7 7 8 8", "1 2 3 4" (3 digits or more)
const SPACED_DIGITS = /^\d(?:[ \t]+\d(?![\p{L}\p{N}])){2,}/u;

/** Every code (rule 3) in the normalised text: [{ at, len, tokenAt, tokenLen }] (at: the label). */
function codeHits(t, year) {
  const out = [];
  for (const m of t.matchAll(CODE_LABEL)) {
    const label = m[0];
    // a bare "code" after another word ("Dress code", "Group Code: AA022026SD") is some other code, unless it "is"
    // a number ("workshop code is 7788": a page address has lost the dash of "Workshop – Code is 7788"), or it is
    // given a letters-and-digits value after ":" and the word does not name a public code ("Workshop code: 8Hk2pX")
    let other = false;
    let otherWord = "";
    if (/^codes?$/i.test(label)) {
      const before = CODE_WORD_BEFORE.exec(t.slice(Math.max(0, m.index - 30), m.index));
      other = !!before && !CODE_ARTICLE.test(before[1]);
      otherWord = before ? before[1] : "";
    }
    const from = m.index + label.length;
    const gap = CODE_GAP.exec(t.slice(from, from + 40))[0];
    if (gap.length > 25) continue;
    const at = from + gap.length;
    const tok = CODE_TOKEN.exec(t.slice(at));
    if (!tok) continue;
    let value = tok[0].replace(/[.:!?]+$/, "");
    let len = value.length;
    if (!value || value.startsWith("$")) continue;
    const nd = (value.match(/\d/g) || []).length;
    // after ":" or "is" / "es": a letters-and-digits value ("Clave: Ab3x9Q", "Code is 8Hk2pX")
    const mixed = /[:=]|(?<!\p{L})(?:is|es)(?!\p{L})/iu.test(gap) && MIXED_VALUE.test(value);
    const spaced = /^\d$/.test(value) ? SPACED_DIGITS.exec(t.slice(at)) : null;
    if (other) {
      const isNumber = /^\s*(?:is|es|was|era)\s+["']?$/i.test(gap) && /^\d{3,}$/.test(value);
      if (!isNumber && !(mixed && !PUBLIC_CODE.test(otherWord))) continue;
    }
    if (spaced && !other) {
      // a code typed digit by digit: "Clave: 7 7 8 8", "PIN 1 2 3 4"
      value = spaced[0];
      len = value.length;
    } else if (nd >= 3) {
      // the event's own year or date, and times, are not codes ("PW 2026 Forum", "Lapel Pin 2026", "Clave 12/12/2026")
      if (YEAR_GROUP.test(value) && Number(value) >= year) continue;
      if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})$/.test(value) && yearIn(value, year) >= year) continue;
      if (/^\d{1,2}[:.]\d{2}(?:[ap]\.?m\.?)?$/i.test(value)) continue;
    } else if (mixed) {
      // a letters-and-digits passcode: its whole token
    } else if (NUMBER_WORD.test(value)) {
      // a code spelled out: "Clave: siete siete ocho ocho"
      const words = /^(?:[a-z]+(?:[\s,\-]+|$)){1,12}/i.exec(t.slice(at))[0].split(/[\s,\-]+/).filter(Boolean);
      let k = 0;
      while (k < words.length && NUMBER_WORD.test(words[k])) k++;
      if (k < 3) continue;
      const spelled = new RegExp(`^(?:[a-z]+[\\s,\\-]+){${k - 1}}[a-z]+`, "i").exec(t.slice(at))[0];
      value = spelled;
      len = spelled.length;
    } else continue;
    out.push({ at: m.index, len: at + len - m.index, tokenAt: at, tokenLen: len });
  }
  return out;
}

// Rule 4, sobriety dates. Four kinds of words (global, any case; DOS is checked below; the longer wording wins):
//  - lab: a label that says what its date is: sober since, sober date, sobriety since / date, fecha de sobriedad, sobrio
//    / sobria / sobrios desde, DOS, D.O.S., clean date, clean since, clean time since, last drink, sin beber / tomar /
//    alcohol desde, libre de alcohol desde, no drinking since, recovery date;
//  - bday: sobriety / sober / AA / A.A. birthday, cumpleaños de sobriedad (a label that may also name an event:
//    "Sobriety Birthday Night – Nov 14", "2026 Sobriety Birthday Bash", "AA Birthday 2025 Recap");
//  - ann: soberversary, AA / A.A. anniversary, clean time;
//  - bd: birthday, b-day, cumpleaños on their own;
//  - gen: sober, sobriety, sobriedad, sobrio / sobria / sobrios / sobrias on their own.
const SOBER_WORD = new RegExp(
  [
    String.raw`(?<lab>\bsober\s+(?:since|date)\b|\bsobri(?:ety|edad)\s+(?:since|date)\b|\bfecha\s+de\s+(?:la\s+)?sobriedad\b|\bsobri[oa]s?\s+desde\b|\bd\.o\.s\b\.?|\bdos\b|\bclean\s+(?:date|since|time\s+since)\b|\blast\s+drink\b|\bsin\s+(?:beber|tomar|alcohol)\s+desde\b|\blibre\s+de\s+alcohol\s+desde\b|\bno\s+drinking\s+since\b|\brecovery\s+date\b)`,
    String.raw`(?<bday>\b(?:sobriety|sober|sobriedad)\s+(?:birthday|b-?day)\b|\ba\.?\s?a\.?\s+(?:birthday|b-?day)\b|\bcumplea[ñn]os\s+de\s+(?:la\s+)?sobriedad\b)`,
    String.raw`(?<ann>\bsoberversary\b|\ba\.?\s?a\.?\s+anniversary\b|\bclean\s+time\b)`,
    String.raw`(?<bd>\b(?:birthday|b-?day|cumplea[ñn]os)\b)`,
    String.raw`(?<gen>\bsober\b|\bsobri(?:ety|edad)\b|\bsobri[oa]s?\b)`,
  ].join("|"),
  "giu",
);
// Spanish words before "dos" that make it "two" ("Los DOS 12/12/2026 Talleres", "de dos", "sus dos")
const DOS_TWO = /(?:^|[^\p{L}])(?:los|las|de|del|y|e|a|o|u|en|con|sus|unos|unas|entre|nuestros|nuestras|mis|tus|ambos|ambas|cada|son|por|para|cuatro|tres|uno|una)[ \t]+$/iu;
// a group's name ("Grupo Sobrios Desde 1985", "Sobriety Group")
const GROUP_BEFORE = /\b(?:grupo|group|club)\s+(?:de\s+)?(?:la\s+)?$/i;
const GROUP_AFTER = /^\s+(?:group|club|grupo)\b/i;
// The dates (global), by kind:
//  - full: with its day and year: 3/14/1989, 3-14-89, 3 14 1989, 1989-03-14, 3 de marzo de 1990, March 3, 1990, March
//    3rd, '90;
//  - my: a month and a year: March 1990, marzo de 1990, March '90, 3/1990, 3/90 (a "3/14" is read as md: March 14 or
//    March 2014);
//  - md: a month and a day: March 3, 3 de marzo, 3/14;
//  - apos: an apostrophe year: '90 (not '90s);
//  - year: a year alone: 1990 (not 1980s);
//  - two: two digits from 40 to 99 alone, not a count ("90", as a page address writes '90; not "60 Years", "90 días").
const SOBER_DATES = new RegExp(
  [
    String.raw`(?<full>(?<![\w\/.\-])(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})(?!\d)|\d{1,2} \d{1,2} ${YEAR}(?!\d)|${YEAR}-\d{1,2}-\d{1,2}(?!\d)|\d{1,2}\s+de\s+(?:${MONTHS_ES})\s+(?:de|del)\s+\d{4}|${MONTH_EN}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:\d{4}|'\d{2})(?!\d)))`,
    String.raw`(?<my>(?<![\w\/.\-])(?:${MONTH_ES}\s+(?:de|del)\s+\d{4}|${MONTH_EN},?\s+(?:of\s+)?(?:\d{4}|'\d{2})(?!\d)|\d{1,2}[\/.\-](?:19|20)\d{2}(?![\d\/.\-]\d)|\d{1,2}\/\d{2}(?![\d\/]|\.\d)))`,
    String.raw`(?<md>${MONTH_EN}\s+\d{1,2}(?:st|nd|rd|th)?\b|\d{1,2}\s+de\s+(?:${MONTHS_ES})\b)`,
    String.raw`(?<apos>'\d{2}(?!\d|s\b))`,
    String.raw`(?<year>(?<![\d$\/.])${YEAR}(?!\d|'?s\b))`,
    String.raw`(?<two>(?<![\w\/.\-$'])[4-9]\d(?![\w\/.\-]|[ \t]*(?:%|\+|days?\b|d[ií]as\b|years?\b|yrs?\b|a[ñn]os\b|months?\b|meses\b|hours?\b|hrs?\b|horas\b|min|weeks?\b|semanas\b|steps?\b|pasos\b)))`,
  ].join("|"),
  "giu",
);
// between a label and a date right after it: signs, then up to two short words ("sober since: 1990", "sobrio desde el
// 3/14", "sobriety date is 1990")
const RIGHT_AFTER = /^[\s:=#,()\-'"]{0,4}(?:(?:is|was|es|fue|el|la|on|of|from|desde|since|en|in)[\s:,]+){0,2}$/i;
// the end of a phrase after a year ("Tom R. (sobriety birthday 1989)"; not "Sobriety Birthday 2025 Recap")
const PHRASE_END = /^[ \t]*(?:$|[\n).,;:!?\]])/;

/** Is (nearly) every letter a capital? (then a capital word says nothing: "LOS DOS AMIGOS") */
const shouting = (t) => {
  const letters = t.match(/\p{L}/gu) || [];
  return letters.length >= 4 && letters.filter((c) => /\p{Lu}/u.test(c)).length / letters.length > 0.85;
};

/** The dates of a text that may be a person's: [{ index, end, kind, year, next }] (see SOBER_DATES; the year from 1940
 *  to last year, '90 and 3/3/90 are 1990; md has no year). */
function soberDates(t, year) {
  const out = [];
  for (const d of t.matchAll(SOBER_DATES)) {
    const g = d.groups;
    const s = d[0];
    let kind = g.full ? "full" : g.my ? "my" : g.md ? "md" : g.apos ? "apos" : g.year ? "year" : "two";
    let y = 0;
    if (kind === "my" && /^\d{1,2}\/\d{2}$/.test(s)) {
      const [mo, x] = s.split("/").map(Number);
      if (mo < 1 || mo > 12) continue;
      if (x <= 31) kind = "md";
      else y = fullYear(x, year);
    } else if (kind === "two") y = 1900 + Number(s);
    else if (kind !== "md") y = yearIn(s, year);
    if (kind !== "md" && !(y >= 1940 && y < year)) continue;
    out.push({ index: d.index, end: d.index + s.length, kind, year: y, next: t.slice(d.index + s.length) });
  }
  return out;
}

/** Does a word of this kind (see SOBER_WORD) make this date a person's sobriety date? right: the date comes right
 *  after the word (RIGHT_AFTER). */
function soberPair(cls, d, right, dos) {
  const dated = d.kind === "full" || d.kind === "my";
  if (cls === "gen") return dated;
  if (cls === "bd") return d.kind === "full";
  if (cls === "ann") return dated || d.kind === "apos";
  if (dated || d.kind === "apos") return true;
  if (!right || GROUP_NEXT.test(d.next)) return false;
  if (cls === "bday") return d.kind === "year" && PHRASE_END.test(d.next);
  // lab: a year, a month and a day, or (not after DOS) two digits, right after it
  return d.kind === "year" || d.kind === "md" || (d.kind === "two" && !dos);
}

/**
 * A sobriety date (rule 4): a sobriety word and a date on the same line, within 25 characters, either side, each kind
 * of word with the dates it may go with (see SOBER_WORD, SOBER_DATES, soberPair): a word on its own needs a date with
 * its day or its month ("sober 3/3/1990", not "Since 1988 – Proud & Sober." or "Sober in the Sun 2025 Recap"); a label
 * also takes an apostrophe year, and right after it a year alone ("sober since 1990"), unless Group, Grupo or Club
 * follows the year. Dates from 1940 to last year. DOS in capitals (in text that is not all capitals) or written D.O.S.
 * counts like any label; "dos" otherwise only right before a date ("Ana R. dos: 3/14/89"), and never after a Spanish
 * word that goes with "dos". A group's name does not count. → { at, len } (from the earlier of the two to the end of the
 * later) or null.
 */
function sobrietyDate(t, year) {
  const dates = soberDates(t, year);
  if (!dates.length) return null;
  const caps = shouting(t);
  let best = null;
  for (const w of t.matchAll(SOBER_WORD)) {
    const g = w.groups;
    const cls = g.lab ? "lab" : g.bday ? "bday" : g.ann ? "ann" : g.bd ? "bd" : "gen";
    const word = w[0];
    const before = t.slice(Math.max(0, w.index - 40), w.index);
    const after = t.slice(w.index + word.length);
    if (GROUP_BEFORE.test(before) || GROUP_AFTER.test(after)) continue;
    let near = 25;
    const dos = /^dos$/i.test(word);
    if (dos) {
      if (DOS_TWO.test(before)) continue;
      // "dos" in lower case (or in a text in capitals): only right before its date
      if (word !== "DOS" || caps) near = 4;
    }
    const wEnd = w.index + word.length;
    for (const d of dates) {
      // the date after the word, or before it; the characters between them
      const fwd = d.index >= wEnd;
      if (!fwd && d.end > w.index) continue;
      if ((fwd ? d.index - wEnd : w.index - d.end) > near) continue;
      const between = fwd ? t.slice(wEnd, d.index) : t.slice(d.end, w.index);
      if (between.includes("\n")) continue;
      if (near === 4 && (!fwd || !/^[\s:=\-]*$/.test(between))) continue;
      if (!soberPair(cls, d, fwd && RIGHT_AFTER.test(between), dos)) continue;
      const at = Math.min(w.index, d.index);
      const end = Math.max(wEnd, d.end);
      if (!best || at < best.at) best = { at, len: end - at };
    }
  }
  return best;
}

/**
 * The details that keep an event TITLE (or a Spanish title, a venue, an id read as words) from being shown whole:
 * contactHits plus the structural rules (the top of this file): meeting numbers (kind zoom), codes (password) and
 * sobriety dates (sobriety). [{ kind, value, index }] in the given text, as contactHits; a structural hit starts at
 * its label (a code), its number (a meeting number) or the earlier of the sobriety word and the date.
 */
export function titleRisk(text, { allow, officeHost, now } = {}) {
  const src = String(text ?? "").replace(/\r/g, "");
  if (!src.trim()) return [];
  const al = allow || loadAllow();
  const year = yearOf(now);
  const hits = contactHits(src, { allow: al, officeHost, now: year });
  const n = normalized(src);
  const t = n.text;
  const add = (kind, h) => {
    if (!h) return;
    const [a, b] = spanOf(n, h.at, h.len);
    hits.push({ kind, value: src.slice(a, b), index: a });
  };
  add("zoom", meetingNumber(t, al));
  add("password", codeHits(t, year)[0]);
  add("sobriety", sobrietyDate(t, year));
  return hits;
}

/** The ways an address or an id may be read as words, all of them: "ana-r-sobriety-date-3-3-1990" as "ana r sobriety
 *  date 3 3 1990" and "… 3/3/1990"; "potluck-p-w-774411" as "potluck PW 774411"; "ana-r-d-o-s-…" as "ana r DOS …";
 *  "ana-r-sober-since-331990" (slugify drops "/") as "… 3/3/1990"; "3390" as "3/3/90"; "390" and "3 90" as "3/90";
 *  "maria-gmail-com", "maria-gmail-dot-com" and, as WordPress writes it with the "@" dropped, "mariagmail-com" as
 *  "maria@gmail.com"; "anar1990-at-example-net" as "anar1990 at example.net"; "pass-code-ab3x9q" as "pass code: ab3x9q".
 *  An id's own date ("…-20261212") is read as a date. Letters and digits that NFKC makes plain are read plainly. */
export function slugForms(slug, { now } = {}) {
  const year = yearOf(now);
  let s = String(slug ?? "");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* not percent-encoded */
  }
  s = compatFold(s);
  // the words; an event's own date as an id ends with it ("…-20261212") is read as a date, not as part of a number
  // ("room-101-20261212" is not the 11-digit "101 20261212")
  const words = s
    .replace(/[\-_+.\/\s]+/g, " ")
    .trim()
    .replace(/(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g, (m, y, mo, d) => (Number(y) >= year - 1 ? `on ${y}/${mo}/${d}` : m));
  // letters spelled apart: "p w" PW, "d o s" DOS, "i d" ID, "a a" AA ("ana r d o s …" is "ana r DOS …"), and every run
  // of single letters joined
  const known = words.replace(/\b(?:p w|d o s|i d|a a)\b/gi, (m) => m.replace(/ /g, "").toUpperCase());
  const letters = words.replace(/\b[a-z](?: [a-z]\b)+/gi, (m) => m.replace(/ /g, "").toUpperCase());
  const dated = known.replace(/\b(\d{1,2}) (\d{1,2}) (\d{4}|\d{2})\b/g, "$1/$2/$3");
  // an address at a free-mail service ("maria-gmail-com", "ana-r-gmail-dot-com"; "mariagmail-com", "josegmail-com": the
  // "@" that WordPress drops); a domain whose dot slugify dropped ("anar1990-at-example-net": the "at" rule reads it); a
  // "pass code" whose ":" slugify dropped, before a value with a digit ("pass-code-ab3x9q"; not "pass-code-workshop")
  const mail = known
    .replace(new RegExp(String.raw`\b([\p{L}\p{N}_+]+) (${FREE_MAIL_NAMES})(?: dot)? (com|net|me)\b`, "giu"), "$1@$2.$3")
    .replace(new RegExp(String.raw`\b([\p{L}\p{N}_+]{2,}?)(${FREE_NAMED_LIST}) (com|net|me)\b`, "giu"), "$1@$2.$3")
    .replace(/\b(\S+) at ([a-z0-9]+) (com|net|org|edu|gov|us|info|me|io|co|mx)\b/gi, "$1 at $2.$3")
    .replace(/\b(pass code)\b(?= \S*\d)/gi, "$1:")
    // …and a code label before a letters-and-digits value ("taller-clave-ab3x9q": "Clave: Ab3x9Q")
    .replace(/\b(pw|pin|clave|c[oó]digo|code|passcode)\b (?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])([a-z0-9]{5,})\b/gi, "$1: $2");
  // a date whose "/" slugify dropped: 331990 → 3/3/1990, 31489 → 3/14/89 (a month and a day, then a past year)
  const md = (p) => {
    for (let i = 1; i < p.length; i++) {
      const [m, d] = [Number(p.slice(0, i)), Number(p.slice(i))];
      if (p.slice(i).length <= 2 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${m}/${d}`;
    }
    return "";
  };
  // (whole words only: not the size in a file name, "-181x300")
  const squashed = dated.replace(/(?<![\w\/])\d{3,8}(?![\w\/])/g, (g) => {
    if (YEAR_GROUP.test(g)) return g;
    const y4 = Number(g.slice(-4));
    if (g.length >= 5 && y4 >= 1940 && y4 < year && md(g.slice(0, -4))) return `${md(g.slice(0, -4))}/${g.slice(-4)}`;
    const y2 = fullYear(Number(g.slice(-2)), year);
    if (g.length <= 6 && y2 >= 1940 && y2 < year && md(g.slice(0, -2))) return `${md(g.slice(0, -2))}/${g.slice(-2)}`;
    // a month and a 2-digit year: 390 → 3/90, 0390 → 03/90
    const mo = Number(g.slice(0, -2));
    if (g.length <= 4 && mo >= 1 && mo <= 12 && Number(g.slice(-2)) > 31 && y2 >= 1940 && y2 < year) return `${g.slice(0, -2)}/${g.slice(-2)}`;
    return g;
  })
    // a month and a 2-digit year whose "/" slugify made a "-": "3 90" → 3/90
    .replace(/(?<![\w\/])(\d{1,2}) (\d{2})(?![\w\/])/g, (x, mo, yy) => (Number(mo) >= 1 && Number(mo) <= 12 ? `${mo}/${yy}` : x));
  // (only next to a sobriety word: elsewhere a number is read as it is)
  const sober = /\b(?:sober\w*|sobri\w*|dos|clean|drink\w*|birthday|bday|beber|tomar|alcohol|anniversary|recovery)\b/i.test(dated);
  return [...new Set([words, known, letters, dated, mail, sober ? squashed : dated])].filter(Boolean);
}

/** titleRisk of every way an address or an id may be read as words (slugForms): an id or a page address made from a
 *  title must not carry what the title may not. [{ kind, value, index, form }] (index: in that form). */
export function slugRisk(slug, opts = {}) {
  const al = opts.allow || loadAllow();
  return slugForms(slug, opts).flatMap((form) => titleRisk(form, { ...opts, allow: al }).map((h) => ({ ...h, form })));
}

/* ------------------------------------------------------------------ summaries: all or nothing */

// A word that labels a code or a meeting, anywhere: zoom, meeting ID, webinar ID, ID de reunión, passcode, password,
// pass code, contraseña, clave, código, PW, PIN, PMI.
const CODE_WORDS =
  /\b(?:zoom|(?:meeting|webinar)\s*(?:id|#|number|n[uú]mero)|(?:id|n[uú]mero)\s+de\s+(?:la\s+)?reuni[oó]n|pass[\s-]?codes?|passwords?|passwd|pwd|contrase[nñ]as?|claves?|c[oó]digos?|pw|pin|pmi)(?!\p{L})/iu;
// Sobriety dates and lengths, however written: "sobriety date", "fecha de sobriedad", "sober since", "sobrio desde",
// "años sin beber", "N years sober", "years of sobriety", "sober for 10 years", "30 años sobrio", a sobriety word
// within 30 characters of a number (either way, over lines too), "sober" within 15 characters of a date or a year, and
// "AA birthday", "clean date", "last drink", "sin beber desde" with a number after them.
const SOBER_WORDS = alt(
  "iu",
  String.raw`\bsobri(?:ety|edad)\s+(?:date|birthday|b-?day|anniversary|anniv)`,
  String.raw`\bsober\s+(?:since|date|birthday|b-?day|anniversary)\b`,
  String.raw`\b(?:fecha|aniversario|cumplea[ñn]os)\s+de\s+(?:la\s+)?sobriedad\b`,
  String.raw`\bsobri[oa]s?\s+desde\b`,
  String.raw`\ba[ñn]os\s+sin\s+(?:beber|tomar)\b`,
  String.raw`\b(?:years?|yrs?|months?|a[ñn]os|meses)\s+(?:of|de|in|en)\s+(?:\p{L}+\s+)?(?:la\s+)?sobri(?:ety|edad)\b`,
  String.raw`(?:${COUNT})\+?[\s-]*(?:years?|yrs?|months?)\s+(?:of\s+)?(?:clean\s+(?:and|&)\s+)?sober\b`,
  String.raw`\bsober\s+(?:for\s+)?(?:over\s+|more\s+than\s+|almost\s+|nearly\s+|about\s+)?(?:${COUNT})\+?[\s-]*(?:years?|yrs?|months?)\b`,
  String.raw`\d+\s+a[ñn]os\s+(?:limpi[oa]s?\s+y\s+)?sobri[oa]s?\b`,
  String.raw`\bsobri[oa]s?\s+(?:por|durante)\s+(?:m[aá]s\s+de\s+)?\d`,
  String.raw`\bsobri(?:ety|edad|[oa]s?)\b[^\d]{0,30}\d`,
  String.raw`\d[^\d]{0,30}\bsobri(?:ety|edad|[oa]s?)\b`,
  String.raw`\bsober\b[^\d]{0,15}(?:${DATE_Y}|${YEAR}(?!\d)|'\d{2}\b)`,
  String.raw`(?:${DATE_Y}|(?<!\d)${YEAR}(?!\d))[^\d]{0,15}\bsober\b`,
  String.raw`\b(?:a\.?\s?a\.?\s+(?:birthday|b-?day)|clean\s+(?:date|since)|last\s+drink|sin\s+(?:beber|tomar)\s+desde)\b[^\d\n]{0,25}\d`,
);
const DOS_WORD = /\bD\.?O\.?S\b|\b[Dd]\.[Oo]\.[Ss]\b/; // capitals, or dotted: Spanish "dos" is "two"
// Runs of digits with spaces, dots, dashes, "/", "_", "·", "•" or "|" between them; a "$" before one is a price.
const DIGIT_RUN = /(\$\s?)?\d+(?:[\s.\-\/_·•|]{1,4}\d+)*/g;

/** Is there a run of 7 or more digits (spaces, dots, dashes, "/", "_", "·", "•" or "|" between them) that is not an
 *  allowed or toll-free phone number, a $ price, or dates and times (every group 1-2 digits or a year: 11-14-2026,
 *  11/14/2026, 7.30 - 9.30, 31 2026 7)? */
function longNumber(t, al) {
  const s = t.replace(PHONE, (m, a, b, c) => (officeLine(a + b + c, al) ? " ".repeat(m.length) : m));
  for (const m of s.matchAll(DIGIT_RUN)) {
    if (m[1]) continue;
    const groups = m[0].split(/[\s.\-\/_·•|]+/).filter(Boolean);
    if (groups.join("").length < 7) continue;
    if (groups.every((g) => g.length <= 2 || YEAR_GROUP.test(g))) continue;
    return true;
  }
  return false;
}

/**
 * Why an imported summary must be left out whole, or "" when it may stay: the kind of its first titleRisk hit
 * ("phone", "email", "sobriety", "zoom", "password"), "label" (a word that labels a code or a meeting: zoom, meeting
 * ID, passcode, password, contraseña, clave, código, PW, PIN, PMI…), "sobriety" (any sobriety date or length wording),
 * or "digits" (a run of 7 or more digits). The reason never carries the text.
 */
export function summaryRisk(text, { allow, officeHost, now } = {}) {
  const src = String(text ?? "");
  if (!src.trim()) return "";
  const al = allow || loadAllow();
  const found = titleRisk(src, { allow: al, officeHost, now });
  if (found.length) return found[0].kind;
  const t = normalizeText(src);
  if (CODE_WORDS.test(t)) return "label";
  if (SOBER_WORDS.test(t) || DOS_WORD.test(t)) return "sobriety";
  if (longNumber(t, al)) return "digits";
  return "";
}
/** true when an imported summary must be left out whole (summaryRisk). */
export const summaryRisky = (text, opts) => summaryRisk(text, opts) !== "";

/* ------------------------------------------------------------------ other text */

// Sentence ends that are not: "Dr.", "St.", "Ave.", "A.A.", "Monica H." (an initial), "No. 5".
const ABBR = /(?:^|[\s(.])(?:Dr|St|Mr|Mrs|Ms|Sr|Sra|Jr|Ave|Av|Blvd|Rd|Ste|Apt|No|Mt|Ft|Hwy|Pkwy|Fwy|Ln|Ct|vs|etc|approx|Inc|Co|Corp|Dept|Univ|p\.m|a\.m|[A-ZÁÉÍÓÚÑ])\.$/;
/** One line → its sentences (and " · " / " | " separated parts), joined again by the caller. */
export function splitSentences(line) {
  const raw = String(line || "").split(/(?<=[.!?…])\s+(?=[\p{Lu}\d¿¡"“'(‘])|\s+[·•|]\s+/u);
  const out = [];
  for (const p of raw) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out.filter((p) => p.trim());
}

// A value typed on its own line under the line with its label: digits, one short token, or a date ("Meeting
// Password" / "042582", "Passcode:" / "7788", "Sobriety Date:" / "March 3, 1989")…
const BARE_VALUE = new RegExp(String.raw`^(?:[\d\s#*.\-()]{3,30}|\S{1,24}|(?:on\s+|el\s+|desde\s+)?(?:\d|(?:${MONTHS_EN}|${MONTHS_ES})\b)[^.!?\n]{0,30}[.!?]?)$`, "i");
// …or the first sentence of a line that starts with one ("March 3, 1989. Dinner follows.")
const VALUE_START = new RegExp(String.raw`^(?:on\s+|el\s+|desde\s+)?(?:\d|(?:${MONTHS_EN}|${MONTHS_ES})\b)`, "i");
// a line of digits only (the rest of a number)
const DIGITS_ONLY = /^(?=\D*\d)[\d\s.\-]+$/;
// a date, a year or a number of 3 digits or more: what a line before its label may hold ("Ana R. 3/3/1990")
const LEADING_PART = new RegExp(String.raw`${DATE_Y}|\b${YEAR}\b|\d{3}`, "i");
// a line that ends with a label, so its value may be on the next line
const LABEL_END = /(?:[:#=]|\b(?:id|number|n[uú]mero|pass\s?code|passwords?|contrase[nñ]a|clave|c[oó]digo|pw|pin|pmi|zoom|date|since|desde|birthday|sobriety|sober|sobriedad|reuni[oó]n))\s*$/iu;

/**
 * The text (normalised, its dashes kept) without every sentence that summaryRisk flags (a cautious, line-by-line
 * fallback for other text: imported summaries do not use it, cleanRecord leaves a summary out whole when summaryRisk
 * finds anything, because a detail split over lines or sentences cannot be cut out reliably). Also removed: the value
 * on the line under a line that went and ended with its label ("Meeting Password" / "042582"; blank lines between count
 * as nothing; digits over several lines all go), a label whose value is on the next line ("Sobriety:" / "1989"), the
 * line before a line that went when it has a number and no full stop ("Ana R. 3/3/1990" / "sobriety birthday"), and a
 * label left on its own ("For tickets contact:") before a line that went. Running it twice gives the same text.
 */
export function scrubText(text, { allow, officeHost } = {}) {
  const opts = { allow: allow || loadAllow(), officeHost };
  const lines = normalizeText(String(text ?? "").replace(/\r\n?/g, "\n"), { dashes: false }).split("\n").map((l) => l.trim());
  const out = [];
  // "label": the line that went ended with its label, so its value may come next; "digits": a number that went may go
  // on over the next lines
  let after = "";
  lines.forEach((first, at) => {
    let line = first;
    if (!line) {
      out.push("");
      return;
    }
    if (after) {
      const was = after;
      after = "";
      if (was === "label" ? BARE_VALUE.test(line) : DIGITS_ONLY.test(line)) {
        if (DIGITS_ONLY.test(line)) after = "digits";
        return;
      }
      if (was === "label" && VALUE_START.test(line)) line = splitSentences(line).slice(1).join(" ").trim();
      if (!line) return;
    }
    if (!summaryRisk(line, opts)) {
      const next = lines.slice(at + 1).find(Boolean);
      if (!/[:#=]$/.test(line) || !next || !summaryRisk(`${line} ${next}`, opts)) {
        out.push(line);
        return;
      }
      after = "label";
      return;
    }
    // the line before, when it has a date, a year or a long number and no full stop: the start of the same detail
    const j = out.findLastIndex(Boolean);
    if (j >= 0 && LEADING_PART.test(out[j]) && !/[.!?…]$/.test(out[j])) out.splice(j, 1);
    after = LABEL_END.test(line) ? "label" : /\d$/.test(line) ? "digits" : "";
    const keep = splitSentences(line)
      .filter((p) => !summaryRisk(p, opts))
      .join(" ")
      .trim();
    if (keep && !summaryRisk(keep, opts)) out.push(keep);
    else while (out.length && /:$/.test(out[out.length - 1])) out.pop();
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The text with personal details replaced by look-alikes, for test fixtures that go into the public repository's
 * history: phone numbers → (714) 555-01xx, e-mail addresses → name@example.org (the office's own and the allowed ones
 * stay; also "name at domain dot net"), passcodes (passcode, password, contraseña, código, clave, PW, PIN, and every
 * code titleRisk reads: "PW is 774411", "Clave para entrar: 7788") → "xxxxxx", Zoom links → zoom.us/j/0, meeting IDs
 * (labelled, or 3-4-4 outside a web address) → 000 0000 0000.
 */
export function maskText(text, { allow, officeHost, now } = {}) {
  const al = allow || loadAllow();
  let n = 0;
  const seen = new Map();
  const phone = (m, a, b, c, d = "") => {
    const key = a + b + c + d;
    if (officeLine(key, al)) return m;
    if (!seen.has(key)) seen.set(key, `(714) 555-01${String(n++ % 100).padStart(2, "0")}`);
    return seen.get(key);
  };
  const masked = String(text ?? "")
    .replace(/(zoom(?:gov)?\.us\/(?:j|s|w|my|wc(?:\/join)?)\/)[^\s"'<>\\]+/gi, "$10")
    .replace(/([?&](?:amp;)?pwd=)[^&\s"'<>\\]+/gi, "$1x")
    .replace(/(\b(?:zoom\s*(?:meeting\s*)?(?:id|#)?|(?:meeting|webinar|reuni[oó]n)\s*(?:id|#|number|n[uú]mero)|id\s+de\s+(?:la\s+)?reuni[oó]n|pmi)\s*[:#=\-‐-―−]?\s*)\d[\d\s.\-‐-―−]{7,14}\d/gi, "$1000 0000 0000")
    .replace(/(\b(?:pass[\s-]?code|password|passwd|contrase[nñ]a|pwd|c[oó]digo(?:\s+de\s+(?:la\s+)?(?:acceso|reuni[oó]n|zoom|entrada))?)\s*(?:is|es)?\s*[:=#\-‐-―−]?\s*)([^\s"'<>\\,;]{2,})/gi, (m, label, value) =>
      /^(?:protected|protegid[oa]|and|y|for|para|the|el|la|de|postal)$/i.test(value) ? m : `${label}xxxxxx`,
    )
    .replace(/(\bclave(?:\s+de\s+acceso)?\s*(?:es\s*)?[:=#\-‐-―−]\s*|\bclave\s+(?:es\s+)?(?=\d))([^\s"'<>\\,;]{2,})/gi, "$1xxxxxx")
    .replace(/(\b(?:pw|p\.w\.?|p\/w)(?![a-z])\s*[:=#.\-‐-―−]*\s*)(?=[^\s"'<>\\,;]{4,})(?!(?:19|20)\d\d\b)([^\s"'<>\\,;]*\d[^\s"'<>\\,;]*)/gi, "$1xxxxxx")
    .replace(/(\bpin\s*(?:#|number)?\s*[:=#\-‐-―−]?\s*)(?!(?:19|20)\d\d\b)\d{4,}/gi, "$1xxxxxx")
    .replace(PHONE, (m, a, b, c) => phone(m, a, b, c))
    .replace(PHONE_3322, (m, a, b, c, d) => phone(m, a, b, c, d))
    // a meeting ID without its label (3-4-4, 3-3-3, 4-3-4…), not inside a web address or a file name
    .replace(/(?<![\w\/=.\-%])\d{3,4}[ .\-\/_·‐-―−]\d{3,4}[ .\-\/_·‐-―−]\d{3,4}(?![\w\/.\-%]*\.(?:jpe?g|png|gif|webp|pdf|html?)\b)(?![\w\/%])/g, (m) =>
      m.split(/[^\d]+/).every((g) => g.length <= 2 || YEAR_GROUP.test(g)) ? m : "000 0000 0000",
    )
    .replace(EMAIL, (m) => (emailAllowed(m, { allow: al, officeHost }) ? m : "name@example.org"))
    .replace(EMAIL_SPELLED, (m, local, domain) => {
      const addr = `${local}@${domain.replace(/\s+(?:dot|punto)\s+/gi, ".")}`;
      return emailAllowed(addr, { allow: al, officeHost }) || (!FREE_MAIL.test(addr) && SPACED_NOT_MAILBOX.test(local)) ? m : "name at example dot org";
    })
    .replace(/(https?:\/\/urldefense\.com\/v3\/__.*?__;)[^"'\s<>\\]*/gi, "$1!!masked$");
  // the codes titleRisk reads in other wordings ("PW is 774411", "Clave para entrar: 7788"): their values
  const nm = normalized(masked);
  const spans = codeHits(nm.text, yearOf(now))
    .map((h) => spanOf(nm, h.tokenAt, h.tokenLen))
    .filter(([a, b]) => b > a && !/^x+$/.test(masked.slice(a, b)))
    .sort((p, q) => q[0] - p[0]);
  let out = masked;
  for (const [a, b] of spans) out = out.slice(0, a) + "xxxxxx" + out.slice(b);
  return out;
}

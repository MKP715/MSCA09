// Checks the built site before it is published. Run after `npm run build`:
//
//   npm run check                    (checks _site)
//   node scripts/check-site.mjs _site_preview   (checks another output folder)
//
// Stops the deploy (exit code 1) when it finds:
//   - a personal e-mail address or phone number on a page, in a calendar (.ics) or
//     data (.json) file the site serves, or in a data file (Tradition Eleven — see
//     "Anonymity" in README.md)
//   - a trusted servant written with a surname instead of a last initial, or what looks
//     like a full name (first name + surname) on the panel, committee, district or event pages
//   - a link to a Google Drive file that is held for anonymity review (data/flyer-holds.csv)
//   - a broken row in a data/*.csv file (wrong number of values, a stray " quote)
//   - a link to a page or file of this site that does not exist
//   - an old-address forwarding row (data/redirects.csv) that points nowhere or
//     collides with a real page
//   - wording a page asks for that is missing from data/text/*.csv
//   - a page title or meta description escaped twice ("&amp;amp;" shows as "&amp;")
// Prints warnings (does not stop) for links to the old WordPress site, pages without a
// title or heading, very large pages, full-name look-alikes elsewhere, and Zoom IDs that
// look like a member's own phone number.
//
// Allowed contact details live in data/contact-allowlist.csv (value, kind, reason): role
// mailboxes that happen to be on gmail/outlook (their name must say which role), public
// office phone lines. Allowed name look-alikes (venues, authors, trustees, place names)
// live in data/name-allowlist.csv. Both files need a reviewer's approval (.github/CODEOWNERS).
import fs from "node:fs";
import path from "node:path";
import { readCsv, readCsvDir, checkCsvFile } from "../src/_lib/csv.js";
import { nameHits } from "../src/_lib/names.js";

const ROOT = process.cwd();
const SITE = path.resolve(process.argv[2] || process.env.SITE_DIR || "_site");

// The path prefix the site was built with: from the environment (GitHub Actions exports
// it for every step), else from what the build recorded in .cache/build-info.json.
function builtPrefix() {
  if (process.env.ELEVENTY_PATH_PREFIX) return process.env.ELEVENTY_PATH_PREFIX;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(ROOT, ".cache", "build-info.json"), "utf8"));
    if (info[SITE]?.prefix) return info[SITE].prefix;
  } catch {}
  return "/";
}
const prefix = builtPrefix().replace(/\/?$/, "/").replace(/^(?!\/)/, "/");

// Public logs (GitHub Actions logs of a public repository are public): show contact details masked —
// "j…@gmail.com", "(714) …-…43". Run locally (not in CI) to see them in full, or add --show.
const SHOW = !process.env.CI && !process.env.GITHUB_ACTIONS || process.argv.includes("--show");
const maskContacts = (s) =>
  SHOW
    ? String(s)
    : String(s)
        .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[a-z]{2,})/g, "$1…@$2")
        .replace(/\(?\b(\d{3})\)?([\s.-]?)\d{3}[\s.-]?\d{2}(\d{2})\b/g, "($1)$2…-…$3");

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

if (!fs.existsSync(SITE)) {
  console.error(`No ${path.relative(ROOT, SITE) || SITE} folder — run \`npm run build\` first.`);
  process.exit(1);
}

const decode = (s) =>
  String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)));

// ------------------------------------------------------------- allow lists
const allow = readCsv("contact-allowlist.csv");
const allowedEmails = new Set(allow.filter((r) => r.kind === "email").map((r) => r.value.toLowerCase()));
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const allowedPhones = new Set(allow.filter((r) => r.kind === "phone").map((r) => digits(r.value)));
// Public office lines published on the resources pages are allowed by definition.
for (const file of ["central-offices.csv", "resources.csv"]) {
  for (const row of readCsv(file)) {
    for (const v of Object.values(row)) {
      for (const m of String(v).matchAll(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)) allowedPhones.add(digits(m[0]));
    }
  }
}
const ROLE_DOMAINS = [/@msca09aa\.org$/i, /@aa\.org$/i, /@aagrapevine\.org$/i, /@area9btg\.org$/i];
const FREE_MAIL =
  /@(gmail|googlemail|yahoo|ymail|rocketmail|icloud|me|mac|hotmail|outlook|live|msn|aol|att|sbcglobal|bellsouth|comcast|cox|verizon|earthlink|charter|frontier|protonmail|proton|gmx|mail|zoho|juno|netzero|roadrunner|twc|q)\.(com|net|me)$/i;
// A free-mail address may be published only when its name says which service role it belongs to.
const ROLE_NAME =
  /district|dist\d|^d\d|dcm|chair|secretary|registrar|treas|delegate|gsr|grapevine|vina|cpc|literature|archiv|area|msca|handi|ypaa|webmaster|website|newcomer|accessib|cec|committee|intergroup|office|corrections|treatment|registration|(^|[._-]|\d)(pi|hi|sec|pio)([._-]|\d|$)/i;
for (const r of allow.filter((r) => r.kind === "email")) {
  const a = r.value.toLowerCase();
  if (FREE_MAIL.test(a) && !ROLE_NAME.test(a.split("@")[0])) {
    err(
      `data/contact-allowlist.csv row ${r._row}`,
      `"${a}" does not look like a role mailbox (its name should say district/DCMC/chair/secretary/registrar/treasurer/delegate/GSR/…). A personal address may not be published, even when it is listed here.`,
    );
    allowedEmails.delete(a);
  }
}

function checkEmail(addr, where) {
  const a = addr.toLowerCase().replace(/[.,;:]+$/, "");
  if (ROLE_DOMAINS.some((re) => re.test(a))) return;
  if (allowedEmails.has(a)) return;
  if (FREE_MAIL.test(a))
    err(where, `personal-looking e-mail address "${a}" — publish only role mailboxes (…@msca09aa.org, or a district/committee role mailbox approved in data/contact-allowlist.csv)`);
}

// Phone-like numbers. A Zoom meeting ID (9–11 digits) is fine when it is labelled as one
// directly before the number ("Meeting ID: 714 555 0123", "Zoom: …", "ID de reunión: …"),
// when it is the number in a Zoom link ("zoom.us/j/7145550123"), or when the same number
// is a Zoom link right next to it (a zoom_url + zoom_id pair of columns, or the "id" and
// "url" of a meeting in events.json).
const PHONE = /(?<![\d#])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;
const ID_LABEL =
  /(?:\bzoom\s*(?:meeting\s*)?(?:id|#|number)?|(?:meeting|webinar|reuni[oó]n)\s*(?:id|#|number|n[uú]mero)|\bid\s*(?:de\s+(?:la\s+)?reuni[oó]n|de\s+zoom|zoom)?|\bpmi|passcode|password|contrase[nñ]a|c[oó]digo|pwd)\s*(?:is|es)?\s*[:#=-]?\s*$/i;
const ZOOM_URL_BEFORE = /zoom(?:gov)?\.us\/(?:j|s|w|my|wc(?:\/join)?)\/$/i;
const zoomLinkDigits = (text) =>
  new Set([...text.matchAll(/zoom(?:gov)?\.us\/(?:j|s|w|wc(?:\/join)?)\/(\d{9,11})/gi)].map((x) => x[1].replace(/^1(?=\d{10}$)/, "")));
const SOCAL_AREA_CODES = new Set(["213", "310", "323", "424", "562", "626", "657", "714", "760", "818", "909", "949", "951"]);
function checkPhones(text, where) {
  for (const m of text.matchAll(PHONE)) {
    const d = m[1] + m[2] + m[3];
    if (allowedPhones.has(d)) continue;
    if (/^8(00|33|44|55|66|77|88)/.test(d)) continue; // toll-free lines
    const raw = text.slice(Math.max(0, m.index - 40), m.index);
    const before = raw.replace(/["'{}\[\],\\]/g, " ");
    const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, " ");
    if (ZOOM_URL_BEFORE.test(raw)) continue; // the digits of a Zoom link
    if (ID_LABEL.test(before) || zoomLinkDigits(text.slice(Math.max(0, m.index - 250), m.index + 250)).has(d)) {
      if (SOCAL_AREA_CODES.has(m[1]) && !/passcode|password|contrase|c[oó]digo|pwd/i.test(before.slice(-25)))
        warn(where, `the Zoom ID ${m[0].trim()} looks like a Southern California phone number — if it is a member's personal meeting room (PMI), ask for a meeting ID that is not their phone. Context: …${ctx}…`);
      continue;
    }
    err(where, `phone-like number "${m[0].trim()}" — allowed only for public office lines (data/contact-allowlist.csv) and labelled Zoom meeting IDs. Context: …${ctx}…`);
  }
}

// ------------------------------------------------------------- full-name look-alikes
// "Maria Gonzalez" (first name + capitalised word) where "Maria G." is the rule: src/_lib/names.js.
const servants = readCsv("trusted-servants.csv");
const STRICT_NAME_PAGES = /^\/(es\/)?(about\/panel|committees|districts|events)\//;

// ------------------------------------------------------------- data files
const dataDir = path.join(ROOT, "data");
function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name === "generated") continue;
      walk(p, ext, out);
    } else if (ext.some((e) => f.name.toLowerCase().endsWith(e))) out.push(p);
  }
  return out;
}
const SKIP_CONTACT_SCAN = /(contact-allowlist|name-allowlist|media-review|flyer-holds|redirects)\.csv$/;
let csvFiles = 0;
for (const file of walk(dataDir, [".csv"])) {
  csvFiles++;
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  // Broken rows lose data silently (src/_lib/csv.js recovers what it can): never publish them.
  for (const p of checkCsvFile(path.relative(dataDir, file))) err(`${rel}${p.line ? ` line ${p.line}` : ""}`, p.message);
  if (SKIP_CONTACT_SCAN.test(rel)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) checkEmail(m[0], rel);
  if (!/(central-offices|resources)\.csv$/.test(rel)) checkPhones(text, rel);
  if (!/trusted-servants\.csv$/.test(rel)) for (const h of nameHits(text)) warn(rel, `"${h.name}" looks like a full name (first name + last initial only). Context: …${h.ctx}…`);
}

// Trusted servants: first name + last initial only; free-mail role boxes are double-checked.
for (const r of servants) {
  const name = (r.name || "").trim();
  if (name) {
    const words = name.split(/\s+/);
    const last = words[words.length - 1];
    if (words.length > 1 && !/^[\p{Lu}]\.?$/u.test(last) && !/^\(.*\)$/.test(last)) {
      err(`data/trusted-servants.csv row ${r._row}`, `"${name}" — publish first name + last initial only (e.g. "Maria G.")`);
    }
  }
  for (const a of [r.email, r.email_alt].filter(Boolean)) {
    if (FREE_MAIL.test(a) && allowedEmails.has(a.toLowerCase()))
      warn(`data/trusted-servants.csv row ${r._row}`, `${a} is a free-mail address (allowed as a role mailbox in data/contact-allowlist.csv) — prefer an @msca09aa.org role address when there is one`);
  }
}

// ------------------------------------------------------------- held Drive files
// A file is held while it has a row in data/flyer-holds.csv, or while its result in
// data/media-review.csv still starts with "hold" (releasing a file means clearing both).
const held = new Map(); // drive id -> why, and where it is recorded
for (const r of readCsv("flyer-holds.csv")) if (r.drive_id) held.set(r.drive_id.trim(), `${r.reason || "held"}; data/flyer-holds.csv`);
for (const r of readCsv("media-review.csv")) {
  if (r.drive_id && /^hold/i.test(r.result || "") && !held.has(r.drive_id.trim()))
    held.set(r.drive_id.trim(), `${r.result}; data/media-review.csv — change the result to "cleared" once the file is fixed`);
}
const DRIVE_ID = /[-\w]{25,60}/g;
function checkHeld(text, where) {
  if (!held.size) return;
  for (const id of new Set(text.match(DRIVE_ID) || [])) {
    if (held.has(id)) err(where, `links Google Drive file ${id}, which is held for anonymity review (${held.get(id)})`);
  }
}

// ------------------------------------------------------------- built pages
const pages = walk(SITE, [".html"]);
const files = new Set(walk(SITE, [""]).map((f) => path.relative(SITE, f).replace(/\\/g, "/")));
const toFile = (urlPath) => {
  let p = decodeURIComponent(urlPath.split("#")[0].split("?")[0]);
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  else if (p.startsWith("/")) p = p.slice(1);
  if (p === "" || p.endsWith("/")) return files.has(p + "index.html") ? p + "index.html" : null;
  for (const c of [p, p + "/index.html", p + ".html"]) if (files.has(c)) return c;
  return null;
};
const exists = (urlPath) => !!toFile(urlPath);

let checkedLinks = 0;
for (const file of pages) {
  const rel = "/" + path.relative(SITE, file).replace(/\\/g, "/");
  if (rel.startsWith("/pagefind/")) continue;
  const html = fs.readFileSync(file, "utf8");
  const isStub = /<meta name="msca-legacy-redirect"/.test(html);
  // visible text and attributes, without scripts' JSON (checked separately)
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
    if (/\.(png|jpe?g|webp|avif|svg|gif)$/i.test(m[0])) continue; // srcset descriptors like logo@2x.png
    checkEmail(m[0], rel);
  }
  const visible = decode(text.replace(/<[^>]+>/g, " \n "));
  checkPhones(visible, rel);
  checkHeld(html, rel);

  if (!isStub) {
    const attrs = [...text.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g)].map((m) => decode(m[1])).join(" \n ");
    const pagePath = rel.replace(/index\.html$/, "");
    const strict = STRICT_NAME_PAGES.test(pagePath);
    for (const h of nameHits(visible + " \n " + attrs)) {
      const msg = `"${h.name}" looks like a full name — members appear as first name + last initial ("${h.name.split(" ")[0]} ${h.name.split(" ")[1][0]}."). If it is a place, venue, book or public figure, add it to data/name-allowlist.csv. Context: …${h.ctx}…`;
      if (strict) err(rel, msg);
      else warn(rel, msg);
    }
  }

  if (!/<title>[^<]+<\/title>/.test(html)) warn(rel, "page has no <title>");
  // Escaped twice ("Hospitals &amp;amp; Institutions"): browser tabs, search results and share
  // previews would show the raw code. The template must escape a title or description once.
  for (const m of html.matchAll(/<title>([^<]*)<\/title>|\scontent="([^"]*)"/g)) {
    const v = m[1] ?? m[2];
    const twice = /&amp;(amp|#0?39|#x27|quot|lt|gt);/i.exec(v);
    if (twice) err(rel, `"${twice[0]}" in ${m[1] != null ? "<title>" : "a content=\"…\" attribute"} is escaped twice (shows as "${twice[0].replace("&amp;", "&")}"). Context: ${v.slice(0, 120)}`);
  }
  if (!/<h1[\s>]/.test(html) && !/404/.test(rel) && !/redirect|http-equiv="refresh"/i.test(html)) warn(rel, "page has no <h1>");
  if (html.length > 1_500_000) warn(rel, `page is large (${Math.round(html.length / 1024)} KB)`);

  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|#|webcal:|sms:)/i.test(u)) {
      if (/msca09aa\.org\/wp-content|myftpupload\.com|p3cdn1\.secureserver\.net|\/\/(www\.)?area09\.org/i.test(u)) warn(rel, `links to the old website (will break when it is retired): ${u}`);
      continue;
    }
    if (!u.startsWith("/")) continue;
    checkedLinks++;
    if (!exists(u)) err(rel, `broken link to ${u}`);
  }
}

// JSON the browser loads (events, documents) and calendar files people download: same
// contact rules. In .ics files the UID / ORGANIZER / ATTENDEE lines are calendar ids, not contacts.
for (const file of walk(SITE, [".json", ".ics"])) {
  const rel = "/" + path.relative(SITE, file).replace(/\\/g, "/");
  if (rel.startsWith("/pagefind/")) continue;
  let text = fs.readFileSync(file, "utf8");
  if (rel.endsWith(".ics")) {
    text = text
      .replace(/\r?\n[ \t]/g, "") // unfold long lines
      .split(/\r?\n/)
      .filter((l) => !/^(UID|ORGANIZER|ATTENDEE|X-[\w-]+|PRODID|DTSTAMP)[;:]/i.test(l))
      .join("\n")
      .replace(/\\n/gi, "\n")
      .replace(/\\([,;\\])/g, "$1");
  } else {
    text = text.replace(/\\n/g, "\n").replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) checkEmail(m[0], rel);
  checkPhones(text, rel);
  checkHeld(text, rel);
}

// ------------------------------------------------------------- old addresses (data/redirects.csv)
try {
  const { legacyRedirects } = await import("../eleventy.config.js");
  const r = legacyRedirects();
  for (const p of r.problems) err("old addresses", p);
  for (const [from, to] of [...Object.entries(r.exact), ...r.prefix]) {
    if (!exists(to)) err("data/redirects.csv", `${from} forwards to ${to}, which is not a page of this site`);
  }
  for (const pg of r.pages) {
    const built = toFile(pg.from);
    if (!built) err("data/redirects.csv", `no forwarding page was built for ${pg.from}`);
    else if (!/<meta name="msca-legacy-redirect"/.test(fs.readFileSync(path.join(SITE, built), "utf8")))
      err("data/redirects.csv", `${pg.from} is the address of a real page of this site — delete that row`);
  }
  for (const from of Object.keys(r.exact)) {
    const built = toFile(from);
    if (built && !/<meta name="msca-legacy-redirect"/.test(fs.readFileSync(path.join(SITE, built), "utf8")))
      err("data/redirects.csv", `${from} is the address of a real page of this site — delete that row`);
  }
} catch (e) {
  warn("old addresses", `could not check data/redirects.csv: ${e.message}`);
}

// ------------------------------------------------------------- wording
try {
  const missing = JSON.parse(fs.readFileSync(path.join(ROOT, ".cache", "missing-text.json"), "utf8"));
  for (const k of missing) err("data/text", `the key "${k}" is used on a page but has no row in data/text/*.csv`);
} catch {}
const keys = new Map();
for (const r of readCsvDir("text")) {
  if (!r.key) continue;
  if (keys.has(r.key)) warn(`data/${r._file}`, `key "${r.key}" is also defined in data/${keys.get(r.key)}`);
  keys.set(r.key, r._file);
  const settingLike = /\.(icon|color|colour|url|href|year|img|image|kind)$/.test(r.key) || /^(https?:|\/|#)/.test(r.en) || !/[a-z]{3}/i.test(r.en);
  if (r.en && !r.es && !settingLike && !/^about\.gsr_line\./.test(r.key)) warn(`${r._file} row ${r._row}`, `"${r.key}" has no Spanish (es) text`);
}

// ------------------------------------------------------------- report
const uniq = (a) => [...new Set(a)];
const E = uniq(errors);
const W = uniq(warnings);
console.log(
  `Checked ${pages.length} pages in ${path.relative(ROOT, SITE) || "."} (path prefix ${prefix}), ${checkedLinks} internal links, ${csvFiles} data files, ${keys.size} text keys.`,
);
if (W.length) {
  console.log(`\n${W.length} warning(s):`);
  for (const w of W.slice(0, 200)) console.log("  ! " + maskContacts(w));
  if (W.length > 200) console.log(`  … and ${W.length - 200} more`);
}
if (E.length) {
  console.log(`\n${E.length} problem(s) that must be fixed before publishing:`);
  for (const e of E.slice(0, 300)) console.log("  ✗ " + maskContacts(e));
  if (E.length > 300) console.log(`  … and ${E.length - 300} more`);
  process.exit(1);
}
console.log("\nAll checks passed.");

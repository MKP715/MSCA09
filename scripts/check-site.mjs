// Checks the built site before it is published. Run after `npm run build`:
//
//   npm run check                    (checks _site)
//   node scripts/check-site.mjs _site_preview   (checks another output folder)
//
// Stops the deploy (exit code 1) when it finds:
//   - a personal e-mail address or phone number on a page, in a calendar (.ics) or
//     data (.json) file the site serves, or in a data file (Tradition Eleven — see
//     "Anonymity" in README.md)
//   - a servant's own address (contact-allowlist.csv kind email-approved) anywhere but on that
//     servant's card under its "own e-mail" label, or kept after the seat opens
//   - a trusted servant written with a surname instead of a last initial, or what looks
//     like a full name (first name + surname) on the panel, committee, district or event pages
//   - a link to a Google Drive file that is held for anonymity review (data/flyer-holds.csv)
//   - a broken row in a data/*.csv file (wrong number of values, a stray " quote)
//   - a link to a page or file of this site that does not exist
//   - a link to a site that data/link-fixes.csv keeps off the site (a hacked site), anywhere in a page,
//     calendar file, data file or sitemap
//   - an old-address forwarding row (data/redirects.csv) that points nowhere or
//     collides with a real page (a row that a Google Calendar edit has overtaken only warns:
//     the build forwards it to the calendar instead)
//   - wording a page asks for that is missing from data/text/*.csv
//   - a page title or meta description escaped twice ("&amp;amp;" shows as "&amp;")
//   - a meeting recording (data/recordings.csv) without a Drive id, a real date, a committee of
//     data/committees.csv or a meeting of data/recording-series.csv, or whose show is not yes / no;
//     a meeting (data/recording-series.csv) listed twice, without a name or linking nowhere
// Prints warnings (does not stop) for links to the old WordPress site (or the old github.io address, also
// percent-encoded inside another address), pages
// without a title or heading, a <title> shared by several indexable pages, a meta description cut short
// ("…", over 300 characters), a page description written in data/text over 200 characters (link previews cut it),
// very large pages, full-name look-alikes elsewhere, Zoom IDs that
// look like a member's own phone number, committee website, flyer or work-log rows
// (data/committee-resources.csv) that are missing their address, description, pictures or PDF,
// and recordings whose show is empty or whose length, part or track cannot be read.
//
// Allowed contact details live in data/contact-allowlist.csv (value, kind, reason): role
// mailboxes that happen to be on gmail/outlook (their name must say which role), public
// office phone lines, and — kind email-approved, the one narrow exception — a servant's own
// address published at an explicit, dated request (it must be the email_alt of a row of
// data/trusted-servants.csv, and the reason must name the seat, the servant and the
// date). Allowed name look-alikes (venues, authors, trustees, place names)
// live in data/name-allowlist.csv. Both files need a reviewer's approval (.github/CODEOWNERS).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readCsv, readCsvDir, checkCsvFile, yes } from "../src/_lib/csv.js";
import { fillSettings } from "../src/_lib/i18n.js";
import { nameHits } from "../src/_lib/names.js";
import { normStatus, holdsSeat } from "../src/_lib/status.js";
import { compileLinkFixes } from "../src/_lib/calendar.js";

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
// kind email-approved: a servant's own address, published only at an explicit request recorded in the reason.
// Narrow on purpose: it must be that servant's email_alt in data/trusted-servants.csv (never the email column,
// which pages show as the seat's role mailbox — only email_alt is labelled "own e-mail" there, src/_data/servants.js),
// and the reason must name the seat and the servant and date the request. The servant must hold the seat now
// (a Filled or Unconfirmed row of the current panel, settings.csv — holdsSeat in src/_lib/status.js, which
// src/_data/servants.js uses to show the address only there; a named row with an empty status counts as Filled).
// Only then does it count as allowed — and then only on that servant's card, under its label (below).
const servants = readCsv("trusted-servants.csv");
const currentPanel = String((readCsv("settings.csv").find((r) => r.key === "panel") || {}).value || "").trim();
const approvedEmails = new Set();
const sameAddr = (e, a) => String(e || "").trim().toLowerCase() === a;
for (const r of allow.filter((r) => r.kind === "email-approved")) {
  const a = r.value.toLowerCase();
  const where = `data/contact-allowlist.csv row ${r._row}`;
  const owners = servants.filter((s) => sameAddr(s.email_alt, a));
  const owner = owners[0];
  const asRole = servants.find((s) => sameAddr(s.email, a));
  if (asRole)
    err(where, `"${a}" (email-approved) is in the email column of data/trusted-servants.csv row ${asRole._row} — a servant's own address goes in email_alt; the email column is the seat's role mailbox.`);
  else if (!owner || !owner.name)
    err(where, `"${a}" (email-approved) is not the email_alt of a named servant in data/trusted-servants.csv — an approved personal address belongs to one trusted servant.`);
  else if (owners.length > 1)
    err(where, `"${a}" (email-approved) is the email_alt of ${owners.length} rows of data/trusted-servants.csv (rows ${owners.map((s) => s._row).join(", ")}) — a servant's own address stands on that servant's current row only.`);
  else if (!holdsSeat(owner, currentPanel))
    err(where, `"${a}" (email-approved) is on data/trusted-servants.csv row ${owner._row} (Panel ${owner.panel}, status "${owner.status}", read as ${normStatus(owner)}) — a servant's own address is shown only while that servant holds the seat (a Filled or Unconfirmed row of Panel ${currentPanel}). When the seat opens or the servant rotates out, delete this row and the address there.`);
  else if (!/\b\d{4}-\d{2}-\d{2}\b/.test(r.reason) || !r.reason.includes(owner.name) || !r.reason.includes(owner.position_en))
    err(where, `"${a}" (email-approved): the reason must name the seat ("${owner.position_en}") and the servant ("${owner.name}") and give the date of the request (YYYY-MM-DD).`);
  else {
    approvedEmails.add(a);
    allowedEmails.add(a);
  }
}
// An approved address is shown on a page only right after its label, on that servant's card (cmOwnEmail in
// src/_includes/macros/committees.njk): people.also_own ("Own e-mail (not a service mailbox):"), or the label of
// the committees.csv email_other cell that carries it. Anywhere else — a row or card that shows role mailboxes
// only (even in a hidden search attribute), another page, a data file — it would pass for a role mailbox.
// Read in the page's text (tags dropped, entities decoded): each copy shown must come right after a label, with
// only markup and spaces in between, so a label vouches for the one copy that follows it — never for the next
// card's. Each attribute that carries the address (the card's mailto link, copy button, the row's search text)
// may do so once per labelled copy: one more means another row or card carries it. Never inside a <script>,
// <style> or comment, where it is served but not shown.
const committeeRows = readCsv("committees.csv").filter((r) => r.slug && !r.slug.startsWith("#"));
const ownLabelText = readCsvDir("text").filter((r) => r.key === "people.also_own").flatMap((r) => [r.en, r.es]);
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
function ownLabels(a) {
  const texts = ownLabelText.concat(committeeRows.filter((c) => sameAddr(c.email_other, a)).flatMap((c) => [c.email_other_label_en, c.email_other_label_es]));
  return [...new Set(texts.map(squash).filter(Boolean))];
}
// a comment or <script>/<style> block (hidden), a tag (a quoted attribute value may hold ">"), or <!doctype …>
const MARKUP = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*>|<![^>]*>/gi;
function checkOwnEmails(html, where) {
  if (!approvedEmails.size) return;
  const low = html.toLowerCase();
  // by the part before the @: a tag inside the address (cmEmail's <wbr>) splits it in the markup
  const onPage = [...approvedEmails].filter((a) => low.includes(a.split("@")[0]));
  if (!onPage.length) return;
  let text = "";
  const hidden = [];
  const tags = [];
  let last = 0;
  for (const m of html.matchAll(MARKUP)) {
    text += decode(html.slice(last, m.index));
    (m[1] || m[0].startsWith("<!--") ? hidden : tags).push(m[0].toLowerCase());
    last = m.index + m[0].length;
  }
  text += decode(html.slice(last));
  const textLow = text.toLowerCase();
  for (const a of onPage) {
    const labels = ownLabels(a);
    let shown = 0;
    let bare = 0;
    for (let i = textLow.indexOf(a); i >= 0; i = textLow.indexOf(a, i + a.length)) {
      const before = squash(text.slice(0, i).trimEnd().slice(-500));
      if (labels.some((l) => before.endsWith(l))) shown++;
      else bare++;
    }
    const inAttr = new Map(); // attribute name → copies of the address in it
    for (const t of tags) {
      for (let j = t.indexOf(a); j >= 0; j = t.indexOf(a, j + a.length)) {
        const name = (t.slice(0, j).match(/([^\s"'=<>]+)\s*=\s*["']?[^"']*$/) || [])[1] || "tag";
        inAttr.set(name, (inAttr.get(name) || 0) + 1);
      }
    }
    const extra = [...inAttr].filter(([, n]) => n > shown);
    if (bare)
      err(where, `"${a}" (a servant's own address, email-approved) is shown without its label ("${labels[0]}") right before it — each copy shown needs its own label just before it, on that servant's card, under the seat's role mailbox.`);
    if (hidden.some((b) => b.includes(a)))
      err(where, `"${a}" (a servant's own address, email-approved) is inside a <script>, <style> or comment on this page — served there without its label; leave it out.`);
    if (!shown && inAttr.size)
      err(where, `"${a}" (a servant's own address, email-approved) is in this page's markup (a link or search attribute) but not shown on it — leave it out where the page shows role mailboxes only.`);
    else if (extra.length)
      err(where, `"${a}" (a servant's own address, email-approved) is in ${extra.map(([k, n]) => `${n} ${k}`).join(", ")} attribute(s) on this page but shown under its label only ${shown} time(s) — another row or card carries it in a link or search text; leave it out there.`);
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
// (`servants` = data/trusted-servants.csv, read with the allow lists above.)
const STRICT_NAME_PAGES = /^\/(es\/)?(about\/panel|committees|districts|events|calendar\/central-offices)\//;

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
// (office-flyer-review.csv: addresses of the central offices' flyers, never their contents)
const SKIP_CONTACT_SCAN = /(contact-allowlist|name-allowlist|media-review|flyer-holds|redirects|office-flyer-review)\.csv$/;
let csvFiles = 0;
for (const file of walk(dataDir, [".csv"])) {
  csvFiles++;
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  // Broken rows lose data silently (src/_lib/csv.js recovers what it can): never publish them.
  for (const p of checkCsvFile(path.relative(dataDir, file))) err(`${rel}${p.line ? ` line ${p.line}` : ""}`, p.message);
  if (SKIP_CONTACT_SCAN.test(rel)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
    checkEmail(m[0], rel);
    // a servant's own address: email_alt of trusted-servants.csv, or a committee's email_other (checked below)
    const a = m[0].toLowerCase().replace(/[.,;:]+$/, "");
    if (approvedEmails.has(a) && !/^data\/(trusted-servants|committees)\.csv$/.test(rel))
      err(rel, `"${a}" is a servant's own address (data/contact-allowlist.csv, kind email-approved): it may stand only in that servant's email_alt in data/trusted-servants.csv (or a committee's email_other in data/committees.csv), so the site shows it on their card, labelled as an own e-mail.`);
  }
  if (!/(central-offices|resources)\.csv$/.test(rel)) checkPhones(text, rel);
  if (!/trusted-servants\.csv$/.test(rel)) for (const h of nameHits(text)) warn(rel, `"${h.name}" looks like a full name (first name + last initial only). Context: …${h.ctx}…`);
}
for (const c of committeeRows) {
  for (const [col, v] of Object.entries(c)) {
    if (col === "email_other" || col.startsWith("_")) continue;
    for (const a of approvedEmails)
      if (String(v).toLowerCase().includes(a)) err(`data/committees.csv row ${c._row} (${c.slug})`, `"${a}" is a servant's own address (kind email-approved): in data/committees.csv it may stand only in email_other, with its label in email_other_label_en/_es — not in ${col}.`);
  }
}

// ------------------------------------------------------------- committee website cards and flyers
// data/committee-resources.csv, as src/_data/committees.js reads it: a website row is shown only when there is an
// address (its url, else the website column of data/committees.csv: siteOf), as a card that says in both languages
// what is on the site (body_en / body_es); a flyer row is dropped without pictures of its pages (url, or url_es for
// a Spanish one) and offers no printable copy without a PDF (pdf / pdf_es). A log row (the committee's live working
// document) needs its share link and a line in both languages; status = hidden keeps any row off the site.
{
  const committeeSite = new Map(committeeRows.map((c) => [c.slug, String(c.website || "").trim()]));
  const filled = (...v) => v.some((x) => String(x || "").trim());
  for (const r of readCsv("committee-resources.csv")) {
    if (!r.committee || r.committee.startsWith("#")) continue;
    const kind = String(r.kind || "").trim().toLowerCase();
    const where = `data/committee-resources.csv row ${r._row} (${r.committee}, ${kind})`;
    const status = String(r.status || "").trim().toLowerCase();
    if (status && !["current", "superseded", "draft", "reference", "report", "hidden"].includes(status))
      warn(where, `status "${r.status}" — use current, superseded, draft, reference, or hidden to keep the row off the site`);
    if (status === "hidden") continue;
    if (kind === "log") {
      if (!/^https:\/\/(docs|drive)\.google\.com\//.test(String(r.url || "").trim()))
        warn(where, `url should be the share link of the committee's Google Doc or Sheet (https://docs.google.com/… or https://drive.google.com/…) — without one the committee page shows no work-log card`);
      if (!filled(r.body_en) || !filled(r.body_es)) warn(where, `the work-log card needs one line on what is in the document in English and in Spanish (body_en and body_es)`);
    } else if (kind === "website") {
      if (!filled(r.url, committeeSite.get(r.committee)))
        warn(where, `no address: fill url, or the website column of the "${r.committee}" row of data/committees.csv — until then the committee page shows no website card`);
      if (!filled(r.body_en) || !filled(r.body_es))
        warn(where, `the website card needs one line on what is on the site in English and in Spanish (body_en and body_es)`);
    } else if (kind === "flyer") {
      if (!filled(r.url, r.url_es)) warn(where, `no pictures of the flyer's pages (url, or url_es for a Spanish version): the committee page leaves the flyer out`);
      if (!filled(r.pdf, r.pdf_es)) warn(where, `no printable copy (pdf, or pdf_es for a Spanish version): the flyer is shown without a PDF to download or print`);
    }
  }
}

// ------------------------------------------------------------- meeting recordings
// data/recordings.csv and data/recording-series.csv, as src/_data/recordings.js reads them: the page plays each
// recording from its Drive id (…/file/d/<id>/preview), files it under its date and meeting (series) on the page of its
// committee, and shows only rows whose show is yes. A row the loader cannot place would silently go missing.
{
  const slugs = new Set(committeeRows.map((c) => c.slug));
  const seriesKeys = new Set();
  const folders = new Map();
  for (const s of readCsv("recording-series.csv")) {
    const where = `data/recording-series.csv row ${s._row} (${s.key || s.folder || "?"})`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.key || "")) err(where, `key "${s.key || ""}" — use lowercase letters, digits and dashes (it is what the series column of data/recordings.csv names)`);
    else if (seriesKeys.has(s.key)) err(where, `key "${s.key}" is listed twice`);
    seriesKeys.add(s.key);
    const folder = String(s.folder || "").trim().toLowerCase();
    if (folder && folders.has(folder)) err(where, `folder "${s.folder}" is also on row ${folders.get(folder)} — scripts/recordings.py could not tell which meeting a new recording belongs to`);
    if (folder) folders.set(folder, s._row);
    if (!String(s.name_en || "").trim()) err(where, `no English name (name_en): the page and its filter button need one`);
    else if (!String(s.name_es || "").trim()) warn(where, `no Spanish name (name_es): the Spanish page shows "${s.name_en}"`);
    const link = String(s.link || "").trim();
    if (link && !link.startsWith("/") && !slugs.has(link)) err(where, `link "${link}" is neither a committee slug of data/committees.csv nor an address on this site (/…/)`);
  }
  // a real day: 2026-02-30 fails (it would come back as March 2)
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
  const ids = new Map();
  for (const r of readCsv("recordings.csv")) {
    const id = String(r.drive_id || "").trim();
    const where = `data/recordings.csv row ${r._row}${r.path ? ` (${r.path})` : id ? ` (${id})` : ""}`;
    if (!/^[A-Za-z0-9_-]{25,60}$/.test(id)) err(where, `drive_id "${id}" does not look like a Google Drive file id (the long code in the file's Share link: …/file/d/<id>/view)`);
    else if (ids.has(id)) err(where, `the same recording (${id}) is also on row ${ids.get(id)}`);
    else ids.set(id, r._row);
    if (!isDay(r.date)) err(where, `date "${r.date || ""}" — write the meeting's day as YYYY-MM-DD`);
    if (r.time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(r.time)) err(where, `time "${r.time}" — write when the recording started as HH:MM (24-hour, Pacific), or leave it empty`);
    if (!slugs.has(r.committee)) err(where, `committee "${r.committee || ""}" is not a slug of data/committees.csv (the page that lists the recording)`);
    if (!seriesKeys.has(r.series)) err(where, `series "${r.series || ""}" is not a key of data/recording-series.csv`);
    const show = String(r.show || "").trim();
    if (!show) warn(where, `show is empty: the recording stays off the site until it says yes`);
    else if (!yes(show) && !/^(no|n|false|0)$/i.test(show)) err(where, `show "${show}" — write yes or no`);
    if (r.track && !/^(main|es|en)$/i.test(r.track)) warn(where, `track "${r.track}" — main (the meeting's own audio), es or en (an interpretation channel); the page shows it as main`);
    if (r.duration && !/^\d+:[0-5]\d:[0-5]\d$/.test(r.duration)) warn(where, `duration "${r.duration}" — write H:MM:SS (the page leaves the length out)`);
    for (const k of ["part", "session"]) if (r[k] && !/^\d+$/.test(r[k])) warn(where, `${k} "${r[k]}" — a number, or empty`);
    if (r.size_mb && !Number.isFinite(Number(r.size_mb))) warn(where, `size_mb "${r.size_mb}" — the file's size in MB, e.g. 94.5`);
  }
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
    // (an email-approved address is a servant's own one, not a role mailbox: nothing to suggest)
    if (FREE_MAIL.test(a) && allowedEmails.has(a.toLowerCase()) && !approvedEmails.has(a.toLowerCase()))
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

const OLD_SITE = /msca09aa\.org\/wp-content|myftpupload\.com|p3cdn1\.secureserver\.net|\/\/(www\.)?area09\.org|mkp715\.github\.io\/MSCA09/i;
let checkedLinks = 0;
const titles = new Map(); // <title> of each indexable page -> its addresses
const cutDescriptions = []; // [page, description] cut off by base.njk's truncate(300)
const longDescriptions = []; // [page, description] over 200 characters: link previews cut it (og:description, truncate(200))
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
  checkOwnEmails(html, rel);

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
  if (!isStub) {
    const tm = /<title>([^<]+)<\/title>/.exec(html);
    // forwarding pages (old district numbers: an instant refresh, no noindex) are never indexed themselves
    if (tm && !/<meta name="robots" content="noindex"/.test(html) && !/<meta http-equiv="refresh" content="0;/.test(html)) {
      const k = decode(tm[1]).trim();
      titles.set(k, [...(titles.get(k) || []), rel.replace(/index\.html$/, "")]);
    }
    const dm = /<meta name="description" content="([^"]*)"/.exec(html);
    if (dm && decode(dm[1]).trim().endsWith("…")) cutDescriptions.push([rel, decode(dm[1]).trim()]);
    else if (dm && decode(dm[1]).trim().length > 200) longDescriptions.push([rel, decode(dm[1]).trim()]);
  }
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
      // also inside another address, percent-encoded (an Office viewer's ?src=https%3A%2F%2Fmsca09aa.org%2Fwp-content…)
      let plain = u;
      try {
        plain = decodeURIComponent(decode(u));
      } catch {}
      if ([u, plain].some((x) => OLD_SITE.test(x))) warn(rel, `links to the old website (will break when it is retired): ${u}`);
      continue;
    }
    if (!u.startsWith("/")) continue;
    checkedLinks++;
    if (!exists(u)) err(rel, `broken link to ${u}`);
  }
}

// Search results. Pages with the same title compete with each other, and search engines show only one of them;
// a description over 300 characters is cut by base.njk. Warnings only: CSV edits and the calendar bring these in.
for (const [title, urls] of titles) {
  if (urls.length > 1) warn(`title "${title}"`, `shared by ${urls.length} indexable pages (search engines show only one of them): ${urls.join(", ")}`);
}
if (cutDescriptions.length) {
  const plain = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const textRows = readCsvDir("text").filter((r) => r.key);
  for (const [rel, d] of cutDescriptions) {
    const shown = d.slice(0, -1).trim();
    const k = textRows.find((r) => plain(r.en).startsWith(shown) || plain(r.es).startsWith(shown));
    warn(rel, `the meta description is over 300 characters and was cut off ("…")${k ? `: shorten "${k.key}" in data/${k._file} row ${k._row}` : ""}`);
  }
}
// A page's own description from data/text (front matter description_key) over 200 characters: link previews show
// 200 and end it with "…". Event, district and committee descriptions are built from editors' data: not counted here.
if (longDescriptions.length) {
  const used = new Set();
  for (const f of walk(path.join(ROOT, "src"), [".njk", ".md"])) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/^description_key:\s*["']?([\w.-]+)/gm)) used.add(m[1]);
  }
  const plain = (s) => decode(fillSettings(s).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  const byText = new Map();
  for (const r of readCsvDir("text")) if (used.has(r.key)) for (const v of [r.en, r.es]) if (v) byText.set(plain(v), r);
  for (const [rel, d] of longDescriptions) {
    const k = byText.get(d);
    if (k) warn(rel, `the description is ${d.length} characters, so link previews cut it ("…"): shorten "${k.key}" in data/${k._file} row ${k._row} (about 150–160 characters)`);
  }
}

// JSON the browser loads (events, documents) and calendar files people download: same
// contact rules. In .ics files the UID / ORGANIZER / ATTENDEE lines are calendar ids, not contacts.
for (const file of walk(SITE, [".json", ".ics"])) {
  const rel = "/" + path.relative(SITE, file).replace(/\\/g, "/");
  if (rel.startsWith("/pagefind/")) continue;
  if (rel === "/version.json") continue; // the app's build fingerprint (letters only), checked below
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
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
    checkEmail(m[0], rel);
    const a = m[0].toLowerCase().replace(/[.,;:]+$/, "");
    if (approvedEmails.has(a)) err(rel, `"${a}" is a servant's own address (kind email-approved): it may appear only on that servant's card, labelled as an own e-mail — not in a data or calendar file the site serves.`);
  }
  checkPhones(text, rel);
  checkHeld(text, rel);
}

// ------------------------------------------------------------- central-office events
// The events read from the central offices' websites (src/_data/officeEvents.js, scripts/office-events.mjs). Their
// text is checked with every page and with events.json above; here: what may never come with them (a Zoom link, an
// e-mail, an .ics file, Event data for search engines: the office's page is the original), a flyer only once the flyer
// check passed for that very file (data/office-flyer-review.csv), and the editors' tables.
{
  const OFFICE_ADAPTERS = ["tribe", "aanoc", "tvco", "watch", "shared", "none"];
  // never in a central office's event (src/_data/officeEvents.js leaves out an event with one, with the same CO_REFUSED and
  // coWords, so this is a backstop): a Zoom address, a passcode word, "PW" with its code, a Zoom meeting number — read
  // after every dash, full-width sign and space is made plain
  const CO_REFUSED = /zoom(?:gov)?\.us|\bpass[\s-]?codes?\b\s*(?:(?:is|es|[:=#-])\s*\S|\w*\d)|\bpasscode\w*\d|\bcontrase[nñ]as?\b\s*(?:(?:is|es|[:=#-])\s*\S|\w*\d)|\bp\s?[./]?\s?w\b\.?\s*[:=#.-]?\s*\w*\d|\bzoom\b[^\n]{0,20}\d{3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b(?:meeting|webinar|reuni[oó]n)\s*id\b[^\n]{0,10}\d{3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/i;
  const coWords = (s) =>
    String(s || "")
      .normalize("NFC")
      .replace(/[‐-―−﹘﹣－]/g, "-")
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[  -   　]/g, " ")
      .replace(/[​-‍﻿]/g, "");
  const OVERRIDE_ACTIONS = ["hide", "show", "type", "title", "same-as"];
  const officeKeys = new Set(readCsv("central-offices.csv").map((r) => r.key).filter(Boolean));
  for (const r of readCsv("office-event-sources.csv")) {
    if (!r.office || r.office.startsWith("#")) continue;
    const where = `data/office-event-sources.csv row ${r._row} (${r.office})`;
    if (!officeKeys.has(r.office)) err(where, `"${r.office}" is not a key of data/central-offices.csv`);
    const adapter = String(r.adapter || "").trim().toLowerCase();
    if (!OFFICE_ADAPTERS.includes(adapter)) err(where, `adapter "${r.adapter}" — use one of ${OFFICE_ADAPTERS.join(", ")}`);
    for (const col of ["feed", "events_page"]) if (r[col] && !/^https:\/\//.test(r[col].trim())) err(where, `${col} must be an https:// address`);
  }
  for (const r of readCsv("central-office-overrides.csv")) {
    if (!r.id || r.id.startsWith("#")) continue;
    const where = `data/central-office-overrides.csv row ${r._row}`;
    if (!/^co-[a-z0-9-]+$/.test(r.id.trim())) err(where, `id "${r.id}" — copy the event's id (co-<office>-…) from data/central-office-events.json or from the card's address (#co-…)`);
    if (!OVERRIDE_ACTIONS.includes(String(r.action || "").trim().toLowerCase())) err(where, `action "${r.action}" — use one of ${OVERRIDE_ACTIONS.join(", ")}`);
    if (r.until && !/^\d{4}-\d{2}-\d{2}$/.test(r.until.trim())) err(where, `until "${r.until}" — a date YYYY-MM-DD, or empty for always`);
  }

  // the flyer addresses the site may show: every size of a flyer whose check passed for the file the mirror lists
  const shownFlyers = new Set();
  try {
    const mirror = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "central-office-events.json"), "utf8"));
    const passed = new Set(
      readCsv("office-flyer-review.csv")
        .filter((r) => /^(clean|cleared)$/i.test(String(r.result || "").trim()) && r.url && r.sha256)
        .map((r) => `${r.url.trim()}|${r.sha256.trim().toLowerCase()}`),
    );
    for (const e of mirror.events || [])
      for (const f of e.flyers || [])
        if (f.sha256 && passed.has(`${f.url}|${String(f.sha256).toLowerCase()}`)) {
          shownFlyers.add(f.url);
          if (f.pdf) shownFlyers.add(f.pdf);
          for (const s of f.sizes || []) if (Array.isArray(s) && s[1]) shownFlyers.add(s[1]);
        }
  } catch {}

  let json = null;
  try {
    json = JSON.parse(fs.readFileSync(path.join(SITE, "assets", "data", "events.json"), "utf8"));
  } catch {}
  if (json) {
    for (const [slug, s] of Object.entries(json.series || {})) {
      if (s.src !== "co") continue;
      const where = `/assets/data/events.json series ${slug}`;
      for (const k of ["online", "email", "ics"]) if (s[k]) err(where, `a central office's event has "${k}": its details stay on the office's own page`);
      if (CO_REFUSED.test(coWords(JSON.stringify(s)))) err(where, "Zoom details or a passcode in a central office's event");
      for (const u of [...(s.flyers || []), s.pdf].filter(Boolean)) if (!shownFlyers.has(u)) err(where, `flyer ${u} has not passed the flyer check (data/office-flyer-review.csv)`);
    }
    for (const o of json.occurrences || []) if (o.fx && !shownFlyers.has(o.fx)) err(`/assets/data/events.json ${o.k}`, `flyer ${o.fx} has not passed the flyer check (data/office-flyer-review.csv)`);
  }
  // the central offices' page, and the Events page's strip of their events: pictures from anywhere but Google Drive
  // (the Area's own flyers) are the offices' flyers
  for (const file of pages) {
    const rel = "/" + path.relative(SITE, file).replace(/\\/g, "/");
    const coPage = /^\/(es\/)?calendar\/central-offices\//.test(rel);
    if (!coPage && !/^\/(es\/)?calendar\/index\.html$/.test(rel)) continue;
    const html = fs.readFileSync(file, "utf8");
    if (coPage && /"@type"\s*:\s*"Event"/.test(html)) err(rel, "Event data for search engines on the central offices' page: the offices' own pages are the originals");
    // the page's words (not its markup: the zoom-in icon's SVG is not a Zoom meeting)
    const words = decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " \n "));
    if (coPage && CO_REFUSED.test(coWords(words))) err(rel, "Zoom details or a passcode on the central offices' page");
    for (const m of html.matchAll(/<img\b[^>]*\ssrc="(https?:\/\/[^"]+)"/g)) {
      const u = decode(m[1]);
      if (/^https:\/\/(lh3\.googleusercontent\.com|drive\.google\.com)\//.test(u)) continue;
      if (!shownFlyers.has(u)) err(rel, `picture ${u} has not passed the flyer check (data/office-flyer-review.csv)`);
    }
  }
}

// ------------------------------------------------------------- links the site must not carry (data/link-fixes.csv)
// A site named in data/link-fixes.csv with an empty replace_with (a hacked site) must not be linked from anywhere, also not
// percent-encoded inside another address ("Add to calendar" links). The parser already takes the calendar's links to it
// out (src/_lib/calendar.js fixLinks), so one that is still here comes from a data/*.csv file: remove it there.
{
  const fixes = compileLinkFixes(readCsv("link-fixes.csv"));
  for (const x of fixes.invalid) warn(`data/link-fixes.csv row ${x.row}`, `"${x.match}" is not a web address, or replace_with is not one (https://…): the row is ignored`);
  // f.inText: the site's name, also of a sub-site, but not after the "@" of an e-mail address — the same pattern the
  // parser (fixLinks) clears out of the calendar's text, so the calendar can never stop the deploy here
  const banned = fixes.filter((f) => f.host && !f.to);
  // percent-escapes of plain characters ("%3A%2F%2F"), twice for an address inside an address
  const unescape = (s) => decode(s).replace(/%25([0-7][0-9a-f])/gi, "%$1").replace(/%([0-7][0-9a-f])/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  if (banned.length) {
    for (const file of walk(SITE, [".html", ".ics", ".json", ".xml"])) {
      const rel = "/" + path.relative(SITE, file).replace(/\\/g, "/");
      if (rel.startsWith("/pagefind/")) continue;
      let text = fs.readFileSync(file, "utf8");
      if (rel.endsWith(".ics")) text = text.replace(/\r?\n[ \t]/g, "").replace(/\\([,;\\])/g, "$1");
      // a line break in a calendar file's or a data file's text is written "\n" ("…\naadistrict17.info")
      if (/\.(ics|json)$/.test(rel)) text = text.replace(/\\[nNrt]/g, " ");
      text = unescape(text);
      for (const f of banned) {
        const m = f.inText.exec(text);
        if (m) err(rel, `links to ${f.host}, which data/link-fixes.csv row ${f.row} keeps off the site — remove it from the data/*.csv file that adds it. Context: …${text.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, " ")}…`);
      }
    }
  }
}

// ------------------------------------------------------------- old addresses (data/redirects.csv)
// Rows that a Google Calendar edit has overtaken (an old event address that is an event page again, a forward to an
// event page the calendar no longer has) are only warnings: the build forwards those to the calendar instead.
try {
  const { legacyRedirects, eventPageUrls } = await import("../eleventy.config.js");
  const r = legacyRedirects({ eventUrls: await eventPageUrls() });
  for (const p of r.problems) err("old addresses", p);
  for (const w of r.warnings) warn("old addresses", w);
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

// ------------------------------------------------------------- the installable app (scripts/build-pwa.mjs)
// The pages, the manifest, the service worker and version.json must agree, and every file the service worker keeps
// for offline use must be in the site exactly as listed: one wrong entry would make the app's install fail on every
// device, without anything showing on the site.
try {
  const appRow = readCsv("settings.csv").find((r) => r.key === "app");
  const appOn = !/^(off|no|false|0)$/i.test(String((appRow && appRow.value) || "on").trim());
  const readSite = (rel) => fs.readFileSync(path.join(SITE, rel));
  const sha = (alg, buf, enc = "hex") => crypto.createHash(alg).update(buf).digest(enc);
  const version = files.has("version.json") ? JSON.parse(readSite("version.json")).v : null;
  if (!files.has("sw.js") || !version) err("/sw.js", "sw.js or version.json is missing: run scripts/build-pwa.mjs (the last step of npm run build)");
  else if (appOn ? !/^[a-p]{16}$/.test(version) : version !== "off") err("/version.json", `unexpected build fingerprint "${version}"`);
  const wrong = [];
  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const rel = "/" + path.relative(SITE, file).replace(/\\/g, "/");
    if (html.includes("__MSCA_BUILD__") || html.includes("__MSCA_PAGE__")) err(rel, "the app's fingerprints were not filled in: run scripts/build-pwa.mjs");
    const b = (html.match(/<meta name="msca-build" content="([^"]*)">/) || [])[1];
    if (b !== undefined && b !== version) wrong.push(rel);
  }
  if (wrong.length) err(wrong[0], `${wrong.length} page(s) carry a different build fingerprint from version.json (${version})`);
  if (appOn && files.has("sw.js")) {
    const sw = readSite("sw.js").toString("utf8");
    const config = JSON.parse((sw.match(/\/\*__MSCA_CONFIG__\*\/ (\{.*\})/) || [])[1] || "null");
    if (!config) err("/sw.js", "the service worker's settings are missing (scripts/sw-template.js lost its /*__MSCA_CONFIG__*/ marker?)");
    else {
      if (config.base !== prefix) err("/sw.js", `built for the path prefix ${config.base}, the site for ${prefix}`);
      for (const m of ["core", "routing", "strategies", "precaching", "expiration"])
        if (!files.has(`assets/vendor/workbox-${config.wb}/workbox-${m}.prod.js`)) err("/sw.js", `loads assets/vendor/workbox-${config.wb}/workbox-${m}.prod.js, which is missing`);
      for (const e of config.precache) {
        const built = toFile(e.url);
        if (!built) err("/sw.js", `keeps ${e.url} for offline use, but there is no such file`);
        else if (e.integrity ? e.integrity !== "sha256-" + sha("sha256", readSite(built), "base64")
          : e.revision !== (readSite(built).toString("utf8").match(/<meta name="msca-page" content="([a-p]{16})">/) || [])[1])
          err("/sw.js", `keeps ${e.url} with a fingerprint that does not match the file`);
        const v = (e.url.match(/[?&]v=([0-9a-f]{8})$/) || [])[1];
        if (built && v && !sha("sha1", readSite(built)).startsWith(v)) err("/sw.js", `${e.url}: the address's hash does not match the file`);
      }
      for (const off of ["offline/", "es/offline/"])
        if (!config.precache.some((e) => e.url === prefix + off)) err("/sw.js", `the offline page ${prefix + off} is not kept for offline use`);
      // the app's start page opens offline only with all its scripts and styles
      for (const home of ["index.html", "es/index.html"])
        for (const [, u] of readSite(home).toString("utf8").matchAll(/<(?:script|link rel="stylesheet")\b[^>]*\b(?:src|href)="([^"]+)"/gi))
          if (u.startsWith(prefix) && !config.precache.some((e) => e.url === u)) err("/sw.js", `${u} (the home page loads it) is not kept for offline use`);
    }
    // the manifest: inside the site's address, every icon and shortcut there, and an icon for phones' round masks
    const m = JSON.parse(readSite("site.webmanifest"));
    const inside = (u) => typeof u === "string" && u.startsWith(prefix);
    if (!inside(m.start_url) || !inside(m.scope) || !inside(m.id)) err("/site.webmanifest", "start_url, scope and id must be inside the site's address");
    const pics = [...(m.icons || []), ...Object.values(m.icons_localized || {}).flat(), ...(m.shortcuts || []).flatMap((s) => s.icons || []), ...(m.screenshots || [])];
    for (const i of pics) {
      const built = toFile(i.src);
      const v = (i.src.match(/[?&]v=([0-9a-f]{8})$/) || [])[1];
      if (!built) err("/site.webmanifest", `${i.src} is missing`);
      else if (v && !sha("sha1", readSite(built)).startsWith(v)) err("/site.webmanifest", `${i.src}: the address's hash does not match the file`);
    }
    if (!(m.icons || []).some((i) => /maskable/.test(i.purpose || ""))) err("/site.webmanifest", "no maskable icon (phones crop app icons to a circle or squircle)");
    for (const s of m.shortcuts || []) if (!inside(s.url) || !toFile(s.url)) err("/site.webmanifest", `shortcut ${s.url} leads nowhere`);
  }
} catch (e) {
  err("the app", `could not check the manifest / service worker: ${e.message}`);
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

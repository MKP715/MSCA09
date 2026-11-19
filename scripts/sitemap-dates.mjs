// Gives the sitemap a <lastmod> for the pages that have no date of their own (the home pages, About, the calendar,
// every district, committee, document shelf and service page …): the day what the page SAYS last changed. A step of
// `npm run build`, after asset-hash.mjs and just before build-pwa.mjs.
//
//   node scripts/sitemap-dates.mjs [site folder, default _site] [--live <the live site's page-dates.json>]
//        [--live-sitemap <the live site's sitemap.xml>] [--today YYYY-MM-DD]
//
// (--live and --live-sitemap may also come from the environment variables PAGE_DATES_LIVE and PAGE_DATES_LIVE_SITEMAP,
// which is how the deploy workflow passes them; --today is for tests only: the day is otherwise today in California.)
//
// How it knows what changed: for every page in sitemap.xml it takes a fingerprint of what the page says (its title,
// its description and the text of its <main>, with the addresses of its links and pictures), and publishes them all
// in /assets/data/page-dates.json = { "/districts/d05/": ["<fingerprint>", "2026-11-18"], … }. The deploy workflow
// downloads the live site's copy first. A page whose fingerprint is the same as on the live site keeps the live date;
// a page whose fingerprint changed (or that is new) gets today's date in California. Without a live copy (a build on
// your own computer, or the very first deploy) no page gets a date: a date is never made up. If only the live copy
// could not be read (Pages did not answer in time), the dates of the live sitemap are kept for this one build, so one
// failed download never wipes them all (a page that changed in that build keeps its old date).
//
// Left out of the fingerprint, so they never re-date a page:
//  - everything outside <main> (menus, footer, styles and scripts: a new stylesheet is not a new page);
//  - text marked data-msca-volatile (the calendar's "refreshed" date) and blocks marked data-lastmod-skip: the parts
//    that roll forward on their own as days pass or that only list other pages ("Coming up next", the next dates of a
//    meeting, this week's meetings on the home page, a countdown …). Mark any such new block the same way in its
//    template (the attribute does nothing else). The page those lists point to has its own date;
//  - attributes other than link and picture addresses and their alt / title / aria-label words (classes, colours,
//    ids, data-* such as the "In 24 days" badges), the ?v=<hash> of the site's own files, inline pictures (<svg>).
// So the date changes when an editor changes a CSV row the page shows, when Google Calendar changes what an event
// page says (an event that has ended changes its page too), when a new document is linked, or when what a page tells
// people to use changes (the Zoom room of the next Area meeting on the committee pages counts: it is not a list of
// dates). Changing these rules (what counts, a new data-lastmod-skip) re-dates the pages it touches once; harmless.
//
// What the sitemap then says:
//  - pages without a date of their own: the date above (none while it is not known);
//  - event pages: the later of the day their Google Calendar entry was last edited (event.njk) and the date above;
//  - every other page with its own date (the Delegate's Corner posts: front matter `updated`, else the post's day):
//    their own date, unchanged.
// scripts/indexnow-urls.mjs then announces every page whose <lastmod> changed to Bing and the other IndexNow engines.
//
// Why here, just before build-pwa.mjs: build-pwa.mjs takes a fingerprint of every file of the site (the app's
// version.json, <meta name="msca-build">), so the sitemap and page-dates.json must be final before it runs, and
// nothing may change a page after it stamped them. This script reads the pages and writes only sitemap.xml and
// page-dates.json, never a page. What build-pwa.mjs changes in a page (its <head>) is not part of these fingerprints.
// An identical build with the same live copy gives identical files (sorted, no clock unless a page changed), so
// deploy.yml can still tell that a scheduled build is the same as the published site and skip it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { DateTime } from "luxon";

const TZ = "America/Los_Angeles"; // the Area's time zone (TZ in src/_lib/filters.js)
export const MANIFEST = "assets/data/page-dates.json";

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
// in the letters a–p only, as build-pwa.mjs does: digits in a data file could look like a phone number to check-site.mjs
const letters = (hex) => hex.replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)]).slice(0, 16);

/* ------------------------------------------------------------------ what a page says */
// elements with no closing tag
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
// elements whose content never counts: scripts, styles and inline pictures (icons)
const SKIP_CONTENT = new Set(["script", "style", "svg"]);
// the attributes that carry words or a destination; every other attribute is layout or behaviour
const KEEP_ATTRS = new Set(["href", "src", "alt", "title", "aria-label", "placeholder", "datetime"]);
// blocks left out with everything inside them
const SKIP_BLOCK = /^(data-lastmod-skip|data-msca-volatile)$/i;
const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

// One tag starting at html[lt] === "<": { end (index after ">"), close, name, attrs } or null when it is not a tag.
// Quote-aware: a ">" inside an attribute value (x-show="a > b") does not end the tag.
function readTag(html, lt) {
  const m = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 80));
  if (!m) return null;
  let j = lt + m[0].length;
  let quote = "";
  let afterEq = false;
  for (; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === quote) quote = "";
    } else if ((c === '"' || c === "'") && afterEq) quote = c;
    else if (c === ">") break;
    if (!quote) afterEq = c === "=" || (afterEq && /\s/.test(c));
  }
  const inner = html.slice(lt + m[0].length, j);
  const attrs = [];
  for (const a of inner.matchAll(ATTR)) attrs.push([a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? ""]);
  return { end: j + 1, close: m[1] === "/", name: m[2].toLowerCase(), attrs, selfClosing: /\/\s*$/.test(inner) };
}

/** The words and destinations of one stretch of HTML, as one line of text (see the top of this file). */
export function pageWords(html) {
  const out = [];
  let i = 0;
  // the element being left out ({ name, depth }), when inside one
  let skip = null;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const text = html.slice(i, lt < 0 ? html.length : lt);
    if (!skip && text.trim()) out.push(text);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const e = html.indexOf("-->", lt + 4);
      i = e < 0 ? html.length : e + 3;
      continue;
    }
    const tag = readTag(html, lt);
    if (!tag) {
      if (!skip) out.push("<");
      i = lt + 1;
      continue;
    }
    i = tag.end;
    const opens = !tag.close && !tag.selfClosing && !VOID.has(tag.name);
    if (skip) {
      if (tag.name === skip.name) skip.depth += tag.close ? -1 : opens ? 1 : 0;
      if (skip.depth === 0) skip = null;
      continue;
    }
    if (tag.close) continue;
    if (SKIP_CONTENT.has(tag.name) || tag.attrs.some(([n]) => SKIP_BLOCK.test(n))) {
      if (!opens) continue;
      // a script or style ends at its own closing tag (its text may hold anything)
      if (tag.name === "script" || tag.name === "style") {
        const close = new RegExp(`</${tag.name}\\s*>`, "gi");
        close.lastIndex = i;
        i = close.exec(html) ? close.lastIndex : html.length;
      } else skip = { name: tag.name, depth: 1 };
      continue;
    }
    for (const [n, v] of tag.attrs) {
      if (!KEEP_ATTRS.has(n) || !v.trim()) continue;
      if ((n === "href" && v.startsWith("#")) || /^javascript:/i.test(v)) continue; // a place on the same page
      // the site's own files carry ?v=<hash of the file> (asset-hash.mjs, build-pwa.mjs): the file, not its version
      out.push(`${n}=${n === "href" || n === "src" ? v.replace(/([?&])v=[\w.-]+(&|$)/, (m, a, b) => (b ? a : "")) : v}`);
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** What a built page says: its title, its description and its <main> (see the top of this file). */
export function pageText(html) {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const description = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || "";
  const start = html.search(/<main[\s>]/i);
  const end = html.lastIndexOf("</main>");
  const main = start >= 0 && end > start ? html.slice(start, end) : "";
  return [title.trim(), description.trim(), pageWords(main)].join("\n");
}

export const pageFingerprint = (html) => letters(sha1(pageText(html)));

/* ------------------------------------------------------------------ the sitemap */
const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// "https://msca09aa.org/districts/d05/" → "/districts/d05/" (the site's path prefix taken off), or null
function pathOf(loc, prefix) {
  let p;
  try {
    p = decodeURIComponent(new URL(unescapeXml(loc)).pathname);
  } catch {
    return null;
  }
  return prefix !== "/" && p.startsWith(prefix) ? "/" + p.slice(prefix.length) : p;
}
// event pages (/events/<page>/, /es/events/<page>/; not the /events/ list itself)
export const isEventPage = (p) => /^\/(es\/)?events\/[^/]+\/$/.test(p);

/** A live page-dates.json: { "/page/": [fingerprint, "YYYY-MM-DD" or ""] }, or null when it is missing or not one. */
export function readManifest(file) {
  if (!file) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out = new Map();
  for (const [p, v] of Object.entries(data)) {
    if (!Array.isArray(v) || typeof v[0] !== "string") return null;
    out.set(p, [v[0], typeof v[1] === "string" && DAY.test(v[1]) ? v[1] : ""]);
  }
  return out;
}

/** The live sitemap's dates: { "/page/" → "YYYY-MM-DD" }, or null when it is missing or not a sitemap. */
export function readSitemapDates(file, prefix = "/") {
  let xml;
  try {
    xml = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (!/<urlset[\s>]/.test(xml)) return null;
  const out = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/);
    const lastmod = (block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/) || [])[1] || "";
    const p = loc && pathOf(loc[1], prefix);
    if (p && DAY.test(lastmod.slice(0, 10))) out.set(p, lastmod.slice(0, 10));
  }
  return out;
}

/**
 * The new sitemap and manifest.
 *   xml      the sitemap Eleventy wrote
 *   pageOf   (path) => the built page's HTML, or null
 *   live     readManifest() of the live site, or null
 *   fallback readSitemapDates() of the live site, used only when live is null, or null
 *   today    "YYYY-MM-DD" in California
 *   prefix   the path prefix the site was built with ("/" on msca09aa.org)
 * Returns { xml, manifest (sorted JSON text), counts }.
 */
export function dateSitemap({ xml, pageOf, live, fallback = null, today, prefix = "/" }) {
  const entries = new Map();
  const counts = { pages: 0, changed: 0, dated: 0, missing: [] };
  const out = xml.replace(/<url>([\s\S]*?)<\/url>/g, (whole, block) => {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/);
    if (!loc) return whole;
    const p = pathOf(loc[1], prefix);
    if (!p) return whole;
    const html = pageOf(p);
    if (html == null) {
      counts.missing.push(p);
      return whole;
    }
    counts.pages++;
    const fp = pageFingerprint(html);
    const before = live ? live.get(p) : undefined;
    // the live date while the page says the same; today when it says something new (or is new); without a live copy,
    // the live sitemap's date when there is one, else none
    const date = !live ? (fallback && fallback.get(p)) || "" : before && before[0] === fp ? before[1] : today;
    if (live && !(before && before[0] === fp)) counts.changed++;
    const ownMatch = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/);
    const own = ownMatch ? ownMatch[1] : "";
    // Without the live page-dates.json, the live sitemap's date stands in only for a page with no date of its own: for
    // a post or an event page it is that page's own (or later calendar) date, not the day its text changed, and
    // keeping it would change this file although nothing changed (an unchanged scheduled build must stay identical).
    entries.set(p, [fp, !live && own ? "" : date]);
    let lastmod = own;
    if (!own) lastmod = date;
    else if (isEventPage(p) && date > own.slice(0, 10)) lastmod = date;
    if (!lastmod) return whole;
    if (lastmod !== own) counts.dated++;
    if (ownMatch) return whole.replace(ownMatch[0], `<lastmod>${lastmod}</lastmod>`);
    // right after <loc>, as sitemap.njk writes it (the sitemap schema wants loc, lastmod, then xhtml:link)
    return whole.replace(/<\/loc>/, `</loc>\n    <lastmod>${lastmod}</lastmod>`);
  });
  const keys = [...entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // one page per line: small, and easy to compare between two deploys
  const manifest = "{\n" + keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(entries.get(k))}`).join(",\n") + "\n}\n";
  return { xml: out, manifest, counts };
}

/* ------------------------------------------------------------------ run */
// The path prefix the site was built with (as scripts/build-pwa.mjs reads it): "/" on msca09aa.org.
function builtPrefix(site) {
  if (process.env.ELEVENTY_PATH_PREFIX) return process.env.ELEVENTY_PATH_PREFIX;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".cache", "build-info.json"), "utf8"));
    if (info[site]?.prefix) return info[site].prefix;
  } catch {}
  return "/";
}

function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const [, v] = args.splice(i, 2);
    return v;
  };
  const livePath = opt("--live") ?? process.env.PAGE_DATES_LIVE ?? "";
  const liveSitemapPath = opt("--live-sitemap") ?? process.env.PAGE_DATES_LIVE_SITEMAP ?? "";
  const today = opt("--today") || DateTime.now().setZone(TZ).toISODate();
  const site = path.resolve(args[0] || "_site");
  const sitemapFile = path.join(site, "sitemap.xml");
  if (!DAY.test(today)) {
    console.error(`[dates] --today must be YYYY-MM-DD, not "${today}".`);
    process.exit(1);
  }
  if (!fs.existsSync(sitemapFile)) {
    console.error(`[dates] ${sitemapFile} does not exist: build the site first.`);
    process.exit(1);
  }
  const prefix = builtPrefix(site).replace(/\/?$/, "/").replace(/^(?!\/)/, "/");
  const live = readManifest(livePath);
  const fallback = live || !liveSitemapPath ? null : readSitemapDates(liveSitemapPath, prefix);
  const pageOf = (p) => {
    const file = path.join(site, ...p.split("/").filter(Boolean), "index.html");
    return p.endsWith("/") && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  };
  const { xml, manifest, counts } = dateSitemap({ xml: fs.readFileSync(sitemapFile, "utf8"), pageOf, live, fallback, today, prefix });
  // never blocks the build: such an address keeps what the sitemap says (scripts/check-site.mjs reports the missing page)
  if (counts.missing.length)
    console.warn(`[dates] the sitemap lists ${counts.missing.length} address(es) with no page in ${site}, left as they are: ${counts.missing.slice(0, 5).join(", ")}`);
  fs.writeFileSync(sitemapFile, xml);
  fs.mkdirSync(path.dirname(path.join(site, MANIFEST)), { recursive: true });
  fs.writeFileSync(path.join(site, MANIFEST), manifest);
  console.log(
    live
      ? `[dates] ${counts.pages} pages: ${counts.changed} say something new since the live site (dated ${today}); ${counts.dated} <lastmod> written from their content`
      : fallback
        ? `[dates] ${counts.pages} pages fingerprinted; no live page-dates.json${livePath ? ` (${livePath})` : ""}: the live sitemap's dates are kept`
        : `[dates] ${counts.pages} pages fingerprinted; no live page-dates.json${livePath ? ` (${livePath})` : ""}, so no page is dated from its content`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));

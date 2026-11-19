// Lists the pages to announce to Bing and the other IndexNow search engines after a deploy: the addresses
// that are new, gone, or have a new <lastmod> in the sitemap just built, compared with the sitemap on the
// live site. Pages without a date of their own get theirs from what they say (scripts/sitemap-dates.mjs), so
// an edit to a district, committee or document page is announced too. Prints a JSON array of addresses ([]
// when there is nothing to send) and a one-line summary on stderr. The deploy workflow
// (.github/workflows/deploy.yml) sends the list once the site is published.
//
//   node scripts/indexnow-urls.mjs <live sitemap.xml> [new sitemap, default _site/sitemap.xml]
//        [--old <live sitemap-old-addresses.xml> <new sitemap-old-addresses.xml>] [--all-old]
//
// --old: also the old WordPress addresses that forward to a new page (src/pages/sitemap-old-addresses.njk) and are
// new or gone since the live copy, e.g. a renamed event's old address added to data/redirects.csv, so search
// engines learn where it went. --all-old: every one of them, whatever the live copy says (the deploy workflow's
// one-time "announce_old_addresses" run, for the addresses that were there before this was announced).
//
// Sends nothing (prints []) when the live sitemap could not be read (a list of every page would be a guess; the
// same for the old addresses without --all-old), and when this build is not the site at the root of the domain in
// data/settings.csv (site_url), e.g. a https://<user>.github.io/<repository>/ build: IndexNow only accepts
// addresses of the domain that serves the key file (src/static/<key>.txt).
import fs from "node:fs";
import { readCsv } from "../src/_lib/csv.js";

// IndexNow takes at most 10,000 addresses per request. The deploy job receives the list through an environment
// variable, which holds at most 128 KB, so the list also stays under 100,000 characters (about 1,400 addresses;
// the whole sitemap is about 670 today, the old addresses about 270). Anything left over is still found through
// the sitemap.
const MAX_URLS = 10000;
const MAX_CHARS = 100000;

const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e]);

/** address -> <lastmod> ("" when the page gives none), in sitemap order; null when the file is not a sitemap. */
function readSitemap(file) {
  let xml;
  try {
    xml = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (!/<urlset[\s>]/.test(xml)) return null;
  const pages = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/);
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/);
    pages.set(unescapeXml(loc[1]), lastmod ? lastmod[1] : "");
  }
  return pages;
}

/** [addresses to announce, summary for the log]. old: { livePath, newPath, all } or null. */
function changedPages(livePath, newPath, old) {
  // The same address the build uses (src/_data/site.js), and the domain the key file is published for.
  const settingsUrl = readCsv("settings.csv").find((r) => r.key === "site_url")?.value || "https://msca09aa.org";
  const home = hostOf(settingsUrl);
  const host = hostOf(process.env.SITE_URL || settingsUrl);
  const prefix = (process.env.ELEVENTY_PATH_PREFIX || "/").replace(/\/?$/, "/");
  if (!home || host !== home || prefix !== "/")
    return [[], `This build is for ${host || "an unknown address"}${prefix === "/" ? "" : prefix}, not ${home || settingsUrl}: nothing to send.`];

  // New and changed pages first, then gone ones, then the old addresses, so the pages are the ones kept if the list is
  // cut short.
  const wanted = [];
  const notes = [];
  const before = livePath ? readSitemap(livePath) : null;
  const after = readSitemap(newPath);
  if (!before) notes.push(`The live sitemap could not be read${livePath ? ` (${livePath})` : ""}: no page is sent`);
  else if (!after) notes.push(`The new sitemap could not be read (${newPath}): no page is sent`);
  else {
    const added = [...after.keys()].filter((u) => !before.has(u));
    const changed = [...after.keys()].filter((u) => before.has(u) && before.get(u) !== after.get(u));
    const removed = [...before.keys()].filter((u) => !after.has(u));
    wanted.push(...added, ...changed, ...removed);
    notes.push(`${added.length} new, ${changed.length} changed, ${removed.length} removed page(s)`);
  }
  if (old) {
    const oldAfter = readSitemap(old.newPath);
    const oldBefore = old.livePath ? readSitemap(old.livePath) : null;
    if (!oldAfter) notes.push(`no old addresses in this build (${old.newPath})`);
    else if (old.all) {
      wanted.push(...oldAfter.keys());
      notes.push(`all ${oldAfter.size} old addresses (asked for)`);
    } else if (!oldBefore) notes.push("the live list of old addresses could not be read: none is sent");
    else {
      const added = [...oldAfter.keys()].filter((u) => !oldBefore.has(u));
      const removed = [...oldBefore.keys()].filter((u) => !oldAfter.has(u));
      wanted.push(...added, ...removed);
      notes.push(`${added.length} new, ${removed.length} removed old address(es)`);
    }
  }
  // An address listed twice (an old address that is a page again) is sent once.
  const unique = [...new Set(wanted)];
  if (!unique.length) return [[], `${notes.join("; ")}: nothing to send.`];

  // Only this domain's addresses: IndexNow refuses the whole request when one address belongs to another host.
  const list = [];
  let chars = 2;
  for (const u of unique) {
    if (hostOf(u) !== host) continue;
    chars += JSON.stringify(u).length + 1;
    if (list.length >= MAX_URLS || chars > MAX_CHARS) break;
    list.push(u);
  }
  return [list, `${notes.join("; ")}; announcing ${list.length} of ${unique.length}.`];
}

const args = process.argv.slice(2);
const allOld = args.includes("--all-old");
const o = args.indexOf("--old");
const oldFiles = o >= 0 ? args.slice(o + 1, o + 3) : [];
const old =
  o >= 0 || allOld ? { livePath: oldFiles[0] || "", newPath: oldFiles[1] || "_site/sitemap-old-addresses.xml", all: allOld } : null;
const [livePath, newPath = "_site/sitemap.xml"] = args.filter((a, i) => a !== "--all-old" && (o < 0 || i < o || i > o + 2));
const [list, summary] = changedPages(livePath, newPath, old);
console.error(`[indexnow] ${summary}`);
process.stdout.write(JSON.stringify(list) + "\n");

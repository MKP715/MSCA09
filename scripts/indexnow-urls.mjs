// Lists the pages to announce to Bing and the other IndexNow search engines after a deploy: the addresses
// that are new, gone, or have a new <lastmod> in the sitemap just built, compared with the sitemap on the
// live site. Prints a JSON array of addresses ([] when there is nothing to send) and a one-line summary on
// stderr. The deploy workflow (.github/workflows/deploy.yml) sends the list once the site is published.
//
//   node scripts/indexnow-urls.mjs <live sitemap.xml> [new sitemap, default _site/sitemap.xml]
//
// Sends nothing (prints []) when the live sitemap could not be read (a list of every page would be a guess),
// and when this build is not the site at the root of the domain in data/settings.csv (site_url), e.g. a
// https://<user>.github.io/<repository>/ build: IndexNow only accepts addresses of the domain that serves
// the key file (src/static/<key>.txt).
import fs from "node:fs";
import { readCsv } from "../src/_lib/csv.js";

// IndexNow takes at most 10,000 addresses per request. The deploy job receives the list through an environment
// variable, which holds at most 128 KB, so the list also stays under 100,000 characters (about 1,400 addresses;
// the whole sitemap is about 650 today). Anything left over is still found through the sitemap.
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

/** [addresses to announce, summary for the log] */
function changedPages(livePath, newPath) {
  // The same address the build uses (src/_data/site.js), and the domain the key file is published for.
  const settingsUrl = readCsv("settings.csv").find((r) => r.key === "site_url")?.value || "https://msca09aa.org";
  const home = hostOf(settingsUrl);
  const host = hostOf(process.env.SITE_URL || settingsUrl);
  const prefix = (process.env.ELEVENTY_PATH_PREFIX || "/").replace(/\/?$/, "/");
  if (!home || host !== home || prefix !== "/")
    return [[], `This build is for ${host || "an unknown address"}${prefix === "/" ? "" : prefix}, not ${home || settingsUrl}: nothing to send.`];

  const before = livePath ? readSitemap(livePath) : null;
  if (!before) return [[], `The live sitemap could not be read${livePath ? ` (${livePath})` : ""}: nothing to send.`];
  const after = readSitemap(newPath);
  if (!after) return [[], `The new sitemap could not be read (${newPath}): nothing to send.`];

  const added = [...after.keys()].filter((u) => !before.has(u));
  const changed = [...after.keys()].filter((u) => before.has(u) && before.get(u) !== after.get(u));
  const removed = [...before.keys()].filter((u) => !after.has(u));
  const total = added.length + changed.length + removed.length;
  if (!total) return [[], "No page is new, gone or changed in the sitemap: nothing to send."];

  // New and changed pages first, so they are the ones kept if the list is cut short. Only this domain's
  // addresses: IndexNow refuses the whole request when one address belongs to another host.
  const list = [];
  let chars = 2;
  for (const u of [...added, ...changed, ...removed]) {
    if (hostOf(u) !== host) continue;
    chars += JSON.stringify(u).length + 1;
    if (list.length >= MAX_URLS || chars > MAX_CHARS) break;
    list.push(u);
  }
  return [list, `${added.length} new, ${changed.length} changed, ${removed.length} removed page(s); announcing ${list.length} of ${total}.`];
}

const [livePath, newPath = "_site/sitemap.xml"] = process.argv.slice(2);
const [list, summary] = changedPages(livePath, newPath);
console.error(`[indexnow] ${summary}`);
process.stdout.write(JSON.stringify(list) + "\n");

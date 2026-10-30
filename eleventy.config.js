// Eleventy configuration for the MSCA09 website.
//
// Volunteers never need to touch this file: everything that changes lives in
// the CSV files under data/ and in the Area's Google Calendar. This file only
// wires up the build — filters, shortcodes, and which files get copied.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HtmlBasePlugin } from "@11ty/eleventy";
import { registerFilters } from "./src/_lib/filters.js";
import { registerShortcodes } from "./src/_lib/shortcodes.js";
import { readCsv, resetCsvProblems } from "./src/_lib/csv.js";
import { dictionary, t } from "./src/_lib/i18n.js";

const PATH_PREFIX = process.env.ELEVENTY_PATH_PREFIX || "/";

// Top-level folders and files of this site. An old WordPress address inside one of them
// (e.g. /events/category/…) is forwarded by the 404 page, never by a page of its own,
// so a row in data/redirects.csv can never overwrite a real page. A Spanish address is checked
// past its leading /es/: /es/prf2028/ gets a page of its own, /es/events/… and /es/ itself do not.
// One exception: the old address of a calendar event page (EVENT_PAGE, below).
const RESERVED = new Set([
  "", "es", "assets", "pagefind", "calendar", "events", "districts", "committees", "service", "documents",
  "about", "contact", "newcomers", "resources", "contribute", "404.html", "sitemap.xml", "sitemap-old-addresses.xml", "robots.txt",
  "calendar.ics", "calendar-es.ics", "site.webmanifest", "favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png",
]);

/** "/Foo/bar" → "/foo/bar/" (old WordPress addresses are case-insensitive and end in /). */
export function normaliseOldPath(p) {
  let s = String(p || "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\/(www\.)?msca09aa\.org/i, "");
  if (!s.startsWith("/")) s = "/" + s;
  s = s.split("#")[0].split("?")[0];
  if (s.endsWith("*")) return s.toLowerCase();
  if (!/\.[a-z0-9]{2,5}$/i.test(s) && !s.endsWith("/")) s += "/";
  return s.toLowerCase();
}

// The address of a calendar event page (src/pages/event.njk): /events/<slug>/ or /es/events/<slug>/. It comes from the
// entry's title (and date) in Google Calendar, so it changes when an entry is renamed or moved, and goes when it is deleted.
const EVENT_PAGE = /^\/(es\/)?events\/[^/]+\/$/;

/** Every calendar event page of this build (/events/<slug>/ and /es/events/<slug>/), from the same calendar data
 *  src/pages/event.njk makes them from. */
export async function eventPageUrls() {
  const { default: calendar } = await import("./src/_data/calendar.js");
  const cal = await calendar();
  return new Set((cal.pages || []).map((p) => `${p.lang.prefix}/events/${p.item.slug}/`));
}

/**
 * Old msca09aa.org addresses → pages of this site, from data/redirects.csv plus the
 * old_url of every archived Delegate's Corner post (src/content/delegate/*.md).
 *   pages:  one forwarding page per exact old address (src/pages/legacy-redirects.njk)
 *   exact / prefix: what the 404 page looks up (/assets/data/redirects.json)
 *   problems: rows the site check reports as errors (scripts/check-site.mjs)
 *   warnings: rows it reports as warnings: rows that a Google Calendar edit has overtaken (below)
 * eventUrls (eventPageUrls()): the calendar event pages of this build. With it, an old event address (/events/<old slug>/,
 * /es/events/<old slug>/: an entry renamed or moved) gets a forwarding page of its own like any other old address, so
 * search engines follow it — except while it is the address of an event page again (the entry got its old title back):
 * then the real page stays and the row waits. And a row that forwards to an event page the calendar no longer has
 * (the entry was renamed, moved or deleted) forwards to the calendar instead. Neither ever stops the build.
 */
export function legacyRedirects({ eventUrls = null } = {}) {
  const exact = {};
  const prefix = [];
  const pages = [];
  const problems = [];
  const warnings = [];
  const add = (from, to, note, source) => {
    const old = normaliseOldPath(from);
    let target = String(to || "").trim();
    if (!old || !target) return problems.push(`${source}: needs both old_path and new_path`);
    if (!target.startsWith("/")) return problems.push(`${source}: new_path "${target}" must start with / (an address on this site)`);
    const targetPage = target.split(/[?#]/)[0];
    if (eventUrls && EVENT_PAGE.test(targetPage) && !eventUrls.has(targetPage)) {
      const calendarPage = target.startsWith("/es/") ? "/es/calendar/" : "/calendar/";
      warnings.push(`${source}: ${old} forwards to ${target}, which the calendar no longer has (the entry was renamed, moved or deleted in Google Calendar) — it forwards to ${calendarPage} until new_path is updated`);
      target = calendarPage;
    }
    if (old.endsWith("*")) {
      prefix.push([old.slice(0, -1), target]);
      return;
    }
    if (exact[old]) return problems.push(`${source}: "${old}" is listed twice`);
    if (eventUrls && eventUrls.has(old))
      return warnings.push(`${source}: ${old} is the address of a calendar event page again, so the page stays and the row does nothing — delete the row`);
    exact[old] = target;
    const rest = old.startsWith("/es/") ? old.slice(3) : old; // "/es/prf2028/" → "/prf2028/"
    const first = rest.split("/")[1] || "";
    if (RESERVED.has(first) && !(eventUrls && EVENT_PAGE.test(old))) return; // the 404 page handles it
    pages.push({ from: old, to: target, note: note || "" });
  };
  for (const r of readCsv("redirects.csv")) add(r.old_path, r.new_path, r.note, `data/redirects.csv row ${r._row}`);
  const dir = path.join(process.cwd(), "src", "content", "delegate");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const m = /^old_url:\s*"?([^"\r\n]+)"?\s*$/m.exec(fs.readFileSync(path.join(dir, f), "utf8"));
      if (m) add(m[1], `/service/delegate/posts/${f.replace(/\.md$/, "")}/`, "Delegate's Corner post", `src/content/delegate/${f}`);
    }
  }
  prefix.sort((a, b) => b[0].length - a[0].length); // longest match first
  return { pages, exact, prefix, problems, warnings };
}

export default async function (eleventyConfig) {
  // Rewrites every absolute URL ("/calendar/") when the site is served from a
  // sub-folder, e.g. https://<user>.github.io/<repo>/ — set by the deploy workflow.
  eleventyConfig.addPlugin(HtmlBasePlugin);

  registerFilters(eleventyConfig);
  registerShortcodes(eleventyConfig);

  // Each build starts clean, then records what scripts/check-site.mjs needs to know:
  // the path prefix and output folder it was built with, and problems in data/*.csv.
  eleventyConfig.on("eleventy.before", ({ directories } = {}) => {
    resetCsvProblems();
    try {
      // { "<absolute output folder>": { prefix, builtAt } } — one entry per output folder
      const file = ".cache/build-info.json";
      let info = {};
      try {
        info = JSON.parse(fs.readFileSync(file, "utf8")) || {};
        if (info.prefix) info = {}; // older single-build format
      } catch {}
      info[path.resolve(directories?.output || "_site")] = { prefix: PATH_PREFIX, builtAt: new Date().toISOString() };
      fs.mkdirSync(".cache", { recursive: true });
      fs.writeFileSync(file, JSON.stringify(info, null, 1));
    } catch {}
  });

  // Old msca09aa.org addresses (data/redirects.csv + old Delegate's Corner posts), checked against the calendar's
  // event pages of this build; rows that a Google Calendar edit has overtaken are only reported.
  eleventyConfig.addGlobalData("legacyRedirects", async () => {
    const r = legacyRedirects({ eventUrls: await eventPageUrls() });
    for (const w of r.warnings) console.warn(`[redirects] ${w}`);
    return r;
  });

  // {{ "some.key" | tIf(lang) }}: like t, but empty (and no "missing text" warning) when the key does not exist.
  eleventyConfig.addFilter("tIf", (key, lang, vars) => (dictionary()[key] ? t(key, lang, vars) : ""));

  // The title of a page of this site, by its address (used by the forwarding pages).
  eleventyConfig.addFilter("titleForUrl", (url, all) => {
    const u = String(url || "").split("#")[0];
    const hit = (all || []).find((p) => p.url === u);
    return hit ? String(hit.data.title || "") : "";
  });
  // What a page of this site shows in link previews, by its address (used by the forwarding pages, so a shared old or
  // short address such as /prf2028/ gets the new page's card): { title, description, ogImage, ogImageAlt, ogImageWidth,
  // ogImageHeight, ogImageType }, each "" when the page has none (or there is no such page). The title is its og:title
  // (layouts/base.njk): the meta title or title, with a section's own suffix (title_suffix_key); the home page's own title.
  eleventyConfig.addFilter("pageForUrl", (url, all) => {
    const u = String(url || "").split("#")[0];
    const d = (all || []).find((p) => p.url === u)?.data || {};
    const s = (v) => (v == null ? "" : String(v));
    const core = s(d.metaTitle || d.title);
    const suffix = core && d.title_suffix_key ? t(d.title_suffix_key, d.lang) : "";
    const home = (u === "/" || u === "/es/") && d.lang ? t("site.home_title", d.lang) : "";
    return {
      title: home || (suffix ? `${core} · ${suffix}` : core),
      description: s(d.description),
      ogImage: s(d.ogImage),
      ogImageAlt: s(d.ogImageAlt),
      ogImageWidth: s(d.ogImageWidth),
      ogImageHeight: s(d.ogImageHeight),
      ogImageType: s(d.ogImageType),
    };
  });

  // Sitemap entries: indexable pages only, and a language alternate only when that page
  // exists and is indexable too (the Spanish copies of the old Delegate's Corner posts are not).
  // Event pages of a series marked noindex (events and finished series that ended over two years ago, or that a live
  // series with the same title replaces: src/_data/calendar.js) stay out even if the page's own flag is missing.
  // <lastmod> comes from a page's own `lastmod` (event pages: the calendar entry's LAST-MODIFIED day), never the build time.
  eleventyConfig.addFilter("sitemapEntries", (all) => {
    const pages = (all || []).filter((p) => p.url && p.url.endsWith("/") && !p.data.eleventyExcludeFromCollections);
    const noindex = (p) => !!p.data.noindex || !!(/^\/(es\/)?events\//.test(p.url) && p.data.entry?.item?.noindex);
    const indexable = new Map(pages.filter((p) => !noindex(p)).map((p) => [p.url, p]));
    return [...indexable.values()]
      .map((p) => {
        const es = p.url === "/es/" || p.url.startsWith("/es/");
        const alt = es ? p.url.replace(/^\/es(\/|$)/, "/") || "/" : "/es" + p.url;
        const lastmod = p.data.lastmod || p.data.updated || "";
        return {
          url: p.url,
          lang: es ? "es" : "en",
          alt: indexable.has(alt) && !p.data.altNoindex ? alt : "",
          altLang: es ? "en" : "es",
          lastmod: /^\d{4}-\d{2}-\d{2}/.test(String(lastmod)) ? String(lastmod).slice(0, 10) : "",
        };
      })
      .sort((a, b) => a.url.localeCompare(b.url));
  });

  // Each part of the site may add its own filters/shortcodes in src/_lib/plugins/<name>.js
  // (a module whose default export is a function taking eleventyConfig).
  const pluginDir = path.join(process.cwd(), "src", "_lib", "plugins");
  if (fs.existsSync(pluginDir)) {
    for (const f of fs.readdirSync(pluginDir).filter((f) => f.endsWith(".js")).sort()) {
      const mod = await import(pathToFileURL(path.join(pluginDir, f)).href);
      if (typeof mod.default === "function") await mod.default(eleventyConfig);
    }
  }

  // Rebuild in dev when a data file changes.
  eleventyConfig.addWatchTarget("./data/");
  eleventyConfig.addWatchTarget("./src/_lib/");
  eleventyConfig.setWatchThrottleWaitTime(200);

  // Tailwind writes the CSS straight into _site; don't let Eleventy wipe or copy it.
  eleventyConfig.ignores.add("src/assets/css/**");
  eleventyConfig.setServerOptions({ watch: ["_site/assets/css/site.css"] });

  // Static files.
  eleventyConfig.addPassthroughCopy({ "src/assets/img": "assets/img" });
  eleventyConfig.addPassthroughCopy({ "src/assets/js": "assets/js" });
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });

  // Open-source libraries, served from this site (no third-party CDN at run time).
  const nm = "node_modules/";
  eleventyConfig.addPassthroughCopy({
    [nm + "alpinejs/dist/cdn.min.js"]: "assets/vendor/alpine.min.js",
    [nm + "@alpinejs/collapse/dist/cdn.min.js"]: "assets/vendor/alpine-collapse.min.js",
    [nm + "@alpinejs/focus/dist/cdn.min.js"]: "assets/vendor/alpine-focus.min.js",
    [nm + "@alpinejs/intersect/dist/cdn.min.js"]: "assets/vendor/alpine-intersect.min.js",
    [nm + "@alpinejs/persist/dist/cdn.min.js"]: "assets/vendor/alpine-persist.min.js",
    [nm + "fullcalendar/index.global.min.js"]: "assets/vendor/fullcalendar.min.js",
    [nm + "leaflet/dist/leaflet.js"]: "assets/vendor/leaflet/leaflet.js",
    [nm + "leaflet/dist/leaflet.css"]: "assets/vendor/leaflet/leaflet.css",
    [nm + "leaflet/dist/images"]: "assets/vendor/leaflet/images",
    [nm + "leaflet.markercluster/dist/leaflet.markercluster.js"]: "assets/vendor/leaflet/leaflet.markercluster.js",
    [nm + "leaflet.markercluster/dist/MarkerCluster.css"]: "assets/vendor/leaflet/MarkerCluster.css",
    [nm + "photoswipe/dist/umd/photoswipe.umd.min.js"]: "assets/vendor/photoswipe/photoswipe.umd.min.js",
    [nm + "photoswipe/dist/umd/photoswipe-lightbox.umd.min.js"]: "assets/vendor/photoswipe/photoswipe-lightbox.umd.min.js",
    [nm + "photoswipe/dist/photoswipe.css"]: "assets/vendor/photoswipe/photoswipe.css",
    [nm + "swiper/swiper-bundle.min.js"]: "assets/vendor/swiper/swiper-bundle.min.js",
    [nm + "swiper/swiper-bundle.min.css"]: "assets/vendor/swiper/swiper-bundle.min.css",
    [nm + "fuse.js/dist/fuse.min.mjs"]: "assets/vendor/fuse.min.mjs",
    [nm + "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2"]: "assets/fonts/outfit-latin.woff2",
    [nm + "@fontsource-variable/outfit/files/outfit-latin-ext-wght-normal.woff2"]: "assets/fonts/outfit-latin-ext.woff2",
    [nm + "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"]: "assets/fonts/inter-latin.woff2",
    [nm + "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2"]: "assets/fonts/inter-latin-ext.woff2",
  });

  return {
    // "/" on msca09aa.org; "/<repo>/" on a github.io project address (set by the deploy workflow).
    pathPrefix: PATH_PREFIX,
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts",
      data: "_data",
    },
    templateFormats: ["njk", "md", "11ty.js"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
}

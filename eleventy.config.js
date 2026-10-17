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
// so a row in data/redirects.csv can never overwrite a real page.
const RESERVED = new Set([
  "", "es", "assets", "pagefind", "calendar", "events", "districts", "committees", "service", "documents",
  "about", "contact", "newcomers", "resources", "contribute", "404.html", "sitemap.xml", "robots.txt",
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

/**
 * Old msca09aa.org addresses → pages of this site, from data/redirects.csv plus the
 * old_url of every archived Delegate's Corner post (src/content/delegate/*.md).
 *   pages:  one forwarding page per exact old address (src/pages/legacy-redirects.njk)
 *   exact / prefix: what the 404 page looks up (/assets/data/redirects.json)
 *   problems: rows the site check reports (scripts/check-site.mjs)
 */
export function legacyRedirects() {
  const exact = {};
  const prefix = [];
  const pages = [];
  const problems = [];
  const add = (from, to, note, source) => {
    const old = normaliseOldPath(from);
    const target = String(to || "").trim();
    if (!old || !target) return problems.push(`${source}: needs both old_path and new_path`);
    if (!target.startsWith("/")) return problems.push(`${source}: new_path "${target}" must start with / (an address on this site)`);
    if (old.endsWith("*")) {
      prefix.push([old.slice(0, -1), target]);
      return;
    }
    if (exact[old]) return problems.push(`${source}: "${old}" is listed twice`);
    exact[old] = target;
    const first = old.split("/")[1] || "";
    if (RESERVED.has(first)) return; // the 404 page handles it
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
  return { pages, exact, prefix, problems };
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

  // Old msca09aa.org addresses (data/redirects.csv + old Delegate's Corner posts).
  eleventyConfig.addGlobalData("legacyRedirects", () => legacyRedirects());

  // {{ "some.key" | tIf(lang) }}: like t, but empty (and no "missing text" warning) when the key does not exist.
  eleventyConfig.addFilter("tIf", (key, lang, vars) => (dictionary()[key] ? t(key, lang, vars) : ""));

  // The title of a page of this site, by its address (used by the forwarding pages).
  eleventyConfig.addFilter("titleForUrl", (url, all) => {
    const u = String(url || "").split("#")[0];
    const hit = (all || []).find((p) => p.url === u);
    return hit ? String(hit.data.title || "") : "";
  });

  // Sitemap entries: indexable pages only, and a language alternate only when that page
  // exists and is indexable too (the Spanish copies of the old Delegate's Corner posts are not).
  // Event pages of a series marked noindex (one-time events that ended over two years ago,
  // src/_data/calendar.js) stay out even if the page's own flag is missing.
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

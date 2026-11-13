// The installable app — the last step of `npm run build`, after asset-hash.mjs. README "The app" explains it all.
//
//   node scripts/build-pwa.mjs [site folder, default _site]
//
//  1. app icons, drawn from the Area logo (src/assets/img/logo/logo-en.png, logo-es.png) into assets/img/app/: the
//     logo itself (192, 512), on white inside the 80 % safe zone that phones crop to a circle or a squircle ("maskable":
//     192, 512, 1024), the iPhone/iPad home-screen icon (180, on white), and one icon per shortcut (192)
//  2. site.webmanifest: ONE app for both languages (Spanish names and icons in the *_localized members), wording from
//     data/text/common.csv (app.*). Every icon address carries its own hash (?v=…), so a new logo reaches installed apps
//  3. a fingerprint of every page (<meta name="msca-page">) and of the whole site (<meta name="msca-build"> on every
//     page, and version.json): an open page compares them with the published ones to know when it is out of date
//     (pwa.js). Spans marked data-msca-volatile (the footer's "Updated <date>") do not count, so the date alone never
//     reloads anything. Both are written in the letters a–p only: digits in version.json could look like a phone
//     number to scripts/check-site.mjs
//  4. sw.js, the service worker, from scripts/sw-template.js, with the files the offline pages need (precache)
// Everything comes from the built files alone (no clock, no random, files in a fixed order), so an identical build
// gives identical files and deploy.yml still skips publishing it.
// data/settings.csv app = off: no app. Pages get msca-build "off" and unregister the service worker; sw.js becomes one
// that empties the caches and unregisters itself on every device at its next visit. Never delete sw.js instead.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { t, missing } from "../src/_lib/i18n.js";
import { readCsv } from "../src/_lib/csv.js";

const ROOT = process.cwd();
const SITE = path.resolve(process.argv[2] || "_site");
if (!fs.existsSync(SITE)) {
  console.error(`[app] ${SITE} does not exist: build the site first.`);
  process.exit(1);
}

// The path prefix the site was built with (as scripts/check-site.mjs reads it): "/" on msca09aa.org.
function builtPrefix() {
  if (process.env.ELEVENTY_PATH_PREFIX) return process.env.ELEVENTY_PATH_PREFIX;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(ROOT, ".cache", "build-info.json"), "utf8"));
    if (info[SITE]?.prefix) return info[SITE].prefix;
  } catch {}
  return "/";
}
const PREFIX = builtPrefix().replace(/\/?$/, "/").replace(/^(?!\/)/, "/");

const setting = Object.fromEntries(readCsv("settings.csv").map((r) => [r.key, String(r.value || "").trim()]));
const APP_ON = !/^(off|no|false|0)$/i.test(setting.app || "on");

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const letters = (hex) => hex.replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)]).slice(0, 16);
const read = (rel) => fs.readFileSync(path.join(SITE, rel));
const write = (rel, data) => {
  const file = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
// every file of the site, "/"-separated, in code-point order
function walk(dir, base = "", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base + e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel + "/", out);
    else out.push(rel);
  }
  return out;
}
const sortCp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ 1. icons */
const APP_DIR = "assets/img/app/";
const PNG = { compressionLevel: 9, adaptiveFiltering: false };
// one shortcut per row: the manifest's shortcut, its page and its picture (lucide-static, white on the site's blue)
const SHORTCUTS = [
  { key: "calendar", url: "calendar/", icon: "calendar-days" },
  { key: "events", url: "events/", icon: "list" },
  { key: "newcomers", url: "newcomers/", icon: "heart-handshake" },
  { key: "contact", url: "contact/", icon: "send" },
];
async function onWhite(src, size, inner) {
  const logo = await sharp(src).resize(inner, inner).png().toBuffer();
  const sheet = await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();
  return sharp(sheet).flatten({ background: "#ffffff" }).png(PNG).toBuffer();
}
async function drawIcons() {
  for (const lang of ["en", "es"]) {
    const src = path.join(ROOT, "src/assets/img/logo", `logo-${lang}.png`);
    for (const size of [192, 512]) write(`${APP_DIR}icon-${lang}-${size}.png`, await sharp(src).resize(size, size).png(PNG).toBuffer());
    for (const size of [192, 512, 1024]) write(`${APP_DIR}maskable-${lang}-${size}.png`, await onWhite(src, size, Math.round(size * 0.8)));
    write(`${APP_DIR}apple-touch-icon-${lang}.png`, await onWhite(src, 180, 164));
  }
  for (const s of SHORTCUTS) {
    const svg = fs.readFileSync(path.join(ROOT, "node_modules/lucide-static/icons", `${s.icon}.svg`), "utf8");
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const art = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f6fae"/><stop offset="1" stop-color="#6b5ba8"/></linearGradient></defs>
<rect width="192" height="192" rx="44" fill="url(#g)"/>
<svg x="46" y="46" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>
</svg>`;
    write(`${APP_DIR}shortcut-${s.key}.png`, await sharp(Buffer.from(art)).png(PNG).toBuffer());
  }
}

// "assets/img/app/icon-en-192.png" → "/assets/img/app/icon-en-192.png?v=<first 8 of its SHA-1>"
const hashed = (rel) => `${PREFIX}${rel}?v=${sha1(read(rel)).slice(0, 8)}`;

/* ------------------------------------------------------------------ 2. manifest */
function manifest() {
  const icons = (lang) => [
    { src: hashed(`${APP_DIR}icon-${lang}-192.png`), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: hashed(`${APP_DIR}icon-${lang}-512.png`), sizes: "512x512", type: "image/png", purpose: "any" },
    { src: hashed(`${APP_DIR}maskable-${lang}-192.png`), sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: hashed(`${APP_DIR}maskable-${lang}-512.png`), sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: hashed(`${APP_DIR}maskable-${lang}-1024.png`), sizes: "1024x1024", type: "image/png", purpose: "maskable" },
  ];
  const m = {
    id: PREFIX,
    name: t("app.name", "en"),
    short_name: t("app.short_name", "en"),
    description: t("app.description", "en"),
    name_localized: { es: t("app.name", "es") },
    short_name_localized: { es: t("app.short_name", "es") },
    description_localized: { es: t("app.description", "es") },
    lang: "en",
    dir: "ltr",
    // ?source=app: base.njk opens the app in the language last chosen on the device, then drops it from the address
    start_url: `${PREFIX}?source=app`,
    scope: PREFIX,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2ea3dd",
    categories: ["lifestyle", "social", "health"],
    icons: icons("en"),
    icons_localized: { es: icons("es") },
    shortcuts: SHORTCUTS.map((s) => ({
      name: t(`app.shortcut.${s.key}`, "en"),
      name_localized: { es: t(`app.shortcut.${s.key}`, "es") },
      url: `${PREFIX}${s.url}?source=app`,
      icons: [{ src: hashed(`${APP_DIR}shortcut-${s.key}.png`), sizes: "192x192", type: "image/png" }],
    })),
    prefer_related_applications: false,
  };
  // wording that has no row in data/text (t() then gives the key itself) or is empty would become the installed app's
  // name: stop the build instead (no template uses app.name, app.description or the shortcut names, so the site check
  // would not notice)
  const blank = [["name", m.name], ["short_name", m.short_name], ["description", m.description]].filter(([, v]) => !String(v || "").trim());
  if (missing.size || blank.length) {
    console.error(`[app] the app's wording is missing in data/text/common.csv: ${[...missing, ...blank.map(([k]) => `app.${k}`)].join(", ")}`);
    process.exit(1);
  }
  return JSON.stringify(m, null, 2) + "\n";
}

/* ------------------------------------------------------------------ 3. fingerprints */
// the app's own icons in the pages (the iPhone icon, base.njk) carry the build time until here: their hash instead
// (the build time only: digits up to the end of the value, never the start of a hash such as "540ae778")
const APP_ICON_LINK = /\/assets\/img\/app\/([\w.-]+\.png)\?v=\d+(?![0-9a-f])/g;
const META = /<meta name="msca-(build|page)" content="[^"]*">/g;
const VOLATILE = /(<[a-z][a-z0-9]*\b[^>]*\bdata-msca-volatile\b[^>]*>)[^<]*(<\/[a-z][a-z0-9]*>)/g;
const pageFingerprint = (html) => sha1(html.replace(META, "").replace(VOLATILE, "$1$2"));

/* ------------------------------------------------------------------ 4. service worker */
// The offline pages and every file of this site they load (<script src>, stylesheets, preloads, icons, <img> and
// <source> pictures with their srcset), and the scripts and stylesheets of the home pages (the app's start page:
// pwa.js saves its HTML; not its pictures, which are many and large). Each file carries an SRI hash, so a stale copy
// from GitHub's servers is refused; the offline pages, which carry the build's fingerprint and date, are checked by
// their own fingerprint instead (sw-template.js), so sw.js changes only when the offline set does.
function precache(fingerprints) {
  const urls = new Map();
  for (const [rel, own] of [["offline/index.html", true], ["es/offline/index.html", true], ["index.html", false], ["es/index.html", false]]) {
    const html = read(rel).toString("utf8");
    if (own) urls.set(PREFIX + rel.replace(/index\.html$/, ""), { file: rel, revision: letters(fingerprints.get(rel)), page: true });
    for (const [tag] of html.matchAll(own ? /<(?:script|link|img|source)\b[^>]*>/gi : /<(?:script|link)\b[^>]*>/gi)) {
      if (/^<link/i.test(tag) && !/\brel="(stylesheet|preload|icon|apple-touch-icon)"/i.test(tag)) continue;
      const found = [];
      for (const [, , v] of tag.matchAll(/\b(src|href)="([^"]+)"/gi)) found.push(v);
      for (const [, v] of tag.matchAll(/\bsrcset="([^"]+)"/gi)) for (const c of v.split(",")) found.push(c.trim().split(/\s+/)[0]);
      for (const u of found) {
        if (!u.startsWith(PREFIX) || u.startsWith("//")) continue;
        const file = decodeURIComponent(u.slice(PREFIX.length).split("#")[0].split("?")[0]);
        if (!fs.existsSync(path.join(SITE, file)) || fs.statSync(path.join(SITE, file)).isDirectory()) {
          console.error(`[app] ${rel} loads ${u}, which is not in the built site: the offline set cannot be made.`);
          process.exit(1);
        }
        // an address with ?v=<hash> changes with its file; others need a revision
        urls.set(u, { file, revision: /[?&]v=[0-9a-f]{8}$/.test(u) ? null : letters(sha1(read(file))) });
      }
    }
  }
  // and what those stylesheets load in turn (the fonts' other letters: "Kālia Rd", "Ōtsuka" …)
  for (const { file } of [...urls.values()]) {
    if (!file.endsWith(".css")) continue;
    for (const [, ref] of read(file).toString("utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      if (/^(data:|https?:|\/\/|#)/.test(ref)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.split("?")[0].split("#")[0]));
      if (fs.existsSync(path.join(SITE, target))) urls.set(PREFIX + target, { file: target, revision: letters(sha1(read(target))) });
    }
  }
  return [...urls.entries()]
    .sort(([a], [b]) => sortCp(a, b))
    .map(([url, { file, revision, page }]) =>
      page ? { url, revision } : { url, revision, integrity: "sha256-" + crypto.createHash("sha256").update(read(file)).digest("base64") },
    );
}

// It does not reload the pages it controls: a page GitHub's servers still hand out from before the switch-off would
// register the app again, and the two would take turns. Without a fetch handler it passes every request to the network,
// so the open pages simply work as the plain website until their next click.
const KILL_SWITCH = `/*
  MSCA09 — the app is switched off (data/settings.csv: app = off). Written by scripts/build-pwa.mjs.
  This service worker empties the app's caches and unregisters itself, so every device that installed the app goes
  back to the plain website at its next visit.
*/
"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith("msca-")) await caches.delete(name);
      try {
        indexedDB.deleteDatabase("workbox-expiration");
      } catch (e) {}
      await self.registration.unregister();
    })(),
  );
});
`;

/* ------------------------------------------------------------------ run */
const wbVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/workbox-core/package.json"), "utf8")).version;
if (APP_ON) {
  for (const m of ["core", "routing", "strategies", "precaching", "expiration"])
    if (!fs.existsSync(path.join(SITE, `assets/vendor/workbox-${wbVersion}/workbox-${m}.prod.js`))) {
      console.error(`[app] assets/vendor/workbox-${wbVersion}/workbox-${m}.prod.js is missing (eleventy.config.js copies it).`);
      process.exit(1);
    }
  await drawIcons();
  write("site.webmanifest", manifest());
}

// pass 1: the app icons' addresses, then each page's fingerprint (the pages keep their placeholders until pass 2)
const files = walk(SITE)
  .filter((f) => !/^(pagefind|pagefind-posts)\//.test(f) && f !== "sw.js" && f !== "version.json")
  .sort(sortCp);
const fingerprints = new Map(); // page → SHA-1 hex
const lines = [];
for (const rel of files) {
  if (!rel.endsWith(".html")) {
    lines.push(`${rel}\0${sha1(read(rel))}`);
    continue;
  }
  let html = read(rel).toString("utf8");
  const linked = html.replace(APP_ICON_LINK, (m, f) => (fs.existsSync(path.join(SITE, APP_DIR + f)) ? `/assets/img/app/${f}?v=${sha1(read(APP_DIR + f)).slice(0, 8)}` : m));
  if (linked !== html) write(rel, (html = linked));
  const fp = pageFingerprint(html);
  fingerprints.set(rel, fp);
  lines.push(`${rel}\0${fp}`);
}
const build = APP_ON ? letters(sha1(lines.join("\n"))) : "off";

// pass 2: the fingerprints into the pages
let stamped = 0;
for (const [rel, fp] of fingerprints) {
  const html = read(rel).toString("utf8");
  const out = html.replace('content="__MSCA_BUILD__"', `content="${build}"`).replace('content="__MSCA_PAGE__"', `content="${letters(fp)}"`);
  if (out !== html) {
    write(rel, out);
    stamped++;
  }
}

if (APP_ON) {
  const list = precache(fingerprints);
  const template = fs.readFileSync(path.join(ROOT, "scripts/sw-template.js"), "utf8");
  if (!template.includes("/*__MSCA_CONFIG__*/")) {
    console.error("[app] scripts/sw-template.js has lost its /*__MSCA_CONFIG__*/ marker.");
    process.exit(1);
  }
  const config = JSON.stringify({ base: PREFIX, wb: wbVersion, precache: list });
  write("sw.js", template.replace(/\/\*__MSCA_CONFIG__\*\/\s*\{[^\n]*\}/, () => `/*__MSCA_CONFIG__*/ ${config}`));
  write("version.json", JSON.stringify({ v: build }) + "\n");
  console.log(`[app] build ${build}: ${stamped} pages stamped, ${list.length} files kept for offline use, manifest and icons written`);
} else {
  write("sw.js", KILL_SWITCH);
  write("version.json", JSON.stringify({ v: "off" }) + "\n");
  console.log(`[app] switched off (data/settings.csv app = off): ${stamped} pages stamped; sw.js unregisters installed copies`);
}

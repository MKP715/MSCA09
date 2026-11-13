// English / Spanish text. All wording on the site comes from data/text/*.csv
// (columns: key, en, es). Pages call {{ "some.key" | t(lang) }}.
//
// {panel}, {years} and {previous_panel} are filled in everywhere from data/settings.csv
// (panel, panel_years, previous_panel) — in text keys and in CSV columns read with loc() —
// so nothing needs editing when the panel rotates. A caller's own values win.
import { readCsv, readCsvDir } from "./csv.js";

export const LANGS = [
  { code: "en", prefix: "", name: "English", short: "EN", locale: "en-US", htmlLang: "en", other: "es" },
  { code: "es", prefix: "/es", name: "Español", short: "ES", locale: "es-US", htmlLang: "es", other: "en" },
];
export const LANG = Object.fromEntries(LANGS.map((l) => [l.code, l]));

let cache = null;
let defaults = null;
export const missing = new Set();

export function resetText() {
  cache = null;
  defaults = null;
  missing.clear();
}

/** The placeholders every text gets: { panel, years, previous_panel } from data/settings.csv. */
export function defaultVars() {
  if (defaults) return defaults;
  const s = {};
  for (const row of readCsv("settings.csv")) if (row.key) s[row.key] = row.value;
  defaults = { panel: s.panel || "", years: s.panel_years || "", previous_panel: s.previous_panel || "" };
  return defaults;
}

const fill = (s, vars) =>
  s.indexOf("{") < 0
    ? s
    : s.replace(/\{(\w+)\}/g, (m, k) => {
        if (vars && vars[k] != null) return String(vars[k]);
        const d = defaultVars()[k];
        return d ? String(d) : m;
      });

export function dictionary() {
  if (cache) return cache;
  cache = {};
  for (const row of readCsvDir("text")) {
    if (!row.key) continue;
    if (cache[row.key] && process.env.ELEVENTY_RUN_MODE !== "serve") {
      console.warn(`[text] duplicate key "${row.key}" in data/${row._file} row ${row._row} (later row wins)`);
    }
    cache[row.key] = { en: row.en || "", es: row.es || "" };
  }
  return cache;
}

/** Normalise "es" | {code:"es"} | undefined → "en"/"es". */
export function code(lang) {
  const c = typeof lang === "string" ? lang : lang && lang.code;
  return c === "es" ? "es" : "en";
}

/** Translate a key. {name} placeholders are filled from vars, then from defaultVars(). Falls back to English. */
export function t(key, lang, vars) {
  const entry = dictionary()[key];
  const c = code(lang);
  if (!entry) {
    missing.add(key);
    return key;
  }
  return fill(entry[c] || entry.en || "", vars && typeof vars === "object" ? vars : null);
}

/** Pick a localised column from a CSV row: field_es / field_en / field ({panel}, {years}, {previous_panel} filled in). */
export function loc(obj, field, lang) {
  if (!obj) return "";
  const c = code(lang);
  const v = c === "es" && obj[`${field}_es`] ? obj[`${field}_es`] : obj[`${field}_en`] || obj[field] || obj[`${field}_es`] || "";
  return typeof v === "string" ? fillSettings(v) : v;
}

/** Only the settings placeholders ({panel}, {years}, {previous_panel}); any other {word} is left alone.
 *  For loaders that read CSV text without loc() (e.g. a search string). */
export function fillSettings(s) {
  s = String(s ?? "");
  if (s.indexOf("{") < 0) return s;
  const d = defaultVars();
  return s.replace(/\{(panel|years|previous_panel)\}/g, (m, k) => d[k] || m);
}

/** Prefix a site path with /es for Spanish pages. Leaves assets and external links alone. */
export function lurl(url, lang) {
  if (!url || typeof url !== "string") return url;
  if (code(lang) !== "es") return url;
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  if (/^\/(es\/|es$|assets\/|pagefind\/|docs\/|feeds?\/|calendar\.ics|sitemap|robots|favicon)/.test(url)) return url;
  if (/\.(json|ics|xml|txt|pdf|jpg|jpeg|png|webp|avif|svg|css|js|mjs)$/i.test(url)) return url;
  return "/es" + url;
}

/** The same page in the other language. */
export function altUrl(pageUrl, lang) {
  const url = pageUrl || "/";
  if (code(lang) === "es") return url.replace(/^\/es(\/|$)/, "/") || "/";
  return "/es" + url;
}

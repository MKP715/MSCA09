// Filters and data for the informational pages (About, Policy, Newcomers,
// Resources, Contribute, 404). Loaded automatically by eleventy.config.js.
//
// Volunteers never need to edit this file. Wording lives in
// data/text/content.csv, links in data/resources.csv, offices in
// data/central-offices.csv and questions in data/faq.csv.
import { dictionary, code, lurl, loc, t } from "../i18n.js";
import fs from "node:fs";
import path from "node:path";
import { readCsv } from "../csv.js";
// "tel:+17145564555" from "(714) 556-4555" (shared with the telHref filter)
import { telUs } from "../filters.js";
// the shared search matcher (src/assets/js/search.js): the build folds text the same way the visitor's query is folded
import "../../assets/js/search.js";

const { index: searchIndex, fold } = globalThis.MSearch;

const pad2 = (n) => String(n).padStart(2, "0");

/** "1 & 3" → "d01-03", "5" → "d05", "d05" → "d05". */
export function districtSlug(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  if (/^d\d/.test(s)) return s;
  const nums = s.match(/\d+/g);
  return nums ? "d" + nums.map((n) => pad2(Number(n))).join("-") : "";
}

/** Display form of a district number list: "1 & 3" (English) or "1 y 3" (Spanish). */
export function districtLabel(value, lang) {
  const nums = String(value || "").match(/\d+/g) || [];
  return nums.map(Number).join(code(lang) === "es" ? " y " : " & ");
}

/**
 * Other names people type for a city in the finder, from data/text/content.csv (and the same list for the
 * district finders, districts.city_alias in data/text/districts.csv, which counts here too):
 *   content.city_alias.01.city         = the city as written in data/districts.csv (Avalon)
 *   content.city_alias.01.names        = other names, separated by ; (Catalina; Catalina Island) — offered in the list
 *   content.city_alias.01.misspellings = common misspellings, separated by ; (Torrence) — found, never offered
 * The English and Spanish columns are both used, on both pages.
 * Returns Map(lower-case city → [name, …]) for `field` ("names" or "misspellings").
 */
export function cityAliases(field = "names") {
  const out = new Map();
  for (const prefix of ["content.city_alias", "districts.city_alias"]) {
    const en = tlist(prefix, "en");
    const es = tlist(prefix, "es");
    en.forEach((item, i) => {
      const city = String(item.city || "").trim();
      if (!city) return;
      const names = [item[field], es[i] && es[i][field]]
        .flatMap((v) => String(v || "").split(";"))
        .map((v) => v.trim())
        .filter(Boolean);
      if (!names.length) return;
      const k = city.toLowerCase();
      out.set(k, [...new Set([...(out.get(k) || []), ...names])]);
    });
  }
  return out;
}

/**
 * A repeating list kept in the text CSV. Keys look like
 *   about.timeline.01.year, about.timeline.01.title, about.timeline.01.body
 * `tlist("about.timeline", lang)` → [{ id: "01", year, title, body }, …] sorted by id.
 * Add an item by adding rows with the next number; delete it by deleting its rows.
 */
export function tlist(prefix, lang) {
  const dict = dictionary();
  const c = code(lang);
  const base = String(prefix).replace(/\.$/, "") + ".";
  const items = new Map();
  for (const [key, entry] of Object.entries(dict)) {
    if (!key.startsWith(base)) continue;
    const rest = key.slice(base.length);
    const dot = rest.indexOf(".");
    const id = dot === -1 ? rest : rest.slice(0, dot);
    const field = dot === -1 ? "text" : rest.slice(dot + 1);
    if (!items.has(id)) items.set(id, { id });
    items.get(id)[field] = entry[c] || entry.en || "";
  }
  return [...items.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** Map points for the About page: from districts.geoJsonPoints, or from districts.list lat/lng. */
export function districtPoints(districts, lang) {
  if (!districts) return [];
  const src = Array.isArray(districts.geoJsonPoints) && districts.geoJsonPoints.length
    ? districts.geoJsonPoints
    : (districts.list || []).map((d) => ({
        lat: d.lat ?? d.map?.lat,
        lng: d.lng ?? d.map?.lng,
        label: loc(d, "name", lang) || d.name || "",
        url: d.slug ? `/districts/${d.slug}/` : "",
        color: d.color,
        num: d.number,
      }));
  return src
    .map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      label: p[`label_${code(lang)}`] || p.label || "",
      url: p.url ? lurl(p.url, lang) : "",
      color: p.color || "iris",
      num: p.num != null ? String(p.num) : "",
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0);
}

/** Counts of active districts: { total, english, spanish }. */
export function districtStats(districts) {
  const list = (districts && Array.isArray(districts.list) ? districts.list : []).filter(
    (d) => !/merged|inactive/i.test(String(d.status || ""))
  );
  const spanish = list.filter(
    (d) => /linguistic/i.test(String(d.kind || "")) || /span|esp/i.test(String(d.language || ""))
  ).length;
  return { total: list.length, english: list.length - spanish, spanish };
}

/**
 * City → district index for the "find the office near me" box on /newcomers/:
 * [{ city, aliases?: [name], misspellings?: [name], districts: [{ slug, label, url, spanish, related }] }].
 * - Every city of every active district in data/districts.csv (qualifiers in brackets removed); a merged or
 *   retired district's cities count for the district it merged into (District 3 → 1 & 3: Dominguez).
 * - A city that no Spanish-speaking district lists also gets the Spanish-speaking district(s) whose
 *   covers_districts include its district (Hawthorne → District 21), as the district pages say.
 * - English-speaking district first, as in the "Which district am I in?" finder.
 * - related = the districts that share its groups (the English districts a Spanish district covers, the
 *   Spanish districts that cover an English one): the box shows their offices when the city's own districts
 *   have no phone office.
 * - aliases / misspellings: content.city_alias (data/text/content.csv) and districts.city_alias (see cityAliases).
 * The build log (English pass only, each message once per build: /newcomers/ and /districts/ both use this) names
 * cities that are missing an English- or Spanish-speaking district, so the lists in data/districts.csv can be completed.
 */
const cityWarned = new Set();
export function cityIndex(districts, lang) {
  const isActive = (d) => d && d.slug && !/merged|inactive/i.test(String(d.status || ""));
  const isSpanish = (d) => /linguistic/i.test(String(d.kind || "")) || /span|esp/i.test(String(d.language || ""));
  const list = (districts && Array.isArray(districts.list) ? districts.list : []).filter(isActive);
  const retired = districts && Array.isArray(districts.inactive) ? districts.inactive : [];
  const bySlug = new Map(list.map((d) => [d.slug, d]));
  const warn = (msg) => {
    if (code(lang) !== "en" || cityWarned.has(msg)) return;
    cityWarned.add(msg);
    console.warn(msg);
  };
  const map = new Map();
  const add = (raw, d) => {
    const city = String(raw || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!city) return;
    const k = city.toLowerCase();
    if (!map.has(k)) map.set(k, { city, districts: [] });
    const entry = map.get(k);
    if (entry.districts.some((x) => x.slug === d.slug)) return;
    entry.districts.push({
      slug: d.slug,
      label: loc(d, "name", lang) || d.name || `District ${d.number || ""}`,
      url: lurl(`/districts/${d.slug}/`, lang),
      spanish: isSpanish(d),
      related: [...new Set([...(d.covers || []), ...(Array.isArray(d.spanish) ? d.spanish : [])])].filter((s) => bySlug.has(s)),
    });
  };
  for (const d of list) for (const raw of d.cities || []) add(raw, d);
  for (const old of retired) {
    const into = bySlug.get(String(old.merged_into || "").toLowerCase());
    if (into) for (const raw of old.cities || []) add(raw, into);
  }
  const spanishDistricts = list.filter((d) => isSpanish(d) && !/interdistrict/i.test(String(d.kind || "")));
  for (const entry of map.values()) {
    const english = entry.districts.filter((x) => !x.spanish);
    if (!english.length) {
      warn(`[content] city "${entry.city}" is listed only under Spanish-speaking district(s) ${entry.districts.map((x) => x.slug).join(", ")} in data/districts.csv: add it to the English-speaking district that serves it (the Newcomers city box shows the offices of the districts they cover until then)`);
      continue;
    }
    if (entry.districts.some((x) => x.spanish)) continue;
    const by = spanishDistricts.filter((s) => english.some((x) => (s.covers || []).includes(x.slug)));
    for (const s of by) add(entry.city, s);
    if (by.length > 1)
      warn(`[content] city "${entry.city}" is in no Spanish-speaking district's city list in data/districts.csv; the Newcomers city box shows ${by.map((s) => s.slug).join(" and ")} (they cover ${english.map((x) => x.slug).join(" and ")}). Add it to the right one.`);
  }
  for (const entry of map.values()) entry.districts.sort((a, b) => a.spanish - b.spanish); // stable: English first
  for (const field of ["names", "misspellings"]) {
    for (const [k, names] of cityAliases(field)) {
      const entry = map.get(k);
      const own = names.filter((n) => !map.has(n.toLowerCase()));
      if (entry && own.length) entry[field === "names" ? "aliases" : "misspellings"] = own;
      else if (!entry) warn(`[content] city alias "${k}" (content.city_alias / districts.city_alias in data/text/) matches no city in data/districts.csv`);
    }
  }
  return [...map.values()].sort((a, b) => a.city.localeCompare(b.city));
}

// Numbers the data spells out ("The Twelve Steps", "Séptima Tradición"), so "12 Steps" and "7th Tradition" find them;
// a web address (not an e-mail address) also as one word ("aa.org" typed "aaorg").
const NUMBER_WORDS = { three: "3", tres: "3", seventh: "7", septima: "7", twelve: "12", doce: "12" };
const searchText = (...parts) => {
  const text = fold(parts.flat(Infinity).filter(Boolean).join(" "));
  const numbers = text.split(/[^a-z0-9]+/).filter((w) => NUMBER_WORDS[w]).map((w) => NUMBER_WORDS[w]);
  const sites = (text.match(/(?<![@a-z0-9.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|com|net|gov|edu|club|us)\b/g) || []).map((h) => h.replace(/[.-]/g, ""));
  return searchIndex(parts, numbers, sites);
};
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const noNotes = (s) => String(s || "").replace(/\s*\([^)]*\)/g, ""); // "(aa.org listing)", "(outside District 10)"

/**
 * Search text (MSearch.index) for a resource card on /resources/: what the card shows, in both languages —
 * titles, descriptions, website, the language chip — plus `extra` (the heading of the section it sits under).
 */
export function resourceSearch(r, lang, extra) {
  if (!r) return " ";
  const lg = String(r.language || "").toLowerCase();
  const chip = lg === "es" ? "Español" : lg === "en" && code(lang) === "es" ? "English" : "";
  return searchText(r.title_en, r.title_es, r.description_en, r.description_es, host(r.url), host(r.url_es), chip, extra);
}

/**
 * Search text (MSearch.index) for a central-office card on /resources/: everything the card shows in both
 * languages (name, who it serves, region, language and 24-hour chips, district chips, phones and what they are,
 * TTY, website, address), the section heading, and the cities of the districts it serves. The hours are left out:
 * "9 am–5 pm" would make "Area 9" find offices.
 */
export function officeSearch(f, districts, lang) {
  if (!f) return " ";
  const both = (key, vars) => [t(key, "en", vars), t(key, "es", vars)];
  const g = String(f.language || "").toLowerCase();
  const chip = /span/.test(g) || g === "es" ? "Español" : /multi/.test(g) ? both("content.lang_multi") : /eng/.test(g) || g === "en" ? "English" : "";
  const bySlug = (districts && districts.bySlug) || {};
  const phones = [f.phone, f.phone_2, f.tty].filter(Boolean).map((p) => [p, p.replace(/\D/g, "")]);
  return searchText(
    f.name, f.name_es, f.serves_en, f.serves_es, f.kind, f.address,
    both("offices.region." + f.region), chip, f.always_open ? [both("offices.always_open"), "24/7"] : "",
    (f.districts || []).map((d) => both("offices.district", { n: d.label })), f.district_slugs,
    phones, f.tty ? "TTY" : "", [f.phone_label_en, f.phone_label_es, f.phone_2_label_en, f.phone_2_label_es].map(noNotes),
    host(f.website), host(f.website_es),
    both("resources.offices_title"), both("resources.offices_nav"), "central office intergroup oficina intergrupo",
    (f.district_slugs || []).map((s) => (bySlug[s] ? bySlug[s].cities.map(noNotes) : []))
  );
}

/** Google Maps search link for a street address. */
export function mapsSearch(address) {
  const a = String(address || "").trim();
  return a ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a) : "";
}

/** Photo credits for the site's banner images, read from data/hero.csv when it exists. */
function heroCredits() {
  return readCsv("hero.csv")
    .map((r) => ({
      file: r.file || r.image || "",
      credit_en: r.credit_en || r.credit || "",
      credit_es: r.credit_es || r.credit_en || r.credit || "",
      alt_en: r.alt_en || r.alt || "",
      alt_es: r.alt_es || r.alt_en || r.alt || "",
      source_url: r.source_url || r.source || "",
      license: r.license || r.licence || "",
      license_url: r.license_url || r.licence_url || "",
    }))
    .filter((r) => r.credit_en);
}

export default function (eleventyConfig) {
  eleventyConfig.addFilter("tlist", (prefix, lang) => tlist(prefix, lang));
  eleventyConfig.addFilter("districtSlug", districtSlug);
  eleventyConfig.addFilter("districtLabel", (v, lang) => districtLabel(v, lang));
  eleventyConfig.addFilter("districtPoints", (d, lang) => districtPoints(d, lang));
  eleventyConfig.addFilter("districtStats", districtStats);
  eleventyConfig.addFilter("cityIndex", (d, lang) => cityIndex(d, lang));
  // a new build (or a --serve rebuild) logs the city list problems again
  eleventyConfig.on("eleventy.before", () => cityWarned.clear());
  // data-search text for the /resources/ filter: {{ r | resourceSearch(L, heading) }}, {{ f | officeSearch(districts, L) }}
  eleventyConfig.addFilter("resourceSearch", (r, lang, extra) => resourceSearch(r, lang, extra));
  eleventyConfig.addFilter("officeSearch", (f, districts, lang) => officeSearch(f, districts, lang));
  eleventyConfig.addFilter("telUs", telUs);
  eleventyConfig.addFilter("mapsSearch", mapsSearch);
  // Does a text key exist? {% if "x.y" | hasText %}
  eleventyConfig.addFilter("hasText", (key) => !!dictionary()[key]);
  // Does a file exist (path relative to the project folder)?
  eleventyConfig.addFilter("fileExists", (p) => !!p && fs.existsSync(path.join(process.cwd(), String(p))));
  eleventyConfig.addGlobalData("heroCredits", () => heroCredits());
}

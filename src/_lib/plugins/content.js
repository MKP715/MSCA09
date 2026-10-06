// Filters and data for the informational pages (About, Policy, Newcomers,
// Resources, Contribute, 404). Loaded automatically by eleventy.config.js.
//
// Volunteers never need to edit this file. Wording lives in
// data/text/content.csv, links in data/resources.csv, offices in
// data/central-offices.csv and questions in data/faq.csv.
import { dictionary, code, lurl, loc } from "../i18n.js";
import fs from "node:fs";
import path from "node:path";
import { readCsv } from "../csv.js";

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
 * Other names people type for a city in the finder, from data/text/content.csv:
 *   content.city_alias.01.city  = the city as written in data/districts.csv (Avalon)
 *   content.city_alias.01.names = other names, separated by ; (Catalina; Catalina Island)
 * The English and Spanish columns are both used, on both pages.
 * Returns Map(lower-case city → [alias, …]).
 */
function cityAliases() {
  const out = new Map();
  const en = tlist("content.city_alias", "en");
  const es = tlist("content.city_alias", "es");
  en.forEach((item, i) => {
    const city = String(item.city || "").trim();
    if (!city) return;
    const names = [item.names, es[i] && es[i].names]
      .flatMap((v) => String(v || "").split(";"))
      .map((v) => v.trim())
      .filter(Boolean);
    const k = city.toLowerCase();
    out.set(k, [...new Set([...(out.get(k) || []), ...names])]);
  });
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
 * City → district index for the "find the office near me" box:
 * [{ city, aliases?: [name], districts: [{ slug, label, url, spanish }] }], built from
 * districts.list[].cities plus the other names in content.city_alias (see cityAliases).
 */
export function cityIndex(districts, lang) {
  const list = (districts && Array.isArray(districts.list) ? districts.list : []).filter(
    (d) => d.slug && !/merged|inactive/i.test(String(d.status || ""))
  );
  const map = new Map();
  for (const d of list) {
    const spanish = /linguistic/i.test(String(d.kind || "")) || /span|esp/i.test(String(d.language || ""));
    const label = loc(d, "name", lang) || d.name || `District ${d.number || ""}`;
    for (const raw of d.cities || []) {
      const city = String(raw || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
      if (!city) continue;
      const k = city.toLowerCase();
      if (!map.has(k)) map.set(k, { city, districts: [] });
      const entry = map.get(k);
      if (!entry.districts.some((x) => x.slug === d.slug))
        entry.districts.push({ slug: d.slug, label, url: lurl(`/districts/${d.slug}/`, lang), spanish });
    }
  }
  for (const [k, names] of cityAliases()) {
    const entry = map.get(k);
    if (entry) entry.aliases = names.filter((n) => !map.has(n.toLowerCase()));
    else console.warn(`[content] city alias "${k}" (content.city_alias in data/text/content.csv) matches no city in data/districts.csv`);
  }
  return [...map.values()].sort((a, b) => a.city.localeCompare(b.city));
}

/** "tel:+17145564555" from "(714) 556-4555". */
export function telUs(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return "tel:" + (digits.length === 10 ? "+1" + digits : "+" + digits);
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
  eleventyConfig.addFilter("telUs", telUs);
  eleventyConfig.addFilter("mapsSearch", mapsSearch);
  // Does a text key exist? {% if "x.y" | hasText %}
  eleventyConfig.addFilter("hasText", (key) => !!dictionary()[key]);
  // Does a file exist (path relative to the project folder)?
  eleventyConfig.addFilter("fileExists", (p) => !!p && fs.existsSync(path.join(process.cwd(), String(p))));
  eleventyConfig.addGlobalData("heroCredits", () => heroCredits());
}

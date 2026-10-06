// Filters for the document library (owner: documents). Loaded automatically by eleventy.config.js.
//
//   {{ doc | docDate(lang) }}          "August 2024" / "agosto de 2024", "May 15, 2022", "2019" or ""
//   {{ doc.size_kb | docSize(lang) }}  "196 KB" / "1.2 MB"
//   {{ doc.language | docLang }}       "en" | "es" | "bi" | ""   (CSS hook for the language badge)
//   {{ doc.language | docLangShort }}  "EN" | "ES" | "EN·ES"
//   {{ doc.meeting_type | docMeeting(lang) }}  "ASC" → "ASC" / "CSA", "Board" → "Board" / "Junta"
//   {{ doc | docTitle(lang) }}         title in the page language (title_es on Spanish pages)
//   {{ docs | docGroupYears }}         [{ year, items }] newest year first, undated last
import { DateTime } from "luxon";
import { iconSvg } from "../shortcodes.js";
import { accentVars } from "../filters.js";
import { code, t, dictionary } from "../i18n.js";

const has = (key) => Object.prototype.hasOwnProperty.call(dictionary(), key);

const TZ = "America/Los_Angeles";

export function docDate(doc, lang) {
  const d = String((doc && doc.date) || "");
  const loc = code(lang) === "es" ? "es-US" : "en-US";
  let m;
  if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const dt = DateTime.fromISO(d, { zone: TZ }).setLocale(loc);
    if (!dt.isValid) return String(doc.year || "");
    // Old indexes store month-level dates as the 1st: show "August 2024" rather than a precise day.
    return m[3] === "01" ? dt.toLocaleString({ month: "long", year: "numeric" }) : dt.toLocaleString(DateTime.DATE_FULL);
  }
  if ((m = d.match(/^(\d{4})-(\d{2})$/))) {
    const dt = DateTime.fromObject({ year: +m[1], month: +m[2], day: 1 }, { zone: TZ }).setLocale(loc);
    return dt.isValid ? dt.toLocaleString({ month: "long", year: "numeric" }) : m[1];
  }
  return doc && doc.year ? String(doc.year) : "";
}

export function docSize(kb, lang) {
  const n = Number(kb) || 0;
  if (!n) return "";
  if (n < 1000) return `${Math.max(1, Math.round(n))} KB`;
  const mb = n / 1024;
  const s = mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
  return `${s} MB`;
}

export function docLang(language) {
  const g = String(language || "").toLowerCase();
  if (!g) return "";
  if (g.startsWith("bil") || (g.includes("eng") && (g.includes("span") || g.includes("esp")))) return "bi";
  if (g.startsWith("span") || g.startsWith("esp") || g === "es") return "es";
  return "en";
}

const LANG_SHORT = { en: "EN", es: "ES", bi: "EN·ES" };

export default function (eleventyConfig) {
  eleventyConfig.addFilter("docDate", (doc, lang) => docDate(doc, lang));
  eleventyConfig.addFilter("docSize", (kb, lang) => docSize(kb, lang));
  eleventyConfig.addFilter("docLang", (language) => docLang(language));
  eleventyConfig.addFilter("docLangShort", (language) => LANG_SHORT[docLang(language)] || "");
  eleventyConfig.addFilter("docLangName", (language, lang) => {
    const k = docLang(language);
    return k ? t({ en: "language.english", es: "language.spanish", bi: "language.bilingual" }[k], lang) : "";
  });
  eleventyConfig.addFilter("docMeeting", (mt, lang) => {
    const m = String(mt || "").trim();
    if (!m) return "";
    const key = "documents.meeting." + m.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return has(key) ? t(key, lang) : m;
  });
  eleventyConfig.addFilter("docTitle", (doc, lang) => {
    if (!doc) return "";
    return code(lang) === "es" && doc.title_es ? doc.title_es : doc.title || doc.title_es || "";
  });
  eleventyConfig.addFilter("docFormat", (fmt, lang) => {
    if (!fmt) return "";
    const key = "documents.format." + fmt;
    return has(key) ? t(key, lang) : String(fmt).toUpperCase();
  });
  eleventyConfig.addFilter("docGroupYears", (docs) => {
    const map = new Map();
    for (const d of docs || []) {
      const y = d && d.year ? String(d.year) : "";
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(d);
    }
    return [...map].sort((a, b) => (b[0] || "0").localeCompare(a[0] || "0")).map(([year, items]) => ({ year, items }));
  });
  // English and Spanish copies of the same document (same shelf, date and title, different language)
  // → one entry: [{ doc, versions: [doc, doc…] }]. On Spanish pages the Spanish copy leads.
  eleventyConfig.addFilter("docPairs", (docs, lang) => {
    const out = [];
    const byKey = new Map();
    const es = code(lang) === "es";
    for (const d of docs || []) {
      if (!d) continue;
      const k = [d.category, d.date || d.year, String(d.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()].join("|");
      const hit = byKey.get(k);
      const lk = docLang(d.language);
      if (hit && lk && !hit.versions.some((v) => docLang(v.language) === lk)) {
        hit.versions.push(d);
        continue;
      }
      const entry = { doc: d, versions: [d] };
      byKey.set(k, entry);
      out.push(entry);
    }
    for (const e of out) {
      const order = { en: es ? 2 : 0, es: es ? 0 : 2, bi: 1, "": 3 };
      e.versions.sort((a, b) => order[docLang(a.language)] - order[docLang(b.language)]);
      e.doc = e.versions[0];
    }
    return out;
  });

  // An inline SVG sprite of Lucide icons, so long lists can reference one copy: <use href="#doc-ico-<name>">.
  eleventyConfig.addFilter("docIconSprite", (names) => {
    const syms = [...new Set((names || []).filter(Boolean))].map((n) =>
      iconSvg(n, "")
        .replace(/<svg[^>]*>/, `<symbol id="doc-ico-${n}" viewBox="0 0 24 24">`)
        .replace(/<\/svg>\s*$/, "</symbol>")
    );
    return `<svg width="0" height="0" class="absolute" aria-hidden="true" focusable="false">${syms.join("")}</svg>`;
  });

  // Number with thousands separators in the page language (es-US uses the same separators as en-US).
  eleventyConfig.addFilter("docNum", (n, lang) => Number(n || 0).toLocaleString(code(lang) === "es" ? "es-US" : "en-US"));

  // Everything assets/js/documents.js needs, in the page's language (printed into the page as JSON).
  eleventyConfig.addFilter("docClientConfig", (documents, lang) => clientConfig(documents || {}, lang));
}

// Wording used by the browser script (keys in data/text/documents.csv, without the "documents." prefix).
const CLIENT_STRINGS = [
  "result_one", "result_many", "close_matches", "remove_filter", "show_results", "showing", "count_one", "count_many",
  "undated", "district_n", "hist_aria", "coll_all", "coll_current", "coll_archive", "year_from", "year_to", "year_range",
  "query_chip", "district_short", "archive_tag",
];

function clientConfig(D, lang) {
  const L = code(lang);
  const cats = (D.allCategories || []).map((c, i) => ({
    key: c.key,
    label: L === "es" ? c.label_es : c.label_en,
    label_en: c.label_en,
    label_es: c.label_es,
    style: accentVars(c.color, i),
    icon: iconSvg(c.icon, "size-5"),
    iconSm: iconSvg(c.icon, "size-4"),
    count: c.count,
  }));
  const f = D.facets || {};
  const langs = ["en", "es", "bi"].map((k) => ({
    key: k,
    short: LANG_SHORT[k],
    label: t({ en: "language.english", es: "language.spanish", bi: "language.bilingual" }[k], lang),
    label_en: t({ en: "language.english", es: "language.spanish", bi: "language.bilingual" }[k], "en"),
    label_es: t({ en: "language.english", es: "language.spanish", bi: "language.bilingual" }[k], "es"),
  }));
  const meetingKeys = ["ASC", "ASA", "Board"];
  const meetings = {};
  const meetingsEs = {};
  for (const m of meetingKeys) {
    const key = "documents.meeting." + m.toLowerCase();
    meetings[m] = has(key) ? t(key, lang) : m;
    meetingsEs[m] = has(key) ? t(key, "es") + " " + t(key, "en") : m;
  }
  const str = {};
  for (const k of CLIENT_STRINGS) str[k] = t("documents." + k, lang);
  const formats = (f.formats || []).map((x) => ({
    key: x.key,
    label: has("documents.format." + x.key) ? t("documents.format." + x.key, lang) : x.label,
  }));
  return JSON.stringify({
    lang: L,
    locale: L === "es" ? "es-US" : "en-US",
    total: (D.all || []).length,
    cats,
    districts: (f.districts || []).map((d) => ({ slug: d.slug, label: d.label })),
    committees: (f.committees || []).map((c) => ({ slug: c.slug, name: L === "es" ? c.name_es : c.name_en, all: `${c.name_en} ${c.name_es}` })),
    formats,
    langs,
    meetings,
    meetingsAll: meetingsEs,
    str,
  }).replace(/</g, "\\u003c");
}

// Template filters shared by every page.
import fs from "node:fs";
import { DateTime } from "luxon";
import markdownIt from "markdown-it";
import { t, loc, lurl, altUrl, code, resetText, missing, dictionary } from "./i18n.js";

export const TZ = "America/Los_Angeles";

const md = markdownIt({ html: false, linkify: true, typographer: true, breaks: true });
// Open external links in a new tab, safely.
const defaultLinkOpen =
  md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet("href") || "";
  if (/^https?:\/\//.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Tailwind colour names a CSV may use in a `color` column. */
export const ACCENTS = [
  "ocean", "iris", "coral", "sun", "sage", "copper", "blush", "lilac", "sea",
  "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "red", "orange",
  "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "slate", "stone",
];
const ACCENT_CYCLE = ["ocean", "coral", "sage", "iris", "copper", "sea", "blush", "sun", "lilac", "indigo", "emerald", "fuchsia", "orange", "teal", "rose", "violet"];

export function toDateTime(value, zone = TZ) {
  if (!value) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone });
  if (typeof value === "number") return DateTime.fromMillis(value, { zone });
  const s = String(value).trim();
  // A plain day, month ("2025-10") or year ("2025") is a Pacific calendar date, not a moment:
  // read it in Pacific time so it never slides back to the previous day/month/year.
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s)) return DateTime.fromISO(s, { zone });
  const dt = DateTime.fromISO(s, { setZone: true });
  return dt.isValid ? dt.setZone(zone) : null;
}

const NBSP = "\u00a0";
/** Clock times in one style everywhere (matches the calendar's labels):
 *  English "7:30 PM", Spanish "7:30 p. m." — with non-breaking spaces so they never wrap. */
function tidyTime(s, lang) {
  let out = String(s).replace(/[\u202f ](?=[AaPp]\.?\s?[Mm]\.?)/g, NBSP);
  if (code(lang) === "es") out = out.replace(/\s?\b([ap])\.?\s?m\.?(?![a-z])/gi, (m, ap) => `${NBSP}${ap.toLowerCase()}.${NBSP}m.`);
  return out;
}

/** "7:00–8:00 PM", "10:00 AM–2:00 PM" / "7:00–8:00 p. m." — the same shape the calendar uses. */
export function timeRange(start, end, lang = "en") {
  const s = toDateTime(start);
  if (!s || !s.isValid) return "";
  const e = end ? toDateTime(end) : null;
  const one = (d, withMer = true) => {
    const hm = `${d.hour % 12 || 12}:${String(d.minute).padStart(2, "0")}`;
    if (!withMer) return hm;
    const pm = d.hour >= 12;
    return code(lang) === "es" ? `${hm}${NBSP}${pm ? "p" : "a"}.${NBSP}m.` : `${hm}${NBSP}${pm ? "PM" : "AM"}`;
  };
  if (!e || !e.isValid || +e <= +s) return one(s);
  const sameHalf = s.hour < 12 === e.hour < 12 && s.toISODate() === e.toISODate();
  return `${one(s, !sameHalf)}–${one(e)}`;
}

const DATE_PRESETS = {
  iso: (d) => d.toISO(),
  ymd: (d) => d.toISODate(),
  // "Sat, Oct 5, 2026" / "sáb, 5 oct 2026"
  date: (d) => d.toLocaleString({ weekday: "short", month: "short", day: "numeric", year: "numeric" }),
  // "Saturday, October 5, 2026"
  long: (d) => d.toLocaleString({ weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  // "October 5, 2026"
  full: (d) => d.toLocaleString(DateTime.DATE_FULL),
  // "Oct 5"
  short: (d) => d.toLocaleString({ month: "short", day: "numeric" }),
  // "7:00 PM" / "19:00"
  time: (d) => d.toLocaleString(DateTime.TIME_SIMPLE),
  month: (d) => d.toLocaleString({ month: "long", year: "numeric" }),
  mon: (d) => d.toLocaleString({ month: "short" }),
  day: (d) => d.toFormat("d"),
  weekday: (d) => d.toLocaleString({ weekday: "long" }),
  wkd: (d) => d.toLocaleString({ weekday: "short" }),
  year: (d) => d.toFormat("yyyy"),
};

export function formatDate(value, preset = "date", lang = "en") {
  const dt = toDateTime(value);
  if (!dt || !dt.isValid) return "";
  // "auto": as precise as the value itself — "2025" → year, "2025-10" → "October 2025", a day → full date.
  if (preset === "auto") {
    const raw = typeof value === "string" ? value.trim() : "";
    preset = /^\d{4}$/.test(raw) ? "year" : /^\d{4}-\d{2}$/.test(raw) ? "month" : "full";
  }
  const d = dt.setLocale(code(lang) === "es" ? "es-US" : "en-US");
  const fn = DATE_PRESETS[preset];
  const out = fn ? fn(d) : d.toFormat(preset);
  return preset === "time" ? tidyTime(out, lang) : out;
}

/** Turn HTML entities back into characters (&amp; → &, &#39; → ', &#x2019; → ’). */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const k = e.toLowerCase();
    return k in ENTITIES ? ENTITIES[k] : m;
  });
}

/** Extract a Google Drive file id from any Drive URL (or return the id as given). */
export function driveId(urlOrId) {
  if (!urlOrId) return "";
  const s = String(urlOrId);
  const m =
    s.match(/\/d\/([A-Za-z0-9_-]{20,})/) ||
    s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) ||
    s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : "";
}

/** An embeddable image URL for a Drive image (flyer). */
export function driveImg(urlOrId, width = 1200) {
  const id = driveId(urlOrId);
  if (!id) return urlOrId || "";
  return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
}

/** The Drive viewer URL for any Drive file. */
export function driveView(urlOrId) {
  const id = driveId(urlOrId);
  return id ? `https://drive.google.com/file/d/${id}/view` : urlOrId || "";
}

export function accentVars(color, fallbackIndex = 0) {
  let c = String(color || "").trim().toLowerCase();
  if (!ACCENTS.includes(c)) c = ACCENT_CYCLE[Math.abs(Number(fallbackIndex) || 0) % ACCENT_CYCLE.length];
  return ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]
    .map((s) => `--a-${s}:var(--color-${c}-${s})`)
    .join(";");
}

export function registerFilters(eleventyConfig) {
  eleventyConfig.on("eleventy.before", () => resetText());
  eleventyConfig.on("eleventy.after", () => {
    // Remembered for scripts/check-site.mjs (kept out of _site so it is never published).
    try {
      fs.mkdirSync(".cache", { recursive: true });
      fs.writeFileSync(".cache/missing-text.json", JSON.stringify([...missing].sort(), null, 1));
    } catch {}
    if (missing.size) {
      console.warn(`[text] ${missing.size} text key(s) used by a page but missing from data/text/*.csv:`);
      for (const k of [...missing].sort()) console.warn(`   - ${k}`);
    }
  });

  // ---- language ----
  eleventyConfig.addFilter("t", (key, lang, vars) => t(key, lang, vars));
  // Optional wording: the text if data/text/*.csv has the key, otherwise "" (no "missing key" warning).
  eleventyConfig.addFilter("tOpt", (key, lang, vars) => (Object.prototype.hasOwnProperty.call(dictionary(), key) ? t(key, lang, vars) : ""));
  eleventyConfig.addFilter("loc", (obj, field, lang) => loc(obj, field, lang));
  eleventyConfig.addFilter("lurl", (url, lang) => lurl(url, lang));
  eleventyConfig.addFilter("altUrl", (url, lang) => altUrl(url, lang));
  eleventyConfig.addFilter("langCode", (lang) => code(lang));

  // ---- text ----
  eleventyConfig.addFilter("md", (s) => (s ? md.render(String(s)) : ""));
  eleventyConfig.addFilter("mdi", (s) => (s ? md.renderInline(String(s)) : ""));
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v ?? null).replace(/</g, "\\u003c"));
  // Plain text for <title> and meta tags: drops tags and turns entities back into characters,
  // so a title that was already escaped once ("Hospitals &amp; Institutions") is escaped only once on output.
  eleventyConfig.addFilter("strip", (s) => decodeEntities(String(s || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim());
  eleventyConfig.addFilter("truncate", (s, n = 160) => {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
  });
  // 'Britton "Britt" H.' → "BH": nicknames in quotes or brackets and stray punctuation are skipped.
  eleventyConfig.addFilter("initials", (s) =>
    String(s || "")
      .replace(/"[^"]*"|“[^”]*”|(^|\s)'[^']*'(?=\s|$)|(^|\s)‘[^’]*’(?=\s|$)|\([^)]*\)|\[[^\]]*\]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toLocaleUpperCase())
      .join("")
  );
  eleventyConfig.addFilter("telHref", (s) => "tel:" + String(s || "").replace(/[^\d+]/g, ""));
  eleventyConfig.addFilter("hostname", (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  });
  eleventyConfig.addFilter("ensureHttp", (u) => (!u ? "" : /^https?:\/\//.test(u) ? u : "https://" + u));

  // ---- dates (always Pacific time) ----
  eleventyConfig.addFilter("dt", (value, preset = "date", lang = "en") => formatDate(value, preset, lang));
  eleventyConfig.addFilter("isoDate", (value) => toDateTime(value)?.toISODate() || "");
  // {{ start | timeRange(end, lang) }} → "7:00–8:00 PM" / "7:00–8:00 p. m."
  eleventyConfig.addFilter("timeRange", (start, end, lang = "en") => timeRange(start, end, lang));

  // ---- collections / arrays ----
  eleventyConfig.addFilter("where", (arr, key, val) =>
    (arr || []).filter((x) => (val === undefined ? !!x?.[key] : x?.[key] === val))
  );
  eleventyConfig.addFilter("whereNot", (arr, key, val) => (arr || []).filter((x) => x?.[key] !== val));
  eleventyConfig.addFilter("whereIn", (arr, key, vals) => (arr || []).filter((x) => (vals || []).includes(x?.[key])));
  eleventyConfig.addFilter("sortBy", (arr, key, dir = "asc") => {
    const out = [...(arr || [])].sort((a, b) => {
      const x = a?.[key], y = b?.[key];
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
    });
    return dir === "desc" ? out.reverse() : out;
  });
  eleventyConfig.addFilter("groupBy", (arr, key) => {
    const map = new Map();
    for (const x of arr || []) {
      const k = typeof key === "function" ? key(x) : x?.[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    }
    return [...map].map(([k, items]) => ({ key: k, items }));
  });
  eleventyConfig.addFilter("limit", (arr, n) => (arr || []).slice(0, n));
  eleventyConfig.addFilter("offset", (arr, n) => (arr || []).slice(n));
  eleventyConfig.addFilter("pluck", (arr, key) => (arr || []).map((x) => x?.[key]));
  eleventyConfig.addFilter("unique", (arr) => [...new Set(arr || [])]);
  eleventyConfig.addFilter("compact", (arr) => (arr || []).filter(Boolean));
  eleventyConfig.addFilter("flatten", (arr) => (arr || []).flat());
  eleventyConfig.addFilter("includes", (arr, v) => (arr || []).includes(v));
  eleventyConfig.addFilter("keys", (o) => Object.keys(o || {}));
  eleventyConfig.addFilter("values", (o) => Object.values(o || {}));
  eleventyConfig.addFilter("find", (arr, key, val) => (arr || []).find((x) => x?.[key] === val));

  // ---- colour / Drive ----
  eleventyConfig.addFilter("accent", (color, i) => accentVars(color, i));
  eleventyConfig.addFilter("driveId", driveId);
  eleventyConfig.addFilter("driveImg", (u, w) => driveImg(u, w));
  eleventyConfig.addFilter("driveView", driveView);

  // ---- menu ----
  // Is a nav.csv item (or one of its dropdown entries) the page being viewed? enPath = English path of the page.
  eleventyConfig.addFilter("navActive", (item, enPath = "/") => {
    const hit = (u) => {
      const p = String(u || "").split("#")[0];
      return p && p !== "/" && String(enPath).startsWith(p);
    };
    return !!item && (hit(item.url) || (item.children || []).some((c) => hit(c.url)));
  });

  // ---- urls ----
  // Absolute URL. base may include a path (https://user.github.io/repo), which is kept.
  eleventyConfig.addFilter("absUrl", function (url, base) {
    const u = String(url || "");
    if (/^[a-z]+:\/\//i.test(u)) return u;
    const b = String(base || "").replace(/\/+$/, "");
    if (u.startsWith("/")) return b + u;
    try {
      return new URL(u, b + "/").href;
    } catch {
      return u;
    }
  });
}

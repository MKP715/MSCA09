// Filters and shortcodes used by the home page (src/pages/index.njk and partials/home-*.njk).
import fs from "node:fs";
import path from "node:path";
import Image from "@11ty/eleventy-img";
import sharp from "sharp";
import { DateTime } from "luxon";
import { TZ, toDateTime } from "../filters.js";
import { lurl, loc, code, t } from "../i18n.js";
import heroData from "../../_data/hero.js";

const INCLUDES = path.join(process.cwd(), "src", "_includes");

/* ------------------------------------------------------------------ hero photos
   Every banner photo is published twice:
   - "wide": the whole photo, for tablets and computers (640–2560 px wide; 2560 is
     enough for a 1440 px retina laptop, and a 3840 px file would weigh three times more);
   - "phone": a tall crop (3 wide : 5 high) for screens up to 767 px, cut around the
     position_mobile point of data/hero.csv — or a separate photo named in file_mobile.
     A phone shows the banner as a tall box, so the wide photo would be blown up 2–3×
     and look blurry.
   `sizes` is worked out per photo from its shape, because a photo that fills
   ("covers") a box taller than the photo's own shape is drawn wider than the screen. */
export const HERO_WIDTHS = [640, 960, 1280, 1920, 2560];
export const HERO_PHONE_WIDTHS = [480, 720, 960, 1280, 1600];
const PHONE_RATIO = 0.6; // width ÷ height of the phone crop
const PHONE_MEDIA = "(max-width: 767px)";
const WIDE_MEDIA = "(min-width: 768px)";
// Typical banner heights (see .home-hero in src/assets/css/pages/home.css).
const HERO_H = { phone: 44, tablet: 49 }; // rem
const DESKTOP_H = "clamp(46rem, 76vh, 56rem)";

const imgOptions = (eleventyConfig, widths) => ({
  widths: [...new Set(widths)],
  formats: ["avif", "webp", "jpeg"],
  outputDir: path.join(eleventyConfig.directories?.output || "_site", "assets/img/gen/"),
  urlPath: "/assets/img/gen/",
  sharpJpegOptions: { quality: 78, progressive: true },
  sharpWebpOptions: { quality: 76 },
  sharpAvifOptions: { quality: 55 },
});

/** "40% 50%" → 0.4 (the horizontal part of a CSS object-position). */
const posX = (pos) => {
  const m = String(pos || "").match(/(-?\d+(?:\.\d+)?)%/);
  return m ? Math.min(1, Math.max(0, Number(m[1]) / 100)) : 0.5;
};
const round = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const heroCache = new Map();

/**
 * Both versions of one banner photo: { wide, phone, aspect, phoneAspect, sizesWide, sizesPhone }.
 * `slide` is a row from src/_data/hero.js (or just its `src`).
 */
function heroSet(eleventyConfig, slide) {
  const s = typeof slide === "string" ? { src: slide } : slide || {};
  if (!s.src || !fs.existsSync(s.src)) return Promise.resolve(null);
  const mobileSrc = s.file_mobile ? path.join("src", "assets", "img", "hero", s.file_mobile) : "";
  const stamp = (f) => (f && fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  const key = [s.src, stamp(s.src), mobileSrc, stamp(mobileSrc), s.posMobile || ""].join("|");
  if (heroCache.has(key)) return heroCache.get(key);
  const job = (async () => {
    const meta = await sharp(s.src).metadata();
    const W = meta.width, H = meta.height;
    const aspect = W / H;
    const wide = await Image(s.src, imgOptions(eleventyConfig, HERO_WIDTHS));
    let phone = null;
    let phoneAspect = aspect;
    if (mobileSrc && fs.existsSync(mobileSrc)) {
      const m = await sharp(mobileSrc).metadata();
      phoneAspect = m.width / m.height;
      phone = await Image(mobileSrc, imgOptions(eleventyConfig, HERO_PHONE_WIDTHS));
    } else if (aspect > PHONE_RATIO * 1.25) {
      const cw = Math.round(H * PHONE_RATIO);
      const left = Math.round((W - cw) * posX(s.posMobile));
      const buf = await sharp(s.src)
        .extract({ left, top: 0, width: cw, height: H })
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
        .toBuffer();
      phoneAspect = cw / H;
      phone = await Image(buf, imgOptions(eleventyConfig, HERO_PHONE_WIDTHS));
    }
    // Drawn width = the larger of the screen width and (banner height × photo shape).
    const sizesPhone = `max(100vw, ${round(HERO_H.phone * phoneAspect)}rem)`;
    const sizesWide = [
      ...(phone ? [] : [`${PHONE_MEDIA} ${sizesPhone}`]),
      `(max-width: 1023px) max(100vw, ${round(HERO_H.tablet * aspect)}rem)`,
      `max(100vw, calc(${DESKTOP_H} * ${round(aspect)}))`,
    ].join(", ");
    return { wide, phone, aspect, phoneAspect, sizesWide, sizesPhone };
  })();
  heroCache.set(key, job);
  return job;
}

const srcsetOf = (list, prefix = "") => list.map((m) => `${prefix}${m.url} ${m.width}w`).join(", ");
const pick = (list, w) => list.find((m) => m.width >= w) || list[list.length - 1];

/** <picture> for one banner photo: a tall crop for phones, the whole photo above. */
function heroPictureHtml(set, { alt = "", cls = "", loading = "lazy" } = {}) {
  const { wide, phone } = set;
  const out = ["<picture>"];
  if (phone) {
    for (const fmt of ["avif", "webp", "jpeg"]) {
      const list = phone[fmt];
      if (!list || !list.length) continue;
      const big = list[list.length - 1];
      out.push(`<source type="${list[0].sourceType}" media="${PHONE_MEDIA}" srcset="${srcsetOf(list)}" sizes="${set.sizesPhone}" width="${big.width}" height="${big.height}">`);
    }
  }
  for (const fmt of ["avif", "webp"]) {
    const list = wide[fmt];
    if (!list || !list.length) continue;
    out.push(`<source type="${list[0].sourceType}" srcset="${srcsetOf(list)}" sizes="${set.sizesWide}">`);
  }
  const jpg = wide.jpeg || wide.webp || [];
  const fallback = pick(jpg, 1280);
  const eager = loading === "eager";
  out.push(
    `<img src="${fallback.url}" srcset="${srcsetOf(jpg)}" sizes="${set.sizesWide}" width="${fallback.width}" height="${fallback.height}"` +
      ` alt="${esc(alt)}" class="${esc(cls)}" loading="${eager ? "eager" : "lazy"}" decoding="${eager ? "sync" : "async"}"${eager ? ' fetchpriority="high"' : ""}>`
  );
  out.push("</picture>");
  return out.join("");
}

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export default function (eleventyConfig) {
  /** Does a template exist in src/_includes? Lets the home page use another part's macros only once they exist. */
  eleventyConfig.addFilter("homeIncludeExists", (rel) => {
    try {
      return fs.existsSync(path.join(INCLUDES, String(rel || "")));
    } catch {
      return false;
    }
  });

  /** Occurrences that start within `days` days of `fromIso` (the build time). */
  eleventyConfig.addFilter("homeWithinDays", (items, days = 7, fromIso) => {
    const from = toDateTime(fromIso) || DateTime.now().setZone(TZ);
    const until = from.plus({ days: Number(days) || 7 }).toMillis();
    return (items || []).filter((o) => {
      const t = toDateTime(o && o.start);
      return t && t.toMillis() < until;
    });
  });

  /** Items that have not ended yet at `fromIso` (the build time). */
  eleventyConfig.addFilter("homeFuture", (items, fromIso) => {
    const from = (toDateTime(fromIso) || DateTime.now().setZone(TZ)).toMillis();
    return (items || []).filter((o) => {
      const t = toDateTime(o && (o.end || o.start));
      return t && t.toMillis() >= from;
    });
  });

  /** How many meetings (types marked is_meeting) happen in the build's calendar month. */
  eleventyConfig.addFilter("homeMonthCount", (occurrences, typeMap, fromIso) => {
    const from = toDateTime(fromIso) || DateTime.now().setZone(TZ);
    const ym = from.toFormat("yyyy-LL");
    const isMeeting = (o) => {
      const t = typeMap && typeMap[o.type];
      return t ? !!t.is_meeting : !!o.recurring;
    };
    return (occurrences || []).filter((o) => {
      const d = o && (o.date || (toDateTime(o.start) || { toISODate: () => "" }).toISODate());
      return d && d.startsWith(ym) && isMeeting(o);
    }).length;
  });

  /**
   * Compact index for the "find your district" box (expanded by homeCitySearch in home.js):
   *   { p: "/es" or "", d: { slug: [label, number, "en"|"es", colour] }, c: [[city, slug], …] }
   * Spanish readers see the Spanish-speaking district first when a city has both.
   */
  eleventyConfig.addFilter("homeCityIndex", (cities, bySlug, lang) => {
    const es = code(lang) === "es";
    const d = {};
    const rows = [];
    for (const c of cities || []) {
      if (!c || !c.city || !c.slug) continue;
      if (!d[c.slug]) {
        const x = (bySlug && bySlug[c.slug]) || {};
        const linguistic = x.kind === "linguistic" || /span|espa/i.test(x.language || "");
        const num = (es && x.number_es) || x.number || String(c.slug).replace(/^d/, "").split("-").map((n) => String(Number(n) || n)).join(" & ");
        d[c.slug] = [loc(x, "name", lang) || c.label || c.slug, num, linguistic ? "es" : "en", x.color || ""];
      }
      rows.push([c.city, c.slug]);
    }
    const first = es ? "es" : "en";
    rows.sort((a, b) => fold(a[0]).localeCompare(fold(b[0])) || (d[a[1]][2] === d[b[1]][2] ? 0 : d[a[1]][2] === first ? -1 : 1));
    return { p: es ? "/es" : "", d, c: rows };
  });

  /** Map points with links into the page's language. */
  eleventyConfig.addFilter("homeLocalizePoints", (points, lang) =>
    (points || []).map((p) => ({ ...p, url: p && p.url ? lurl(p.url, lang) : p && p.url }))
  );

  /** Offices in the reader's language first, then the CSV order. */
  eleventyConfig.addFilter("homeOfficeOrder", (offices, lang) => {
    const es = code(lang) === "es";
    return [...(offices || [])].sort((a, b) => (a.spanish === b.spanish ? a.sort - b.sort : a.spanish === es ? -1 : 1));
  });

  /** Total items in the groups whose key is listed, e.g. committees.groups | homeGroupCount(["standing", "school"]). */
  eleventyConfig.addFilter("homeGroupCount", (groups, keys) =>
    (groups || []).filter((g) => g && (keys || []).includes(g.key)).reduce((n, g) => n + (g.items || []).length, 0)
  );

  /**
   * Every host district of a calendar occurrence, as [{ slug, name, url }] in the page's
   * language. Uses occ.districts (all hosts), else occ.district, else the series' hosts.
   * Unknown slugs get "District N" (home.next.district).
   */
  eleventyConfig.addFilter("homeHosts", (occ, calendar, districts, lang) => {
    if (!occ) return [];
    let slugs = Array.isArray(occ.districts) && occ.districts.length ? occ.districts : occ.district ? [occ.district] : [];
    const series = calendar && calendar.bySlug && occ.slug ? calendar.bySlug[occ.slug] : null;
    if (series && Array.isArray(series.hosts) && series.hosts.length > slugs.length) slugs = series.hosts;
    return [...new Set(slugs.filter(Boolean))].map((slug) => {
      const d = districts && districts.bySlug ? districts.bySlug[slug] : null;
      const n = String(slug).replace(/^d/i, "").split("-").map((x) => String(Number(x) || x)).join(" & ");
      return {
        slug,
        name: (d && loc(d, "name", lang)) || t("home.next.district", lang, { n }),
        url: d ? lurl(`/districts/${slug}/`, lang) : "",
      };
    });
  });

  /**
   * The first occurrence of each series only, so a meeting that repeats every two weeks
   * shows once in the events carousel instead of filling it.
   */
  eleventyConfig.addFilter("homeOncePerSeries", (items) => {
    const seen = new Set();
    return (items || []).filter((o) => {
      const k = (o && (o.slug || o.uid)) || "";
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

  /** Number of whole years since a year (e.g. 1958 → 68 in 2026). */
  eleventyConfig.addFilter("homeYearsSince", (year, buildYear) => {
    const y = Number(year), b = Number(buildYear) || new Date().getFullYear();
    return Number.isFinite(y) && y > 0 ? Math.max(0, b - y) : 0;
  });

  /** Milliseconds since 1970 for an ISO date (for small browser-side comparisons). */
  eleventyConfig.addFilter("homeMs", (iso) => {
    const t = toDateTime(iso);
    return t ? t.toMillis() : 0;
  });

  /**
   * One banner photo as a <picture> (tall crop on phones, whole photo above):
   *   {% homeHeroPicture slide, "alt text", "class", "eager" | "lazy" %}
   */
  eleventyConfig.addAsyncShortcode("homeHeroPicture", async (slide, alt = "", cls = "", loading = "lazy") => {
    const set = await heroSet(eleventyConfig, slide);
    return set ? heroPictureHtml(set, { alt, cls, loading }) : "";
  });

  /**
   * <link rel="preload"> for the first banner photo (one for phones, one for wider
   * screens), so the browser fetches the biggest image on the page straight away.
   * Takes the photo's `src` (src/assets/img/hero/…) or its row from src/_data/hero.js and
   * uses the same files, widths and sizes as homeHeroPicture, so the URLs match.
   * HtmlBasePlugin does not rewrite imagesrcset, so the path prefix is added here.
   */
  eleventyConfig.addAsyncShortcode("homeHeroPreload", async (slide) => {
    let s = slide;
    if (typeof slide === "string") s = (heroData().slides || []).find((x) => x.src === slide) || { src: slide };
    const set = await heroSet(eleventyConfig, s);
    if (!set) return "";
    const prefix = (process.env.ELEVENTY_PATH_PREFIX || "/").replace(/\/?$/, "/").replace(/\/$/, "");
    const link = (meta, sizes, media) => {
      const list = (meta && (meta.avif || meta.webp || meta.jpeg)) || [];
      if (!list.length) return "";
      return `<link rel="preload" as="image" type="${list[0].sourceType}"${media ? ` media="${media}"` : ""} imagesrcset="${srcsetOf(list, prefix)}" imagesizes="${sizes}" fetchpriority="high">`;
    };
    if (!set.phone) return link(set.wide, set.sizesWide, "");
    return link(set.phone, set.sizesPhone, PHONE_MEDIA) + "\n" + link(set.wide, set.sizesWide, WIDE_MEDIA);
  });
}

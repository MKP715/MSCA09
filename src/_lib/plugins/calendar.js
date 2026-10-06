// Calendar plugin: files and template helpers for the calendar pages and event macros.
//  - copies the FullCalendar Spanish locale. The whole-calendar file /calendar.ics is NOT a copy of the
//    Google feed: src/pages/calendar-ics.11ty.js builds it from the cleaned entries (no maintainer lines,
//    no text under "--" for meetings, no held flyers).
//  - filters: calGoogle / calOutlook (add-to-calendar links), calIcs (iCalendar text),
//             calTitle / calTypeLabel / calLoc (English or Spanish field of an entry),
//             calNotes (the Note / Nota lines for a language), calJsonLd (schema.org Event),
//             calConfig (settings for the /calendar/ page script), calUid (unique ids), calHost (hostname)
import { readCsv } from "../csv.js";
import { t, code } from "../i18n.js";
import { iconSvg } from "../shortcodes.js";
import { googleAddUrl, outlookAddUrl, seriesToIcs } from "../calendar.js";

// strings the calendar page's script needs (data/text/calendar.csv, keys "calendar.js.<name>")
const JS_KEYS = [
  "online", "all_day", "upcoming", "today", "tomorrow", "no_results", "cancelled", "postponed", "meeting_id", "passcode",
  "format_in_person", "format_hybrid", "format_online", "lang_en", "lang_es", "lang_bi",
  "tod_morning", "tod_afternoon", "tod_evening", "tod_allday", "has_flyer", "has_zoom", "n_categories", "no_categories",
  "n_events", "one_event", "no_events", "nav_hint", "close", "go_agenda",
];

function siteUrl() {
  const row = readCsv("settings.csv").find((r) => r.key === "site_url");
  return (process.env.SITE_URL || (row && row.value) || "https://msca09aa.org").replace(/\/$/, "");
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    "node_modules/@fullcalendar/core/locales/es.global.min.js": "assets/vendor/fullcalendar-es.min.js",
  });

  const base = siteUrl();
  eleventyConfig.addFilter("calGoogle", (series, occ, lang) => (series ? googleAddUrl(series, occ || null, lang, base) : ""));
  eleventyConfig.addFilter("calOutlook", (series, occ, lang) => (series ? outlookAddUrl(series, occ || null, lang, base) : ""));
  eleventyConfig.addFilter("calIcs", (series, stamp, instances) => (series ? seriesToIcs(series, { siteUrl: base, stamp, instances: instances || [] }) : ""));

  // The Note lines of a Series for a page language: [{ text, lang }]. Spanish pages show the Nota: lines;
  // without them, `override` (e.g. a district's meeting_note_es) or else the English notes marked lang="en".
  //   {% for n in series | calNotes(lang, overrideTextOrList) %}<p {% if n.lang != lang.code %}lang="{{ n.lang }}"{% endif %}>{{ n.text }}</p>{% endfor %}
  eleventyConfig.addFilter("calNotes", (s, lang, override) => {
    if (!s) return [];
    const L = code(lang);
    const en = s.notes_en || s.notes || [];
    if (L !== "es") return en.map((text) => ({ text, lang: "en" }));
    if ((s.notes_es || []).length) return s.notes_es.map((text) => ({ text, lang: "es" }));
    const ov = (Array.isArray(override) ? override : [override]).map((x) => String(x || "").trim()).filter(Boolean);
    if (ov.length) return ov.map((text) => ({ text, lang: "es" }));
    return en.map((text) => ({ text, lang: "en" }));
  });

  // schema.org Events (JSON-LD) for the coming dates of a Series (up to 4; none once it has ended).
  // Online-only events point to the event page, never to the Zoom link.
  eleventyConfig.addFilter("calJsonLd", (s, lang, description) => {
    if (!s) return [];
    const dates = (s.upcomingDates || []).slice(0, s.recurring ? 4 : 1);
    return dates.map((o) => jsonLd(s, o, lang, description));
  });
  const jsonLd = (s, o, lang, description) => {
    const L = code(lang);
    const pageUrl = `${base}${L === "es" ? "/es" : ""}${s.url}`;
    const fmt = (s.format || "").toLowerCase();
    const mode = fmt.includes("virtual") ? "OnlineEventAttendanceMode" : fmt.includes("hybrid") ? "MixedEventAttendanceMode" : "OfflineEventAttendanceMode";
    const ymd = (iso) => String(iso || "").slice(0, 10);
    const allDay = o ? o.allDay : s.allDay;
    const start = o ? o.start : s.start;
    const end = o ? o.end : s.end;
    const place = s.location && !s.location.tba
      ? { "@type": "Place", name: s.location.name || s.location.city || s.location.raw, address: s.location.address || s.location.raw }
      : null;
    const virtual = { "@type": "VirtualLocation", url: pageUrl };
    const location = mode === "OnlineEventAttendanceMode" ? virtual : mode === "MixedEventAttendanceMode" ? [place, virtual].filter(Boolean) : place;
    const cancelled = (o && o.status === "cancelled") || s.status === "cancelled";
    const desc = String(description || "").trim();
    const out = {
      "@context": "https://schema.org",
      "@type": "Event",
      name: (L === "es" && ((o && o.title_es) || s.title_es)) || (o && o.title) || s.title,
      startDate: allDay ? ymd(start) : start,
      endDate: allDay ? ymd(o ? o.endDate || o.date : s.endDate) : end,
      eventAttendanceMode: `https://schema.org/${mode}`,
      eventStatus: `https://schema.org/${cancelled ? "EventCancelled" : s.status === "postponed" ? "EventPostponed" : "EventScheduled"}`,
      url: pageUrl,
      inLanguage: s.language === "Spanish" ? "es" : s.language === "Bilingual" ? ["en", "es"] : "en",
      organizer: { "@type": "Organization", name: t("site.name", L), url: base },
    };
    if (location && (!Array.isArray(location) || location.length)) out.location = location;
    else if (mode === "OfflineEventAttendanceMode") out.location = { "@type": "Place", name: t("calendar.place_tba", L) };
    if (desc) out.description = desc;
    // flyers on hold (data/flyer-holds.csv) never reach s.flyers
    if (s.flyers && s.flyers.length) out.image = [`https://lh3.googleusercontent.com/d/${s.flyers[0].id}=w1200`];
    return out;
  };

  // A short description for search engines: the first sentence of the public text, then date and place.
  eleventyConfig.addFilter("calMetaDescription", (s, lang) => {
    if (!s) return "";
    const L = code(lang);
    const first = String(s.about_text || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().match(/^.{20,180}?[.!?](?=\s|$)/);
    const when = L === "es" ? s.pattern_es : s.pattern_en; // "Every 2nd Tuesday · 7:00–8:00 PM" or "Sun, Oct 11, 2026 · 9:00 AM–3:00 PM"
    const where = s.location && s.location.city ? s.location.city : s.format === "Virtual" ? "Zoom" : "";
    const typeLabel = L === "es" ? s.typeLabel_es : s.typeLabel_en;
    const lead = first && !s.recurring ? first[0] : "";
    return [lead, [when, where].filter(Boolean).join(" · "), lead ? "" : typeLabel].filter(Boolean).join(" — ");
  });

  // label of a calendar type from an occurrence/series ({ typeLabel_en, typeLabel_es })
  eleventyConfig.addFilter("calTypeLabel", (x, lang) => {
    if (!x) return "";
    const es = (lang && (lang.code || lang)) === "es";
    return (es ? x.typeLabel_es : x.typeLabel_en) || x.typeLabel_en || x.type || "";
  });
  // the localised title of an occurrence/series
  eleventyConfig.addFilter("calTitle", (x, lang) => {
    if (!x) return "";
    const es = (lang && (lang.code || lang)) === "es";
    return (es && x.title_es) || x.title || "";
  });
  // localised field: x.<field>_en / x.<field>_es
  eleventyConfig.addFilter("calLoc", (x, field, lang) => {
    if (!x) return "";
    const es = (lang && (lang.code || lang)) === "es";
    return (es ? x[`${field}_es`] : x[`${field}_en`]) || x[`${field}_en`] || x[field] || "";
  });
  // configuration for the /calendar/ page script (lang, strings, type icons, filter labels)
  eleventyConfig.addFilter("calConfig", (cal, lang) => {
    const L = code(lang);
    const c = cal || {};
    const i18n = Object.fromEntries(JS_KEYS.map((k) => [k, t(`calendar.js.${k}`, L)]));
    const icons = Object.fromEntries((c.types || []).map((x) => [x.key, iconSvg(x.icon, "size-3.5 shrink-0")]));
    const dows = [0, 1, 2, 3, 4, 5, 6].map((d) => t(`calendar.dow.${d}`, L));
    const districts = (c.districts || []).map((d) => ({ slug: d.slug, label: L === "es" ? d.label_es : d.label_en }));
    const cmts = [
      ...(c.committees || []).map((x) => ({ value: `c:${x.slug}`, label: L === "es" ? x.name_es : x.name_en })),
      ...(c.topics || []).map((x) => ({ value: `t:${x.slug}`, label: t(`calendar.topic.${x.slug}`, L) })),
    ];
    return { lang: L, locale: L === "es" ? "es-US" : "en-US", json: c.jsonUrl || "/assets/data/events.json", i18n, icons, dows, districts, cmts };
  });

  // unique ids for lists on one page (data-empty targets)
  let n = 0;
  eleventyConfig.addFilter("calUid", (prefix) => `${prefix || "cal"}-${++n}`);
  // "zoom.us" from a URL
  eleventyConfig.addFilter("calHost", (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u || "";
    }
  });
}

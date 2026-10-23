// /calendar.ics (English) and /calendar-es.ics (Spanish titles, links to /es/ pages): the whole Area
// calendar as one file to download or import.
//
// Built from the cleaned calendar entries — NOT a copy of the Google feed. Each entry carries only what
// its page shows: title, time, place, Zoom, Note/Nota lines, the public text of one-time events
// (without "Source:" lines) and a link back to the site. Maintainer lines, the "MSCA09|Type|Format"
// header, text under "--" of repeating meetings and flyers on hold (data/flyer-holds.csv) never get in.
// People who want live updates subscribe to the Google feed itself (the "Subscribe" buttons).
import { calendarToIcs } from "../_lib/calendar.js";
import { t } from "../_lib/i18n.js";

export const data = {
  pagination: { data: "langs", size: 1, alias: "icsLang", addAllPagesToCollections: false },
  permalink: (d) => (d.icsLang.code === "es" ? "/calendar-es.ics" : "/calendar.ics"),
  eleventyExcludeFromCollections: true,
  layout: false,
};

export function render(d) {
  const c = d.calendar || {};
  const L = d.icsLang.code;
  const base = String((d.site && d.site.url) || "https://msca09aa.org").replace(/\/$/, "");
  return calendarToIcs(c.series || [], {
    name: `MSCA09 – ${t("calendar.title", L)}`,
    description: t("calendar.ics_description", L),
    siteUrl: base,
    stamp: c.generated,
    lang: L,
    instancesBySlug: c.instancesBySlug || {},
  });
}

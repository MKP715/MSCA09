// Search-result titles (<title>, og:title) of pages whose heading is only a name. Shared by the page filters and by
// the calendar data (src/_data/calendar.js): a calendar entry named exactly like one of these titles gets its pattern
// added to its own title, so an event page and a hub page never share a title in search results.
import { t, loc, code } from "./i18n.js";

// Longer titles are cut off in search results: past this, a committee's name stands without its category.
const FIT = 65;

/**
 * A committee page, from a data/committees.csv row or a src/_data/committees.js item:
 *  - a standing committee whose name does not say "Committee" gets it: "Archives Committee" / "Comité de Archivos
 *    Históricos" (committees.meta_title.standing);
 *  - a service event gets its kind, when that still fits: "FORO – Area service event" (committees.meta_title.event);
 *  - then the short form people search for, when the name leaves it out (short_en / short_es):
 *    "Public Information Committee (PI)", "Comité de Información Pública (IP)".
 */
export function committeeMetaTitle(c, lang) {
  if (!c) return "";
  const L = code(lang);
  const name = String(loc(c, "name", L) || c.slug || "").trim();
  const short = String(loc(c, "short", L) || "").trim();
  const category = String(c.category || "standing").trim().toLowerCase();
  let title = name;
  if (category === "standing" && !/\b(committee|comit[eé])/i.test(name)) title = t("committees.meta_title.standing", L, { name });
  else if (category === "service-event") {
    const withKind = t("committees.meta_title.event", L, { name });
    if (withKind.length <= FIT) title = withKind;
  }
  if (short && !title.includes(short)) title = `${title} (${short})`;
  return title;
}

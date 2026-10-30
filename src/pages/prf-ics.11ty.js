// /service/prf-2028/prf-2028.ics — the 2028 Pacific Regional Forum as one calendar entry, for "Add to calendar →
// Apple / Outlook (.ics)" on the Forum pages. Dates and hotel: data/prf/forum.csv; wording: data/text/prf.csv.
import { DateTime } from "luxon";
import { t } from "../_lib/i18n.js";

export const data = {
  permalink: "/service/prf-2028/prf-2028.ics",
  eleventyExcludeFromCollections: true,
  layout: false,
};

// iCalendar text: escape \ ; , and line breaks, then fold lines at 75 octets
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > 74) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function render(d) {
  const P = d.prf;
  const S = P.set;
  const base = String((d.site && d.site.url) || "https://msca09aa.org").replace(/\/$/, "");
  const utc = (iso) => DateTime.fromISO(iso, { setZone: true }).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const url = base + P.base;
  const place = [S.venue_name, S.venue_street, `${S.venue_city} ${S.venue_zip}`.trim()].filter(Boolean).join(", ");
  // DTSTAMP: the build day (midnight Pacific), not the moment, so builds on the same day give the same file (deploy.yml
  // does not publish a scheduled build that changed nothing)
  const day = (d.site && d.site.build && d.site.build.date) || DateTime.now().setZone("America/Los_Angeles").toISODate();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mid-Southern California Area 09//PRF 2028//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:prf-2028@msca09aa.org",
    `DTSTAMP:${utc(DateTime.fromISO(day, { zone: "America/Los_Angeles" }).toISO())}`,
    `DTSTART:${utc(P.start)}`,
    `DTEND:${utc(P.end)}`,
    `SUMMARY:${esc(t("prf.cal.title", "en"))}`,
    `LOCATION:${esc(place)}`,
    `DESCRIPTION:${esc(t("prf.cal.details", "en", { url }) + "\n\n" + t("prf.cal.details", "es", { url: base + "/es" + P.base }))}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

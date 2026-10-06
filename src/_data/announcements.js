// Announcements shown on the home page, from data/announcements.csv.
//
// Columns: start, end, pin, color, icon, title_en, title_es, body_en, body_es, url,
//          link_label_en, link_label_es, notes
//  - start / end (YYYY-MM-DD): the announcement shows from `start` until the end of `end`
//    (Pacific time). Past ones disappear by themselves — at the next build and, in the
//    visitor's browser, the moment `end` is over.
//  - pin = yes puts it first and highlights it
//  - color: ocean, iris, coral, sun, sage, copper, blush, lilac, sea (or a Tailwind colour name)
//  - icon: a name from https://lucide.dev/icons
//  - body: a sentence or two; **bold** and [links](https://…) work
//  - url: where the button goes (a page of this site like /calendar/, or a full https:// address)
//  - notes: for the people who edit the file (where the information came from); never shown
//
// Returns the live announcements, pinned first, then the ones ending soonest.
import { DateTime } from "luxon";
import { readCsv, yes, isLive } from "../_lib/csv.js";
import { TZ } from "../_lib/filters.js";

const endOfDay = (ymd) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return "";
  const dt = DateTime.fromISO(ymd, { zone: TZ }).endOf("day");
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : "";
};

export default function () {
  // isLive compares against today's date in UTC; use the Pacific date instead.
  const today = new Date(DateTime.now().setZone(TZ).toISODate() + "T12:00:00Z");
  return readCsv("announcements.csv")
    .filter((r) => r.title_en || r.title_es)
    .filter((r) => isLive(r, today))
    .map((r) => ({
      ...r,
      pin: yes(r.pin),
      external: /^https?:\/\//i.test(r.url || ""),
      hideAfter: endOfDay(r.end),
    }))
    .sort((a, b) => {
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      const ea = a.end || "9999-12-31";
      const eb = b.end || "9999-12-31";
      if (ea !== eb) return ea < eb ? -1 : 1;
      return (b.start || "").localeCompare(a.start || "");
    });
}

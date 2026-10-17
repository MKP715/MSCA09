// Announcements shown on the home page, from data/announcements.csv.
//
// Columns: start, end, event_date, pin, color, icon, title_en, title_es, body_en, body_es, url,
//          link_label_en, link_label_es, notes
//  - start / end (YYYY-MM-DD): the announcement shows from `start` until the end of `end`
//    (Pacific time). Past ones disappear by themselves — at the next build and, in the
//    visitor's browser, the moment `end` is over.
//  - event_date (YYYY-MM-DD): the day of the event (or the deadline) the announcement is about —
//    the home page lists announcements in event order, soonest first; general notices without
//    an event_date come after the dated ones
//  - pin = yes highlights it (it keeps its place in the event order)
//  - color: ocean, iris, coral, sun, sage, copper, blush, lilac, sea (or a Tailwind colour name)
//  - icon: a name from https://lucide.dev/icons
//  - body: a sentence or two; **bold** and [links](https://…) work
//  - url: where the button goes (a page of this site like /calendar/, or a full https:// address)
//  - notes: for the people who edit the file (where the information came from); never shown
//
// Returns the live announcements in event order (event_date, soonest first), then the undated notices
// (ending soonest first).
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
      const da = /^\d{4}-\d{2}-\d{2}$/.test(a.event_date || "") ? a.event_date : "9999-12-31";
      const db = /^\d{4}-\d{2}-\d{2}$/.test(b.event_date || "") ? b.event_date : "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      if (a.pin !== b.pin) return a.pin ? -1 : 1;
      const ea = a.end || "9999-12-31";
      const eb = b.end || "9999-12-31";
      if (ea !== eb) return ea < eb ? -1 : 1;
      return (b.start || "").localeCompare(a.start || "");
    });
}

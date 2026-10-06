// General Service Conference, PRAASA, Regional Forums and other A.A.-wide dates, from data/gsc.csv.
// Columns: kind, conference, title_en, title_es, date_start, date_end, place, url, url_label_en, url_label_es,
//          summary_en, summary_es, notes
// A dated row drops off the site the day after its date_end (at build time here, and in the browser via
// data-hide-after), so nothing goes stale between panels.
import { readCsv } from "../_lib/csv.js";
import { DateTime } from "luxon";

const TZ = "America/Los_Angeles";

const KINDS = {
  conference: { icon: "landmark", color: "coral" },
  highlight: { icon: "sparkles", color: "sun" },
  praasa: { icon: "users", color: "iris" },
  forum: { icon: "messages-square", color: "sea" },
  workshop: { icon: "archive", color: "copper" },
  convention: { icon: "globe", color: "ocean" },
  deadline: { icon: "alarm-clock", color: "blush" },
};

export default function () {
  const today = DateTime.now().setZone(TZ).toISODate();
  const rows = readCsv("gsc.csv").map((r) => {
    const kind = String(r.kind || "").toLowerCase().trim();
    const end = r.date_end || r.date_start || "";
    // the moment the item stops being relevant: end of its last day, Pacific time
    const hideAfter = end ? DateTime.fromISO(end, { zone: TZ }).endOf("day").toISO() : "";
    const startIso = r.date_start ? DateTime.fromISO(r.date_start, { zone: TZ }).startOf("day").toISO() : "";
    return {
      ...r,
      kind,
      conference: String(r.conference || "").replace(/\D/g, ""),
      icon: (KINDS[kind] || {}).icon || "calendar",
      color: (KINDS[kind] || {}).color || "ocean",
      hideAfter,
      startIso,
      live: !end || end >= today,
      multiDay: !!(r.date_start && r.date_end && r.date_end !== r.date_start),
    };
  });

  const live = rows.filter((r) => r.live);
  const dated = live
    .filter((r) => r.kind !== "highlight" && r.kind !== "conference")
    .sort((a, b) => (a.date_start || "9999").localeCompare(b.date_start || "9999"));
  const conferences = rows
    .filter((r) => r.kind === "conference")
    .sort((a, b) => Number(a.conference) - Number(b.conference));
  // the most recent Conference that has started (its summary + highlights), and the next one
  const held = conferences.filter((c) => c.date_start && c.date_start <= today);
  const last = held[held.length - 1] || null;
  const next = conferences.find((c) => c.live && (!c.date_start || c.date_start > today)) || null;
  const highlights = (num) => rows.filter((r) => r.kind === "highlight" && r.conference === num);

  return {
    all: rows,
    upcoming: dated,
    conferences,
    last,
    next,
    lastHighlights: last ? highlights(last.conference) : [],
    deadlines: live.filter((r) => r.kind === "deadline"),
    praasa: live.filter((r) => r.kind === "praasa"),
    forums: live.filter((r) => r.kind === "forum"),
  };
}

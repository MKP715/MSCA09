// Zoom meeting recordings (audio only) that committee pages list and play — today the Technology Committee page
// (/committees/technology/#recordings) — from data/recordings.csv, and the meetings they record from
// data/recording-series.csv. scripts/recordings.py fills both from the Area's Drive folder MSCA09AA/Zoom Recordings/;
// a row typed by hand on github.com (a Drive id, committee, series, date, show = yes) works the same.
//
// Columns (recordings.csv): drive_id, committee, series, date, time, part, session, track, duration, size_mb, show,
//   title_en, title_es, path, notes   — show = no keeps a row off the site without deleting it
// Columns (recording-series.csv): key, folder, name_en, name_es, link, sort, notes
//   link = a committee slug (finance) or an address on this site (/service/area-meetings/)
//
// The audio plays in Google Drive's own player: the page opens an iframe of …/file/d/<id>/preview on demand
// (src/assets/js/committees.js, cmRecordings). An <audio> element cannot play Drive files — Drive answers 403 to
// media requests — and a file of about 100 MB or more first shows Drive's "can't scan this file for viruses" page
// with a "Play anyway" button: `big` marks those, so the page can say so.
//
// Shape: { list:[Recording], series:[Series], bySeries, byCommittee: { <slug>: { count, series:[Series + {count}],
//   months:[{ key: "2026-10", first: "2026-10-01", count, items:[Recording] }] } }, stats: { rows, shown, hidden } }
//   Recording = { id, committee, series, seriesItem, date, time, start (ISO, Pacific), part, session, track,
//     seconds, duration (H:MM:SS), iso (PT1H2M3S), minutes, size_mb, big, title_en, title_es, path,
//     previewUrl, viewUrl, downloadUrl }
//   Series = { key, folder, name_en, name_es, link (an address on this site, or ""), linkSlug, sort }
// Months, and the recordings in a month, are newest first; the parts, sessions and interpretation tracks of one
// meeting stay in their own order (Part 1 before Part 2, the meeting's own audio before its interpretation).
import { DateTime } from "luxon";
import { readCsv, num, yes } from "../_lib/csv.js";

const TZ = "America/Los_Angeles";
// Drive's virus-scan limit is about 100 MB; from 90 MB the page says Drive may ask to press "Play anyway".
const BIG_MB = 90;
const DRIVE_ID = /^[A-Za-z0-9_-]{25,60}$/;
const TRACKS = { main: 0, es: 1, en: 2 };

/** "1:30:50" (or "90:50", "50") → seconds, else null. */
function toSeconds(v) {
  const parts = String(v || "").trim().split(":");
  if (!parts[0] || parts.some((p) => !/^\d+$/.test(p)) || parts.length > 3) return null;
  return parts.reduce((s, p) => s * 60 + Number(p), 0);
}

export default function () {
  const committeeSlugs = new Set(readCsv("committees.csv").map((r) => r.slug).filter(Boolean));
  const series = readCsv("recording-series.csv")
    .filter((r) => r.key)
    .map((r) => {
      const link = String(r.link || "").trim();
      const linkSlug = link && !link.startsWith("/") && committeeSlugs.has(link) ? link : "";
      return {
        key: r.key,
        folder: r.folder || "",
        name_en: r.name_en || r.folder || r.key,
        name_es: r.name_es || "",
        link: link.startsWith("/") ? link : linkSlug ? `/committees/${linkSlug}/` : "",
        linkSlug,
        sort: num(r.sort, 999),
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name_en.localeCompare(b.name_en));
  const bySeries = Object.fromEntries(series.map((s) => [s.key, s]));

  const all = readCsv("recordings.csv").filter((r) => r.drive_id && !r.drive_id.startsWith("#"));
  const list = all
    .filter((r) => yes(r.show) && DRIVE_ID.test(r.drive_id) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.committee)
    .map((r) => {
      const id = r.drive_id;
      const time = /^\d{1,2}:\d{2}$/.test(r.time || "") ? r.time.padStart(5, "0") : "";
      const start = DateTime.fromISO(time ? `${r.date}T${time}` : r.date, { zone: TZ });
      const seconds = toSeconds(r.duration);
      const sizeMb = Number.parseFloat(r.size_mb);
      const s = bySeries[r.series] || null;
      const track = String(r.track || "main").toLowerCase();
      return {
        id,
        committee: r.committee,
        series: s ? s.key : "",
        seriesItem: s,
        date: r.date,
        time,
        start: start.isValid ? start.toISO() : r.date,
        part: r.part || "",
        session: r.session || "",
        track: track in TRACKS ? track : "main",
        seconds,
        duration: r.duration || "",
        iso: seconds == null ? "" : `PT${Math.floor(seconds / 3600)}H${Math.floor((seconds % 3600) / 60)}M${seconds % 60}S`,
        minutes: seconds == null ? null : Math.max(1, Math.round(seconds / 60)),
        size_mb: Number.isFinite(sizeMb) ? sizeMb : null,
        big: Number.isFinite(sizeMb) && sizeMb >= BIG_MB,
        // a row's own name wins; otherwise the meeting's name (both languages, so loc() can fall back)
        title_en: r.title_en || (s ? s.name_en : ""),
        title_es: r.title_es || (r.title_en ? "" : s ? s.name_es : ""),
        path: r.path || "",
        previewUrl: `https://drive.google.com/file/d/${id}/preview`,
        viewUrl: `https://drive.google.com/file/d/${id}/view`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`,
      };
    })
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.time.localeCompare(a.time) ||
        num(a.session, 0) - num(b.session, 0) ||
        num(a.part, 0) - num(b.part, 0) ||
        TRACKS[a.track] - TRACKS[b.track],
    );

  const byCommittee = {};
  for (const r of list) {
    const c = (byCommittee[r.committee] ||= { count: 0, series: [], months: [] });
    c.count++;
    const key = r.date.slice(0, 7);
    let m = c.months[c.months.length - 1];
    if (!m || m.key !== key) c.months.push((m = { key, first: `${key}-01`, count: 0, items: [] }));
    m.items.push(r);
    m.count++;
  }
  for (const [slug, c] of Object.entries(byCommittee)) {
    const items = list.filter((r) => r.committee === slug);
    c.series = series.map((s) => ({ ...s, count: items.filter((r) => r.series === s.key).length })).filter((s) => s.count);
  }

  return {
    list,
    series,
    bySeries,
    byCommittee,
    stats: { rows: all.length, shown: list.length, hidden: all.length - list.length },
  };
}

// The 2028 Pacific Regional Forum, hosted by Area 09: the pages under /service/prf-2028/ (overview, about, program,
// volunteer, travel, save the date, FAQ, contact), from data/prf/*.csv. Wording is in data/text/prf.csv.
//
// Shape:
//   { set: { start, end, venue_name, …, email, … }   data/prf/forum.csv, key → value
//     start / end (ISO, Pacific time), startMs / endMs, registrationOpen, base ("/service/prf-2028/"),
//     pages: [{ key, url, icon }]                              the section's pages, in menu order
//     positions: [{ id, icon, open, phases[], title_en, …, duties_en[], duties_es[] }]
//     days: [{ key, date, items: [{ time_en, kind, proposed, title_en, … }], shifts: [] }]   Thursday – Sunday
//     faq: [{ id, cat, q_en, … }], faqCats: ["general", …]
//     areas: [{ num, name_en, …, host }], areaPoints / mapPoints: points for the mapBlock macro (label in English)
//     places: { airport: [], todo: [], map: [] }, timeline: { road: [], forums: [], hosted: [] },
//     cards: { pillars: [], stats: [], … }, links: { forums: [], safety: [], service: [] },
//     qr: { en, es } (SVG of the short address /prf2028/ — /es/prf2028/ — for the printed flyer), short: { en, es } }
import QRCode from "qrcode";
import { DateTime } from "luxon";
import { readCsv, num, yes, list } from "../_lib/csv.js";

const TZ = "America/Los_Angeles";
const PRF_BASE = "/service/prf-2028/";
const PAGES = [
  { key: "overview", path: "", icon: "flag" },
  { key: "about", path: "about/", icon: "info" },
  { key: "program", path: "program/", icon: "calendar-days" },
  { key: "volunteer", path: "volunteer/", icon: "hand-heart" },
  { key: "travel", path: "travel/", icon: "map-pinned" },
  { key: "save", path: "save-the-date/", icon: "calendar-heart" },
  { key: "faq", path: "faq/", icon: "circle-help" },
  { key: "contact", path: "contact/", icon: "mail" },
];
// map pin colours (mapBlock: a palette name)
const PIN = { hotel: "coral", airport: "ocean", sight: "iris", food: "sun", transit: "sage" };

const rows = (file) => readCsv(`prf/${file}`).filter((r) => Object.values(r).some((v) => v && !String(v).startsWith("#")));
const bySort = (a, b) => num(a.sort, 999) - num(b.sort, 999);
const groupBy = (list, key) => list.reduce((m, r) => ((m[r[key]] ||= []).push(r), m), {});
const lines = (v) => String(v || "").split(/\n+/).map((s) => s.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

export default async function () {
  const set = {};
  for (const r of rows("forum.csv")) if (r.key) set[r.key] = r.value || "";

  const start = DateTime.fromISO(set.start || "2028-12-01T18:30:00-08:00", { setZone: true });
  const end = DateTime.fromISO(set.end || "2028-12-03T12:00:00-08:00", { setZone: true });
  const now = DateTime.now().setZone(TZ);

  const positions = rows("positions.csv").filter((r) => r.id).sort(bySort).map((r) => ({
    ...r,
    open: String(r.status || "open").toLowerCase() !== "filled",
    phases: list(r.phase).map((p) => p.toLowerCase()),
    duties_en: lines(r.duties_en),
    duties_es: lines(r.duties_es).length ? lines(r.duties_es) : lines(r.duties_en),
  }));

  // Thursday (early arrivals) to Sunday, from the opening day
  const day0 = start.setZone(TZ).startOf("day").minus({ days: 1 });
  const sched = groupBy(rows("schedule.csv").filter((r) => r.day && r.title_en).map((r) => ({ ...r, day: r.day.toLowerCase(), proposed: yes(r.proposed) })), "day");
  const shifts = groupBy(rows("shifts.csv").filter((r) => r.day && r.task_en).map((r) => ({ ...r, day: r.day.toLowerCase() })), "day");
  const days = ["thu", "fri", "sat", "sun"].map((key, i) => ({
    key,
    date: day0.plus({ days: i }).toISODate(),
    items: (sched[key] || []).sort(bySort),
    shifts: (shifts[key] || []).sort(bySort),
  }));

  // {prf} in an answer = the Forum pages' address in the page's language (the site adds its path prefix to links)
  const faq = rows("faq.csv").filter((r) => r.q_en).sort(bySort).map((r) => ({
    ...r,
    a_en: String(r.a_en || "").replace(/\{prf\}/g, PRF_BASE),
    a_es: String(r.a_es || r.a_en || "").replace(/\{prf\}/g, "/es" + PRF_BASE),
  }));
  const areas = rows("areas.csv").filter((r) => r.num).map((r) => ({ ...r, host: yes(r.host) }));
  const places = groupBy(rows("places.csv").filter((r) => r.list && r.name_en).sort(bySort), "list");
  const timeline = groupBy(rows("timeline.csv").filter((r) => r.list && r.title_en).sort(bySort), "list");
  const cards = groupBy(rows("cards.csv").filter((r) => r.group).sort(bySort), "group");
  const links = groupBy(rows("links.csv").filter((r) => r.group && r.url_en).sort(bySort), "group");

  const venue = { lat: num(set.venue_lat, NaN), lng: num(set.venue_lng, NaN) };
  const mapPoints = [
    { lat: venue.lat, lng: venue.lng, label: set.venue_name, color: PIN.hotel, num: "★", cat: "hotel" },
    ...(places.map || []).filter((p) => p.lat && p.lng).map((p) => ({ lat: num(p.lat), lng: num(p.lng), label: p.name_en, label_es: p.name_es, color: PIN[p.cat] || "ink", num: "•", cat: p.cat })),
  ];
  const areaPoints = areas.filter((a) => a.lat && a.lng).map((a) => ({ lat: num(a.lat), lng: num(a.lng), label: `Area ${a.num} — ${a.name_en}`, url: a.url, color: a.host ? "coral" : "sea", num: String(+a.num) }));

  // the printed flyer's QR codes: the short addresses (forwarding pages from data/redirects.csv)
  const siteUrl = (process.env.SITE_URL || readCsv("settings.csv").find((r) => r.key === "site_url")?.value || "https://msca09aa.org").replace(/\/$/, "");
  const short = { en: `${siteUrl}/prf2028/`, es: `${siteUrl}/es/prf2028/` };
  const qr = {};
  for (const [code, url] of Object.entries(short)) {
    qr[code] = (await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0d2b36", light: "#ffffff" } }))
      .replace("<svg ", `<svg class="prf-qr__svg" role="img" aria-label="QR: ${url}" `);
  }

  return {
    set,
    base: PRF_BASE,
    pages: PAGES.map((p) => ({ ...p, url: PRF_BASE + p.path })),
    start: start.toISO(),
    end: end.toISO(),
    startMs: start.toMillis(),
    // Add to calendar links: Google wants 20281202T023000Z/…, Outlook.com an ISO time
    gcal: `${start.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}/${end.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}`,
    startUtc: start.toUTC().toISO({ suppressMilliseconds: true }),
    endUtc: end.toUTC().toISO({ suppressMilliseconds: true }),
    endMs: end.toMillis(),
    over: now > end,
    registrationOpen: !!set.registration_url,
    positions,
    openCount: positions.filter((p) => p.open).length,
    days,
    faq,
    faqCats: [...new Set(faq.map((f) => f.cat))],
    areas,
    areaPoints,
    mapPoints,
    venue,
    places: { airport: places.airport || [], todo: places.todo || [], map: places.map || [] },
    timeline: { road: timeline.road || [], forums: timeline.forums || [], hosted: timeline.hosted || [] },
    cards,
    links,
    qr,
    short,
  };
}

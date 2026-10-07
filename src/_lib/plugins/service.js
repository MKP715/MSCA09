// Filters for the Area-business pages (/service/…, /about/structure/).
// Everything here is defensive: other parts of the site (calendar, documents, districts)
// may be missing while the site is being built, and the pages must still render.
import { DateTime } from "luxon";

const TZ = "America/Los_Angeles";

// What kind of Area meeting an occurrence is. Colours are palette names; labels live in data/text/service.csv.
export const MEETING_KINDS = {
  asa: { color: "coral", icon: "landmark", votes: true },
  election: { color: "sun", icon: "vote", votes: true },
  shareback: { color: "sage", icon: "mic", votes: true },
  asc: { color: "ocean", icon: "users", votes: false },
  preconf: { color: "iris", icon: "list-checks", votes: false },
  foro: { color: "copper", icon: "messages-square", votes: false },
  servathon: { color: "blush", icon: "hand-helping", votes: false },
  area: { color: "sea", icon: "calendar-days", votes: false },
  conference: { color: "lilac", icon: "building-2", votes: false },
  budget: { color: "sun", icon: "calculator", votes: false },
  orientation: { color: "lilac", icon: "graduation-cap", votes: false },
  other: { color: "slate", icon: "calendar", votes: false },
};

const lc = (s) => String(s || "").toLowerCase();

// The calendar's own classification (Series.areaKind) → our kinds.
const AREA_KIND_MAP = {
  asa: "asa",
  "election-assembly": "election",
  "delegate-shareback": "shareback",
  asc: "asc",
  "pre-conference": "preconf",
  foro: "foro",
  servathon: "servathon",
  "area-meeting": "area",
  "conference-cycle": "conference",
  budget: "budget",
  orientation: "orientation",
};

export function meetingKind(occ, series) {
  if (!occ) return "other";
  const type = lc(occ.type);
  const t = lc([occ.title, occ.title_es, occ.summary].filter(Boolean).join(" "));
  // a special meeting named in the title wins over the calendar's generic ASC/ASA kind
  if (/pre-?\s?conf|preconf|mock conference|conferencia simulada/.test(t) && type !== "conference") return "preconf";
  const ak = (series && series.areaKind) || occ.areaKind;
  if (ak && AREA_KIND_MAP[ak]) return AREA_KIND_MAP[ak];
  if (type === "servathon" || /servath|servat[oó]n/.test(t)) return "servathon";
  if (type === "foro" || /\bforo\b/.test(t)) return "foro";
  if (/pre-?\s?conf|preconf|mock conference|conferencia simulada/.test(t)) return "preconf";
  if (/share\s?back|report[- ]back|compartimiento/.test(t)) return "shareback";
  if (/election|elecci[oó]n/.test(t) && (type === "assembly" || /assembl|asamblea/.test(t))) return "election";
  if (type === "assembly" || /assembl|asamblea|\basa\b/.test(t)) return "asa";
  if (type === "area committee" || /\basc\b|\bcsa\b|area service committee|comit[eé] de servicio/.test(t)) return "asc";
  if (type === "area") return "area";
  if (type === "conference") return "conference";
  return "other";
}

/** "d01-03" → "1 & 3"; "d05" → "5". */
export function districtNumber(slug) {
  const m = String(slug || "").match(/^d(\d+(?:-\d+)*)$/i);
  if (!m) return "";
  return m[1]
    .split("-")
    .map((n) => String(Number(n)))
    .join(" & ");
}

function toDT(v) {
  if (!v) return null;
  const s = String(v);
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? DateTime.fromISO(s, { zone: TZ }) : DateTime.fromISO(s, { setZone: true }).setZone(TZ);
  return dt.isValid ? dt : null;
}

export default function (eleventyConfig) {
  eleventyConfig.addFilter("svcKind", (occ, series) => meetingKind(occ, series));
  // Years (of a list) that have at least one occurrence.
  eleventyConfig.addFilter("svcYearsWith", (years, occs) =>
    (years || []).filter((y) => (occs || []).some((o) => o && String(o.date || o.start || "").slice(0, 4) === String(y)))
  );
  eleventyConfig.addFilter("svcKindInfo", (kind) => MEETING_KINDS[kind] || MEETING_KINDS.other);
  eleventyConfig.addFilter("svcDistrictNum", (slug) => districtNumber(slug));

  // The Series behind an occurrence (for place, Zoom, flyers, links, hosts).
  eleventyConfig.addFilter("svcSeries", (occ, calendar) => {
    if (!occ || !calendar) return null;
    const bySlug = calendar.bySlug || {};
    if (occ.slug && bySlug[occ.slug]) return bySlug[occ.slug];
    return (calendar.series || []).find((s) => s.uid && s.uid === occ.uid) || null;
  });

  // Host districts of an Area meeting: the series' Host: field, else the occurrence's district, else "District N" in the title.
  eleventyConfig.addFilter("svcHosts", (occ, series) => {
    const out = [];
    for (const h of (series && series.hosts) || []) if (h && !out.includes(h)) out.push(h);
    if (!out.length && occ && occ.district) out.push(occ.district);
    if (!out.length && occ) {
      const m = String(occ.title || "").match(/district[s]?\s+([\d\s&,y]+)/i);
      if (m)
        for (const n of m[1].split(/[^\d]+/).filter(Boolean)) {
          const slug = "d" + String(Number(n)).padStart(2, "0");
          if (!out.includes(slug)) out.push(slug);
        }
    }
    return out;
  });

  // Links on a series whose label matches a word (agenda, flyer, minutes …).
  eleventyConfig.addFilter("svcLinks", (series, re) => {
    const rx = new RegExp(re || ".", "i");
    return ((series && series.links) || []).filter((l) => l && l.url && rx.test(`${l.label || ""} ${l.url}`));
  });

  // Documents whose category / collection / kind / title mentions any of the words.
  eleventyConfig.addFilter("svcDocsAbout", (docs, words, fields) => {
    const list = Array.isArray(docs) ? docs : [];
    const ws = (Array.isArray(words) ? words : [words]).map(lc).filter(Boolean);
    const fs = fields || ["category", "collection", "kind", "meeting_type", "title"];
    return list.filter((d) => {
      const hay = fs.map((f) => lc(d && d[f])).join(" | ");
      return ws.some((w) => hay.includes(w));
    });
  });

  // Minutes for an Area meeting: documents dated the same day (or, failing that, the same month)
  // whose category/kind/meeting_type/title says "minutes".
  // kind = our meeting kind; ASA-type meetings only take ASA minutes, ASCs only ASC minutes (never Board minutes).
  eleventyConfig.addFilter("svcMinutesFor", (documents, ymd, kind) => {
    if (!documents || !ymd) return [];
    const all = Array.isArray(documents) ? documents : documents.all || [];
    const isMin = (d) => /minut|acta/.test(lc([d.category, d.kind, d.title].join(" ")));
    const want = ["asa", "election", "shareback"].includes(kind) ? "asa" : ["asc", "preconf", "budget"].includes(kind) ? "asc" : "";
    const typeOk = (d) => {
      const mt = lc(d.meeting_type || d.kind);
      if (/board|junta|school|escuela/.test(mt) || /board|junta/.test(lc(d.title))) return false;
      if (!want || !mt) return true;
      if (want === "asa") return /asa|assembl|asamb/.test(mt);
      return /asc|csa|committee|comit/.test(mt);
    };
    const mins = all.filter((d) => d && d.url && isMin(d) && typeOk(d));
    const exact = mins.filter((d) => String(d.date || "").slice(0, 10) === ymd);
    if (exact.length) return exact;
    const month = String(ymd).slice(0, 7);
    // a month-only date ("2024-12") matches that month; a full date must be within a week
    return mins.filter((d) => {
      const ds = String(d.date || "");
      if (ds.slice(0, 7) !== month) return false;
      if (ds.length === 7) return true;
      const a = toDT(ds), b = toDT(ymd);
      return a && b && Math.abs(a.diff(b, "days").days) <= 7;
    });
  });

  // A document that is still a draft (minutes not yet approved, a proposed budget): its title says so.
  eleventyConfig.addFilter("isDraftDoc", (d) =>
    /\b(draft|un-?approved|not yet approved|borrador|sin aprobar|no aprobad[oa]s?)\b/i.test(`${(d && d.title) || ""} ${(d && d.title_es) || ""}`),
  );

  // Agendas for an Area meeting: documents whose title says "agenda" (never a Treasurer's report filed on
  // the same shelf), of the matching meeting type, dated that day — or that month when the file has no day.
  // One per language; an exact date wins over a month-only date.
  eleventyConfig.addFilter("svcAgendaFor", (documents, ymd, kind) => {
    if (!documents || !ymd) return [];
    const all = Array.isArray(documents) ? documents : documents.all || [];
    const want = ["asa", "election", "shareback"].includes(kind) ? "asa" : ["asc", "preconf", "budget"].includes(kind) ? "asc" : "";
    const typeOk = (d) => {
      const mt = lc(d.meeting_type || "");
      const t = lc(d.title);
      if (/board|junta|school|escuela|inter-?district|interdistrit/.test(mt + " " + t)) return false;
      if (!want) return true;
      if (want === "asa") return /asa|assembl|asamb/.test(mt) || /assembl|asamblea/.test(t);
      return /asc|csa|committee|comit/.test(mt) || /\basc\b|committee/.test(t);
    };
    const docs = all.filter((d) => d && d.url && /agenda|orden del d/i.test(`${d.title} ${d.title_es || ""}`) && !/treasur|tesorer/i.test(d.title || "") && typeOk(d));
    const exact = docs.filter((d) => String(d.date || "").slice(0, 10) === ymd);
    const month = docs.filter((d) => String(d.date || "") === String(ymd).slice(0, 7));
    const pick = exact.length ? exact : month;
    const seen = new Set();
    const order = (d) => (/^en/i.test(d.language || "") ? 0 : /^sp|^es/i.test(d.language || "") ? 1 : 2);
    return [...pick].sort((a, b) => order(a) - order(b)).filter((d) => {
      const k = lc(d.language) || d.url;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

  // Occurrences whose Pacific date falls in one of the given years.
  eleventyConfig.addFilter("svcInYears", (occs, years) => {
    const ys = (years || []).map(String);
    return (occs || []).filter((o) => o && ys.includes(String(o.date || o.start || "").slice(0, 4)));
  });

  // [2026, 2027] from "2026–2027".
  eleventyConfig.addFilter("svcYears", (label) => {
    const ys = String(label || "").match(/\d{4}/g) || [];
    if (ys.length === 2) {
      const out = [];
      for (let y = Number(ys[0]); y <= Number(ys[1]); y++) out.push(y);
      return out;
    }
    return ys.map(Number);
  });

  // Hide an "Area" placeholder occurrence when a real Area meeting exists on the same date (calendar-spec §9.1).
  eleventyConfig.addFilter("svcDedupe", (occs) => {
    const list = (occs || []).filter(Boolean);
    const realDates = new Set(list.filter((o) => lc(o.type) !== "area").map((o) => o.date));
    const seen = new Set();
    return list.filter((o) => {
      if (lc(o.type) === "area" && realDates.has(o.date)) return false;
      const k = `${o.date}|${lc(o.title)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

  // End of the Pacific day for an ISO/ymd — for data-hide-after.
  eleventyConfig.addFilter("svcEndOfDay", (v) => {
    const dt = toDT(v);
    return dt ? dt.endOf("day").toISO() : "";
  });

  // Is the moment in the past, relative to the build?
  eleventyConfig.addFilter("svcIsPast", (v) => {
    const dt = toDT(v);
    return dt ? dt.toMillis() < Date.now() : false;
  });

  // Whole days from the build to a date (negative = past).
  eleventyConfig.addFilter("svcDaysFrom", (v) => {
    const dt = toDT(v);
    if (!dt) return null;
    const today = DateTime.now().setZone(TZ).startOf("day");
    return Math.round(dt.startOf("day").diff(today, "days").days);
  });

  // Month number 1–12 of a date (Pacific).
  eleventyConfig.addFilter("svcMonth", (v) => {
    const dt = toDT(v);
    return dt ? dt.month : 0;
  });

  // A date range "Dec 4–6, 2026" / "4–6 dic 2026" (falls back gracefully).
  eleventyConfig.addFilter("svcRange", (start, end, lang) => {
    const a = toDT(start);
    const b = toDT(end);
    const loc = lc(lang && lang.code ? lang.code : lang) === "es" ? "es-US" : "en-US";
    if (!a) return "";
    const A = a.setLocale(loc);
    if (!b || b.hasSame(a, "day")) return A.toLocaleString({ month: "long", day: "numeric", year: "numeric" });
    const B = b.setLocale(loc);
    if (loc === "es-US") {
      if (a.hasSame(b, "month")) return `${A.toFormat("d")}–${B.toFormat("d")} de ${B.toFormat("LLLL 'de' yyyy")}`;
      return `${A.toFormat("d 'de' LLLL")} – ${B.toFormat("d 'de' LLLL 'de' yyyy")}`;
    }
    if (a.hasSame(b, "month")) return `${A.toFormat("LLLL d")}–${B.toFormat("d, yyyy")}`;
    if (a.hasSame(b, "year")) return `${A.toFormat("LLLL d")} – ${B.toFormat("LLLL d, yyyy")}`;
    return `${A.toFormat("LLLL d, yyyy")} – ${B.toFormat("LLLL d, yyyy")}`;
  });

  // Documents for the Delegate's corner: Conference papers and Delegate reports, newest first.
  // Conference background is confidential and never listed.
  eleventyConfig.addFilter("svcDelegateDocs", (documents) => {
    const all = Array.isArray(documents) ? documents : (documents && documents.all) || [];
    const rx = /delegate.{0,4}(report|share|notes|presentation|handout)|report ?back|share ?back|quick reference|gu[ií]a r[aá]pida|informe del delegado|final (conference )?report|informe final/i;
    return all
      .filter((d) => d && d.url && !/background|confiden|antecedentes/i.test(`${d.title} ${d.title_es || ""}`))
      .filter((d) => ["conference", "delegate"].includes(lc(d.category)) || /delegate|conference/.test(lc(d.kind)) || rx.test(d.title || ""))
      .sort((a, b) => String(b.date || "0").localeCompare(String(a.date || "0")));
  });

  // The calendar occurrence for a gsc.csv row: same start date and a shared keyword in the title.
  eleventyConfig.addFilter("svcCalMatch", (upcoming, row) => {
    if (!row || !row.date_start) return null;
    const words = lc(row.title_en || row.title).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !/^(pacific|general|service|region|regional|national)$/.test(w));
    return (upcoming || []).find((o) => o && o.date === row.date_start && words.some((w) => lc(o.title).includes(w))) || null;
  });

  // Count of items matching key=value (or truthy key).
  eleventyConfig.addFilter("svcCount", (arr, key, val) =>
    (arr || []).filter((x) => (val === undefined ? !!(x && x[key]) : x && String(x[key]).toLowerCase() === String(val).toLowerCase())).length
  );

  // File name without folder or extension ("src/content/delegate/2020-01-10-x.md" → "2020-01-10-x").
  eleventyConfig.addFilter("svcBasename", (p) => String(p || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, ""));

  // Index of the first item whose key equals the value (-1 if none).
  eleventyConfig.addFilter("svcIndexOf", (arr, key, val) => (arr || []).findIndex((x) => x && x[key] === val));

  // Items whose key matches a regular expression (case-insensitive).
  eleventyConfig.addFilter("svcMatch", (arr, key, re) => {
    const rx = new RegExp(re, "i");
    return (arr || []).filter((x) => x && rx.test(String(x[key] || "")));
  });

  // First item of a list whose key matches a regular expression.
  eleventyConfig.addFilter("svcFirstMatch", (arr, key, re) => {
    const rx = new RegExp(re, "i");
    return (arr || []).find((x) => x && rx.test(String(x[key] || ""))) || null;
  });

  // Plain text for data-search attributes (lower case, accents removed).
  eleventyConfig.addFilter("svcFold", (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );
}

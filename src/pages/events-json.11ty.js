// /assets/data/events.json — every occurrence in the build window (build − 400 days … + 550 days),
// compact, for the calendar page (FullCalendar + filters) and any other browser-side script.
// "today" is decided in the browser, so a page built hours ago still shows the right things.
// `series` holds only the calendar entries that have a date in the window (the page reaches an entry only through an
// occurrence's `s`), and there is no build time in it: nothing reads one.
// After the Area's own entries come the central offices' events (officeEvents, src/_data/officeEvents.js): marked
// im = 1 and so = the office, with series src = "co". They have no page of their own: their url is their card on
// /calendar/central-offices/, and web is the event's page on the office's website.
export const data = {
  permalink: "/assets/data/events.json",
  eleventyExcludeFromCollections: true,
  layout: false,
};

const KEYS = {
  k: "occurrence key (<series slug>/<yyyyMMddHHmm>)",
  s: "series slug — details in series[slug] (series lists only the slugs some occurrence uses); page at /events/<slug>/",
  t: "title (English)", te: "title (Spanish, when the calendar has one)",
  ty: "type key (types[].key)", c: "colour name", f: "format: In person | Hybrid | Virtual", l: "language: English | Spanish | Bilingual",
  d: "district slugs", cm: "committee slugs", ci: "city", v: "venue",
  fl: "flyer (the cover on English pages): Google Drive file id (image: https://lh3.googleusercontent.com/d/<id>=w800-rj-l85, a JPEG); flyers on hold in data/flyer-holds.csv are never listed",
  fle: "flyer for Spanish pages, when it is not fl (an IMG: line labelled Spanish)",
  a: "start (ISO, Pacific offset)", b: "end (ISO, Pacific offset; all-day: next midnight)", ad: "1 = all day", r: "1 = part of a repeating series",
  z: "1 = has Zoom", st: "status when not confirmed: cancelled | postponed", tl: "time label [en, es]",
  so: "central office key (offices[].key): the office that posted it, or that holds an Area event",
  al: "other central offices that list the same event", im: "1 = read from a central office's website (no page here)",
  fx: "flyer of an imported event: the full https address of a checked picture on the office's website",
  ne: "1 = the office gives no end time (b = a + 2 hours, or the end of the last day of a multi-day event)",
};

const compact = (o) => {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === "" || v == null || v === 0 || v === false || (Array.isArray(v) && !v.length)) delete o[k];
  }
  return o;
};

// "https://lh3.googleusercontent.com/d/<id>=w800-rj-l85" -> "<id>"
const driveIdOf = (u) => (u ? (u.match(/\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] : "") || "";

export function render({ calendar, officeEvents }) {
  const c = calendar || {};
  const co = officeEvents || {};
  const areaOffice = co.areaOffice || {};
  const occurrences = (c.occurrences || []).map((o) =>
    compact({
      k: `${o.slug}/${o.key.split("@").pop()}`, s: o.slug, t: o.title, te: o.title_es, ty: o.type, c: o.color, f: o.format, l: o.language,
      d: o.districts, cm: o.committees, ci: o.city, v: o.venue,
      fl: driveIdOf(o.flyer_en || o.flyer),
      fle: o.flyer_es && o.flyer_es !== (o.flyer_en || o.flyer) ? driveIdOf(o.flyer_es) : "",
      a: o.start, b: o.end, ad: o.allDay ? 1 : 0, r: o.recurring ? 1 : 0, z: o.hasZoom ? 1 : 0,
      st: o.status && o.status !== "confirmed" ? o.status : "",
      tl: [o.timeLabel_en, o.timeLabel_es],
      so: areaOffice[o.slug] || "",
    })
  );
  const stamp = (iso) => iso.slice(0, 16).replace(/[-T:]/g, "");
  for (const e of co.events || []) {
    occurrences.push(compact({
      k: `${e.id}/${stamp(e.start)}`, s: e.id, t: e.title, te: e.title_es, ty: e.type, c: e.color, f: e.format, l: e.language,
      ci: e.city, v: e.venue, fx: e.flyer ? e.flyer.card : "",
      a: e.start, b: e.end, ad: e.allDay ? 1 : 0, tl: [e.timeLabel_en, e.timeLabel_es],
      so: e.office, al: e.also, im: 1, ne: e.noEnd ? 1 : 0,
    }));
  }
  // only the entries a date in the window points to (older entries, back to 2020, would be a quarter of the file)
  const used = new Set(occurrences.map((o) => o.s));
  const series = {};
  for (const s of c.series || []) {
    if (!used.has(s.slug)) continue;
    series[s.slug] = compact({
      title: s.title, title_es: s.title_es, type: s.type, format: s.format, language: s.language,
      url: s.url, ics: s.icsPath, recurring: s.recurring ? 1 : 0,
      rule_en: s.rule_en, rule_es: s.rule_es, time_en: s.timeLabel_en, time_es: s.timeLabel_es,
      location: s.location && !s.location.tba ? compact({ name: s.location.name, address: s.location.address, maps: s.location.mapsUrl, city: s.location.city }) : s.location && s.location.tba ? { tba: 1 } : null,
      online: s.online ? compact({ id: s.online.zoomId, pc: s.online.passcode, url: s.online.joinUrl }) : null,
      notes: s.notes, notes_es: s.notes_es, reg: s.registration ? [s.registration_en, s.registration_es] : null,
      email: s.email, web: s.web, cost: s.cost,
      // English order; flyers_es only when a flyer labelled Spanish leads on Spanish pages
      flyers: (s.flyers_en || s.flyers || []).map((f) => f.id),
      flyers_es: s.flyers_es && s.flyers_es.length && s.flyers_es[0] !== (s.flyers_en || s.flyers)[0] ? s.flyers_es.map((f) => f.id) : null,
      districts: s.districts, committees: s.committees, topics: s.topics,
      ended: s.ended ? 1 : 0,
    });
  }
  // a central office's event: what its card shows, its card's address, and its page on the office's website. Never a
  // Zoom link, an e-mail or an .ics file (check-site.mjs refuses them here)
  for (const e of co.events || []) {
    series[e.id] = compact({
      src: "co", office: e.office, also: e.also,
      title: e.title, title_es: e.title_es, type: e.type, format: e.format, language: e.language,
      url: e.url, web: e.src, time_en: e.timeLabel_en, time_es: e.timeLabel_es,
      // no place in the office's listing: tba 1 ("flyer" = it is on the flyer shown, else on the office's page);
      // an online event has none
      location: e.noPlace ? { tba: 1, on: e.noPlace } : e.venue || e.address || e.city ? compact({ name: e.venue, address: [e.address, e.city, e.zip].filter(Boolean).join(", "), maps: e.mapsUrl, city: e.city }) : null,
      summary: e.summary, cost: e.cost,
      flyers: e.flyer ? [e.flyer.card] : null, pdf: e.pdf,
    });
  }
  return JSON.stringify({
    v: 1,
    tz: "America/Los_Angeles",
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    keys: KEYS,
    types: (c.types || []).map((x) => ({
      key: x.key, slug: x.slug, en: x.label_en, es: x.label_es, group: x.group, group_en: x.group_en, group_es: x.group_es,
      color: x.color, icon: x.icon, meeting: x.is_meeting, event: x.is_event, sort: x.sort,
    })),
    districts: (c.districts || []).map((d) => ({ slug: d.slug, en: d.label_en, es: d.label_es, nums: d.nums })),
    committees: (c.committees || []).map((x) => ({ slug: x.slug, en: x.name_en, es: x.name_es })),
    topics: (c.topics || []).map((x) => ({ key: x.key, slug: x.slug })),
    offices: (co.offices || []).map((o) => ({ key: o.key, en: o.name_en, es: o.name_es, short: o.short, color: o.color })),
    links: { subscribe: c.subscribeUrl, webcal: c.webcalUrl, ics: c.mirrorUrl, embed: c.embedUrl, embed_es: c.embedUrlEs },
    series,
    occurrences,
  });
}

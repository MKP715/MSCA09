// /assets/data/events.json — every occurrence in the build window (build − 400 days … + 550 days),
// compact, for the calendar page (FullCalendar + filters) and any other browser-side script.
// "today" is decided in the browser, so a page built hours ago still shows the right things.
export const data = {
  permalink: "/assets/data/events.json",
  eleventyExcludeFromCollections: true,
  layout: false,
};

const KEYS = {
  k: "occurrence key (<series slug>/<yyyyMMddHHmm>)",
  s: "series slug — details in series[slug]; page at /events/<slug>/",
  t: "title (English)", te: "title (Spanish, when the calendar has one)",
  ty: "type key (types[].key)", c: "colour name", f: "format: In person | Hybrid | Virtual", l: "language: English | Spanish | Bilingual",
  d: "district slugs", cm: "committee slugs", ci: "city", v: "venue",
  fl: "flyer: Google Drive file id (image: https://lh3.googleusercontent.com/d/<id>=w800); flyers on hold in data/flyer-holds.csv are never listed",
  a: "start (ISO, Pacific offset)", b: "end (ISO, Pacific offset; all-day: next midnight)", ad: "1 = all day", r: "1 = part of a repeating series",
  z: "1 = has Zoom", st: "status when not confirmed: cancelled | postponed", tl: "time label [en, es]",
};

const compact = (o) => {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === "" || v == null || v === 0 || v === false || (Array.isArray(v) && !v.length)) delete o[k];
  }
  return o;
};

export function render({ calendar }) {
  const c = calendar || {};
  const series = {};
  for (const s of c.series || []) {
    series[s.slug] = compact({
      title: s.title, title_es: s.title_es, type: s.type, format: s.format, language: s.language,
      url: s.url, ics: s.icsPath, recurring: s.recurring ? 1 : 0,
      rule_en: s.rule_en, rule_es: s.rule_es, time_en: s.timeLabel_en, time_es: s.timeLabel_es,
      location: s.location && !s.location.tba ? compact({ name: s.location.name, address: s.location.address, maps: s.location.mapsUrl, city: s.location.city }) : s.location && s.location.tba ? { tba: 1 } : null,
      online: s.online ? compact({ id: s.online.zoomId, pc: s.online.passcode, url: s.online.joinUrl }) : null,
      notes: s.notes, notes_es: s.notes_es, reg: s.registration ? [s.registration_en, s.registration_es] : null,
      email: s.email, web: s.web, cost: s.cost,
      flyers: (s.flyers || []).map((f) => f.id),
      districts: s.districts, committees: s.committees, topics: s.topics,
      ended: s.ended ? 1 : 0,
    });
  }
  const occurrences = (c.occurrences || []).map((o) =>
    compact({
      k: `${o.slug}/${o.key.split("@").pop()}`, s: o.slug, t: o.title, te: o.title_es, ty: o.type, c: o.color, f: o.format, l: o.language,
      d: o.districts, cm: o.committees, ci: o.city, v: o.venue,
      fl: o.flyer ? (o.flyer.match(/\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] : "",
      a: o.start, b: o.end, ad: o.allDay ? 1 : 0, r: o.recurring ? 1 : 0, z: o.hasZoom ? 1 : 0,
      st: o.status && o.status !== "confirmed" ? o.status : "",
      tl: [o.timeLabel_en, o.timeLabel_es],
    })
  );
  return JSON.stringify({
    v: 1,
    generated: c.generated,
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
    links: { subscribe: c.subscribeUrl, webcal: c.webcalUrl, ics: c.mirrorUrl, embed: c.embedUrl, embed_es: c.embedUrlEs },
    series,
    occurrences,
  });
}

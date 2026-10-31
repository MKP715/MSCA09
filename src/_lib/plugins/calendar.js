// Calendar plugin: files and template helpers for the calendar pages and event macros.
//  - copies the FullCalendar Spanish locale. The whole-calendar file /calendar.ics is NOT a copy of the
//    Google feed: src/pages/calendar-ics.11ty.js builds it from the cleaned entries (no maintainer lines,
//    no text under "--" for meetings, no held flyers).
//  - filters: calGoogle / calOutlook (add-to-calendar links), calIcs (iCalendar text),
//             calTitle / calTypeLabel / calLoc (English or Spanish field of an entry),
//             calNotes (the Note / Nota lines for a language), calJsonLd (schema.org Event),
//             calMetaDescription (an event page's description for search engines),
//             calConfig (settings for the /calendar/ page script), calUid (unique ids), calHost (hostname)
import { readCsv } from "../csv.js";
import { t, code, dictionary } from "../i18n.js";
import { iconSvg } from "../shortcodes.js";
import { formatDate, ownUrl } from "../filters.js";
import { googleAddUrl, outlookAddUrl, seriesToIcs, slugify, driveImageUrl, parseOrganizer, compileOrganizers, resolveOrganizers } from "../calendar.js";

// strings the calendar page's script needs (data/text/calendar.csv, keys "calendar.js.<name>")
const JS_KEYS = [
  "online", "all_day", "upcoming", "today", "tomorrow", "no_results", "cancelled", "postponed", "meeting_id", "passcode",
  "format_in_person", "format_hybrid", "format_online", "lang_en", "lang_es", "lang_bi",
  "tod_morning", "tod_afternoon", "tod_evening", "tod_allday", "has_flyer", "has_zoom", "n_categories", "no_categories",
  "n_events", "one_event", "no_events", "nav_hint", "close", "go_agenda",
  "later_one", "later_n", "earlier_one", "earlier_n", "go_to", "showing_matches", "early",
  "co_from", "co_site", "co_open", "co_note", "src_area", "src_co",
];

function siteUrl() {
  const row = readCsv("settings.csv").find((r) => r.key === "site_url");
  return (process.env.SITE_URL || (row && row.value) || "https://msca09aa.org").replace(/\/$/, "");
}

// Event descriptions for search engines (calMetaDescription): about this many characters at most, when there is room
// for the first sentence of an event's text.
const META_MAX = 160;
// A full stop after "A.A.", "p.m.", a single capital ("701 W.") or a street word ("St.", "Blvd.") does not end a sentence.
const NOT_A_SENTENCE_END = /(?:\b(?:[A-Za-z]\.)+[A-Za-z]|\b[A-Z]|\b(?:St|Rd|Ave|Blvd|Dr|Mt|Ste|No))$/;
// joining instructions are not a summary ("Join Zoom Meeting … Password: …"); "Join us for …" is
const ZOOM_WORDS = /zoom|meeting\s*i\.?\s*d|passcode|password|contrase[nñ]a|\bjoin\b(?!\s+us\b)/i;
// The first sentence of the first line of an event's text ("" when that line has no complete sentence of 20+ characters).
function leadSentence(text) {
  const line = (String(text || "").split("\n").find((l) => l.trim()) || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  for (const m of line.matchAll(/[.!?](?=\s|$)/g)) {
    if (m[0] === "." && NOT_A_SENTENCE_END.test(line.slice(0, m.index))) continue;
    return m.index >= 19 ? line.slice(0, m.index + 1) : "";
  }
  return "";
}
const plainWords = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const mostlyCapitals = (x) => (x.match(/\p{Lu}/gu) || []).length > (x.match(/\p{L}/gu) || []).length / 2;
const lowerFirst = (x) => (x ? x.charAt(0).toLowerCase() + x.slice(1) : "");
const spaced = (x) => (x ? ` ${x}` : "");

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    "node_modules/@fullcalendar/core/locales/es.global.min.js": "assets/vendor/fullcalendar-es.min.js",
  });

  const base = siteUrl();
  // ownUrl: on Spanish pages, a Web: line that points to this site is given as its Spanish page when that page is built
  eleventyConfig.addFilter("calGoogle", (series, occ, lang) => (series ? googleAddUrl(series, occ || null, lang, base, ownUrl) : ""));
  eleventyConfig.addFilter("calOutlook", (series, occ, lang) => (series ? outlookAddUrl(series, occ || null, lang, base, ownUrl) : ""));
  eleventyConfig.addFilter("calIcs", (series, stamp, instances) => (series ? seriesToIcs(series, { siteUrl: base, stamp, instances: instances || [] }) : ""));

  // The Note lines of a Series for a page language: [{ text, lang }]. Spanish pages show the Nota: lines;
  // without them, `override` (e.g. a district's meeting_note_es) or else the English notes marked lang="en".
  //   {% for n in series | calNotes(lang, overrideTextOrList) %}<p {% if n.lang != lang.code %}lang="{{ n.lang }}"{% endif %}>{{ n.text }}</p>{% endfor %}
  eleventyConfig.addFilter("calNotes", (s, lang, override) => {
    if (!s) return [];
    const L = code(lang);
    const en = s.notes_en || s.notes || [];
    if (L !== "es") return en.map((text) => ({ text, lang: "en" }));
    if ((s.notes_es || []).length) return s.notes_es.map((text) => ({ text, lang: "es" }));
    const ov = (Array.isArray(override) ? override : [override]).map((x) => String(x || "").trim()).filter(Boolean);
    if (ov.length) return ov.map((text) => ({ text, lang: "es" }));
    return en.map((text) => ({ text, lang: "en" }));
  });

  // schema.org Event (JSON-LD) for the coming date of a one-time event (none once it has ended). Google's event results
  // only show public events held at a real place, on a page about that one event:
  //  - repeating entries give none: today they are all business meetings (districts, committees, intergroups, H&I,
  //    service schools, the YPAA committees), on a page that lists many dates;
  //  - online-only entries, and entries whose place is still to be announced (or names no street or city), give none.
  //    The data comes back by itself once a place is typed into the Google Calendar entry. A hybrid event gives its
  //    place only (Google no longer reads VirtualLocation).
  // The address is a PostalAddress from the parsed Location (street, city, state, ZIP code, country), and the place's
  // name is given only when the Location starts with a venue (never the city).
  // The organizer is the organization(s) the entry's Organizer: lines name (data/organizers.csv: official name in the
  // page's language and official website); without such a line, the Area for the types that only the Area holds
  // (AREA_HOSTED), else the one district that hosts it (the page's "Hosted by"). Never a person, and no performer:
  // the speakers are A.A. members, and a host is not a performer. No stand-in image or place name either: Google wants
  // the event's own picture and the venue's real name, or nothing.
  // The price (offers) is given only when the Cost: line states one plainly (offersOf).
  // The 2028 Pacific Regional Forum has its own pages, whose overview carries its Event (partials/prf-head.njk): its
  // calendar entry (on the opening day in data/prf/forum.csv, of type Forum or linking to the Forum pages) gives none,
  // so search engines do not find the same event at two addresses.
  // The General Service Conference itself (type Conference on the first day of a conference row in data/gsc.csv) gives
  // none either: only Conference members attend it, and Google's event results are only for events open to the public.
  const prfDay = String(readCsv("prf/forum.csv").find((r) => r.key === "start")?.value || "").slice(0, 10);
  const isPrfEntry = (s) => !!prfDay && s.startDate === prfDay && (s.type === "Forum" || /\/service\/prf-2028\//.test(s.web || ""));
  const gscDays = readCsv("gsc.csv")
    .filter((r) => String(r.kind || "").trim().toLowerCase() === "conference")
    .map((r) => String(r.date_start || "").slice(0, 10))
    .filter(Boolean);
  const isGscEntry = (s) => s.type === "Conference" && gscDays.includes(s.startDate);
  eleventyConfig.addFilter("calJsonLd", (s, lang, description) => {
    if (!s || s.recurring || isPrfEntry(s) || isGscEntry(s)) return [];
    return (s.upcomingDates || []).slice(0, 1).map((o) => jsonLd(s, o, lang, description)).filter(Boolean);
  });
  // calendar types (data/event-types.csv keys) whose events the Area itself holds
  const AREA_HOSTED = ["Area", "Area Committee", "Assembly", "Servathon"];
  // The Area itself (an organizer whose website is this site's home page): the Organization with the same @id as on every
  // page (layouts/base.njk). Another organization: its name in the page's language (name_es only when it has a Spanish
  // name of its own) and its own website.
  const csvSite = String(readCsv("settings.csv").find((r) => r.key === "site_url")?.value || "https://msca09aa.org").replace(/\/$/, "");
  const homeUrls = new Set([base, csvSite]);
  const areaOrg = (L) => ({ "@type": "Organization", "@id": `${base}/#organization`, name: t("site.name", L), url: `${base}/` });
  const orgLd = (o, L) =>
    o.url && homeUrls.has(o.url.replace(/\/$/, "")) ? areaOrg(L)
      : { "@type": "Organization", name: (L === "es" && o.name_es) || o.name_en, ...(o.url ? { url: o.url } : {}) };
  // The organizations named in a data cell ("Area 09; General Service Board": names from data/organizers.csv, the first
  // leads) as schema.org organizer: one Organization, a list, or null. For pages with Event data of their own
  // (partials/prf-head.njk).
  const organizerRegistry = compileOrganizers(readCsv("organizers.csv"));
  eleventyConfig.addFilter("calOrganizers", (cell, lang) => {
    const L = code(lang);
    const list = resolveOrganizers(String(cell || "").split(";").map((v) => parseOrganizer(v)).filter(Boolean), organizerRegistry).map((o) => orgLd(o, L));
    return list.length > 1 ? list : list[0] || null;
  });
  // "USA" or "United States" in a Location becomes the ISO code; another country stays as typed; none means the US
  const countryCode = (c) => (!c || /^(u\.?s\.?(a\.?)?|united states( of america)?)$/i.test(c.trim()) ? "US" : c.trim());
  // The district that hosts an event, as its organizer: exactly one district on the page (its own, or "Hosted by"),
  // named as in data/districts.csv (name_en / name_es) with its page on this site, as part of the Area. None for the
  // Area's business (types of the "area" group, e.g. the Foro: a district hosts it for the Area) or a shared event.
  const districtRows = new Map(readCsv("districts.csv").map((r) => [r.slug, r]));
  const districtOrganizer = (s, L) => {
    if (s.group === "area") return null;
    const slugs = [...new Set([...(s.ownDistricts || []), ...(s.hosts || [])])];
    const row = slugs.length === 1 ? districtRows.get(slugs[0]) : null;
    if (!row || (row.status || "active").toLowerCase() !== "active") return null;
    return {
      "@type": "Organization",
      name: (L === "es" && row.name_es) || row.name_en || row.slug,
      url: `${base}${L === "es" ? "/es" : ""}/districts/${row.slug}/`,
      parentOrganization: { "@id": `${base}/#organization` },
    };
  };
  // The price, only when the Cost: line states one plainly: "Free" / "Gratis" → 0, or a single "$NN" at the start
  // ("$70", "$25 per person") → NN, in US dollars. "Registration $70; Saturday banquet $65; …" → 70: the registration
  // every ticket needs, when the line starts with it and the extras follow after a ";". A suggested or voluntary
  // contribution (the Seventh Tradition), a range or several prices give none: the page shows the line as typed, and a
  // wrong price would be worse than none. (Spanish entries also say "aportación", "aporte" or "cooperación".)
  const NOT_A_PRICE = /contribu|donat|donaci|suggest|sugerid|voluntar|offering|ofrenda|tradition|tradici|\baport[ae]|cooperaci/i;
  const REG_FIRST = /^(?:registration|registro|inscripci[oó]n|admission|entrada)\s*:?\s*(?=\$)/i;
  const offersOf = (cost) => {
    let c = String(cost || "").trim();
    if (!c || NOT_A_PRICE.test(c)) return null;
    const first = c.split(";")[0].trim();
    if (REG_FIRST.test(first)) c = first.replace(REG_FIRST, "");
    let price = null;
    if (/^(free|gratis|gratuit[oa])\b/i.test(c) && !c.includes("$")) price = 0;
    else {
      const m = /^\$\s?(\d{1,4}(?:\.\d{2})?)(?![\d.,]|\s*(?:[-–—/+]|to\b|or\b|a\b|o\b))/i.exec(c);
      if (m && !c.includes("$", 1)) price = Number(m[1]);
    }
    return price === null ? null : { "@type": "Offer", price, priceCurrency: "USD" };
  };
  const jsonLd = (s, o, lang, description) => {
    const fmt = (s.format || "").toLowerCase();
    const mode = fmt.includes("virtual") ? "OnlineEventAttendanceMode" : fmt.includes("hybrid") ? "MixedEventAttendanceMode" : "OfflineEventAttendanceMode";
    const loc = s.location;
    if (mode === "OnlineEventAttendanceMode" || !loc || loc.tba || !(loc.street || loc.city)) return null;
    const L = code(lang);
    const pageUrl = `${base}${L === "es" ? "/es" : ""}${s.url}`;
    const ymd = (iso) => String(iso || "").slice(0, 10);
    const allDay = o ? o.allDay : s.allDay;
    const start = o ? o.start : s.start;
    const end = o ? o.end : s.end;
    const address = Object.fromEntries(Object.entries({
      "@type": "PostalAddress", streetAddress: loc.street, addressLocality: loc.city, addressRegion: loc.state,
      postalCode: loc.zip, addressCountry: countryCode(loc.country),
    }).filter(([, v]) => v));
    const place = { "@type": "Place", ...(loc.name ? { name: loc.name } : {}), address };
    const cancelled = (o && o.status === "cancelled") || s.status === "cancelled";
    const desc = String(description || "").trim();
    const out = {
      "@context": "https://schema.org",
      "@type": "Event",
      name: (L === "es" && ((o && o.title_es) || s.title_es)) || (o && o.title) || s.title,
      startDate: allDay ? ymd(start) : start,
      endDate: allDay ? ymd(o ? o.endDate || o.date : s.endDate) : end,
      eventAttendanceMode: `https://schema.org/${mode}`,
      eventStatus: `https://schema.org/${cancelled ? "EventCancelled" : s.status === "postponed" ? "EventPostponed" : "EventScheduled"}`,
      url: pageUrl,
      inLanguage: s.language === "Spanish" ? "es" : s.language === "Bilingual" ? ["en", "es"] : "en",
      location: place,
    };
    // the organizations the entry's Organizer: lines name; else the Area for its own types; else the one host district
    const named = (s.organizers || []).map((x) => orgLd(x, L));
    if (named.length) out.organizer = named.length === 1 ? named[0] : named;
    else if (AREA_HOSTED.includes(s.type)) out.organizer = areaOrg(L);
    else {
      const host = districtOrganizer(s, L);
      if (host) out.organizer = host;
    }
    const offers = offersOf(s.cost);
    if (offers) out.offers = offers;
    if (desc) out.description = desc;
    // flyers on hold (data/flyer-holds.csv) never reach s.flyers; the flyer in the page's language leads (flyers_en / flyers_es)
    const fl = s[`flyers_${L}`] || s.flyers;
    if (fl && fl.length) out.image = [driveImageUrl(fl[0].id, 1200)];
    return out;
  };

  // The description of an event page for search engines and link previews (also its JSON-LD description), built from
  // the entry's fields in the page's language with the calendar.meta.* texts (data/text/calendar.csv):
  //   "District 5 (A.A. district business meeting): Every 2nd Monday, 7:00–8:30 PM at <venue>, Santa Ana and on Zoom."
  //   "<title> (<type>): Sat, Nov 14, 2026, 11:00 AM–3:00 PM at <venue>, <city>. In Spanish."
  // <type> is calendar.meta.type.<type slug>, else the type's label; the venue's name is left out (the city stays) when it
  // would make the sentence longer than META_MAX. A finished series starts with "These meetings ended on <date>."
  // A one-time event adds the first sentence of its text while the whole stays within META_MAX, if the
  // entry is in the page's language (or bilingual) and the sentence says nothing about Zoom or passwords, is not
  // mostly capitals and does not just repeat the title.
  eleventyConfig.addFilter("calMetaDescription", (s, lang) => {
    if (!s) return "";
    const L = code(lang);
    const title = (L === "es" && s.title_es) || s.title || "";
    const typeRow = dictionary()[`calendar.meta.type.${slugify(s.type || "")}`];
    const type = (typeRow && (typeRow[L] || typeRow.en)) || s[`typeLabel_${L}`] || s.typeLabel_en || s.type || "";
    const loc = s.location && !s.location.tba ? s.location : null;
    const city = (loc && loc.city) || "";
    const venueName = loc && loc.name && loc.name !== city ? loc.name : "";
    const fmt = (s.format || "").toLowerCase();
    // with the venue's name, or (when that makes it longer than META_MAX and the city is known) with the city only
    const sentence = (venue) => {
      const place = venue && city ? t("calendar.meta.place", L, { venue, city })
        : city ? t("calendar.meta.place_city", L, { city })
        : venue ? t("calendar.meta.place_venue", L, { venue }) : "";
      const mode = fmt.includes("virtual") ? t("calendar.meta.online", L)
        : fmt.includes("hybrid") ? t(place ? "calendar.meta.hybrid" : "calendar.meta.hybrid_noplace", L) : "";
      let x = t(s.recurring ? "calendar.meta.repeat" : "calendar.meta.once", L, {
        title, type, rule: s[`rule_${L}`] || "", date: s[`dateLabel_${L}`] || "",
        time: lowerFirst(s[`timeLabel_${L}`] || ""), place: spaced(place), mode: spaced(mode),
      });
      // the sentence's own full stop after one that ends the time or place ("8:00 a. m.", "Main St.") is dropped
      x = x.replace(/(?<!\.)\.\.$/, ".");
      if (s.language === "Spanish") x += spaced(t("calendar.meta.lang_es", L));
      else if (s.language === "Bilingual") x += spaced(t("calendar.meta.lang_bi", L));
      if (s.recurring && s.ended) x = `${t("calendar.info.ended_series", L, { date: formatDate(s.lastDate, "full", L) })} ${x}`;
      return x;
    };
    let out = sentence(venueName);
    if (venueName && city && out.length > META_MAX) out = sentence("");
    const lead = s.recurring ? "" : leadSentence(s.about_text);
    const pageLanguage = s.language === "Bilingual" || (L === "es" ? s.language === "Spanish" : s.language !== "Spanish");
    const repeatsTitle = [s.title, s.title_es].some((x) => x && plainWords(lead).startsWith(plainWords(x)));
    if (lead && pageLanguage && !ZOOM_WORDS.test(lead) && !mostlyCapitals(lead) && !repeatsTitle && out.length + 1 + lead.length <= META_MAX)
      out += ` ${lead}`;
    return out;
  });

  // label of a calendar type from an occurrence/series ({ typeLabel_en, typeLabel_es })
  eleventyConfig.addFilter("calTypeLabel", (x, lang) => {
    if (!x) return "";
    const es = (lang && (lang.code || lang)) === "es";
    return (es ? x.typeLabel_es : x.typeLabel_en) || x.typeLabel_en || x.type || "";
  });
  // the localised title of an occurrence/series
  eleventyConfig.addFilter("calTitle", (x, lang) => {
    if (!x) return "";
    const es = (lang && (lang.code || lang)) === "es";
    return (es && x.title_es) || x.title || "";
  });
  // localised field: x.<field>_en / x.<field>_es
  eleventyConfig.addFilter("calLoc", (x, field, lang) => {
    if (!x) return "";
    const es = (lang && (lang.code || lang)) === "es";
    return (es ? x[`${field}_es`] : x[`${field}_en`]) || x[`${field}_en`] || x[field] || "";
  });
  // configuration for the /calendar/ page script (lang, strings, type icons, filter labels)
  // officeEvents (src/_data/officeEvents.js): the central offices, for the Office filter and the events' badges
  eleventyConfig.addFilter("calConfig", (cal, lang, officeEvents) => {
    const L = code(lang);
    const c = cal || {};
    const i18n = Object.fromEntries(JS_KEYS.map((k) => [k, t(`calendar.js.${k}`, L)]));
    const icons = Object.fromEntries((c.types || []).map((x) => [x.key, iconSvg(x.icon, "size-3.5 shrink-0")]));
    const dows = [0, 1, 2, 3, 4, 5, 6].map((d) => t(`calendar.dow.${d}`, L));
    const districts = (c.districts || []).map((d) => ({ slug: d.slug, label: L === "es" ? d.label_es : d.label_en }));
    const cmts = [
      ...(c.committees || []).map((x) => ({ value: `c:${x.slug}`, label: L === "es" ? x.name_es : x.name_en })),
      ...(c.topics || []).map((x) => ({ value: `t:${x.slug}`, label: t(`calendar.topic.${x.slug}`, L) })),
    ];
    // Web: lines that point to this site → the page within the site in this language (the detail sheet opens it in the
    // same tab; events.json keeps the full address for other apps)
    const own = {};
    for (const s of c.series || []) if (s.web && ownUrl(s.web, L).startsWith("/")) own[s.web] = ownUrl(s.web, L);
    // every central office (an Area event an office holds has its key too), its name in this language and its badge
    const offices = ((officeEvents && officeEvents.offices) || []).map((o) => ({ key: o.key, label: L === "es" ? o.name_es : o.name_en, short: o.short }));
    // the offices the Office filter offers (those with events now): an address or a saved filter naming another is dropped
    const officeKeys = ((officeEvents && officeEvents.officeList) || []).map((o) => o.key);
    return { lang: L, locale: L === "es" ? "es-US" : "en-US", json: c.jsonUrl || "/assets/data/events.json", i18n, icons, dows, districts, cmts, own, offices, officeKeys };
  });

  // unique ids for lists on one page (data-empty targets)
  let n = 0;
  eleventyConfig.addFilter("calUid", (prefix) => `${prefix || "cal"}-${++n}`);
  // "zoom.us" from a URL
  eleventyConfig.addFilter("calHost", (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u || "";
    }
  });
}

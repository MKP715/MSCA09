// /events/<slug>.ics — one iCalendar file per calendar entry, for "Add to calendar → Download".
// A repeating meeting keeps its repeat rule (and skipped, moved or cancelled dates), so one click adds every date.
// The whole Area calendar is at /calendar.ics (src/pages/calendar-ics.11ty.js), built from the same cleaned
// entries; neither file copies the raw Google description.
import { seriesToIcs } from "../_lib/calendar.js";

export const data = {
  pagination: { data: "calendar.series", size: 1, alias: "s", addAllPagesToCollections: false },
  permalink: (d) => `/events/${d.s.slug}.ics`,
  eleventyExcludeFromCollections: true,
  layout: false,
};

export function render(d) {
  const base = String((d.site && d.site.url) || "https://msca09aa.org").replace(/\/$/, "");
  const c = d.calendar || {};
  return seriesToIcs(d.s, { siteUrl: base, stamp: c.generated, instances: (c.instancesBySlug || {})[d.s.slug] || [] });
}

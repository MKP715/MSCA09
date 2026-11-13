// The online Area finance forms (/service/forms/expense/ and /service/forms/budget/), from
// data/finance-forms.csv: every choice, column and line of the official paper forms, in their order.
// Also read here: the mileage rate, budget year and deadline (data/settings.csv), the Area committees
// and officers with their role e-mails (data/committees.csv) and the active districts (data/districts.csv).
// The official PDF/Word versions are looked up by id in the document library on the page itself
// (documents.all), because a loader cannot see another loader's output.
//
// Shape:
//   { rate, year, deadline, deadlineEnd (the deadline's last moment in the Area's time zone, for data-hide-after),
//     expense: { official:[id], send:{ to, cc }, lines:[Choice], by:[Choice], columns:[Column] },
//     budget:  { official:[id], send:{ to, cc }, groups:[{ key, items:[Choice] }], officers:[Choice], items:[Item] },
//     committees:[{ slug, category, name_en, name_es }]   the Area committees ("Area Committee" on the expense form)
//     officers:[{ slug, name_en, name_es }], districts:[{ slug, number, name_en, name_es }] }
//   Choice = { key, kind, committee, label_en, label_es, hint_en, hint_es }
//   Column = Choice + { code }   Item = Choice + { code, rows, paper_rows }
//   send.to / send.cc = { slug, email, name_en, name_es } | null
import { DateTime } from "luxon";
import { readCsv, num } from "../_lib/csv.js";
import { fillSettings } from "../_lib/i18n.js";
import { TZ } from "../_lib/filters.js";

// Which committees.csv categories are Area committees an expense can be charged to, in the order
// /committees/ shows them. Coordinate committees (H&I, intergroups) are autonomous and not listed.
const AREA_CATEGORIES = ["standing", "school", "subcommittee", "ad-hoc", "service-event"];

export default function () {
  const settings = {};
  for (const r of readCsv("settings.csv")) if (r.key) settings[r.key] = r.value;

  const committees = readCsv("committees.csv").filter((r) => r.slug && !r.slug.startsWith("#"));
  const bySlug = Object.fromEntries(committees.map((r) => [r.slug, r]));
  // officers have no page of their own: their card on /about/panel/ is the place to link to
  const who = (slug) => {
    const c = bySlug[slug];
    if (!c) return slug && slug.includes("@") ? { slug: "", url: "", email: slug, name_en: slug, name_es: slug } : null;
    const url = (c.category || "").toLowerCase() === "officer" ? `/about/panel/#${slug}` : `/committees/${slug}/`;
    return { slug, url, email: c.email || "", name_en: c.name_en || slug, name_es: c.name_es || c.name_en || slug };
  };

  const rows = readCsv("finance-forms.csv")
    .filter((r) => r.form && r.section && r.key)
    .map((r) => ({
      form: r.form.toLowerCase(),
      section: r.section.toLowerCase(),
      key: r.key,
      code: r.code || "",
      kind: (r.kind || "").toLowerCase(),
      rows: num(r.rows, 1),
      paper_rows: num(r.paper_rows, 0),
      committee: r.committee || "",
      sort: num(r.sort, 999),
      // an empty label falls back to the committee's own name in committees.csv
      label_en: fillSettings(r.label_en || bySlug[r.committee]?.name_en || r.key),
      label_es: fillSettings(r.label_es || bySlug[r.committee]?.name_es || r.label_en || r.key),
      hint_en: fillSettings(r.hint_en || ""),
      hint_es: fillSettings(r.hint_es || r.hint_en || ""),
    }))
    .sort((a, b) => a.sort - b.sort);
  const pick = (form, section) => rows.filter((r) => r.form === form && r.section === section);
  const send = (form) => {
    const s = pick(form, "send");
    return { to: who(s.find((r) => r.key === "to")?.committee), cc: who(s.find((r) => r.key === "cc")?.committee) };
  };

  const areaCommittees = committees
    .filter((r) => AREA_CATEGORIES.includes((r.category || "").toLowerCase()) && (r.status || "active").toLowerCase() !== "completed")
    .map((r) => ({ slug: r.slug, category: r.category.toLowerCase(), sort: num(r.sort, 999), name_en: r.name_en || r.slug, name_es: r.name_es || r.name_en || r.slug }))
    .sort((a, b) => AREA_CATEGORIES.indexOf(a.category) - AREA_CATEGORIES.indexOf(b.category) || a.sort - b.sort);

  const officers = committees
    .filter((r) => (r.category || "").toLowerCase() === "officer")
    .map((r) => ({ slug: r.slug, sort: num(r.sort, 999), name_en: r.name_en || r.slug, name_es: r.name_es || r.name_en || r.slug }))
    .sort((a, b) => a.sort - b.sort);

  const districts = readCsv("districts.csv")
    .filter((r) => r.slug && !r.slug.startsWith("#") && (r.status || "active").toLowerCase() === "active" && (r.kind || "").toLowerCase() !== "interdistrict" && r.number)
    .map((r) => ({ slug: r.slug, number: r.number, name_en: r.name_en || `District ${r.number}`, name_es: r.name_es || r.name_en || `Distrito ${r.number}`, n: parseInt(r.number, 10) || 999 }))
    .sort((a, b) => a.n - b.n);

  const rate = Number(String(settings.mileage_rate || "").replace(/[^\d.]/g, "")) || 0;
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(settings.budget_request_deadline || "") ? settings.budget_request_deadline : "";

  return {
    rate,
    year: settings.budget_request_year || "",
    deadline,
    deadlineEnd: deadline ? DateTime.fromISO(deadline, { zone: TZ }).endOf("day").toISO() : "",
    expense: {
      official: pick("expense", "official").map((r) => r.key),
      send: send("expense"),
      lines: pick("expense", "line"),
      by: pick("expense", "by"),
      columns: pick("expense", "column"),
    },
    budget: {
      official: pick("budget", "official").map((r) => r.key),
      send: send("budget"),
      groups: ["both", "english", "spanish"].map((key) => ({ key, items: pick("budget", key) })).filter((g) => g.items.length),
      officers: pick("budget", "officer"),
      items: pick("budget", "item"),
    },
    committees: areaCommittees,
    officers,
    districts,
  };
}

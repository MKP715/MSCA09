// Area committees, officers, service schools, coordinate committees, sub-committees,
// ad hoc committees and service events — from data/committees.csv, with their
// documents and links from data/committee-resources.csv and their trusted servants
// from data/trusted-servants.csv.
//
// Meetings and events are NOT stored here: pages read them from the calendar
// (calendar.byCommittee[slug]) and documents from documents.byCommittee[slug].
//
// Shape (BUILD-SPEC §9.3):
//   { list:[Committee], bySlug, pages:[{lang,item}], groups:[{ key, label_en, label_es, about_en, about_es, icon, color, items }],
//     officers:[Committee], serviceEvents:[Committee], categories, stats }
//   Committee = { slug, url, name_en, name_es, short_en, short_es, category, icon, color, sort,
//     summary_en/_es, purpose_en/_es, activities_en/_es, involve_en/_es, structure_en/_es, history_en/_es (Markdown),
//     email, email_es, email_other, email_other_label_en/_es, phone, phone_label_en/_es, address, website,
//     aa_url, aa_url_es, calendar_match:[…], meets_at_area_meeting, meets_en/_es, liaison, parent, related:[slug],
//     notice:{en,es,url,end}|null, status, notes,
//     chairs:[Servant], servants:[Servant], positions:[Servant], members:[Servant], vacancies:[Servant], liaisons:[Servant], previous:[Servant],
//     resources:[Resource], guidelines:[Resource], pending:[Resource], aaResources:[Resource], links:[Resource], reports:[Resource],
//     faqs:[{q_en,q_es,a_en,a_es}], documents:[], series:[], upcoming:[] }
import { readCsv, num, yes, list } from "../_lib/csv.js";
import { LANGS, t } from "../_lib/i18n.js";
import loadServants from "./servants.js";

// Display order and look of the groups on /committees/. Labels live in data/text/committees.csv.
const GROUPS = [
  { key: "standing", icon: "users-round", color: "ocean" },
  { key: "school", icon: "graduation-cap", color: "sun" },
  { key: "coordinate", icon: "network", color: "blush" },
  { key: "subcommittee", icon: "hand-helping", color: "sage" },
  { key: "ad-hoc", icon: "clipboard-list", color: "lilac" },
  { key: "service-event", icon: "calendar-heart", color: "coral" },
];
const OFFICER = "officer";

const AA_KINDS = ["aa-guideline", "aa-workbook", "aa-kit", "aa-material", "aa-page", "pamphlet"];
const AA_ORDER = { "aa-page": 1, "aa-guideline": 2, "aa-workbook": 3, "aa-kit": 4, "aa-material": 5, pamphlet: 6 };
const STATUS_ORDER = { current: 0, draft: 1, reference: 2, superseded: 3, "": 4 };

function isLiveUntil(end) {
  if (!end) return true;
  return new Date().toISOString().slice(0, 10) <= end;
}

export default function () {
  const rows = readCsv("committees.csv").filter((r) => r.slug && !r.slug.startsWith("#"));
  const res = readCsv("committee-resources.csv").filter((r) => r.committee && !r.committee.startsWith("#"));
  const people = loadServants();

  const resBy = {};
  for (const r of res) {
    const item = {
      committee: r.committee,
      kind: (r.kind || "link").toLowerCase(),
      title_en: r.title_en || r.title || "",
      title_es: r.title_es || "",
      code: r.code || "",
      code_es: r.code_es || "",
      language: r.language || "",
      url: r.url || "",
      url_es: r.url_es || "",
      pdf: r.pdf || "",
      pdf_es: r.pdf_es || "",
      approved: r.approved || "",
      status: (r.status || "").toLowerCase(),
      sort: num(r.sort, 999),
      body_en: r.body_en || "",
      body_es: r.body_es || "",
      notes: r.notes || "",
    };
    (resBy[r.committee] ||= []).push(item);
  }
  for (const k of Object.keys(resBy)) resBy[k].sort((a, b) => a.sort - b.sort);

  const list_ = rows.map((r) => {
    const slug = r.slug;
    const resources = resBy[slug] || [];
    const servants = (people.byCommittee[slug] || []).slice().sort((a, b) => a.position_sort - b.position_sort);
    const isMember = (s) => /member|miembro/i.test(s.position_en);
    const isChair = (s) => /chair|co-chair|coordinat/i.test(s.position_en) || s.level === "area" || ["subcommittee", "ad-hoc"].includes(s.level);
    const chairs = servants.filter((s) => !isMember(s) && isChair(s));
    const positions = servants.filter((s) => !isMember(s) && !isChair(s));
    const members = servants.filter(isMember);
    const prev = people.previous.filter((s) => s.committee === slug);
    const guidelines = resources
      .filter((x) => x.kind === "guideline")
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4) || a.sort - b.sort);
    const notice = r.notice_en || r.notice_es ? { en: r.notice_en, es: r.notice_es || r.notice_en, url: r.notice_url || "", end: r.notice_end || "" } : null;
    return {
      slug,
      url: `/committees/${slug}/`,
      category: (r.category || "standing").toLowerCase(),
      sort: num(r.sort, 999),
      name_en: r.name_en || slug,
      name_es: r.name_es || r.name_en || slug,
      short_en: r.short_en || "",
      short_es: r.short_es || r.short_en || "",
      icon: r.icon || "users",
      color: r.color || "",
      summary_en: r.summary_en || "",
      summary_es: r.summary_es || "",
      purpose_en: r.purpose_en || "",
      purpose_es: r.purpose_es || "",
      activities_en: r.activities_en || "",
      activities_es: r.activities_es || "",
      involve_en: r.involve_en || "",
      involve_es: r.involve_es || "",
      structure_en: r.structure_en || "",
      structure_es: r.structure_es || "",
      history_en: r.history_en || "",
      history_es: r.history_es || "",
      email: r.email || "",
      email_es: r.email_es || "",
      email_other: r.email_other || "",
      email_other_label_en: r.email_other_label_en || "",
      email_other_label_es: r.email_other_label_es || "",
      phone: r.phone || "",
      phone_label_en: r.phone_label_en || "",
      phone_label_es: r.phone_label_es || "",
      address: r.address || "",
      website: r.website || "",
      aa_url: r.aa_url || "",
      aa_url_es: r.aa_url_es || "",
      calendar_match: list(r.calendar_match),
      meets_at_area_meeting: yes(r.meets_at_area_meeting),
      meets_en: r.meets_en || "",
      meets_es: r.meets_es || "",
      liaison: r.liaison || "",
      parent: r.parent || "",
      related: list(r.related),
      notice: notice && isLiveUntil(notice.end) ? notice : null,
      status: (r.status || "active").toLowerCase(),
      notes: r.notes || "",
      // people
      servants,
      chairs,
      positions,
      members,
      vacancies: servants.filter((s) => s.open),
      liaisons: [],
      previous: prev,
      // resources
      resources,
      guidelines,
      currentGuidelines: guidelines.filter((g) => g.status !== "superseded"),
      olderGuidelines: guidelines.filter((g) => g.status === "superseded"),
      pending: resources.filter((x) => x.kind === "pending"),
      aaResources: resources
        .filter((x) => AA_KINDS.includes(x.kind))
        .sort((a, b) => (AA_ORDER[a.kind] || 9) - (AA_ORDER[b.kind] || 9) || a.sort - b.sort),
      links: resources.filter((x) => ["form", "link", "video"].includes(x.kind)),
      reports: resources.filter((x) => x.kind === "report"),
      faqs: resources.filter((x) => x.kind === "faq").map((x) => ({ q_en: x.title_en, q_es: x.title_es, a_en: x.body_en, a_es: x.body_es })),
      // filled in by the pages from calendar.byCommittee / documents.byCommittee
      documents: [],
      series: [],
      upcoming: [],
    };
  });
  list_.sort((a, b) => a.sort - b.sort || a.name_en.localeCompare(b.name_en));

  const bySlug = Object.fromEntries(list_.map((c) => [c.slug, c]));
  // "Related" cards: the CSV's own list first, then committees of the same kind, then the officer
  // responsible — at least MIN_RELATED, so a small committee's page doesn't end with one lone card.
  const MIN_RELATED = 4;
  const relatedFor = (c) => {
    const seen = new Set([c.slug]);
    const out = [];
    const add = (x) => {
      if (x && !seen.has(x.slug) && x.status !== "inactive") seen.add(x.slug) && out.push(x);
    };
    c.related.forEach((s) => add(bySlug[s]));
    for (const x of list_) if (out.length < MIN_RELATED && x.category === c.category) add(x);
    for (const s of [c.parent, c.liaison, "chair"]) if (out.length < MIN_RELATED) add(bySlug[s]);
    return out;
  };
  // Liaisons (e.g. the Alternate Delegate for H&I and intergroups) and the officer/committee responsible.
  for (const c of list_) {
    const who = c.liaison || (c.chairs.length ? "" : c.parent);
    if (who && bySlug[who]) c.liaisons = bySlug[who].chairs.filter((s) => !s.open);
    c.relatedItems = relatedFor(c);
    c.parentItem = c.parent && bySlug[c.parent] ? bySlug[c.parent] : null;
    c.languages = [...new Set(c.servants.map((s) => s.language).filter(Boolean))];
    c.bilingual = !!c.email_es || c.servants.some((s) => /span/i.test(s.language));
  }

  const officers = list_.filter((c) => c.category === OFFICER);
  const committees = list_.filter((c) => c.category !== OFFICER);
  const groups = GROUPS.map((g) => ({
    ...g,
    label_en: t(`committees.group.${g.key}`, "en"),
    label_es: t(`committees.group.${g.key}`, "es"),
    about_en: t(`committees.group.${g.key}.about`, "en"),
    about_es: t(`committees.group.${g.key}.about`, "es"),
    items: committees.filter((c) => c.category === g.key),
  })).filter((g) => g.items.length);

  const pages = [];
  for (const lang of LANGS) for (const item of committees) pages.push({ lang, item });

  const chairSeats = committees.flatMap((c) => c.chairs);
  return {
    list: committees,
    all: list_,
    bySlug,
    pages,
    groups,
    officers,
    serviceEvents: committees.filter((c) => c.category === "service-event"),
    categories: groups.map(({ key, label_en, label_es, icon, color }) => ({ key, label_en, label_es, icon, color })),
    stats: {
      committees: committees.filter((c) => !["service-event"].includes(c.category)).length,
      standing: committees.filter((c) => c.category === "standing").length,
      serving: chairSeats.filter((s) => s.filled).length,
      open: committees.reduce((n, c) => n + c.vacancies.length, 0),
      helpWanted: committees.filter((c) => c.vacancies.length).length,
    },
  };
}

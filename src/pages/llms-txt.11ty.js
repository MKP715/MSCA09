// /llms.txt (English) and /es/llms.txt (Spanish): a short guide to this site for AI assistants, agents and other
// programs that read the llms.txt format (https://llmstxt.org) — what Area 09 is, how to find an A.A. meeting, the
// key pages, the districts, the central offices, the Area's role e-mail addresses and the data files. Search engines
// do not need it (they read the pages and /sitemap.xml); it helps a program that someone points at the site.
//
// Volunteers never edit this file. Everything in the guide comes from the data files, so it follows them by itself:
//   - its sentences and headings: data/text/llms.csv (en / es)
//   - the pages: the menu (data/nav.csv: each dropdown entry, or the item itself when it has none), each with the
//     description its page gives search engines (the page's description_key in data/text/*.csv)
//   - the districts: data/districts.csv (name and place as in search results, and the region)
//   - the central offices: data/central-offices.csv (public office lines only — the phone check allows them)
//   - the officers' role mailboxes: data/committees.csv (rows with category officer), plus email_footer in
//     data/settings.csv as the general contact
//   - the document shelves (data/document-categories.csv) and the committees (data/committees.csv)
// Never in it: servants' names, personal e-mails or phones, Zoom IDs or passcodes, and no build date or "updated"
// line — so the file changes only when the data does, and two builds of the same data give the same file.
// It is kept out of the sitemap and IndexNow (eleventyExcludeFromCollections), and the site search (Pagefind) and the
// app's offline copies never take it (they hold .html pages and what those load). scripts/check-site.mjs checks it
// like a page: contacts, full names, held Drive files and links to this site.
import { t, loc, lurl } from "../_lib/i18n.js";
import { districtMetaTitle } from "../_lib/plugins/districts.js";

export const data = {
  pagination: { data: "langs", size: 1, alias: "llmsLang", addAllPagesToCollections: false },
  permalink: (d) => (d.llmsLang.code === "es" ? "/es/llms.txt" : "/llms.txt"),
  eleventyExcludeFromCollections: true,
  layout: false,
};

// Only the Area's own mailboxes are listed here (…@msca09aa.org): a guide that programs copy from is no place for
// the free-mail role boxes or the one servant's own address that the pages show under their labels.
const ROLE_MAILBOX = /^[\w.+-]+@msca09aa\.org$/i;

export function render(d) {
  const L = d.llmsLang.code;
  const site = d.site || {};
  // absolute addresses, as in the sitemap ("/calendar/" → "https://msca09aa.org/calendar/")
  const base = String(site.url || "https://msca09aa.org").replace(/\/$/, "");
  const abs = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : base + u);
  const own = (u) => abs(lurl(u, L));
  // one Markdown list line: "- [label](address): note" (a label's [ ] would end the link early). Text from the CSVs
  // goes on one line, without the bit of markup (<strong> …) a page may show it with.
  const flat = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const item = (label, url, note) => `- [${flat(label).replace(/[[\]]/g, "\\$&")}](${url})${flat(note) ? `: ${flat(note)}` : ""}`;
  // "Central and coastal Orange County" + "Area 09 districts: 5, 6" + "Phone: …" → one line of sentences
  const sentences = (parts) => {
    const s = parts.map((p) => flat(p).replace(/\.+$/, "")).filter(Boolean);
    return s.length ? s.join(". ") + "." : "";
  };
  const out = [];
  const section = (heading, lines) => {
    if (lines.length) out.push("", `## ${heading}`, "", ...lines);
  };

  const D = d.districts || {};
  const stats = D.stats || {};
  out.push(
    `# ${t("llms.title", L, { name: t("site.name", L), short: t("site.short", L), of_aa: t("site.of_aa", L) })}`,
    "",
    `> ${flat(t("llms.summary", L, { n: stats.active, english: stats.english, spanish: stats.spanish }))}`,
    "",
    flat(t("llms.other_language", L, { url: abs(L === "es" ? "/llms.txt" : "/es/llms.txt") })),
    "",
    `- ${flat(t("llms.note.meetings", L, { guide: site.aa_meeting_guide, find: site.aa_find_meeting }))}`,
    `- ${flat(t("llms.note.service", L))}`,
    `- ${flat(t("llms.note.time", L, { tz: site.timezone }))}`,
    `- ${flat(t("llms.note.anonymity", L))}`,
  );

  // Key pages: Home, then the menu in its order. A dropdown stands for its item (Service → Area business …), and an
  // address already listed is skipped (Central offices & hotlines = /resources/#offices). A page that is not built
  // (a menu row ahead of its page) is left out rather than linked.
  const pages = new Map((d.collections?.all || []).map((p) => [p.url, p.data || {}]));
  const seen = new Set();
  const pageLines = [];
  const addPage = (label, url, fallback) => {
    const path = String(url || "").split("#")[0];
    const local = lurl(path, L);
    if (!path.startsWith("/") || seen.has(path) || !pages.has(local)) return;
    seen.add(path);
    pageLines.push(item(label, abs(local), pages.get(local).description || fallback));
  };
  addPage(t("nav.home", L), "/", "");
  for (const top of d.nav?.top || []) for (const r of top.children?.length ? top.children : [top]) addPage(loc(r, "label", L), r.url, loc(r, "desc", L));
  section(t("llms.h.pages", L), pageLines);

  section(
    t("llms.h.districts", L),
    (D.list || []).map((x) => item(districtMetaTitle(x, L), own(`/districts/${x.slug}/`), loc(x, "region", L))),
  );

  // Central offices: what they serve, the Area 09 districts they serve ("1 & 3" → "1 y 3" in Spanish, as on the
  // district pages) and their public numbers, each with its label as on the resources page ("(714) 556-4555 · 24 hours").
  section(
    t("llms.h.offices", L),
    (d.offices?.list || []).map((o) => {
      const phones = [
        [o.phone, loc(o, "phone_label", L)],
        [o.phone_2, loc(o, "phone_2_label", L)],
      ]
        .filter(([p]) => p)
        .map(([p, label]) => (label ? `${p} · ${label}` : p));
      const nums = (o.districts || []).map((x) => (L === "es" ? x.label.replace(/\s*&\s*/g, " y ") : x.label));
      const web = (L === "es" && o.website_es) || o.website || own("/resources/#offices");
      return item(
        loc(o, "name", L),
        web,
        sentences([
          loc(o, "serves", L),
          nums.length ? t("llms.office_districts", L, { list: nums.join(", ") }) : "",
          phones.length ? t("llms.office_phone", L, { phones: phones.join("; ") }) : "",
        ]),
      );
    }),
  );

  // Contact: the general address, each Area officer's role mailbox with what the officer does, and the P.O. box.
  const contact = [];
  if (ROLE_MAILBOX.test(site.email_footer || "")) contact.push(item(t("llms.contact_general", L), `mailto:${site.email_footer}`, t("llms.contact_general_note", L)));
  for (const c of d.committees?.officers || []) {
    const mail = (L === "es" && c.email_es) || c.email;
    if (ROLE_MAILBOX.test(mail || "")) contact.push(item(loc(c, "name", L), `mailto:${mail}`, loc(c, "summary", L)));
  }
  const postal = [site.mailing_name, site.mailing_po_box, site.mailing_city].filter(Boolean).join(", ");
  if (postal) contact.push(item(t("llms.contact_mail", L), own("/contact/"), postal));
  section(t("llms.h.contact", L), contact);

  section(t("llms.h.data", L), [
    item(t("llms.data.ics_en", L), abs("/calendar.ics"), t("llms.data.ics_note", L)),
    item(t("llms.data.ics_es", L), abs("/calendar-es.ics"), t("llms.data.ics_note", L)),
    item(t("llms.data.sitemap", L), abs("/sitemap.xml"), t("llms.data.sitemap_note", L)),
  ]);

  // "Optional" is a word of the llms.txt format, not wording: it tells a program that these links may be skipped
  // when it needs a shorter text, so it stays in English in both files. The shelves of the document library, then
  // every committee page (finished ad hoc committees are history: left out).
  section("Optional", [
    ...(d.documents?.categories || []).map((c) => item(t("llms.shelf", L, { name: loc(c, "label", L) }), own(`/documents/${c.key}/`), loc(c, "description", L))),
    ...(d.committees?.list || []).filter((c) => !["completed", "inactive"].includes(c.status)).map((c) => item(loc(c, "name", L), own(c.url), loc(c, "summary", L))),
  ]);

  return out.join("\n") + "\n";
}

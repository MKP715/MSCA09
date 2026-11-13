// Links and files used on the informational pages, from data/resources.csv.
//
// Columns: key, group, sort, page, title_en, title_es, url, url_es, description_en,
//   description_es, icon, color, language, license, show, notes
//  - key       a short name a page can ask for (resources.byKey["big-book"])
//  - group     cards are grouped by this on /resources/ (heading text: resources.group.<group>.title)
//  - page      where the row appears: resources; newcomers; contribute; policy; about (";"-list)
//  - url_es    the Spanish page, when the site has one (otherwise url is used)
//  - language  en / es / both — shows a small language tag
//  - show      "no" hides the row without deleting it
import { readCsv, num, list } from "../_lib/csv.js";

export default function () {
  const rows = readCsv("resources.csv")
    .filter((r) => (r.title_en || r.title) && !/^(no|n|false|0|hide|hidden)$/i.test(r.show || ""))
    .map((r, i) => ({
      ...r,
      key: r.key || `resource-${i + 1}`,
      sort: num(r.sort, 999),
      pages: list(r.page).map((p) => p.toLowerCase()),
      language: String(r.language || "").toLowerCase(),
    }))
    .sort((a, b) => a.sort - b.sort);

  const groupKeys = [...new Set(rows.map((r) => r.group || "other"))];
  const groups = groupKeys
    .map((key) => {
      const items = rows.filter((r) => (r.group || "other") === key);
      return { key, color: items[0]?.color || "ocean", icon: items[0]?.icon || "link", sort: items[0]?.sort ?? 999, items };
    })
    .sort((a, b) => a.sort - b.sort);

  const byPage = {};
  for (const r of rows) for (const p of r.pages) (byPage[p] ||= []).push(r);

  const pageGroups = (page) =>
    groups
      .map((g) => ({ ...g, items: g.items.filter((r) => r.pages.includes(page)) }))
      .filter((g) => g.items.length);

  return {
    list: rows,
    byKey: Object.fromEntries(rows.map((r) => [r.key, r])),
    groups,
    byPage,
    // groups shown on /resources/ (rows whose page list includes "resources")
    resourcesGroups: pageGroups("resources"),
  };
}

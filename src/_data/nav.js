// The menu, from data/nav.csv.
// Columns: sort, key, parent, label_en, label_es, url, icon, color, desc_en, desc_es, cta
//  - a row with an empty `parent` is a top-level item
//  - a row whose `parent` names another row's `key` is an entry in that item's dropdown
//  - cta = yes renders the item as a highlighted button (e.g. Contribute)
//  - {panel} / {years} in a label are replaced from data/settings.csv
import { readCsv, num, yes } from "../_lib/csv.js";

// Labels may say {panel} or {years}; they are filled in from data/settings.csv,
// so the menu never needs editing when the panel rotates.
export default function () {
  const settings = Object.fromEntries(readCsv("settings.csv").map((r) => [r.key, r.value]));
  const fill = (s) => String(s || "").replace(/\{panel\}/g, settings.panel || "").replace(/\{years\}/g, settings.panel_years || "");
  const rows = readCsv("nav.csv").map((r) => ({
    ...r,
    label_en: fill(r.label_en),
    label_es: fill(r.label_es),
    desc_en: fill(r.desc_en),
    desc_es: fill(r.desc_es),
    sort: num(r.sort, 999),
    cta: yes(r.cta),
    children: [],
  }));
  rows.sort((a, b) => a.sort - b.sort);
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key, r]));
  const top = [];
  for (const r of rows) {
    if (r.parent && byKey.has(r.parent)) byKey.get(r.parent).children.push(r);
    else if (!r.parent) top.push(r);
  }
  return { top, all: rows };
}

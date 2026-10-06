// Frequently asked questions, from data/faq.csv.
// Columns: page, sort, q_en, q_es, a_en, a_es, source, show
//  - page   newcomers / contribute / … (which page shows the question)
//  - a_en / a_es may use Markdown: **bold**, [link text](https://…), lists
//  - source where the answer comes from (not shown; for editors)
//  - show   "no" hides a question without deleting it
import { readCsv, num } from "../_lib/csv.js";

export default function () {
  const rows = readCsv("faq.csv")
    .filter((r) => (r.q_en || r.q) && !/^(no|n|false|0|hide|hidden)$/i.test(r.show || ""))
    .map((r, i) => ({ ...r, page: String(r.page || "").toLowerCase().trim(), sort: num(r.sort, 999), id: `faq-${r.page || "x"}-${i + 1}` }))
    .sort((a, b) => a.sort - b.sort);
  const byPage = {};
  for (const r of rows) (byPage[r.page] ||= []).push(r);
  return { list: rows, byPage };
}

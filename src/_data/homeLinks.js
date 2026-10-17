// Home page lists.
//
// tiles — the "quick actions" grid, from data/home-links.csv
//   Columns: sort, icon, color, title_en, title_es, body_en, body_es, url
//   {panel} and {years} in any text are replaced with the current panel from data/settings.csv,
//   so the tiles never need editing when the panel rotates.
//
// offices — local central offices / intergroups with a public phone line, for the
//   "New to A.A.?" tap-to-call band. Read from data/central-offices.csv (the same file the
//   Resources page uses), so phone numbers are typed in one place only. Rows with show = no,
//   or confirm = yes (number not yet confirmed), are left off the home page.
import { readCsv, num, yes } from "../_lib/csv.js";

function settings() {
  const out = {};
  for (const row of readCsv("settings.csv")) if (row.key) out[row.key] = row.value;
  return out;
}

export default function () {
  const s = settings();
  const fill = (v) =>
    String(v || "")
      .replace(/\{panel\}/g, s.panel || "")
      .replace(/\{years\}/g, s.panel_years || "");

  const tiles = readCsv("home-links.csv")
    .filter((r) => r.url && (r.title_en || r.title_es))
    .map((r) => {
      const out = { ...r, sort: num(r.sort, 999), external: /^https?:\/\//i.test(r.url) };
      for (const k of ["title_en", "title_es", "body_en", "body_es"]) out[k] = fill(r[k]);
      return out;
    })
    .sort((a, b) => a.sort - b.sort);

  const offices = readCsv("central-offices.csv")
    .filter((r) => r.phone)
    .filter((r) => !("show" in r) || r.show === "" || yes(r.show))
    .filter((r) => !yes(r.confirm))
    .map((r, i) => ({
      ...r,
      sort: num(r.sort, 100 + i),
      always: yes(r.always_open) || /24/.test(r.phone_label_en || r.phone_label || ""),
      spanish: /span|espa/i.test(r.language || ""),
      online: /online|en l[ií]nea/i.test(r.kind || ""),
      tel: "tel:+1" + String(r.phone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""),
    }))
    .filter((r) => !r.online)
    .sort((a, b) => a.sort - b.sort);

  return { tiles, offices };
}

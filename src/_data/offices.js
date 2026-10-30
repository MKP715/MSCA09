// Central offices, intergroups and hotlines, from data/central-offices.csv.
// Used by /newcomers/ (call now), /resources/#offices and the district pages
// (offices.byDistrict["d05"]).
//
// Columns: sort, key, show, region, name, name_es, kind, language, serves_en, serves_es,
//   districts (";"-list: 5; 6; 1 & 3), website, website_es, phone, phone_label_en, phone_label_es,
//   phone_2, phone_2_label_en, phone_2_label_es, tty, address, hours_en, hours_es,
//   always_open (yes = the main number is answered 24 hours), confirm (yes = a number still
//   needs confirming), verified, sources, notes
// Only public office / hotline numbers belong here — never a member's personal phone.
import { readCsv, num, yes, list } from "../_lib/csv.js";

const REGION_ORDER = ["oc", "coast", "inland", "desert", "highdesert", "online"];
const REGION_COLOR = { oc: "ocean", coast: "sea", inland: "copper", desert: "sun", highdesert: "lilac", online: "iris" };
const REGION_ICON = { oc: "sun", coast: "waves", inland: "mountain", desert: "sun-medium", highdesert: "mountain-snow", online: "globe" };

const pad2 = (n) => String(n).padStart(2, "0");
const slugOf = (v) => {
  const nums = String(v || "").match(/\d+/g);
  return nums ? "d" + nums.map((n) => pad2(Number(n))).join("-") : "";
};

export default function () {
  const rows = readCsv("central-offices.csv")
    .filter((r) => r.name && !/^(no|n|false|0|hide|hidden)$/i.test(r.show || ""))
    .map((r, i) => {
      const lang = String(r.language || "").toLowerCase();
      const districts = list(r.districts).map((d) => ({ label: d.replace(/\s+/g, " "), slug: slugOf(d) }));
      return {
        ...r,
        key: r.key || `office-${i + 1}`,
        sort: num(r.sort, 999),
        region: r.region || "other",
        color: r.color || REGION_COLOR[r.region] || "sea",
        spanish: /span|esp/.test(lang),
        online: r.region === "online" || /online/i.test(r.kind || ""),
        always_open: yes(r.always_open),
        confirm: yes(r.confirm),
        districts,
        district_slugs: districts.map((d) => d.slug).filter(Boolean),
      };
    })
    .sort((a, b) => a.sort - b.sort);

  const regionKeys = [...new Set([...REGION_ORDER.filter((k) => rows.some((r) => r.region === k)), ...rows.map((r) => r.region)])];
  const regions = regionKeys.map((key) => ({
    key,
    color: REGION_COLOR[key] || "sea",
    icon: REGION_ICON[key] || "map-pin",
    items: rows.filter((r) => r.region === key),
  }));

  const byDistrict = {};
  for (const r of rows) for (const s of r.district_slugs) (byDistrict[s] ||= []).push(r);

  return {
    list: rows,
    byKey: Object.fromEntries(rows.map((r) => [r.key, r])),
    regions,
    byDistrict,
    phones: rows.filter((r) => r.phone),
    hotlines: rows.filter((r) => r.phone && r.always_open),
    spanish: rows.filter((r) => r.spanish && r.phone),
    count: rows.filter((r) => r.phone).length,
  };
}

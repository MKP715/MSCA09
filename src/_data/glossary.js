// Bilingual service glossary, from data/glossary.csv.
// Columns: term_en, term_es, abbr_en, abbr_es, category, definition_en, definition_es, url, notes
import { readCsv } from "../_lib/csv.js";
import { fillSettings } from "../_lib/i18n.js";

const CATEGORIES = [
  { key: "group", label_en: "Groups", label_es: "Grupos", color: "sage", icon: "users" },
  { key: "district", label_en: "Districts", label_es: "Distritos", color: "copper", icon: "map" },
  { key: "area", label_en: "The Area", label_es: "El Área", color: "ocean", icon: "landmark" },
  { key: "meeting", label_en: "Meetings & votes", label_es: "Reuniones y votaciones", color: "iris", icon: "gavel" },
  { key: "conference", label_en: "The Conference", label_es: "La Conferencia", color: "coral", icon: "mic" },
  { key: "board", label_en: "Board & GSO", label_es: "Junta y OSG", color: "lilac", icon: "building-2" },
  { key: "money", label_en: "Self-support", label_es: "Automantenimiento", color: "sun", icon: "hand-coins" },
  { key: "other", label_en: "Other", label_es: "Otros", color: "sea", icon: "book-open" },
];

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export default function () {
  const cats = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
  const list = readCsv("glossary.csv")
    .filter((r) => r.term_en || r.term_es)
    .map((r) => {
      const category = cats[(r.category || "").toLowerCase()] ? r.category.toLowerCase() : "other";
      return {
        ...r,
        category,
        cat: cats[category],
        // one lower-case, accent-free string per row for the in-page search
        search: fold(fillSettings([r.term_en, r.term_es, r.abbr_en, r.abbr_es, r.definition_en, r.definition_es].join(" "))),
        letter_en: fold(r.term_en || r.term_es).replace(/[^a-z]/g, "").charAt(0).toUpperCase(),
        letter_es: fold(r.term_es || r.term_en).replace(/[^a-z]/g, "").charAt(0).toUpperCase(),
      };
    });
  const sortFor = (lc) =>
    [...list].sort((a, b) =>
      fold(a[`term_${lc}`] || a.term_en).replace(/^[^a-z0-9]+/, "").localeCompare(
        fold(b[`term_${lc}`] || b.term_en).replace(/^[^a-z0-9]+/, ""),
        lc
      )
    );
  const usedCats = CATEGORIES.filter((c) => list.some((r) => r.category === c.key));
  return { list, en: sortFor("en"), es: sortFor("es"), categories: usedCats, count: list.length };
}

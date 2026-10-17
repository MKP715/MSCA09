// The list of archived Delegate's Corner posts (src/content/delegate/*.md) for the
// searchable archive on /service/delegate/. Reads each file's front matter and its text (for the search).
import fs from "node:fs";
import path from "node:path";
import "../assets/js/search.js";
import { t } from "../_lib/i18n.js";
import { formatDate } from "../_lib/filters.js";

const { index } = globalThis.MSearch;
const DIR = path.join(process.cwd(), "src", "content", "delegate");

// Panel → who wrote most of the posts (first name + last initial only).
const PANELS = {
  70: { years: "2020–2021", color: "ocean" },
  72: { years: "2022–2023", color: "iris" },
  74: { years: "2024–2025", color: "sea" },
  76: { years: "2026–2027", color: "coral" },
};

// A list of districts in a post ("Districts 1, 4, and 12", "Districts 4 (9/2), 7 (8/10), and 12",
// "District #06 on 5/4, #04 on 5/5, #1/3 on 5/13", "D1&3") → "District 1 District 4 District 12", so the
// archive search finds every district of the list, not only the first. Dates in brackets or after "on" are skipped.
// Runs on text whose white space is already collapsed (the pattern is slow on long runs of spaces).
const DIST_DATE = String.raw`\d+\/\d+(?:\/\d+)?`;
const DIST_NOTE = String.raw`\([^)]*\)|\bon\s+${DIST_DATE}(?:\s*(?:,|\band\b|&)\s*${DIST_DATE}(?![\d\/]|\s*on\b))*`;
const DIST_ITEM = String.raw`#?\s*\d+(?![\da-z])(?:\s*(?:${DIST_NOTE}))*`;
const DIST_LIST = new RegExp(
  String.raw`\b(?:(?:districts?|distritos?)\s*:?\s*|d(?=#?\d))${DIST_ITEM}(?:(?:\s*(?:[,;&\/]|\band\b|\by\b))+\s*${DIST_ITEM})*`,
  "gi"
);
const DIST_NOTES = new RegExp(DIST_NOTE, "gi");
const districtNames = (text) =>
  (text.match(DIST_LIST) || [])
    .flatMap((m) => m.replace(DIST_NOTES, " ").replace(/^\D+/, "").match(/\d+/g) || [])
    .filter((n) => Number(n) > 0 && Number(n) < 100)
    .map((n) => `District ${Number(n)}`)
    .join(" ");

function frontMatter(text) {
  const m = text.replace(/\r/g, "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

export default function () {
  if (!fs.existsSync(DIR)) return { list: [], years: [], panels: [], count: 0 };
  const list = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, body } = frontMatter(fs.readFileSync(path.join(DIR, f), "utf8"));
      const slug = f.replace(/\.md$/, "");
      const date = String(data.date || slug.slice(0, 10));
      const panel = String(data.panel || "");
      const kind = data.kind || "reflection";
      const author_es = data.author_es || data.author_en || "";
      // the post as a reader sees it: link text instead of [text](url); hyphens kept ("pre-conference")
      const text = body
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      const plain = text
        .replace(/[#*_>`|-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const kindKey = `service.posts.kind_${kind}`;
      return {
        slug,
        url: `/service/delegate/posts/${slug}/`,
        title: data.title || slug,
        date,
        year: date.slice(0, 4),
        panel,
        panelInfo: PANELS[panel] || null,
        author_en: data.author_en || "",
        author_es,
        kind,
        summary: data.summary || plain.slice(0, 180),
        words: Number(data.words) || plain.split(" ").length,
        minutes: Math.max(1, Math.round((Number(data.words) || plain.split(" ").length) / 220)),
        // what the archive search looks through (MSearch.index, each word once): the whole post plus
        // everything its card shows in either language — panel and kind chips, month, day and year, both bylines
        search: index(
          data.title,
          data.summary,
          data.author_en,
          author_es,
          panel ? t("service.posts.panel_n", "en", { n: panel }) : "",
          t(kindKey, "en"),
          t(kindKey, "es"),
          formatDate(date, "month", "en"),
          formatDate(date, "month", "es"),
          formatDate(date, "day", "en"),
          districtNames(text),
          text
        ),
        // the title, and what the card itself says: posts whose title, then whose card, has every word are
        // listed first (service.js svcPosts)
        titleSearch: index(data.title),
        card: index(data.title, data.summary, data.author_en, author_es),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

  const years = [...new Set(list.map((p) => p.year))].sort().reverse();
  const panels = [...new Set(list.map((p) => p.panel).filter(Boolean))].sort();
  const byYear = years.map((y) => ({ year: y, items: list.filter((p) => p.year === y) }));
  return { list, years, panels, byYear, count: list.length, panelInfo: PANELS };
}

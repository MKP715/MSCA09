// The list of archived Delegate's Corner posts (src/content/delegate/*.md) for the
// searchable archive on /service/delegate/. Reads only each file's front matter.
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "src", "content", "delegate");

// Panel → who wrote most of the posts (first name + last initial only).
const PANELS = {
  70: { years: "2020–2021", color: "ocean" },
  72: { years: "2022–2023", color: "iris" },
  74: { years: "2024–2025", color: "sea" },
  76: { years: "2026–2027", color: "coral" },
};

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
      const plain = body
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[#*_>`|-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        slug,
        url: `/service/delegate/posts/${slug}/`,
        title: data.title || slug,
        date,
        year: date.slice(0, 4),
        panel,
        panelInfo: PANELS[panel] || null,
        author_en: data.author_en || "",
        author_es: data.author_es || data.author_en || "",
        kind: data.kind || "reflection",
        summary: data.summary || plain.slice(0, 180),
        words: Number(data.words) || plain.split(" ").length,
        minutes: Math.max(1, Math.round((Number(data.words) || plain.split(" ").length) / 220)),
        // what the in-page search looks through (lower case, no accents)
        search: [data.title, data.summary, data.author_en, plain.slice(0, 1500)]
          .join(" ")
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase(),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

  const years = [...new Set(list.map((p) => p.year))].sort().reverse();
  const panels = [...new Set(list.map((p) => p.panel).filter(Boolean))].sort();
  const byYear = years.map((y) => ({ year: y, items: list.filter((p) => p.year === y) }));
  return { list, years, panels, byYear, count: list.length, panelInfo: PANELS };
}

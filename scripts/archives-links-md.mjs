// Writes ARCHIVES-DRIVE-LINKS.md: every Google Drive folder (and directly linked file) that the Area 09
// Archives Committee's website, msca09aa-archives.org, links to — grouped by the page it appears on —
// with the number of files in each folder and how this website shows it.
//
// Source: data/archives/collections.csv (one row per link), data/archives/files.json (file counts, refreshed by
// scripts/archives-index.mjs) and the site's document loader (how many of those files the library lists). Run after
// any of them changes:
//
//   node scripts/archives-links-md.mjs
import fs from "node:fs";
import path from "node:path";
import { readCsv } from "../src/_lib/csv.js";
import loadDocuments from "../src/_data/documents.js";

const OUT = path.join(process.cwd(), "ARCHIVES-DRIVE-LINKS.md");
const SITE = "https://msca09aa-archives.org/";
const rows = readCsv("archives/collections.csv").filter((r) => r.key && !r.key.startsWith("#") && r.drive_id);
let data = {};
try {
  data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "archives", "files.json"), "utf8")).collections || {};
} catch {
  /* no list yet */
}

// How many files of each link the library lists (copies, the Area's own copies and held files are left out)
const listed = {};
try {
  for (const sec of loadDocuments().archiveSections || []) for (const it of sec.items || []) listed[it.key] = it.listed || 0;
} catch (e) {
  console.warn(`[archives] could not load the library (${e.message}); listed counts left out`);
}

const url = (r) => (r.kind === "folder" ? `https://drive.google.com/drive/folders/${r.drive_id}` : `https://drive.google.com/file/d/${r.drive_id}/view`);
const num = (n) => (n || n === 0 ? Number(n).toLocaleString("en-US") : "—");
const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const SHOWN = {
  files: "In the library, file by file",
  link: "Collection card (opens the folder)",
  off: "Not shown",
};
// "In the library: 41 of 52 files" / "In the library" / "Held from the library" for one link
const shownAs = (r, count) => {
  if (r.mode !== "files" || !(r.key in listed)) return SHOWN[r.mode] || r.mode;
  const n = listed[r.key];
  if (r.kind !== "folder") return n ? "In the library" : "Held from the library (not listed)";
  if (count === 0) return "In the library (the folder is empty for now)";
  return count != null ? `In the library: ${num(n)} of ${num(count)} files` : `In the library: ${num(n)} files`;
};
const pageOf = (r) => (r.archives_url || SITE).replace(/^https?:\/\//, "").replace(/\/$/, "");

// Sections in the order of the Archives site's menu (the CSV's sort column), each with its folders and files.
const sections = new Map();
for (const r of [...rows].sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))) {
  if (!sections.has(r.section_en)) sections.set(r.section_en, { name: r.section_en, name_es: r.section_es, pages: {}, folders: [], files: [] });
  const s = sections.get(r.section_en);
  const pg = r.archives_url || SITE;
  s.pages[pg] = (s.pages[pg] || 0) + 1;
  (r.kind === "folder" ? s.folders : s.files).push(r);
}
// A section's page is the Archives page most of its links come from (a few may sit on another page, e.g. the home page).
for (const s of sections.values()) s.page = Object.entries(s.pages).sort((a, b) => b[1] - a[1])[0][0];

const all = [...sections.values()];
// " (linked from the home page)" when a link sits on another Archives page than the rest of its section
const elsewhere = (r, s) => ((r.archives_url || SITE) !== s.page ? ` (linked from [${pageOf(r)}](${r.archives_url || SITE}))` : "");
const nFolders = rows.filter((r) => r.kind === "folder").length;
const nFiles = rows.filter((r) => r.kind !== "folder").length;
const counted = rows.filter((r) => r.kind === "folder" && data[r.key] && data[r.key].count != null);
const filesInFolders = counted.reduce((s, r) => s + (data[r.key].count || 0), 0);
const uncounted = nFolders - counted.length;
const inLibrary = rows.filter((r) => r.mode === "files").reduce((s, r) => s + (listed[r.key] || 0), 0);

const L = [];
L.push("# Area 09 Archives — Google Drive links");
L.push("");
L.push(
  `Every Google Drive folder and file that the Area 09 Archives Committee's website, [msca09aa-archives.org](${SITE}), links to: **${nFolders} main folders** and **${nFiles} files linked directly**, grouped by the page of the Archives website where each link appears. ` +
    `The daily listing reads ${num(filesInFolders)} files in ${counted.length} of the folders` +
    (uncounted ? ` (the ${uncounted} folder${uncounted === 1 ? "" : "s"} marked *Not shown* ${uncounted === 1 ? "is" : "are"} not read or counted)` : "") +
    (Object.keys(listed).length ? `; the Area's document library lists ${num(inLibrary)} files from these links.` : "."),
);
L.push("");
const shown = rows.filter((r) => r.mode === "files" || r.mode === "link");
const shortcutSections = new Set(shown.map((r) => r.section_en)).size;
L.push(
  "The Archives Committee owns and keeps these folders. The Area website lists the files of the collections marked *In the library* on its document shelves, shows the others as collection cards on `/documents/archive/`, and leaves out the ones marked *Not shown* (the notes say why). " +
    "*In the library: N of M* counts the files the library lists: it leaves out extra copies, files the Area's library already has, and files held because they print members' contact details or list people by name.",
);
L.push("");
L.push(
  `**Drive shortcuts.** \`scripts/archives-shortcuts.gs\` puts a shortcut to each shown link (${shown.length} shortcuts, in ${shortcutSections} section folders) in the Area's Drive folder \`MSCA09AA/MSCA09AA-archives/\` — never a copy — when the owner of the MSCA09AA folder runs it once at script.google.com (instructions at the top of the script). Links marked *Not shown* get no shortcut, because that Drive folder is shared with anyone who has the link.`,
);
L.push("");
L.push(
  "File counts come from the daily listing (`data/archives/files.json`); a folder that is not listed shows —. This file is generated from `data/archives/collections.csv` — edit that file, then run `node scripts/archives-links-md.mjs`.",
);
L.push("");
L.push("## Sections");
L.push("");
L.push("| Section (Archives page) | Main folders | Files linked directly |");
L.push("|---|---:|---:|");
for (const s of all) {
  const anchor = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  L.push(`| [${esc(s.name)}](#${anchor}) | ${s.folders.length} | ${s.files.length} |`);
}
L.push("");

for (const s of all) {
  L.push(`## ${s.name}`);
  L.push("");
  L.push(`*${esc(s.name_es)}* · on the Archives website: [${pageOf({ archives_url: s.page })}](${s.page})`);
  L.push("");
  if (s.folders.length) {
    L.push("### Main folders");
    L.push("");
    L.push("| Folder | Google Drive link | Files | Sub-folders | On the Area website |");
    L.push("|---|---|---:|---:|---|");
    for (const r of s.folders) {
      const d = data[r.key] || {};
      const note = (r.mode === "off" && r.notes ? ` — ${esc(r.notes).replace(/\.$/, "")}` : "") + elsewhere(r, s);
      L.push(`| ${esc(r.title_en)} | [Open folder](${url(r)}) | ${num(d.count)} | ${num(d.folders)} | ${shownAs(r, d.count)}${note} |`);
    }
    L.push("");
  }
  if (s.files.length) {
    L.push("### Files linked directly");
    L.push("");
    L.push("| File | Google Drive link | On the Area website |");
    L.push("|---|---|---|");
    for (const r of s.files) {
      const note = (r.mode === "off" && r.notes ? ` — ${esc(r.notes).replace(/\.$/, "")}` : "") + elsewhere(r, s);
      L.push(`| ${esc(r.title_en)} | [Open file](${url(r)}) | ${shownAs(r, 1)}${note} |`);
    }
    L.push("");
  }
}

L.push("## Not in Google Drive");
L.push("");
L.push(
  "Some files on msca09aa-archives.org are stored on the website itself, not in Drive: the Area motions compilations (1959–2024, [area-09-motions](https://msca09aa-archives.org/area-09-motions)), the history pamphlets ([archive-pamphlets](https://msca09aa-archives.org/archive-pamphlets)), the Heritage Day speaker recordings ([heritage-day-recordings-1](https://msca09aa-archives.org/heritage-day-recordings-1)) and the 2027 National Archives Workshop registration forms. " +
    "The pamphlets and the workshop forms were saved to the Area's Drive (`docs/history`, `docs/service`, `docs/events/2027`; listed in `data/documents/archives-site.csv`). The Area's library has its own copies of the motions compilations for 1970–79 and 2000–2024; its 1959–69, 1980–89 and 1990–99 copies are held for anonymity review, so the site links the Archives' Motions page instead. " +
    "Four pages are for signed-in members only (Videos and Presentations, Standing Committee Files, Pre-Conference Material, PRAASA Timeline) and are not included.",
);
L.push("");

fs.writeFileSync(OUT, L.join("\n"));
console.log(`[archives] ${nFolders} folders and ${nFiles} files → ${path.basename(OUT)}`);

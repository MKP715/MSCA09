// Lists the files in the Area 09 Archives Committee's public Google Drive folders (the ones
// msca09aa-archives.org links to), so the document library can show them next to the Area's own
// documents — and keeps showing what the Archives add, with nobody editing a CSV.
//
// No API key or sign-in: it reads Google Drive's public folder view
// (https://drive.google.com/embeddedfolderview?id=…), the same page anyone with the link can open.
//
// Input:  data/archives/collections.csv — one row per folder or file the Archives site links to, and how
//         the site shows it (mode = files | link | off; see the note at the top of that file).
// Output: data/archives/files.json — committed to the repository, so the site still builds when Google
//         does not answer. A collection is re-read when its copy is older than a day (mode = files) or a
//         week (mode = link: only its file count is shown); a collection Google does not answer keeps its
//         last copy. The whole run stops after 8 minutes and keeps the rest for the next build.
//
//   node scripts/archives-index.mjs           (refresh what is due)
//   node scripts/archives-index.mjs --force   (re-read everything; ARCHIVES_BUDGET_MIN=40 gives it time)
import fs from "node:fs";
import path from "node:path";
import { readCsv } from "../src/_lib/csv.js";

const OUT = path.join(process.cwd(), "data", "archives", "files.json");
const FORCE = process.argv.includes("--force");
const DAY = 24 * 3600 * 1000;
const STALE = { files: 20 * 3600 * 1000, link: 6 * DAY };
// ARCHIVES_BUDGET_MIN lets a first run (or a run by hand) take longer than a build should.
const BUDGET_MS = (Number(process.env.ARCHIVES_BUDGET_MIN) || 8) * 60 * 1000;
const CONCURRENCY = 4;
const started = Date.now();
const UA = { "User-Agent": "Mozilla/5.0 (compatible; MSCA09-site-builder; +https://github.com/MKP715/MSCA09)" };

const rows = readCsv("archives/collections.csv").filter((r) => r.key && !r.key.startsWith("#") && r.drive_id && r.mode && r.mode !== "off");
let prev = { collections: {} };
try {
  prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
} catch {
  /* first run */
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .trim();

async function get(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (res.status === 404 || res.status === 401 || res.status === 403) return { status: res.status, body: "" };
      if (res.ok) return { status: res.status, body: await res.text() };
    } catch {
      /* network hiccup: retry */
    }
    await sleep(1500 * (t + 1));
  }
  return { status: 0, body: "" };
}

/** One folder's entries: { title, entries: [{ id, name, folder: bool, mime }] } — or { failed: status } when Google
 *  does not show it (401/403/404: private or deleted; 0: no answer after the retries). */
async function listFolder(id) {
  const { status, body } = await get(`https://drive.google.com/embeddedfolderview?id=${id}`);
  if (status !== 200 || !body.includes("flip-")) return { failed: status || 0 };
  const title = decode((body.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
  const entries = body
    .split('<div class="flip-entry" id="entry-')
    .slice(1)
    .map((chunk) => {
      const cid = chunk.split('"', 1)[0];
      const href = (chunk.match(/<a href="([^"]+)"/) || [])[1] || "";
      const icon = (chunk.match(/<div class="flip-entry-list-icon"><img src="([^"]*)"/) || [])[1] || "";
      const name = decode((chunk.match(/<div class="flip-entry-title">([\s\S]*?)<\/div>/) || [])[1]);
      const mime = icon.includes("/type/") ? decodeURIComponent(icon.split("/type/")[1]) : "";
      const folder = href.includes("/folders/") || chunk.includes('aria-label="Folder"') || mime === "application/vnd.google-apps.folder";
      return { id: cid, name, folder, mime };
    })
    .filter((e) => e.id);
  return { title, entries };
}

/** A single shared file's name (from its public page). */
async function fileName(id) {
  const { status, body } = await get(`https://drive.google.com/file/d/${id}/view`);
  if (status !== 200) return null;
  const t = body.match(/<meta property="og:title" content="([^"]*)"/) || body.match(/<title>([\s\S]*?)<\/title>/);
  return t ? decode(t[1]).replace(/ - Google Drive$/, "") : null;
}

const hasExt = (n) => /\.[a-z0-9]{2,5}$/i.test(n || "");

/** Every file under a folder: { files: [{ i, n, p, m? }], folders } — null if the top folder is not shown. */
async function walk(rootId) {
  const top = await listFolder(rootId);
  if (top.failed !== undefined) return null;
  const files = [];
  let folders = 0;
  const queue = [{ id: rootId, p: "", depth: 0, listing: top }];
  const seen = new Set([rootId]);
  while (queue.length) {
    if (Date.now() - started > BUDGET_MS) throw new Error("time budget used up");
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(
      batch.map(async (f) => {
        const listing = f.listing || (await listFolder(f.id));
        if (listing.failed !== undefined) {
          // A sub-folder made private or deleted is simply gone; one Google did not answer must not shrink the list:
          // stop, and the collection keeps its last copy until the next run.
          if ([401, 403, 404].includes(listing.failed)) return;
          throw new Error(`sub-folder "${f.p}" did not load (status ${listing.failed})`);
        }
        for (const e of listing.entries) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (e.folder) {
            folders++;
            if (f.depth < 12) queue.push({ id: e.id, p: f.p ? `${f.p}/${e.name}` : e.name, depth: f.depth + 1 });
          } else {
            const row = { i: e.id, n: e.name, p: f.p };
            if (!hasExt(e.name) && e.mime) row.m = e.mime;
            files.push(row);
          }
        }
      })
    );
  }
  return { files, folders };
}

const out = { collections: { ...(prev.collections || {}) } };
let refreshed = 0;
let kept = 0;
let failed = 0;
const wanted = new Set(rows.map((r) => r.key));
for (const k of Object.keys(out.collections)) if (!wanted.has(k)) delete out.collections[k];

for (const r of rows) {
  const old = out.collections[r.key];
  const due = FORCE || !old || old.id !== r.drive_id || Date.now() - Date.parse(old.checked || 0) > (STALE[r.mode] || STALE.link);
  if (!due) {
    kept++;
    continue;
  }
  if (Date.now() - started > BUDGET_MS) {
    console.log(`[archives] time is up — ${r.key} and later collections keep their last copy`);
    break;
  }
  try {
    if (r.kind === "folder") {
      const w = await walk(r.drive_id);
      if (!w) throw new Error("folder not shown");
      // Guard: a list that suddenly shrinks a lot is more likely a hiccup than the Archives deleting files.
      if (!FORCE && r.mode === "files" && old && old.files && old.files.length >= 20 && w.files.length < old.files.length * 0.8)
        throw new Error(`the list shrank from ${old.files.length} to ${w.files.length} files (run with --force if that is right)`);
      out.collections[r.key] = {
        id: r.drive_id,
        kind: "folder",
        checked: new Date().toISOString(),
        count: w.files.length,
        folders: w.folders,
        // mode = link only shows how many files the folder holds; the list itself is kept for mode = files
        ...(r.mode === "files" ? { files: w.files } : {}),
      };
    } else {
      const name = await fileName(r.drive_id);
      if (!name) throw new Error("file not shown");
      out.collections[r.key] = { id: r.drive_id, kind: "file", checked: new Date().toISOString(), count: 1, name };
    }
    refreshed++;
  } catch (err) {
    failed++;
    console.warn(`[archives] ${r.key}: ${err.message} — keeping the last copy`);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
// Stable order (collections by key, one file per line) keeps the committed file's diffs small. "generated" changes only
// when a collection was re-read, and the file is written only when its content changes, so the build commits it
// about once a day (when the file lists are due), not at every run.
const sorted = Object.fromEntries(Object.entries(out.collections).sort(([a], [b]) => a.localeCompare(b)));
const generated = refreshed ? new Date().toISOString() : prev.generated || new Date().toISOString();
const lines = [`{"generated":${JSON.stringify(generated)},"collections":{`];
const keys = Object.keys(sorted);
keys.forEach((k, n) => {
  const { files, ...head } = sorted[k];
  const end = n < keys.length - 1 ? "," : "";
  if (!files) {
    lines.push(`${JSON.stringify(k)}:${JSON.stringify(head)}${end}`);
    return;
  }
  lines.push(`${JSON.stringify(k)}:${JSON.stringify(head).slice(0, -1)},"files":[`);
  files.forEach((f, j) => lines.push(JSON.stringify(f) + (j < files.length - 1 ? "," : "")));
  lines.push(`]}${end}`);
});
lines.push("}}");
const text = lines.join("\n") + "\n";
let before = "";
try {
  before = fs.readFileSync(OUT, "utf8");
} catch {
  /* first run */
}
if (text !== before) fs.writeFileSync(OUT, text);
const total = Object.values(sorted).reduce((s, c) => s + (c.files ? c.files.length : 0), 0);
console.log(`[archives] ${refreshed} collection(s) re-read, ${kept} still fresh, ${failed} kept from the last run; ${total} files listed → data/archives/files.json`);

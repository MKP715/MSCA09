// Lists every file in the Area's shared Google Drive folder, so documents dropped
// into Drive show up on the site without anyone editing a CSV.
//
// Optional. Needs a Google API key (free) in the environment as GOOGLE_API_KEY —
// on GitHub that is a repository secret. Without it this script does nothing and
// the site uses the document index (data/documents/*.csv) alone.
//
// The Drive folder to list comes from DRIVE_FOLDER_ID — on GitHub that is a repository
// variable (Settings → Secrets and variables → Actions → Variables), so the folder id is
// never published in the repository. drive_folder_id in data/settings.csv is used only
// when the variable is not set (keep it empty in the public repository).
//
// Output: data/generated/drive-files.json  (not committed; rebuilt every run)
// Which folders are read, and how their files are labelled, is set in
// data/drive-folders.csv (folder path → category, collection, include yes/no).
//
//   GOOGLE_API_KEY=... DRIVE_FOLDER_ID=... node scripts/drive-index.mjs
import fs from "node:fs";
import path from "node:path";
import { readCsv, yes } from "../src/_lib/csv.js";

const key = process.env.GOOGLE_API_KEY;
const outDir = path.join(process.cwd(), "data", "generated");
const outFile = path.join(outDir, "drive-files.json");

if (!key) {
  console.log("[drive] GOOGLE_API_KEY not set — skipping the automatic Drive listing (data/documents/*.csv is used as-is)");
  process.exit(0);
}

const settings = Object.fromEntries(readCsv("settings.csv").map((r) => [r.key, r.value]));
const rootId = (process.env.DRIVE_FOLDER_ID || settings.drive_folder_id || "").trim();
if (!rootId) {
  console.warn("[drive] no Drive folder: set the DRIVE_FOLDER_ID repository variable (or drive_folder_id in data/settings.csv) — skipping");
  process.exit(0);
}

// Folder rules: longest matching path prefix wins.
const rules = readCsv("drive-folders.csv")
  .map((r) => ({ ...r, path: (r.path || "").replace(/^\/+|\/+$/g, "") }))
  .sort((a, b) => b.path.length - a.path.length);
const ruleFor = (p) => rules.find((r) => p === r.path || p.startsWith(r.path + "/") || r.path === "");

const FOLDER = "application/vnd.google-apps.folder";
const api = "https://www.googleapis.com/drive/v3/files";

async function list(folderId) {
  const files = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, size, webViewLink, thumbnailLink)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      key,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${api}?${params}`);
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    files.push(...(json.files || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return files;
}

const all = [];
async function walk(folderId, folderPath, depth = 0) {
  if (depth > 8) return;
  const rule = ruleFor(folderPath);
  if (rule && rule.include && !yes(rule.include)) return; // folder switched off in drive-folders.csv
  const items = await list(folderId);
  for (const f of items) {
    const p = folderPath ? `${folderPath}/${f.name}` : f.name;
    if (f.mimeType === FOLDER) await walk(f.id, p, depth + 1);
    else if (!/^desktop\.ini$|\.lnk$|^\./i.test(f.name)) {
      const r = ruleFor(folderPath) || {};
      all.push({
        id: f.id,
        name: f.name,
        path: p,
        folder: folderPath,
        mimeType: f.mimeType,
        size: Number(f.size || 0),
        modified: f.modifiedTime,
        created: f.createdTime,
        url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        category: r.category || "",
        collection: r.collection || "",
      });
    }
  }
}

// Safety (Tradition Eleven): never list the unredacted original of a "-redacted" copy, wherever it is.
// src/_data/documents.js checks this again, and also skips every file held in data/documents/held.csv.
function dropRedactedTwins(files) {
  const base = (p) => p.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "");
  const twins = new Set(files.filter((f) => /-redacted\.[a-z0-9]{2,5}$/i.test(f.path)).map((f) => base(f.path).replace(/-redacted$/, "")));
  return files.filter((f) => /-redacted\.[a-z0-9]{2,5}$/i.test(f.path) || !twins.has(base(f.path)));
}

try {
  await walk(rootId, "");
  const before = all.length;
  const files = dropRedactedTwins(all);
  if (files.length < before) console.log(`[drive] left out ${before - files.length} unredacted original(s) of "-redacted" copies`);
  all.length = 0;
  all.push(...files);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), files: all }, null, 1));
  console.log(`[drive] listed ${all.length} files → data/generated/drive-files.json`);
} catch (err) {
  console.warn(`[drive] listing failed (${err.message}) — the site will use data/documents/*.csv only`);
  process.exit(0);
}

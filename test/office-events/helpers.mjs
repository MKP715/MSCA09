// Shared helpers for the central-office events tests (node --test test/office-events/). No network: the saved,
// masked responses in fixtures/<office>/ (written by node scripts/office-events.mjs --save-fixtures …) stand in for
// the offices' websites, and "now" is fixed at 2026-10-30 12:00 Pacific time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readCsv } from "../../src/_lib/csv.js";
import { adapters, filterRecords, mapType, cleanRecord, parseOptions, hostOf, toPT, aanocCards, mimeOf, RECORD_DROPPED } from "../../src/_lib/office-import.js";

export const NOW = "2026-10-30T12:00-07:00";
export const TODAY = "2026-10-30";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export const fixture = (office, name) => fs.readFileSync(path.join(DIR, office, name), "utf8");
export const fixtureJson = (office, name) => JSON.parse(fixture(office, name));
export const fixtureFiles = (office) => fs.readdirSync(path.join(DIR, office)).sort();
/** The saved pages of an office's Events Calendar API, in order. */
export const tribePages = (office) => fixtureFiles(office).filter((f) => /^events-\d+\.json$/.test(f)).map((f) => fixtureJson(office, f));

const sources = readCsv("office-event-sources.csv");
const offices = readCsv("central-offices.csv");
/** The office's row of data/office-event-sources.csv. */
export const sourceRow = (office) => sources.find((r) => r.office === office) || {};
/** The office's website host (data/central-offices.csv). */
export const officeHost = (office) => hostOf((offices.find((r) => r.key === office) || {}).website || "");
/** The adapter options of an office, as the importer passes them. */
export function adapterOpts(office, extra = {}) {
  const row = sourceRow(office);
  return {
    office,
    host: officeHost(office),
    now: NOW,
    lang: /^spanish$/i.test((offices.find((r) => r.key === office) || {}).language || "") ? "Spanish" : "English",
    options: parseOptions(row.options),
    eventsPage: row.events_page || "",
    ...extra,
  };
}
/** adapter → filterRecords → mapType → cleanRecord, as scripts/office-events.mjs does (without the network). A record
 *  that cleanRecord leaves out (a personal detail in its title: RECORD_DROPPED) is skipped, its id listed in `held`. */
export function pipeline(office, raw, extra = {}) {
  const opts = adapterOpts(office, extra);
  const got = adapters[sourceRow(office).adapter](raw, opts);
  const { kept, dropped } = filterRecords(got.records, { now: NOW });
  const records = [];
  const held = [];
  for (const r of kept) {
    try {
      records.push(cleanRecord({ ...r, type: mapType(r) }, { officeHost: opts.host, eventsPage: opts.eventsPage, now: NOW }));
    } catch (e) {
      if (!e || e.code !== RECORD_DROPPED) throw e;
      held.push(e.id);
    }
  }
  return { stats: got.stats, raw: got.records, dropped, records, held, byTitle: (re) => records.find((r) => re.test(r.title)) };
}
/** A deep copy of a value (fixtures are changed in some tests). */
export const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ the importer CLI in a sandbox */
// scripts/office-events.mjs run in a scratch folder (its cwd: data/ holds a copy of the data files it reads) with a
// response cache made from the masked fixtures: OFFICE_HTTP_CACHE + OFFICE_HTTP_OFFLINE=1, so nothing leaves the
// machine (an answer that is not in the cache counts as a failed request; a robots.txt that is not there disallows the
// whole site). The cache files are named as the importer names them: <kind>-<sha1 of the url>.json.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMPORTER = path.join(REPO, "scripts", "office-events.mjs");
const DATA_FILES = ["central-offices.csv", "event-types.csv", "link-fixes.csv", "contact-allowlist.csv", "resources.csv", "trusted-servants.csv", "name-allowlist.csv"];
const sha1 = (s) => createHash("sha1").update(String(s)).digest("hex");
export const REVIEW_HEADER = "url,sha256,checked_on,result,notes\n";
export const ROBOTS_OK = "User-agent: *\nDisallow: /wp-admin/\n";

/** A scratch folder for the importer with only these offices' rows of data/office-event-sources.csv. */
export function importerSandbox(offices) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-cli-"));
  fs.mkdirSync(path.join(dir, "data"));
  for (const f of DATA_FILES) fs.copyFileSync(path.join(REPO, "data", f), path.join(dir, "data", f));
  const lines = fs.readFileSync(path.join(REPO, "data", "office-event-sources.csv"), "utf8").replace(/\r\n/g, "\n").split("\n");
  fs.writeFileSync(path.join(dir, "data", "office-event-sources.csv"), [lines[0], ...lines.filter((l) => offices.some((k) => l.startsWith(`${k},`)))].join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "data", "office-flyer-review.csv"), REVIEW_HEADER);
  const cache = path.join(dir, "cache");
  fs.mkdirSync(cache);
  const file = (...p) => path.join(dir, ...p);
  return {
    dir, cache, file,
    mirrorPath: file("data", "central-office-events.json"),
    mirror: () => (fs.existsSync(file("data", "central-office-events.json")) ? fs.readFileSync(file("data", "central-office-events.json"), "utf8") : ""),
    put: (kind, url, value) => fs.writeFileSync(path.join(cache, `${kind}-${sha1(url)}.json`), JSON.stringify({ url, ...value })),
    drop: (kind, url) => fs.rmSync(path.join(cache, `${kind}-${sha1(url)}.json`), { force: true }),
    has: (kind, url) => fs.existsSync(path.join(cache, `${kind}-${sha1(url)}.json`)),
    review: (rows) => fs.writeFileSync(file("data", "office-flyer-review.csv"), REVIEW_HEADER + rows.map((r) => r.join(",")).join("\n") + (rows.length ? "\n" : "")),
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** The feed address the importer asks for (an Events Calendar feed gets per_page, start_date and end_date). */
export function feedUrl(office, now = NOW) {
  const row = sourceRow(office);
  if (row.adapter !== "tribe") return row.feed;
  const u = new URL(row.feed);
  u.searchParams.set("per_page", "50");
  u.searchParams.set("start_date", toPT(now).toISODate());
  u.searchParams.set("end_date", toPT(now).plus({ days: 550 }).toISODate());
  return u.toString();
}
/** The detail page address of each NOCCO card and its fixture file name (as --save-fixtures names it). */
export function aanocDetailPages() {
  const base = new URL(sourceRow("nocco").feed).origin + "/";
  return aanocCards(fixture("nocco", "events.html"), { base }).map((c) => ({
    url: c.url,
    name: `detail-${(new URL(c.url).pathname.replace(/\/+$/, "").split("/").pop() || "index").replace(/[^a-z0-9.-]+/gi, "-").toLowerCase()}.html`,
  }));
}
/** Put an office's saved answers into the sandbox's cache, as the importer would ask for them on the day of `now`:
 *  its site's robots.txt (`robots`: a text, or { status, body }), its feed (and the next pages), NOCCO's RSS feed and
 *  detail pages (`details: false` leaves those out). `override` replaces a body: { feed, rss }. */
export function cacheOffice(sb, office, { now = NOW, robots = ROBOTS_OK, details = true, override = {} } = {}) {
  const row = sourceRow(office);
  const options = parseOptions(row.options);
  const host = new URL(row.feed).host;
  sb.put("robots", `https://${host}/robots.txt`, typeof robots === "string" ? { status: 200, body: robots } : robots);
  const text = (url, body, type) => sb.put("text", url, { status: 200, type, server: "", body });
  if (row.adapter === "tribe") {
    const pages = fixtureFiles(office).filter((f) => /^events-\d+\.json$/.test(f)).map((f) => fixture(office, f));
    let url = feedUrl(office, now);
    for (const body of pages) {
      text(url, override.feed ?? body, "application/json");
      url = JSON.parse(body).next_rest_url || "";
      if (!url) break;
    }
  } else if (row.adapter === "aanoc") {
    text(row.feed, override.feed ?? fixture(office, "events.html"), "text/html");
    if (options.rss) text(options.rss, override.rss ?? fixture(office, "index.xml"), "application/rss+xml");
    if (details) for (const d of aanocDetailPages()) if (fixtureFiles(office).includes(d.name)) text(d.url, fixture(office, d.name), "text/html");
  } else if (row.adapter === "tvco") text(row.feed, override.feed ?? fixture(office, "page.json"), "application/json");
}
/** A made-up fingerprint for a flyer's bytes (version 2 = the office replaced the file at the same address). */
export const fakeSha = (url, version = 1) => createHash("sha256").update(`${version} ${url}`).digest("hex");
/** Put a flyer's "download" into the cache: { sha256, mime, size, w, h }. */
export function cacheFlyer(sb, url, version = 1) {
  const pdf = /\.pdf(?:[?#]|$)/i.test(url);
  sb.put("flyer", url, { sha256: fakeSha(url, version), mime: pdf ? "application/pdf" : mimeOf(url), size: 1000, w: pdf ? 0 : 600, h: pdf ? 0 : 800 });
}
/** The flyer addresses of an office's fixture events (cleaned, upcoming on `now`'s day). */
export function fixtureFlyerUrls(office) {
  const row = sourceRow(office);
  const raw =
    row.adapter === "tribe" ? tribePages(office) : row.adapter === "aanoc" ? { html: fixture(office, "events.html"), rss: fixture(office, "index.xml"), details: {} } : fixtureJson(office, "page.json");
  // the importer reads NOCCO's cards with the feed's own origin (www.) as the base of relative addresses
  const extra = row.adapter === "aanoc" ? { base: new URL(row.feed).origin + "/" } : {};
  return [...new Set(pipeline(office, raw, extra).records.flatMap((r) => r.flyers.map((f) => f.url)))];
}
/** Run the importer in the sandbox → { status, out (stdout and stderr), mirror (the file afterwards), output
 *  ($GITHUB_OUTPUT's text) }. The GitHub variables of the test's own run are never passed on. */
export function runImporter(sb, args = [], env = {}) {
  const output = sb.file("github-output.txt");
  fs.rmSync(output, { force: true });
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_|OFFICE_|CALENDAR_)/.test(k)));
  const r = spawnSync(process.execPath, [IMPORTER, ...args], {
    cwd: sb.dir,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...base, OFFICE_HTTP_CACHE: sb.cache, OFFICE_HTTP_OFFLINE: "1", OFFICE_BUDGET_MIN: "2", GITHUB_OUTPUT: output, ...env },
  });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}`, mirror: sb.mirror(), output: fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "" };
}

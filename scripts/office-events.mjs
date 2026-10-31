#!/usr/bin/env node
// Central-office events: reads the events the central offices and intergroups post on their own websites and writes
// the committed mirror data/central-office-events.json (README "Central-office events"). Run once a day by
// .github/workflows/deploy.yml; editors steer it with data/office-event-sources.csv.
//
//   node scripts/office-events.mjs [--office key[,key]] [--force] [--dry-run] [--now ISO] [--save-fixtures dir]
//   node scripts/office-events.mjs --check      exit 1 when the mirror still has a personal detail, read as cleanRecord
//                                               reads it (titles, Spanish titles, venues, street addresses, cities and
//                                               prices: titleRisk; ids: slugRisk; event pages: pageRisk; flyer
//                                               addresses: flyerRisk; a summary: also anything summaryRisk flags; other
//                                               fields: contactHits)
//
// Politeness: each site's robots.txt is read first (scripts/lib/robots.mjs, RFC 9309: the group naming our product
// token MSCA09-site-builder, else "*"; a disallowed path is not read; its Crawl-delay is honoured up to 60 s, at least
// the crawl_delay column; a robots.txt that answers 5xx or 429, times out or cannot be reached disallows the whole site
// for this run, so its office keeps its earlier events with errorKind robots). One request at a time per site, an
// honest User-Agent, 20 s per request, 6 minutes in all (OFFICE_BUDGET_MIN; a request whose turn would come later is
// not waited for). Offices on different sites are read at the same time.
// Failures never stop the build: an office that cannot be read keeps its earlier events (minus the past ones), and
// the script always exits 0 (except --check). The mirror has no timestamps and is written only when its content
// changed, so a day without news changes nothing.
// Anonymity: an event whose title still has a personal detail after cleaning is left out ("held (personal details)"
// in the report, which names its id only, never its text). A summary with anything risky is left out whole (the
// "no-summary" count). Every event, also one kept from an earlier run, is cleaned with today's rules.
// The run log ($GITHUB_STEP_SUMMARY too: the Actions logs of a public repository are public) names office keys, record
// ids (hashed ones are fine), counts, kinds and addresses of the offices' own pages only: never a title, a summary, a
// venue, a flyer's text or a flyer's file name (a flyer is "<office> <hash of its address>"). An entry whose date cannot
// be read is "unparsed: <office> card <n> (<hash of its title>)";
// an error is named by its kind (an exception by its name and where it happened: its message may quote what it read).
// The office's own events (after cleaning, before the same event listed by two offices is folded into one record) are
// remembered in its state (sources: id → last day + source hash; flyers: url → SHA-256, size and type; NOCCO's
// details: what the detail pages said about a folded event), so folding changes nothing from one day to the next.
// Flyers: a flyer is downloaded to compute its SHA-256 (8 MB at most) when its address is new or its event's source
// changed, when it has no SHA-256 yet, or when the flyer check found other bytes at its address (review result
// "error: changed" in data/office-flyer-review.csv). At most 3 downloads per office per run: new ones first, then the
// others in turn (round-robin by day, the oldest "error: changed" first), so every flyer is fingerprinted within a few
// days. Otherwise the SHA-256 is carried over, by address, from anything the last run knew. The flyer check
// (scripts/check-media.mjs --office-flyers) reads them later; the number of flyers it has not seen yet goes to
// $GITHUB_OUTPUT as new_flyers=<n>.
// --save-fixtures dir: every response read is also saved under dir/<office>/, with phone numbers, e-mail addresses,
// passcodes and full names masked (test/office-events/fixtures/ is public history).
// OFFICE_HTTP_CACHE=dir (development only): responses are kept in dir and read from there on the next run, so a
// parser can be fixed and re-run without asking the sites again; with OFFICE_HTTP_OFFLINE=1 nothing else is asked for
// (a robots.txt that is not in the cache then counts as unreachable).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readCsv } from "../src/_lib/csv.js";
import { compileLinkFixes } from "../src/_lib/calendar.js";
import { nameHits, shortenNames } from "../src/_lib/names.js";
import { loadAllow, contactHits, titleRisk, slugRisk, summaryRisk, maskText } from "../src/_lib/contact-rules.js";
import {
  adapters, watchStamp, filterRecords, mapType, cleanRecord, settleOffice, buildMirror, stableStringify, parseOptions,
  toPT, isPast, hostOf, aanocCards, aanocDetail, byStart, foldedDetails, flyerFromState, pageRisk, flyerRisk, hashKey, TYPES, RECORD_DROPPED,
} from "../src/_lib/office-import.js";
import { dedupeOffices, matchArea, areaItemsFromCalendar } from "../src/_lib/office-match.js";
import { OFFICE_UA, OFFICE_ACCEPT } from "./lib/media-read.mjs";
import { robotsAllows, robotsFromResponse, ROBOTS_MAX_BYTES } from "./lib/robots.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "central-office-events.json");
const TEXT_ACCEPT = "application/json,text/html,application/xml;q=0.9,*/*;q=0.5";
const REQUEST_MS = 20_000;
const BUDGET_MS = (Number(process.env.OFFICE_BUDGET_MIN) || 6) * 60_000;
const FLYERS_PER_OFFICE = 3;
const FLYER_MAX_BYTES = 8 * 1024 * 1024;
const FLYER_MIME = /^(?:image\/[a-z0-9.+-]+|application\/pdf)$/;
const MIN_DELAY_S = 2;
const MAX_ROBOTS_DELAY_S = 60;
const MAX_PAGES = 5;
const started = Date.now();

/* ------------------------------------------------------------------ arguments */
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
};
const FLAG = (name) => argv.includes(name);
const ONLY = new Set(arg("--office").split(",").map((s) => s.trim()).filter(Boolean));
const FORCE = FLAG("--force");
const DRY = FLAG("--dry-run");
const CHECK = FLAG("--check");
const NOW = toPT(arg("--now") || undefined);
const TODAY = NOW.toISODate();
// the day's number: which of the flyers waiting for a fingerprint get their turn today (round-robin)
const DAY_NO = Math.floor(Date.parse(`${TODAY}T00:00:00Z`) / 864e5) || 0;
const FIXTURES = arg("--save-fixtures") ? path.resolve(arg("--save-fixtures")) : "";
const CACHE = process.env.OFFICE_HTTP_CACHE ? path.resolve(process.env.OFFICE_HTTP_CACHE) : "";
// OFFICE_HTTP_OFFLINE=1 (with the cache): nothing that is not in the cache is asked for
const OFFLINE = !!CACHE && /^(1|yes|true)$/i.test(process.env.OFFICE_HTTP_OFFLINE || "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => createHash("sha1").update(String(s)).digest("hex");
const log = (...a) => console.log("[offices]", ...a);
const warn = (msg) => console.log(`::warning::${msg}`);
const isMap = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ the data files */
const sources = readCsv("office-event-sources.csv").filter((r) => r.office && !r.office.startsWith("#"));
const officeRows = readCsv("central-offices.csv").filter((r) => r.key && !r.key.startsWith("#"));
const officeByKey = Object.fromEntries(officeRows.map((r) => [r.key, r]));
const officeHost = (k) => hostOf((officeByKey[k] || {}).website || "");
const officeSort = Object.fromEntries(officeRows.map((r) => [r.key, Number(r.sort) || 999]));
const typeKeys = new Set(readCsv("event-types.csv").map((r) => r.key).filter((k) => k && !k.startsWith("#")));
const types = TYPES.filter((t) => typeKeys.has(t));
const allow = loadAllow();
const linkFixes = compileLinkFixes(readCsv("link-fixes.csv"));
const reviewRows = readCsv("office-flyer-review.csv").filter((r) => r.url && !String(r.url).startsWith("#"));
const reviewed = new Map(reviewRows.map((r) => [`${r.url} ${r.sha256}`, r]));

let prev = { v: 1, offices: {}, events: [] };
let prevText = "";
try {
  prevText = fs.readFileSync(OUT, "utf8");
  const j = JSON.parse(prevText);
  if (j && typeof j === "object") prev = { offices: isMap(j.offices) ? j.offices : {}, events: Array.isArray(j.events) ? j.events : [] };
} catch {
  /* first run */
}
const prevById = new Map(prev.events.map((e) => [e.id, e]));

/* ------------------------------------------------------------------ HTTP: robots, one request at a time per site */
class FetchError extends Error {
  constructor(kind, msg) {
    super(msg || kind);
    this.kind = kind;
  }
}
/** What the log may say about an error: a FetchError's own message (an HTTP status, a path of the office's own site,
 *  "offline: not in the cache"), otherwise only the error's name and where it happened: an exception's message may
 *  quote the text it was reading (JSON.parse's does), and the run log is public. */
function errText(e) {
  if (e instanceof FetchError) return String(e.message || e.kind).split("\n")[0].slice(0, 120);
  const at = /\n\s+at (?:.*?[\\/])?([\w.-]+\.m?js):(\d+)/.exec(String((e && e.stack) || ""));
  return `${(e && e.name) || "Error"}${at ? ` at ${at[1]}:${at[2]}` : ""}`;
}
const sites = new Map(); // host -> { next, delay, robots, ready }
const requests = { count: 0, cached: 0 };

function cacheFile(url, kind) {
  return CACHE ? path.join(CACHE, `${kind}-${sha1(url)}.json`) : "";
}
function fromCache(url, kind) {
  const f = cacheFile(url, kind);
  if (!f || !fs.existsSync(f)) return null;
  try {
    requests.cached++;
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}
function toCache(url, kind, value) {
  const f = cacheFile(url, kind);
  if (!f) return;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ url, ...value }));
}

// The time budget is checked BEFORE the wait for the site's crawl delay: a site whose next turn would come after the
// budget is used up is not waited for (its office keeps its earlier events), so one site cannot hold the job.
async function slot(host) {
  const s = sites.get(host);
  const wait = Math.max(0, s.next - Date.now());
  if (Date.now() + wait - started > BUDGET_MS) throw new FetchError("timeout", `the time budget is used up${wait > 0 ? ` (this site's next turn would come in ${Math.ceil(wait / 1000)} s)` : ""}`);
  if (wait > 0) await sleep(wait);
}
const release = (host) => {
  const s = sites.get(host);
  s.next = Date.now() + s.delay * 1000;
};

/** GET https://host/robots.txt (or its saved answer) → the rules that apply to us (scripts/lib/robots.mjs). */
async function readRobots(host) {
  const url = `https://${host}/robots.txt`;
  let res = fromCache(url, "robots");
  if (!res) {
    try {
      await slot(host);
      if (OFFLINE) throw new FetchError("network", "offline: not in the cache");
      requests.count++;
      const r = await fetch(url, { headers: { "User-Agent": OFFICE_UA, Accept: "text/plain,*/*;q=0.5" }, signal: AbortSignal.timeout(REQUEST_MS), redirect: "follow" });
      res = { status: r.status, body: r.ok ? (await r.text()).slice(0, ROBOTS_MAX_BYTES) : "" };
      toCache(url, "robots", res);
    } catch (e) {
      // no answer: a timeout, no connection, the time budget used up (or, offline, not in the cache)
      res = { status: 0, body: "", error: e && (e.kind === "timeout" || e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : (e && e.kind === "network" && e.message) || "no answer" };
    } finally {
      release(host);
    }
  }
  return robotsFromResponse(res.status, res.body, res.error);
}

/** The site's state; its robots.txt is read once per site, before anything else there (callers wait for it). */
async function site(host, minDelay) {
  let s = sites.get(host);
  if (!s) {
    s = { next: 0, delay: Math.max(MIN_DELAY_S, minDelay || 0), robots: null, ready: null };
    sites.set(host, s);
    s.ready = readRobots(host).then((robots) => {
      s.robots = robots;
      // a robots.txt Crawl-delay is honoured up to 60 s (as scripts/check-media.mjs does), from the robots.txt request
      // itself on (when it was asked for: not from the cache)
      const before = s.delay;
      s.delay = Math.max(s.delay, Math.min(MAX_ROBOTS_DELAY_S, Number(robots.delay) || 0));
      if (s.next) s.next += (s.delay - before) * 1000;
    });
  } else s.delay = Math.max(s.delay, minDelay || 0);
  await s.ready;
  return s;
}
/** A FetchError("robots") when robots.txt does not let us read `url` (or could not be read today), else null. */
function robotsBlock(s, url) {
  if (s.robots && s.robots.unreachable) return new FetchError("robots", `robots.txt could not be read (${s.robots.error || "no answer"}): nothing is read from this site today`);
  if (!robotsAllows(s.robots, url)) return new FetchError("robots", `robots.txt does not allow ${new URL(url).pathname}`);
  return null;
}

/** GET a text resource (JSON, HTML, XML) politely. → { status, type, body } or throws a FetchError. */
async function getText(url, { minDelay = 0 } = {}) {
  const host = new URL(url).host;
  const s = await site(host, minDelay);
  const blocked = robotsBlock(s, url);
  if (blocked) throw blocked;
  const hit = fromCache(url, "text");
  if (hit) return hit;
  await slot(host);
  if (OFFLINE) throw new FetchError("network", "offline: not in the cache");
  requests.count++;
  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": OFFICE_UA, Accept: TEXT_ACCEPT }, signal: AbortSignal.timeout(REQUEST_MS), redirect: "follow" });
    const body = await r.text();
    const res = { status: r.status, type: r.headers.get("content-type") || "", server: r.headers.get("server") || "", body };
    if (r.ok) toCache(url, "text", res);
    if (!r.ok) {
      const cf = /cloudflare/i.test(res.server) && /cf-chl|just a moment|attention required|cf-error/i.test(body);
      throw new FetchError(cf ? "cloudflare" : r.status === 403 ? "http-403" : r.status >= 500 ? "http-5xx" : `http-${r.status}`, `HTTP ${r.status}`);
    }
    return res;
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError(e && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network", e && e.message);
  } finally {
    release(host);
  }
}
async function getJson(url, opts) {
  const res = await getText(url, opts);
  try {
    return { ...res, json: JSON.parse(res.body.replace(/^﻿/, "")) };
  } catch {
    throw new FetchError(/cf-chl|just a moment/i.test(res.body) ? "cloudflare" : "not-json", "the answer is not JSON");
  }
}

/* ------------------------------------------------------------------ flyers: SHA-256 and size */

/** Width and height of a PNG, JPEG, GIF or WebP picture from its first bytes ({ w: 0, h: 0 } when unknown). */
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      const kind = buf.toString("ascii", 12, 16);
      if (kind === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (kind === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch {
    /* not a picture we know */
  }
  return { w: 0, h: 0 };
}

/** Download one flyer (8 MB at most, a picture or a PDF) → { sha256, mime, w, h } or { error }. No Referer is sent;
 *  the same User-Agent and Accept header as the flyer check (scripts/lib/media-read.mjs), so both get the same bytes. */
async function hashFlyer(url, minDelay) {
  const hit = fromCache(url, "flyer");
  if (hit) return hit;
  const host = new URL(url).host;
  const s = await site(host, minDelay);
  if (robotsBlock(s, url)) return { error: "robots" };
  await slot(host);
  if (OFFLINE) throw new FetchError("network", "offline: not in the cache");
  requests.count++;
  try {
    const r = await fetch(url, { headers: { "User-Agent": OFFICE_UA, Accept: OFFICE_ACCEPT }, signal: AbortSignal.timeout(REQUEST_MS), redirect: "follow" });
    if (!r.ok) return { error: `http-${r.status}` };
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\//.test(type) && type !== "application/pdf") return { error: `not a picture (${type || "no type"})` };
    if (Number(r.headers.get("content-length")) > FLYER_MAX_BYTES) return { error: "larger than 8 MB" };
    const chunks = [];
    let size = 0;
    for await (const c of r.body) {
      size += c.length;
      if (size > FLYER_MAX_BYTES) return { error: "larger than 8 MB" };
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    const out = { sha256: createHash("sha256").update(buf).digest("hex"), mime: type, size, ...(type === "application/pdf" ? { w: 0, h: 0 } : imageSize(buf)) };
    toCache(url, "flyer", out);
    return out;
  } catch (e) {
    return { error: e && e.name === "TimeoutError" ? "timeout" : "network" };
  } finally {
    release(host);
  }
}

/* ------------------------------------------------------------------ test fixtures (masked) */

const maskStr = (s, host) =>
  shortenNames(maskText(String(s), { allow, officeHost: host }))
    .replace(/(data-cfemail=["'])[0-9a-f]+/gi, "$100")
    .replace(/(email-protection#)[0-9a-f]+/gi, "$100");
function maskDeep(x, host) {
  if (typeof x === "string") return maskStr(x, host);
  if (Array.isArray(x)) return x.map((v) => maskDeep(v, host));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, maskDeep(v, host)]));
  return x;
}
// The Events Calendar's answers are large (venue pages, organizers): keep what the adapter reads.
const VENUE_KEEP = ["id", "venue", "address", "city", "zip", "state", "province", "stateprovince", "country", "show_map"];
function slimTribe(j) {
  if (!j || !Array.isArray(j.events)) return j;
  for (const ev of j.events) {
    if (Number(ev.id) >= 10000000 || /\/\d{4}-\d{2}-\d{2}\/?$/.test(String(ev.url || ""))) {
      ev.description = "";
      ev.excerpt = "";
    }
    if (ev.venue && typeof ev.venue === "object" && !Array.isArray(ev.venue)) ev.venue = Object.fromEntries(VENUE_KEEP.filter((k) => k in ev.venue).map((k) => [k, ev.venue[k]]));
    ev.organizer = [];
    delete ev.json_ld;
  }
  return j;
}
function saveFixture(office, name, body, { json = false, host = "" } = {}) {
  if (!FIXTURES) return;
  const dir = path.join(FIXTURES, office);
  fs.mkdirSync(dir, { recursive: true });
  let text;
  if (json) {
    let data;
    try {
      data = JSON.parse(String(body).replace(/^﻿/, ""));
    } catch {
      return;
    }
    text = JSON.stringify(maskDeep(slimTribe(data), host), null, 1) + "\n";
  } else text = maskStr(body, host);
  fs.writeFileSync(path.join(dir, name), text);
}

/* ------------------------------------------------------------------ the adapters' requests */

const fixtureName = (url) => (new URL(url).pathname.replace(/\/+$/, "").split("/").pop() || "index").replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();

async function runTribe(row, opts) {
  const feed = new URL(row.feed);
  if (!feed.searchParams.has("per_page")) feed.searchParams.set("per_page", "50");
  if (!feed.searchParams.has("start_date")) feed.searchParams.set("start_date", TODAY);
  if (!feed.searchParams.has("end_date")) feed.searchParams.set("end_date", NOW.plus({ days: 550 }).toISODate());
  const pages = [];
  let next = feed.toString();
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const r = await getJson(next, opts);
    if (!r.json || typeof r.json !== "object" || (!Array.isArray(r.json.events) && !(Number(r.json.total) === 0))) throw new FetchError("parse", "no events list in the answer");
    pages.push(r.json);
    saveFixture(row.office, `events-${i + 1}.json`, r.body, { json: true, host: opts.host });
    const n = r.json.next_rest_url ? String(r.json.next_rest_url) : "";
    next = n && new URL(n, feed).host === feed.host ? new URL(n, feed).toString() : "";
  }
  return adapters.tribe(pages, opts);
}

async function runAanoc(row, opts) {
  const list = await getText(row.feed, opts);
  saveFixture(row.office, "events.html", list.body, { host: opts.host });
  let rss = "";
  if (opts.options.rss) {
    try {
      rss = (await getText(opts.options.rss, opts)).body;
      saveFixture(row.office, "index.xml", rss, { host: opts.host });
    } catch (e) {
      opts.notes.push(`RSS not read (${e.kind || errText(e)}): no descriptions today`);
    }
  }
  const base = new URL(row.feed).origin + "/";
  const cards = aanocCards(list.body, { base });
  // a first pass without detail pages gives each card's source hash: a detail page is read only for a card that is
  // new or changed since the last run. opts.prev knows the office's events in the mirror and, from its state, the ones
  // folded into another office's record (with what their detail page said), so those are not read again every day.
  // A card of an event that is over (still on the page for a while) needs no detail page.
  const first = adapters.aanoc({ html: list.body, rss, details: {} }, { ...opts, base });
  let wanted = cards
    .filter((c) => {
      const rec = first.records.find((r) => r.src === c.url);
      if (!rec || isPast(rec, TODAY)) return false;
      const old = opts.prev.get(rec.id);
      return FORCE || !old || old.srcHash !== rec.srcHash;
    })
    .map((c) => c.url);
  let sample = false;
  if (!cards.length) {
    // no card could be read (the page's layout changed): the events are made from cards only, so detail pages cannot
    // help today. With --save-fixtures up to 12 are saved for the parser's next fix; otherwise one is read as a sample
    // for the report.
    const links = [...new Set([...list.body.matchAll(/href=["']((?:https?:\/\/[^/"']+)?\/events\/[^/"'#?]+\/)["']/gi)].map((m) => new URL(m[1], base).toString()))];
    wanted = links.slice(0, FIXTURES ? 12 : 1);
    sample = !FIXTURES && wanted.length > 0;
    opts.notes.push(`no event cards found on the events page (${links.length} event link(s) on it): its layout may have changed`);
  }
  // a detail page is named in the log by its event's id (an address made from a title may carry what the id hides)
  const idOf = new Map(first.records.map((r) => [r.src, r.id]));
  const pageName = (url) => (idOf.has(url) ? idOf.get(url) : `event link ${wanted.indexOf(url) + 1}`);
  const details = {};
  for (const url of wanted.slice(0, 20)) {
    try {
      details[url] = (await getText(url, opts)).body;
      saveFixture(row.office, `detail-${fixtureName(url)}.html`, details[url], { host: opts.host });
    } catch (e) {
      opts.notes.push(`detail page not read: ${pageName(url)} (${e.kind || errText(e)})`);
    }
  }
  if (sample) {
    for (const [url, html] of Object.entries(details)) {
      const d = aanocDetail(html);
      opts.notes.push(`sample detail page (${pageName(url)}): ${d.venue || d.street ? "its place can still be read" : "no place found on it either"}`);
    }
  }
  return adapters.aanoc({ html: list.body, rss, details }, { ...opts, base });
}

async function runTvco(row, opts) {
  const r = await getJson(row.feed, opts);
  saveFixture(row.office, "page.json", r.body, { json: true, host: opts.host });
  return adapters.tvco(r.json, opts);
}

async function runWatch(url, row, opts) {
  const r = await getJson(url, opts);
  saveFixture(row.office, "watch.json", r.body, { json: true, host: opts.host });
  const stamp = watchStamp(r.json);
  if (!stamp) throw new FetchError("parse", "no modified date in the answer");
  return stamp;
}

/* ------------------------------------------------------------------ one office */

const langOf = (k) => (/^spanish$/i.test((officeByKey[k] || {}).language || "") ? "Spanish" : "English");
const flyerOk = (f) => {
  const r = reviewed.get(`${f.url} ${f.sha256}`);
  return !!(r && f.sha256 && /^(clean|cleared)$/i.test(String(r.result || "").trim()));
};

/**
 * The office's events as the last run left them, by id: its events in the mirror, plus, from its state, the ones that
 * were folded into another office's record ({ id, srcHash } and, for NOCCO, what their detail page said).
 */
function knownRecords(state, records) {
  const out = new Map(records.map((r) => [r.id, r]));
  const det = isMap(state.details) ? state.details : {};
  for (const [id, v] of Object.entries(isMap(state.sources) ? state.sources : {})) {
    if (out.has(id)) continue;
    const d = isMap(det[id]) ? det[id] : {};
    out.set(id, { id, srcHash: String(v).replace(/^\S*\s/, ""), title_es: String(d.title_es || ""), venue: String(d.venue || ""), format: d.format === "Hybrid" ? "Hybrid" : "In person" });
  }
  return out;
}

/** What cleanRecord needs for an office's events: the allowed details, the office's own website (its e-mail addresses
 *  may stay), the link fixes and its events page. */
function cleanCtx(key) {
  const row = sources.find((r) => r.office === key) || {};
  return { allow, officeHost: officeHost(key) || hostOf(row.feed || ""), linkFixes, eventsPage: row.events_page || "", now: NOW.toISO() };
}

/** Read one office (its flyers are fingerprinted afterwards, for all offices at once, and then it is settled). */
async function processOffice(row) {
  const key = row.office;
  const adapter = String(row.adapter || "none").trim().toLowerCase();
  const options = parseOptions(row.options);
  const host = officeHost(key) || hostOf(row.feed);
  const prevState = isMap(prev.offices[key]) ? prev.offices[key] : {};
  const prevRecords = prev.events.filter((e) => e.office === key);
  const known = knownRecords(prevState, prevRecords);
  const minDelay = Math.max(MIN_DELAY_S, Number(row.crawl_delay) || 0, Number(options.crawl_delay) || 0);
  const info = {
    key, adapter, options, minDelay, prevState, prevRecords, known, result: null, state: null, records: [],
    read: 0, kept: 0, dropped: { meetings: 0, recurring: 0, past: 0, ongoing: 0 }, held: [], unparsedCards: [], notes: [], flyersHashed: 0,
    noSummary: 0,
  };
  const on = /^(y|yes|true|1|on)$/i.test(String(row.import || "").trim());
  const opts = {
    office: key, host, now: NOW.toISO(), lang: langOf(key), options, minDelay, notes: info.notes, force: FORCE,
    prev: known, state: prevState, eventsPage: row.events_page || "",
  };
  let result;
  try {
    if (!["tribe", "aanoc", "tvco", "watch", "shared", "none"].includes(adapter)) throw new FetchError("parse", `unknown adapter "${adapter}"`);
    if (adapter === "none") result = { status: "none" };
    else if (adapter === "shared") result = { status: "shared" };
    else if (adapter === "watch") {
      if (!row.feed) throw new FetchError("parse", "no feed to watch");
      result = { status: "watch", watchModified: await runWatch(row.feed, row, opts) };
    } else if (!on) result = { status: "off" };
    else {
      if (!/^https:\/\//i.test(row.feed || "")) throw new FetchError("parse", "the feed is not an https:// address");
      const run = adapter === "tribe" ? runTribe : adapter === "aanoc" ? runAanoc : runTvco;
      const got = await run(row, opts);
      info.read = got.stats.read;
      info.dropped.recurring = got.stats.recurring || 0;
      info.dropped.meetings = got.stats.meetings || 0;
      info.unparsedCards = got.stats.unparsedCards || [];
      const { kept, dropped } = filterRecords(got.records, { now: NOW.toISO() });
      info.dropped.meetings += dropped.meetings + dropped.series;
      info.dropped.past += dropped.past;
      info.dropped.ongoing += dropped.ongoing;
      // cleaning (anonymity): an event whose title would still show a personal detail is left out, alone; the report
      // names its id, never its text. A summary with anything risky is left out whole (counted, never shown).
      const records = [];
      for (const r of kept) {
        try {
          const clean = cleanRecord({ ...r, type: mapType(r, types) }, { ...cleanCtx(key), onSummaryDropped: () => info.noSummary++ });
          if (clean) records.push(clean);
          else info.held.push(String(r.id || "?"));
        } catch (e) {
          if (!e || e.code !== RECORD_DROPPED) throw e;
          info.held.push(String(e.id || r.id || "?"));
        }
      }
      result = { status: "ok", records, unparsed: got.stats.unparsed || 0, pageModified: got.pageModified || "" };
      // a calendar plugin that is installed but unused today (Inland Empire): its gallery page is watched too
      if (options.watch) {
        try {
          result.watchModified = await runWatch(options.watch, row, opts);
        } catch (e) {
          info.notes.push(`watched page not read (${e.kind || errText(e)})`);
        }
      }
    }
  } catch (e) {
    result = { status: "error", errorKind: e.kind || "parse" };
    info.notes.push(`${e.kind || "error"}: ${errText(e)}`);
    if (e.kind === "robots") info.robotsNote = String(e.message || "");
  }
  info.result = result;
  return info;
}

/* ------------------------------------------------------------------ flyers of all offices: SHA-256, carried or read */

/**
 * The SHA-256 (and size and type) of every flyer of this run's events. Carried over, by address, from anything the
 * last run knew (the mirror's events of any office, then the offices' states: a flyer of a folded event is not in the
 * events) while the event's source is unchanged. Downloaded, at most FLYERS_PER_OFFICE per office: first the flyers
 * whose address is new or whose event's source changed (soonest events first), then, in turn (round-robin by day),
 * the ones the flyer check found changed ("error: changed", the oldest check first) and the ones still without a
 * SHA-256. An address listed by two offices is read once. A download's result is used for every event with that address.
 */
async function fingerprintFlyers(infos) {
  const known = new Map();
  const remember = (url, v) => {
    if (url && v.sha256 && !known.has(url)) known.set(url, v);
  };
  for (const e of prev.events) for (const f of e.flyers || []) if (f) remember(String(f.url || ""), { sha256: String(f.sha256 || ""), w: Number(f.w) || 0, h: Number(f.h) || 0, mime: String(f.mime || "") });
  for (const k of Object.keys(prev.offices).sort()) {
    const fl = isMap(prev.offices[k]) && prev.offices[k].flyers;
    if (isMap(fl)) for (const [url, v] of Object.entries(fl).sort(([a], [b]) => cmp(a, b))) remember(url, flyerFromState(v));
  }
  const fromPage = new WeakSet(); // flyers whose size the office's page gave
  const scheduled = new Map(); // url → the office whose turn it uses
  const live = infos.filter((i) => i.result && i.result.status === "ok");
  for (const i of live) {
    const fresh = [];
    const changed = [];
    const waiting = [];
    for (const rec of [...i.result.records].sort(byStart)) {
      const old = i.known.get(rec.id);
      const same = !!old && old.srcHash === rec.srcHash;
      for (const f of rec.flyers) {
        if (f.w) fromPage.add(f);
        const k = known.get(f.url);
        if (same && k) {
          f.sha256 = k.sha256;
          if (!f.w && k.w) [f.w, f.h] = [k.w, k.h];
          if (FLYER_MIME.test(k.mime)) f.mime = k.mime;
          const row = reviewed.get(`${f.url} ${f.sha256}`);
          if (row && /^error:\s*changed\b/i.test(String(row.result || "").trim())) changed.push({ url: f.url, since: String(row.checked_on || "").trim() });
        } else if (!same) fresh.push(f.url);
        else waiting.push(f.url);
      }
    }
    changed.sort((a, b) => cmp(a.since, b.since) || cmp(a.url, b.url));
    const pending = (list) => [...new Set(list)].filter((u) => !scheduled.has(u));
    const first = pending(fresh);
    const later = pending([...changed.map((c) => c.url), ...waiting]).filter((u) => !first.includes(u));
    const room = Math.max(0, FLYERS_PER_OFFICE - first.length);
    const turn = later.length > room && room > 0 ? (DAY_NO * room) % later.length : 0;
    const queue = [...first, ...later.slice(turn), ...later.slice(0, turn)];
    const mine = queue.slice(0, FLYERS_PER_OFFICE);
    for (const url of mine) scheduled.set(url, i);
    if (queue.length > mine.length) i.notes.push(`${queue.length - mine.length} flyer(s) left for the next run`);
  }
  // one site at a time per host (slot()), different hosts at once
  const byHost = new Map();
  for (const [url, i] of scheduled) {
    let h = "";
    try {
      h = new URL(url).host;
    } catch {
      continue;
    }
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push([url, i]);
  }
  const results = new Map();
  await Promise.all(
    [...byHost.values()].map(async (list) => {
      for (const [url, i] of list) results.set(url, await hashFlyer(url, i.minDelay).catch((e) => ({ error: (e && e.kind) || "network" })));
    }),
  );
  for (const [url, i] of scheduled) {
    const got = results.get(url) || { error: "not a web address" };
    // named by its office and the hash of its address, never by its file name (an office may name a file after its event)
    if (got.error) i.notes.push(`flyer not read (${got.error}): ${i.key} ${hashKey(url)}`);
    else i.flyersHashed++;
  }
  for (const i of live) {
    for (const rec of i.result.records) {
      for (const f of rec.flyers) {
        const got = results.get(f.url);
        if (!got || got.error || !got.sha256) continue;
        f.sha256 = got.sha256;
        if (FLYER_MIME.test(got.mime || "")) f.mime = got.mime;
        if (!fromPage.has(f) && got.w) [f.w, f.h] = [got.w, got.h];
      }
    }
  }
}

/** The office after this run (settleOffice): its state and the events it brings to the mirror. */
function settle(i) {
  const settled = settleOffice({ adapter: i.adapter, prev: i.prevState, prevRecords: i.prevRecords, result: i.result, today: TODAY });
  if (settled.note) i.notes.push(settled.note);
  i.state = settled.state;
  i.records = settled.records;
  i.kept = i.result.status === "ok" ? i.result.records.length : 0;
  i.shared = i.adapter === "shared" ? i.options : null;
}

/* ------------------------------------------------------------------ --check */

function check() {
  let mirror;
  try {
    mirror = JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    console.log("[offices] no mirror to check");
    return 0;
  }
  let bad = 0;
  const now = NOW.toISO();
  // how a field is read, as cleanRecord reads it: "title" (titles, Spanish titles, venues, street addresses, cities,
  // prices: titleRisk, and full names), "summary" (titleRisk, full names, then summaryRisk: all or nothing), "id"
  // (slugRisk: an id read as words every way, "…-p-w-774411" as "PW 774411", "…-3-3-1990" as "3/3/1990"), "src" (an
  // event's page: pageRisk, its path read as an id is), "flyer" (a flyer's address: flyerRisk, its file name read as
  // words for a sobriety date, a code, an e-mail address or a full name), "text" (contactHits and full names)
  const kindsOf = (how, value, hosts) => {
    const v = String(value);
    const opts = { allow, officeHost: hosts, now };
    if (how === "id") return slugRisk(v, opts).map((h) => h.kind);
    if (how === "src") return pageRisk(v, opts);
    if (how === "flyer") return flyerRisk(v, opts);
    const found = (how === "title" || how === "summary" ? titleRisk(v, opts) : contactHits(v, opts)).map((h) => h.kind);
    if (["title", "summary", "text"].includes(how) && nameHits(v).length) found.push("full name");
    // a summary is all or nothing: anything summaryRisk flags (a code or meeting label, a sobriety length, a long number)
    if (how === "summary" && !found.length) {
      const risk = summaryRisk(v, opts);
      if (risk) found.push(`summary (${risk})`);
    }
    return found;
  };
  // label: what the log names (an id only when the id itself is clean); never the value
  const look = (label, field, value, hosts, how) => {
    if (!value) return;
    const found = kindsOf(how, value, hosts);
    if (!found.length) return;
    bad++;
    console.log(`::error::${label} ${field}: ${[...new Set(found)].join(", ")}`);
  };
  const HOW = { title: "title", title_es: "title", venue: "title", address: "title", city: "title", cost: "title", summary: "summary", src: "src" };
  (mirror.events || []).forEach((e, n) => {
    const hosts = [e.office, ...(e.also || [])].map(officeHost).filter(Boolean);
    const label = e.id && !kindsOf("id", e.id, hosts).length ? e.id : `events[${n}]`;
    look(label, "id", e.id, hosts, "id");
    const fields = { title: e.title, title_es: e.title_es, venue: e.venue, address: e.address, city: e.city, zip: e.zip, cost: e.cost, summary: e.summary, src: e.src };
    (e.flyers || []).forEach((f, i) => {
      fields[`flyers[${i}].url`] = f.url;
      fields[`flyers[${i}].pdf`] = f.pdf;
      (f.sizes || []).forEach(([, u], j) => (fields[`flyers[${i}].sizes[${j}]`] = u));
    });
    for (const [field, value] of Object.entries(fields)) look(label, field, value, hosts, HOW[field] || (/^flyers/.test(field) ? "flyer" : "text"));
  });
  // the offices' states: the ids and flyer addresses of their own events (folded ones too) and NOCCO's details
  for (const [k, st] of Object.entries(mirror.offices || {})) {
    if (!isMap(st)) continue;
    const hosts = [officeHost(k)].filter(Boolean);
    Object.keys(isMap(st.sources) ? st.sources : {}).forEach((id, n) => look(`offices.${k}`, `sources[${n}]`, id, hosts, "id"));
    Object.keys(isMap(st.flyers) ? st.flyers : {}).forEach((url, n) => look(`offices.${k}`, `flyers[${n}]`, url, hosts, "flyer"));
    Object.entries(isMap(st.details) ? st.details : {}).forEach(([id, d], n) => {
      look(`offices.${k}`, `details[${n}].id`, id, hosts, "id");
      for (const f of ["title_es", "venue"]) look(`offices.${k}`, `details[${n}].${f}`, isMap(d) ? d[f] : "", hosts, "title");
    });
  }
  console.log(bad ? `[offices] ${bad} field(s) with personal details: data/central-office-events.json must not be committed` : `[offices] ${(mirror.events || []).length} events checked: no personal details`);
  return bad ? 1 : 0;
}

/* ------------------------------------------------------------------ the Area calendar (report preview only) */

async function areaPreview(events) {
  try {
    process.env.CALENDAR_NOW ||= NOW.toISO();
    const quiet = console.warn;
    console.warn = () => {};
    let cal;
    try {
      cal = await (await import("../src/_data/calendar.js")).default();
    } finally {
      console.warn = quiet;
    }
    const items = areaItemsFromCalendar(cal);
    const officeHosts = Object.fromEntries(officeRows.map((r) => [r.key, officeHost(r.key)]));
    const eventsPages = Object.fromEntries(sources.map((r) => [r.office, r.events_page || ""]));
    const twins = new Map();
    for (const e of events) {
      const m = matchArea(e, items, { officeHosts, eventsPages });
      if (m.twin) twins.set(e.id, m);
    }
    return twins;
  } catch (e) {
    log(`(the Area calendar could not be compared: ${errText(e)})`);
    return new Map();
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  if (CHECK) process.exit(check());
  if (!sources.length) {
    log("data/office-event-sources.csv has no rows: nothing to do");
    return;
  }
  for (const k of Object.keys(officeByKey)) if (!sources.some((r) => r.office === k)) log(`(${k} has no row in data/office-event-sources.csv)`);

  // offices on the same site one after the other, different sites at the same time
  const chosen = sources.filter((r) => officeByKey[r.office] && (!ONLY.size || ONLY.has(r.office)));
  const queues = new Map();
  for (const r of chosen) {
    let h = "";
    try {
      h = new URL(r.feed).host;
    } catch {
      h = `(${r.office})`;
    }
    if (!queues.has(h)) queues.set(h, []);
    queues.get(h).push(r);
  }
  const infos = [];
  await Promise.all(
    [...queues.values()].map(async (rows) => {
      for (const r of rows) infos.push(await processOffice(r));
    }),
  );
  infos.sort((a, b) => (officeSort[a.key] || 999) - (officeSort[b.key] || 999) || a.key.localeCompare(b.key));
  await fingerprintFlyers(infos);
  for (const i of infos) settle(i);

  // offices not read this time (--office): their earlier state and events, minus the past ones
  const states = {};
  let events = [];
  for (const [k, st] of Object.entries(prev.offices)) {
    if (!officeByKey[k] || !sources.some((r) => r.office === k) || infos.some((i) => i.key === k)) continue;
    states[k] = st;
    events.push(...prev.events.filter((e) => e.office === k && !isPast(e, TODAY)));
  }
  for (const i of infos) {
    states[i.key] = i.state;
    events.push(...i.records);
  }
  // the cleaning rules may have changed since an event kept from an earlier run (its office failed or was not read
  // this time) was cleaned: every event is cleaned again (a clean one stays the same, byte for byte)
  events = events.flatMap((e) => {
    const i = infos.find((x) => x.key === e.office);
    try {
      return [cleanRecord(e, { ...cleanCtx(e.office), onSummaryDropped: () => i && i.noSummary++ })];
    } catch (err) {
      if (!err || err.code !== RECORD_DROPPED) throw err;
      if (i) i.held.push(String(e.id || "?"));
      else log(`left out (personal details in the title): ${e.id}`);
      return [];
    }
  });
  // an office that shares another's website and calendar (South OC): that office's events in its cities or with its
  // name in the title
  for (const i of infos.filter((x) => x.shared)) {
    const from = i.shared.from;
    const cities = String(i.shared.cities || "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
    let re = null;
    try {
      re = i.shared.title ? new RegExp(i.shared.title, "i") : null;
    } catch {
      i.notes.push("the title= option is not a valid pattern");
    }
    for (const e of events) {
      if (e.office !== from) continue;
      const mine = cities.includes(String(e.city || "").toLowerCase()) || (re && re.test(`${e.title} ${e.title_es}`));
      e.also = [...new Set([...(e.also || []).filter((k) => k !== i.key), ...(mine ? [i.key] : [])])].sort();
    }
  }
  const folded = [];
  events = dedupeOffices(events, { flyerOk, officeSort, log: folded });
  // an office that was not read this time (it failed, or --office left it out) still lists the events it shared
  // with another office: its key stays in their `also`
  const notRead = new Set([...Object.keys(states).filter((k) => !infos.some((i) => i.key === k)), ...infos.filter((i) => ["error", "suspect"].includes(i.state.status)).map((i) => i.key)]);
  for (const e of events) {
    const old = prevById.get(e.id);
    for (const k of (old && old.also) || []) if (notRead.has(k) && k !== e.office && !e.also.includes(k)) e.also = [...e.also, k].sort();
  }
  // NOCCO: what the detail pages said about its events that are folded into another office's record (they are not
  // in the events, and their pages are read again only when their cards change)
  const keptIds = new Set(events.map((e) => e.id));
  for (const i of infos) if (i.adapter === "aanoc" && i.result.status === "ok" && i.state.status !== "suspect") i.state.details = foldedDetails(i.result.records, keptIds);
  const mirror = buildMirror({ offices: states, events, today: TODAY });

  /* ---- write */
  const text = stableStringify(mirror);
  const changed = text !== prevText.replace(/\r\n/g, "\n");
  if (changed && !DRY) fs.writeFileSync(OUT, text);
  const newFlyers = mirror.events.flatMap((e) => e.flyers).filter((f) => f.sha256 && !reviewed.has(`${f.url} ${f.sha256}`));
  const held = mirror.events.flatMap((e) => e.flyers).filter((f) => /^hold/i.test(String((reviewed.get(`${f.url} ${f.sha256}`) || {}).result || "")));

  /* ---- report */
  const twins = await areaPreview(mirror.events);
  const prevIds = new Set(prev.events.map((e) => e.id));
  const rows = [];
  for (const i of infos) {
    const st = mirror.offices[i.key] || i.state;
    const mine = mirror.events.filter((e) => e.office === i.key);
    const fl = mine.flatMap((e) => e.flyers);
    rows.push({
      office: i.key, adapter: i.adapter, status: st.status, read: i.read, kept: i.kept,
      dropped: `${i.dropped.meetings}/${i.dropped.recurring}/${i.dropped.past}/${i.dropped.ongoing}`,
      area: mine.filter((e) => twins.has(e.id)).length,
      new: mine.filter((e) => !prevIds.has(e.id)).length,
      flyers: `${fl.filter((f) => f.sha256 && !reviewed.has(`${f.url} ${f.sha256}`)).length}/${fl.filter((f) => held.includes(f)).length}`,
      "no-summary": i.noSummary,
      unparsed: st.unparsed || 0,
      note: [
        st.errorKind && `error: ${st.errorKind}`,
        st.status === "watch" && st.watchModified && `modified ${st.watchModified.slice(0, 10)}`,
        i.held.length && `${i.held.length} held (personal details): ${i.held.join(", ")}`,
        i.unparsedCards.length && `unparsed: ${i.unparsedCards.map((c) => `${i.key} ${c}`).join("; ")}`,
        ...i.notes,
      ].filter(Boolean).join(" · "),
    });
    if (st.failingSince && st.status === "error" && TODAY >= toPT(st.failingSince).plus({ days: 3 }).toISODate()) warn(`Central-office events: ${i.key} has not been read since ${st.failingSince} (${st.errorKind}).`);
    if (st.status === "suspect") warn(`Central-office events: ${i.key} listed no events today; its earlier ones are kept for now.`);
    if (st.unparsed) warn(`Central-office events: ${i.key} has ${st.unparsed} entr${st.unparsed === 1 ? "y" : "ies"} whose date could not be read.`);
    if (i.held.length) warn(`Central-office events: ${i.held.length} event(s) of ${i.key} left out: their title has a personal detail (${i.held.join(", ")}).`);
    if (st.errorKind === "robots") {
      warn(
        /could not be read/.test(i.robotsNote || "")
          ? `Central-office events: robots.txt of ${i.key}'s website could not be read today, so nothing was read there; its earlier events are kept.`
          : `Central-office events: robots.txt of ${i.key}'s website does not allow reading its events.`,
      );
    }
    const was = (prev.offices[i.key] || {}).watchModified;
    if (st.watchModified && was && st.watchModified !== was) warn(`Central-office events: ${i.key}'s events page changed on ${st.watchModified.slice(0, 10)}: have a look.`);
  }
  if (held.length) warn(`Central-office events: ${held.length} flyer(s) held by the flyer check.`);

  const cols = ["office", "adapter", "status", "read", "kept", "dropped", "area", "new", "flyers", "no-summary", "unparsed", "note"];
  const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
  console.log(cols.map((c) => c.padEnd(width[c])).join("  "));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(width[c])).join("  "));
  console.log("dropped = meetings/recurring/past/ongoing · area = already on the Area calendar (preview) · flyers = waiting for the check/held · no-summary = summaries left out (a contact, code, meeting or sobriety detail)");
  for (const f of folded) log(`same event: ${f.dropped} → ${f.kept} (${f.reason})`);
  for (const [id, m] of twins) log(`on the Area calendar: ${id} = ${m.slug} (${m.reason})`);
  log(`${mirror.events.length} events from ${Object.values(mirror.offices).filter((o) => o.count).length} offices; ${requests.count} requests (${requests.cached} from the cache) in ${Math.round((Date.now() - started) / 1000)} s; ${changed ? (DRY ? "would change" : "written") : "no change"}: data/central-office-events.json`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      "### Central-office events",
      "",
      `| ${cols.join(" | ")} |`,
      `| ${cols.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${cols.map((c) => String(r[c]).replace(/\|/g, "\\|")).join(" | ")} |`),
      "",
      "dropped = meetings / recurring / past / ongoing · area = already on the Area calendar (a preview) · flyers = waiting for the flyer check / held · no-summary = summaries left out whole (they had a contact, code, meeting or sobriety detail; the card links to the office's page) · held (personal details) = left out: its title has a personal detail",
      ...(twins.size ? ["", "On the Area calendar: " + [...twins].map(([id, m]) => `${id} = ${m.slug} (${m.reason})`).join("; ")] : []),
      "",
    ].join("\n");
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch {
      /* not on GitHub */
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_flyers=${newFlyers.length}\nchanged=${changed}\n`);
    } catch {
      /* not on GitHub */
    }
  }
}

main().catch((e) => {
  console.log(`::warning::Central-office events: the import stopped (${errText(e)}); the copy in the repository is used.`);
  process.exitCode = CHECK ? 1 : 0;
});

// The sitemap's content dates (scripts/sitemap-dates.mjs) and what IndexNow is told (scripts/indexnow-urls.mjs), on
// small made-up pages: what counts as a change of a page and what never does, the dates kept or given, event pages and
// Delegate's Corner posts, the same bytes from the same input, and the old addresses. No build and no network.
//
//   npm run test:dates
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pageWords, pageText, pageFingerprint, dateSitemap, readManifest, readSitemapDates, isEventPage } from "../../scripts/sitemap-dates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEXNOW = path.join(ROOT, "scripts", "indexnow-urls.mjs");

const page = (main, { title = "District 5", description = "Meets every 2nd Monday." } = {}) =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}">` +
  `<link rel="stylesheet" href="/assets/css/site.css?v=1a2b3c4d"></head><body><header>Menu</header>` +
  `<main id="main" data-search-title="x">${main}</main><footer><span data-msca-volatile>Calendar refreshed today</span></footer></body></html>`;

test("what a page says: words, link and picture addresses, never layout", () => {
  const a = pageWords(`<p class="a">Hello <a href="/x/" class="b">there</a></p><img src="/i.png?v=0f0f0f0f" alt="A picture">`);
  assert.equal(a, "Hello href=/x/ there src=/i.png alt=A picture");
  // other classes, ids, data-* (the "In 24 days" badges), styles and inline icons do not count
  const b = pageWords(
    `<p class="z" id="upcoming-12" style="color:red" data-ph="In 3 days">Hello <a href="/x/" data-when="2026-11-20">there</a></p>` +
      `<svg viewBox="0 0 2 2"><path d="M0 0"/><title>icon</title></svg><img src="/i.png?v=12345678" alt="A picture">`,
  );
  assert.equal(b, a);
  // a ">" inside an attribute value does not end the tag; scripts and styles never count
  assert.equal(pageWords(`<div x-show="a > b" @click="n = n > 1 ? 0 : 1">Text</div><script>if (a < b) document.write("<p>x</p>")</script><style>p>a{}</style>`), "Text");
  // a link to a place on the same page is not a destination
  assert.equal(pageWords(`<a href="#add">Add</a> <a href="mailto:chair@msca09aa.org">chair@</a>`), "Add href=mailto:chair@msca09aa.org chair@");
});

test("blocks marked data-lastmod-skip or data-msca-volatile never count, with all they hold", () => {
  const base = `<h2>Next meetings</h2><p>Own text</p>`;
  const rolled = `<h2>Next meetings</h2><ul data-lastmod-skip><li><ul><li>Nov 19</li></ul></li><li>Nov 26</li></ul><p>Own text</p>`;
  const later = `<h2>Next meetings</h2><ul data-lastmod-skip><li>Dec 3</li></ul><p>Own text</p>`;
  assert.equal(pageWords(rolled), pageWords(base));
  assert.equal(pageWords(later), pageWords(base));
  // nested elements of the same name are matched to the right closing tag
  assert.equal(pageWords(`<div data-lastmod-skip><div>in</div><div>in</div></div><div>out</div>`), "out");
  assert.equal(pageWords(`<p>A <span data-msca-volatile>Nov 19</span> B</p>`), "A B");
  // a void element with the mark is just left out
  assert.equal(pageWords(`<img data-lastmod-skip src="/next.png" alt="Next"><p>x</p>`), "x");
});

test("the fingerprint reads the title, the description and <main> only", () => {
  const a = page("<p>Meets at the church hall.</p>");
  const otherCss = a.replace("?v=1a2b3c4d", "?v=99999999").replace("Menu", "Other menu").replace("Calendar refreshed today", "x");
  assert.equal(pageFingerprint(otherCss), pageFingerprint(a));
  assert.notEqual(pageFingerprint(page("<p>Meets at the library.</p>")), pageFingerprint(a));
  assert.notEqual(pageFingerprint(page("<p>Meets at the church hall.</p>", { title: "District 5 – new" })), pageFingerprint(a));
  assert.notEqual(pageFingerprint(page("<p>Meets at the church hall.</p>", { description: "Meets on Tuesdays." })), pageFingerprint(a));
  assert.match(pageFingerprint(a), /^[a-p]{16}$/); // letters only: no digits that could look like a phone number
  assert.ok(pageText(a).includes("Meets at the church hall."));
});

// A sitemap the way src/pages/sitemap.njk writes it
const SITE = "https://msca09aa.org";
const sitemap = (urls) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">` +
  urls
    .map(([p, lastmod]) => `\n  <url>\n    <loc>${SITE}${p}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`)
    .join("") +
  "\n</urlset>\n";
const lastmods = (xml) => Object.fromEntries([...xml.matchAll(/<loc>[^<]*?msca09aa\.org([^<]*)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g)].map((m) => [m[1], m[2] || ""]));

const PAGES = {
  "/": page("<p>Welcome</p>"),
  "/districts/d05/": page("<p>Meets at the church hall.</p>"),
  "/events/district-5/": page("<p>District 5 business meeting</p>"),
  "/service/delegate/posts/2020-09-06-step-7/": page("<p>A post from 2020</p>"),
};
const XML = sitemap([["/"], ["/districts/d05/"], ["/events/district-5/", "2026-10-05"], ["/service/delegate/posts/2020-09-06-step-7/", "2020-09-06"]]);
const pageOf = (pages) => (p) => pages[p] ?? null;

test("without the live site's page dates no page gets a made-up date", () => {
  const { xml, manifest, counts } = dateSitemap({ xml: XML, pageOf: pageOf(PAGES), live: null, today: "2026-11-19" });
  assert.equal(xml, XML); // the sitemap is left exactly as Eleventy wrote it
  const m = JSON.parse(manifest);
  assert.deepEqual(Object.keys(m), Object.keys(m).sort());
  assert.deepEqual(Object.values(m).map((v) => v[1]), ["", "", "", ""]);
  assert.equal(counts.pages, 4);
  // the same input gives the same bytes
  assert.equal(dateSitemap({ xml: XML, pageOf: pageOf(PAGES), live: null, today: "2026-12-31" }).manifest, manifest);
});

test("a page keeps its live date while it says the same, and gets today's when it says something new", () => {
  const first = JSON.parse(dateSitemap({ xml: XML, pageOf: pageOf(PAGES), live: null, today: "2026-11-19" }).manifest);
  // the live copy, as an earlier deploy left it: the home page was dated on Nov 1
  const live = new Map(Object.entries(first).map(([p, v]) => [p, p === "/" ? [v[0], "2026-11-01"] : v]));
  const same = dateSitemap({ xml: XML, pageOf: pageOf(PAGES), live, today: "2026-11-19" });
  assert.deepEqual(lastmods(same.xml), { "/": "2026-11-01", "/districts/d05/": "", "/events/district-5/": "2026-10-05", "/service/delegate/posts/2020-09-06-step-7/": "2020-09-06" });
  assert.equal(same.counts.changed, 0);
  // an unchanged build with the live copy gives the live copy back, byte for byte
  const liveText = "{\n" + [...live.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n") + "\n}\n";
  assert.equal(same.manifest, liveText);

  // an editor changes the district's meeting place, and the post's text (an archived post keeps its own date)
  const edited = { ...PAGES, "/districts/d05/": page("<p>Meets at the library.</p>"), "/service/delegate/posts/2020-09-06-step-7/": page("<p>A corrected post</p>") };
  const next = dateSitemap({ xml: XML, pageOf: pageOf(edited), live, today: "2026-11-19" });
  assert.deepEqual(lastmods(next.xml), { "/": "2026-11-01", "/districts/d05/": "2026-11-19", "/events/district-5/": "2026-10-05", "/service/delegate/posts/2020-09-06-step-7/": "2020-09-06" });
  assert.equal(next.counts.changed, 2);
  assert.deepEqual(JSON.parse(next.manifest)["/districts/d05/"], [pageFingerprint(edited["/districts/d05/"]), "2026-11-19"]);
  // the lastmod goes where sitemap.njk puts it
  assert.match(next.xml, /<loc>https:\/\/msca09aa\.org\/districts\/d05\/<\/loc>\n    <lastmod>2026-11-19<\/lastmod>\n  <\/url>/);
});

test("an event page takes the later of its calendar date and the day its page last changed", () => {
  const first = JSON.parse(dateSitemap({ xml: XML, pageOf: pageOf(PAGES), live: null, today: "2026-11-19" }).manifest);
  const live = new Map(Object.entries(first));
  // the event has ended: its page says so (and the calendar entry was not edited)
  const ended = { ...PAGES, "/events/district-5/": page("<p>District 5 business meeting</p><p>This event has ended.</p>") };
  assert.equal(lastmods(dateSitemap({ xml: XML, pageOf: pageOf(ended), live, today: "2026-11-19" }).xml)["/events/district-5/"], "2026-11-19");
  // a page that last changed before its calendar entry was edited keeps the calendar's date
  const older = new Map([...live].map(([p, v]) => [p, p === "/events/district-5/" ? [v[0], "2026-09-01"] : v]));
  assert.equal(lastmods(dateSitemap({ xml: XML, pageOf: pageOf(PAGES), live: older, today: "2026-11-19" }).xml)["/events/district-5/"], "2026-10-05");
  assert.ok(isEventPage("/es/events/district-5/"));
  assert.ok(!isEventPage("/events/"));
});

test("a new page is dated the day it appears; a page missing from the build is left as it is", () => {
  const live = new Map([["/", [pageFingerprint(PAGES["/"]), ""]]]);
  const { xml, counts } = dateSitemap({ xml: sitemap([["/"], ["/districts/d05/"], ["/nowhere/"]]), pageOf: pageOf(PAGES), live, today: "2026-11-19" });
  assert.deepEqual(lastmods(xml), { "/": "", "/districts/d05/": "2026-11-19", "/nowhere/": "" });
  assert.deepEqual(counts.missing, ["/nowhere/"]);
});

test("a site under a path prefix (github.io) uses the same page names", () => {
  const xml = sitemap([["/"], ["/districts/d05/"]]).replaceAll(SITE, "https://example.github.io/repo");
  const { manifest } = dateSitemap({ xml, pageOf: pageOf(PAGES), live: null, today: "2026-11-19", prefix: "/repo/" });
  assert.deepEqual(Object.keys(JSON.parse(manifest)), ["/", "/districts/d05/"]);
});

test("when only the live page dates could not be read, the live sitemap's dates are kept for that build", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dates-"));
  try {
    const f = path.join(dir, "sitemap.xml");
    fs.writeFileSync(f, sitemap([["/", "2026-11-01"], ["/districts/d05/"], ["/events/district-5/", "2026-11-02"]]));
    const fallback = readSitemapDates(f);
    assert.deepEqual([...fallback], [["/", "2026-11-01"], ["/events/district-5/", "2026-11-02"]]);
    // even a page that changed keeps its live date (it cannot be told apart); the fingerprints are the new ones
    const edited = { ...PAGES, "/": page("<p>Welcome, newcomers</p>") };
    const { xml, manifest } = dateSitemap({ xml: XML, pageOf: pageOf(edited), live: null, fallback, today: "2026-11-19" });
    assert.deepEqual(lastmods(xml), { "/": "2026-11-01", "/districts/d05/": "", "/events/district-5/": "2026-11-02", "/service/delegate/posts/2020-09-06-step-7/": "2020-09-06" });
    assert.deepEqual(JSON.parse(manifest)["/"], [pageFingerprint(edited["/"]), "2026-11-01"]);
    assert.equal(readSitemapDates(path.join(dir, "missing.xml")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a live copy that is not a page-dates file counts as none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dates-"));
  try {
    const f = path.join(dir, "page-dates.json");
    fs.writeFileSync(f, "<html>404</html>");
    assert.equal(readManifest(f), null);
    fs.writeFileSync(f, JSON.stringify({ "/": "abc" }));
    assert.equal(readManifest(f), null);
    fs.writeFileSync(f, JSON.stringify({ "/": ["abcdefghijklmnop", "not a day"], "/x/": ["bbbbbbbbbbbbbbbb", "2026-11-01"] }));
    assert.deepEqual([...readManifest(f)], [["/", ["abcdefghijklmnop", ""]], ["/x/", ["bbbbbbbbbbbbbbbb", "2026-11-01"]]]);
    assert.equal(readManifest(path.join(dir, "missing.json")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ IndexNow */
function indexnow(files, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexnow-"));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    const env = { ...process.env };
    delete env.SITE_URL;
    delete env.ELEVENTY_PATH_PREFIX;
    const r = spawnSync(process.execPath, [INDEXNOW, ...args.map((a) => (a in files || a.startsWith("missing") ? path.join(dir, a) : a))], { cwd: ROOT, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return { urls: JSON.parse(r.stdout), log: r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("IndexNow is told about a hub page once it has a new content date", () => {
  const before = sitemap([["/"], ["/districts/d05/"], ["/events/district-5/", "2026-10-05"]]);
  const after = sitemap([["/", ""], ["/districts/d05/", "2026-11-19"], ["/events/district-5/", "2026-10-05"]]);
  const { urls } = indexnow({ "live.xml": before, "new.xml": after }, ["live.xml", "new.xml"]);
  assert.deepEqual(urls, [`${SITE}/districts/d05/`]);
});

test("old addresses: the new and gone ones, all of them when asked, none without the live list", () => {
  const pages = sitemap([["/"]]);
  const oldLive = sitemap([["/old-a/"], ["/old-b/"]]);
  const oldNew = sitemap([["/old-a/"], ["/old-c/"]]);
  const files = { "live.xml": pages, "new.xml": pages, "old-live.xml": oldLive, "old-new.xml": oldNew };
  assert.deepEqual(indexnow(files, ["live.xml", "new.xml", "--old", "old-live.xml", "old-new.xml"]).urls, [`${SITE}/old-c/`, `${SITE}/old-b/`]);
  assert.deepEqual(indexnow(files, ["live.xml", "new.xml", "--old", "old-live.xml", "old-new.xml", "--all-old"]).urls, [`${SITE}/old-a/`, `${SITE}/old-c/`]);
  const none = indexnow(files, ["live.xml", "new.xml", "--old", "missing-old.xml", "old-new.xml"]);
  assert.deepEqual(none.urls, []);
  assert.match(none.log, /could not be read: none is sent/);
  // and the pages as before when there is no --old
  assert.deepEqual(indexnow(files, ["live.xml", "new.xml"]).urls, []);
});

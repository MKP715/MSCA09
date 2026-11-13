// The central-office flyer check: `node scripts/check-media.mjs --office-flyers`, its helpers in
// scripts/lib/media-read.mjs and the robots.txt rules in scripts/lib/robots.mjs.
//
// No network and no OCR program: every download is answered by a stand-in fetch that this file writes to a temporary
// folder and loads with `node --import`, and MEDIA_OCR_CMD / MEDIA_PDFTEXT_CMD / MEDIA_RASTER_CMD point at a stand-in
// reader that prints the words hidden in the test files (between "WORDS:" and ":END"). The flyers are tiny PNG
// pictures and PDFs made here too. Nothing in the repository is written (the events file and the review file are
// temporary copies, passed with --mirror and --review). Run: node --test "test/office-events/*.test.mjs"
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  analyse,
  describe as describeFound,
  reviewDue,
  recheckDue,
  recheckCap,
  RECHECK_DAYS,
  mirrorFlyers,
  mergeReview,
  readReview,
  reviewText,
  fetchCapped,
  siteHost,
  ptDate,
  sniff,
  OFFICE_UA,
  OFFICE_ACCEPT,
  REVIEW_HEADER,
  REVIEW_COMMENTS,
} from "../../scripts/lib/media-read.mjs";
import { parseRobots, robotsAllows, robotsFromResponse, fetchRobots, ROBOTS_TOKEN } from "../../scripts/lib/robots.mjs";
import { hashKey } from "../../src/_lib/office-import.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = "2026-10-30T12:00:00-07:00";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const NO_ALLOW = { okPhones: new Set(), okEmails: new Set() };

/* ------------------------------------------------------------------ tiny test files */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A valid 1×1 grey PNG whose "printed words" (for the stand-in OCR) sit in a tEXt chunk. */
function png(words) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth; colour type 0 (grey), no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`Comment\0WORDS:${words}:END`, "latin1")),
    pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, 0x80]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
/** A file that starts like a PDF; the stand-in pdftotext prints its words. */
const pdf = (words) => Buffer.from(`%PDF-1.4\n% WORDS:${words}:END\n%%EOF\n`, "latin1");

/* ------------------------------------------------------------------ stand-ins */
const FAKE_READ = `import fs from "node:fs";
const text = fs.readFileSync(process.argv[2]).toString("latin1");
const m = /WORDS:([\\s\\S]*?):END/.exec(text);
process.stdout.write(m ? m[1] : "");
`;
const FAKE_FETCH = `import fs from "node:fs";
const routes = JSON.parse(fs.readFileSync(process.env.FAKE_FETCH_ROUTES, "utf8"));
globalThis.fetch = async (input, init = {}) => {
  const url = String(input && input.url ? input.url : input);
  const headers = Object.fromEntries(new Headers(init.headers || {}));
  fs.appendFileSync(process.env.FAKE_FETCH_LOG, JSON.stringify({ url, headers, referrer: init.referrer ?? null }) + "\\n");
  const r = routes[url];
  if (!r) throw new TypeError("fetch failed", { cause: Object.assign(new Error("no network in tests"), { code: "ENOTFOUND" }) });
  const body = r.file ? fs.readFileSync(r.file) : Buffer.from(r.text || "");
  const h = { "content-type": r.type || "application/octet-stream" };
  if (r.length != null) h["content-length"] = String(r.length);
  return new Response(body, { status: r.status || 200, headers: h });
};
`;

let TMP;
let FETCH_MODULE;
let READER;
const readerCmd = () => `"${process.execPath}" "${READER}" "{in}"`;

/**
 * Run check-media.mjs (from the repository root) with the stand-ins; routes = { url: { file|text, type, status, length } }.
 * A URL with no route fails like a lost connection. env.PATH replaces the search path (every spelling of it).
 */
function runCheck(cliArgs, { routes = {}, name = "run", env = {} } = {}) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const routesFile = path.join(dir, "routes.json");
  const log = path.join(dir, "fetch.log");
  const out = path.join(dir, "github-output.txt");
  fs.writeFileSync(routesFile, JSON.stringify(routes));
  if (!fs.existsSync(log)) fs.writeFileSync(log, "");
  if (!fs.existsSync(out)) fs.writeFileSync(out, "");
  const base = { ...process.env };
  if (env.PATH != null) for (const k of Object.keys(base)) if (/^path$/i.test(k)) delete base[k];
  const r = spawnSync(process.execPath, [`--import=${pathToFileURL(FETCH_MODULE).href}`, "scripts/check-media.mjs", ...cliArgs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
    env: {
      ...base,
      MEDIA_OCR_CMD: readerCmd(),
      MEDIA_PDFTEXT_CMD: readerCmd(),
      MEDIA_RASTER_CMD: readerCmd(),
      MEDIA_OFFICE_DELAY: "0",
      MEDIA_LIMIT: "",
      MEDIA_MAX_MINUTES: "",
      FAKE_FETCH_ROUTES: routesFile,
      FAKE_FETCH_LOG: log,
      GITHUB_OUTPUT: out,
      ...env,
    },
  });
  const requests = fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", requests, output: fs.readFileSync(out, "utf8"), error: r.error };
}

/** A file served by the stand-in fetch. */
function serve(name, buf) {
  const file = path.join(TMP, "web", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return { file, sha: sha(buf) };
}
const flyer = (url, sha256, more = {}) => ({ url, sha256, w: 1, h: 1, mime: "image/png", sizes: [], pdf: "", ...more });
const event = (id, office, flyers, more = {}) => ({
  id,
  office,
  also: [],
  src: `https://www.example.net/event/${id}/`, // the office's own site: addresses @example.net are the office's
  title: id,
  title_es: "",
  lang: "English",
  type: "Event",
  cats: [],
  start: "2026-11-14T11:00:00-08:00",
  end: "",
  allDay: false,
  endDate: "",
  venue: "",
  address: "",
  city: "",
  zip: "",
  format: "In person",
  cost: "",
  summary: "",
  flyers,
  flags: [],
  srcHash: "x",
  ...more,
});
/** robots.txt answers for the stand-in fetch */
const robotsUrl = (host) => `https://${host}/robots.txt`;
const ROBOTS_OK = { text: "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n", type: "text/plain" };
const writeMirror = (file, events) => fs.writeFileSync(file, JSON.stringify({ v: 1, tz: "America/Los_Angeles", offices: {}, events }, null, 1) + "\n");

before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "msca-office-flyers-test-"));
  READER = path.join(TMP, "fake-read.mjs");
  FETCH_MODULE = path.join(TMP, "fake-fetch.mjs");
  fs.writeFileSync(READER, FAKE_READ);
  fs.writeFileSync(FETCH_MODULE, FAKE_FETCH);
});
after(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the helpers */
describe("media-read helpers", () => {
  test("flyer rules: e-mail, sobriety and old page passwords; phone numbers only when asked", () => {
    const text = "Call (714) 555-0123. RSVP name@example.org. 30 years of sobriety. Password protected: serenity";
    const flyer = analyse(text, { phones: false, allowed: NO_ALLOW, passwords: true });
    assert.deepEqual(flyer, { phone: 0, email: 1, sobriety: 1, password: 1 });
    assert.equal(describeFound(flyer), "a personal e-mail address, a sobriety date, an old page password");
    // a document (phones on) without the password rule: exactly the old counts, no password key
    const doc = analyse(text, { allowed: NO_ALLOW });
    assert.deepEqual(doc, { phone: 1, email: 1, sobriety: 1 });
    // a Zoom passcode is not an old page password
    assert.equal(analyse("Zoom ID 812 3456 7890 Passcode: 1234", { phones: false, allowed: NO_ALLOW, passwords: true }).password, 0);
  });

  test("the office's own domain (and its sub-domains), role domains and the allow-list are fine", () => {
    const opts = { phones: false, allowed: { okPhones: new Set(), okEmails: new Set(["hello@example.com"]) }, domains: ["https://www.example.net/events/"] };
    assert.equal(analyse("office@example.net events@mail.example.net delegate@msca09aa.org hello@example.com", opts).email, 0);
    // put together while the test runs (this file is public history: example.org/.com/.net addresses only)
    assert.equal(analyse(["someone", "notexample.net"].join("@"), opts).email, 1, "a look-alike domain is not the office's");
    assert.equal(analyse("name@example.org", opts).email, 1);
  });

  test("siteHost, ptDate and sniff", () => {
    assert.equal(siteHost("https://www.OC-AA.org/events/"), "oc-aa.org");
    assert.equal(siteHost("aanoc.org"), "aanoc.org");
    assert.equal(siteHost(""), "");
    assert.equal(ptDate(new Date("2026-10-31T05:00:00Z")), "2026-10-30", "10 pm in California is still the 30th");
    assert.equal(sniff(png("x")), "image/png");
    assert.equal(sniff(pdf("x")), "application/pdf");
    assert.equal(sniff(Buffer.from("<html>")), "");
  });

  test("reviewDue: no row, pending, or an error at least 7 days old", () => {
    const today = "2026-10-30";
    assert.equal(reviewDue(undefined, today), true);
    assert.equal(reviewDue({ result: "pending", checked_on: "" }, today), true);
    assert.equal(reviewDue({ result: "clean", checked_on: "2025-01-01" }, today), false);
    assert.equal(reviewDue({ result: "cleared", checked_on: "2025-01-01" }, today), false);
    assert.equal(reviewDue({ result: "hold: e-mail", checked_on: "2025-01-01" }, today), false);
    assert.equal(reviewDue({ result: "error: HTTP 404", checked_on: "2026-10-27" }, today), false);
    assert.equal(reviewDue({ result: "error: HTTP 404", checked_on: "2026-10-23" }, today), true);
    assert.equal(reviewDue({ result: "error: HTTP 404", checked_on: "" }, today), true);
    assert.equal(reviewDue({ result: "error: robots", checked_on: "2026-10-23" }, today), true, "a robots block is tried again like other errors");
    assert.equal(reviewDue({ result: "error: changed", checked_on: "2026-10-27" }, today), false);
  });

  test("recheckDue: clean or cleared rows whose check is 14 days old or more; recheckCap spreads them over the days", () => {
    const today = "2026-10-30";
    assert.equal(RECHECK_DAYS, 14);
    assert.equal(recheckDue(undefined, today), false);
    assert.equal(recheckDue({ result: "clean", checked_on: "2026-10-17" }, today), false, "13 days");
    assert.equal(recheckDue({ result: "clean", checked_on: "2026-10-16" }, today), true, "14 days");
    assert.equal(recheckDue({ result: "Cleared", checked_on: "2026-10-01" }, today), true);
    assert.equal(recheckDue({ result: "cleared", checked_on: "" }, today), true, "an editor's row without a date");
    assert.equal(recheckDue({ result: "clean", checked_on: "2027-01-01" }, today), true, "a date in the future is not trusted");
    assert.equal(recheckDue({ result: "hold: e-mail", checked_on: "2025-01-01" }, today), false, "a held flyer stays hidden anyway");
    assert.equal(recheckDue({ result: "error: HTTP 404", checked_on: "2025-01-01" }, today), false, "errors come back through reviewDue");
    assert.equal(recheckDue({ result: "pending", checked_on: "" }, today), false);
    assert.deepEqual([0, 1, 2, 21, 30, 100].map((n) => recheckCap(n)), [0, 3, 3, 3, 5, 15]);
  });

  test("mirrorFlyers lists each (url, sha256) once, with every event that uses it", () => {
    const list = mirrorFlyers({
      events: [
        event("co-a-1", "nocco", [flyer("https://x.example.org/a.png", "AB")]),
        event("co-a-2", "nocco", [flyer("https://x.example.org/a.png", "ab"), flyer("https://x.example.org/b.png", "")]),
        { id: "broken" },
      ],
    });
    assert.equal(list.length, 2);
    assert.deepEqual(list[0].ids, ["co-a-1", "co-a-2"]);
    assert.equal(list[0].sha256, "ab");
    assert.equal(list[1].sha256, "");
  });

  test("mergeReview replaces rows by (url, sha256) and drops a changed file's old fingerprint", () => {
    const rows = [
      { url: "https://x/b.png", sha256: "1", checked_on: "2026-10-01", result: "clean", notes: "" },
      { url: "https://x/a.png", sha256: "1", checked_on: "2026-10-01", result: "error: HTTP 500", notes: "" },
      { url: "https://x/c.png", sha256: "9", checked_on: "2026-10-01", result: "cleared", notes: "editor" },
    ];
    const merged = mergeReview(rows, [
      { url: "https://x/a.png", sha256: "1", checked_on: "2026-10-30", result: "clean", notes: "" },
      { url: "https://x/b.png", sha256: "2", checked_on: "2026-10-30", result: "hold: e-mail", notes: "" },
    ], new Map([["https://x/a.png", new Set(["1"])], ["https://x/b.png", new Set(["2"])]]));
    assert.deepEqual(merged.map((r) => `${r.url} ${r.sha256} ${r.result}`), [
      "https://x/a.png 1 clean",
      "https://x/b.png 2 hold: e-mail",
      "https://x/c.png 9 cleared",
    ]);
  });

  test("reviewText and readReview round-trip, comment rows as wide as the header", () => {
    const file = path.join(TMP, "roundtrip.csv");
    const rows = [{ url: "https://x/a,b.png", sha256: "1", checked_on: "2026-10-30", result: "clean", notes: 'read as "picture"' }];
    const text = reviewText({ header: REVIEW_HEADER, comments: REVIEW_COMMENTS.map((c) => [c]), rows, nl: "\r\n" });
    fs.writeFileSync(file, text);
    const back = readReview(file);
    assert.deepEqual(back.header, REVIEW_HEADER);
    assert.equal(back.nl, "\r\n");
    assert.equal(back.comments.length, REVIEW_COMMENTS.length);
    assert.deepEqual(back.rows, rows);
    assert.equal(reviewText(back), text, "reading and writing again changes nothing");
    for (const line of text.split("\r\n").filter(Boolean).slice(1, 1 + REVIEW_COMMENTS.length)) assert.match(line, /,,,,$/);
  });

  test("fetchCapped: office User-Agent, no Referer, 8 MB at most, short reasons", async () => {
    const real = globalThis.fetch;
    const seen = [];
    try {
      globalThis.fetch = async (url, init) => {
        seen.push({ url, init });
        if (url.endsWith("/big")) return new Response(Buffer.alloc(9 * 1024 * 1024), { status: 200, headers: { "content-type": "image/png" } });
        if (url.endsWith("/declared")) return new Response("x", { status: 200, headers: { "content-type": "image/png", "content-length": String(20 * 1024 * 1024) } });
        if (url.endsWith("/gone")) return new Response("nope", { status: 404 });
        if (url.endsWith("/down")) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
        return new Response(png("ok"), { status: 200, headers: { "content-type": "image/png; charset=binary" } });
      };
      const ok = await fetchCapped("https://x.example.org/ok");
      assert.equal(ok.ok, true);
      assert.equal(ok.type, "image/png");
      assert.equal(sniff(ok.buf), "image/png");
      assert.equal(seen[0].init.headers["user-agent"], OFFICE_UA);
      assert.equal(Object.keys(seen[0].init.headers).some((h) => /referer/i.test(h)), false);
      assert.equal(seen[0].init.referrerPolicy, "no-referrer");
      assert.equal(seen[0].init.headers.accept, OFFICE_ACCEPT, "the same Accept header as the importer");
      assert.equal(OFFICE_ACCEPT, "image/*,application/pdf;q=0.9");
      assert.match(OFFICE_UA, new RegExp(`compatible; ${ROBOTS_TOKEN};`));
      assert.match((await fetchCapped("https://x.example.org/big")).error, /^too big/);
      assert.match((await fetchCapped("https://x.example.org/declared")).error, /^too big/);
      assert.equal((await fetchCapped("https://x.example.org/gone")).error, "HTTP 404");
      assert.match((await fetchCapped("https://x.example.org/down")).error, /ECONNREFUSED/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

/* ------------------------------------------------------------------ the command */
describe("check-media.mjs --office-flyers", () => {
  const U = (name) => `https://flyers.example.org/wp-content/uploads/2026/10/${name}`;

  test("reads new flyers, holds e-mail / sobriety / password flyers, records errors, keeps the rest", () => {
    const dir = path.join(TMP, "main");
    fs.mkdirSync(dir, { recursive: true });
    const routes = { [robotsUrl("flyers.example.org")]: ROBOTS_OK };
    const add = (name, buf, more = {}) => {
      const s = serve(`main-${name}`, buf);
      routes[U(name)] = { file: s.file, type: more.type || "image/png", ...more };
      return s.sha;
    };
    const A = add("a.png", png("Practicing Principles, Saturday November 14. Questions: office@example.net or (714) 555-0123. Zoom Passcode: 1234"));
    const B = add("b.png", png("Halloween party. RSVP to name@example.org"));
    const C = add("c.png", png("Banquet: come celebrate 30 years of sobriety with us"));
    const D = add("d.png", png("Recordings page. Password protected: serenity"));
    add("e.png", png("A flyer that was replaced after the importer fingerprinted it"));
    const J = add("j.png", png("Gratitude dinner, all welcome"));
    const htmlBuf = Buffer.from("<!doctype html><title>Not found</title>");
    const K = add("k.png", htmlBuf, { type: "text/html" });
    const L = add("l.pdf", pdf("Thanksgiving Alcathon at the club hall, November 26 from 7am to November 27 at 1am. Meetings every hour, food all day, everyone is welcome to join the fellowship."), { type: "application/pdf" });
    const M = add("m-pdf.jpg", png("Open House preview: coffee and cake"), { type: "image/jpeg" });
    serve("main-m.pdf", pdf("Open House at the office, November 14 from 11am. Coffee, cake and a tour of the office. Questions to name@example.org, the volunteer coordinator, any time."));
    routes[U("m.pdf")] = { file: path.join(TMP, "web", "main-m.pdf"), type: "application/pdf" };
    const N = add("n.png", png("Bowling night, the new version of the flyer"));
    routes[U("o.png")] = { status: 404, text: "not found", type: "text/html" };
    routes[U("p.png")] = { text: "x", type: "image/png", length: 9 * 1024 * 1024 };
    const Q = add("q.png", png("Ice cream social"));
    const G = sha(Buffer.from("already checked"));
    const H = sha(Buffer.from("cleared by an editor"));
    const I = sha(Buffer.from("failed three days ago"));
    const O = sha(Buffer.from("o"));
    const P = sha(Buffer.from("p"));
    const E_MIRROR = sha(Buffer.from("the file the importer saw"));
    const N_OLD = sha(Buffer.from("the old version of the bowling flyer"));

    const mirror = path.join(dir, "central-office-events.json");
    writeMirror(mirror, [
      event("co-nocco-1", "nocco", [flyer(U("a.png"), A)]),
      event("co-oc-central-2", "oc-central", [flyer(U("b.png"), B)]),
      event("co-haco-3", "haco", [flyer(U("c.png"), C)]),
      event("co-temecula-4", "temecula", [flyer(U("d.png"), D)]),
      event("co-asbco-5", "asbco", [flyer(U("e.png"), E_MIRROR)]),
      event("co-asbco-6", "asbco", [flyer(U("f.png"), "")]),
      event("co-asbco-7", "asbco", [flyer(U("g.png"), G), flyer(U("h.png"), H)]),
      event("co-haco-8", "haco", [flyer(U("i.png"), I), flyer(U("j.png"), J)]),
      event("co-haco-9", "haco", [flyer(U("k.png"), K)]),
      event("co-temecula-10", "temecula", [flyer(U("l.pdf"), L, { mime: "application/pdf" })]),
      event("co-haco-11", "haco", [flyer(U("m-pdf.jpg"), M, { mime: "image/jpeg", pdf: U("m.pdf") })]),
      event("co-oc-central-12", "oc-central", [flyer(U("n.png"), N), flyer(U("o.png"), O), flyer(U("p.png"), P), flyer(U("q.png"), Q)]),
      event("co-nocco-13", "nocco", [flyer(U("a.png"), A)]),
    ]);
    const review = path.join(dir, "office-flyer-review.csv");
    const before = [
      { url: U("g.png"), sha256: G, checked_on: "2026-10-20", result: "clean", notes: "read as picture" },
      { url: U("h.png"), sha256: H, checked_on: "2026-10-25", result: "cleared", notes: "an editor looked" },
      { url: U("i.png"), sha256: I, checked_on: "2026-10-27", result: "error: HTTP 503", notes: "" },
      { url: U("j.png"), sha256: J, checked_on: "2026-10-20", result: "error: HTTP 503", notes: "" },
      { url: U("n.png"), sha256: N_OLD, checked_on: "2026-10-01", result: "clean", notes: "the old file" },
      { url: U("q.png"), sha256: Q, checked_on: "", result: "pending", notes: "" },
      { url: "https://flyers.example.org/past-event.png", sha256: "f".repeat(64), checked_on: "2026-09-01", result: "clean", notes: "an event that is over" },
    ];
    fs.writeFileSync(review, reviewText({ header: REVIEW_HEADER, comments: REVIEW_COMMENTS.map((c) => [c]), rows: before, nl: "\r\n" }));

    const r = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "main" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const rows = new Map(readReview(review).rows.map((row) => [`${row.url} ${row.sha256}`, row]));
    const result = (name, s) => rows.get(`${U(name)} ${s}`)?.result;

    assert.equal(result("a.png", A), "clean", "the office's own address, a phone number and a Zoom passcode are fine on a flyer");
    assert.equal(result("b.png", B), "hold: e-mail");
    assert.equal(result("c.png", C), "hold: sobriety");
    assert.equal(result("d.png", D), "hold: password");
    assert.equal(result("e.png", E_MIRROR), "error: changed");
    assert.equal(rows.has(`${U("f.png")} `), false, "a flyer without a fingerprint is left for the importer");
    assert.equal(result("g.png", G), "clean");
    assert.equal(rows.get(`${U("g.png")} ${G}`).checked_on, "2026-10-20", "a clean row checked 10 days ago is not read again");
    assert.equal(result("h.png", H), "cleared");
    assert.equal(rows.get(`${U("h.png")} ${H}`).notes, "an editor looked");
    assert.equal(rows.get(`${U("i.png")} ${I}`).checked_on, "2026-10-27", "an error from 3 days ago waits");
    assert.equal(result("j.png", J), "clean", "an error from 10 days ago is read again");
    assert.match(result("k.png", K), /^error: not a picture or PDF/);
    assert.equal(result("l.pdf", L), "clean");
    assert.match(rows.get(`${U("l.pdf")} ${L}`).notes, /pdf text/);
    assert.equal(result("m-pdf.jpg", M), "hold: e-mail", "the PDF original behind a preview is read too");
    assert.match(rows.get(`${U("m-pdf.jpg")} ${M}`).notes, /PDF original/);
    assert.match(rows.get(`${U("m-pdf.jpg")} ${M}`).notes, /PDF original fingerprint [0-9a-f]{16}/, "noted for an editor's later cleared");
    assert.equal(result("n.png", N), "clean");
    assert.equal(rows.has(`${U("n.png")} ${N_OLD}`), false, "the old fingerprint's row goes when the file changed");
    assert.equal(result("o.png", O), "error: HTTP 404");
    assert.match(result("p.png", P), /^error: too big/);
    assert.equal(result("q.png", Q), "clean", "a pending row is read");
    assert.equal(rows.get(`${U("q.png")} ${Q}`).checked_on, "2026-10-30", "checked_on is the California date of --now");
    assert.equal(rows.get(`https://flyers.example.org/past-event.png ${"f".repeat(64)}`)?.result, "clean", "rows of other flyers stay");
    assert.match(rows.get(`${U("a.png")} ${A}`).notes, /co-nocco-1 co-nocco-13/, "one row for a flyer shared by two events");

    // requests: robots.txt once, each due flyer once (and the PDF original), the office User-Agent and Accept header,
    // never a Referer; nothing else
    const urls = r.requests.map((q) => q.url);
    assert.equal(urls[0], robotsUrl("flyers.example.org"), "robots.txt is read before anything else on the site");
    assert.deepEqual([...urls].sort(), [robotsUrl("flyers.example.org"), U("a.png"), U("b.png"), U("c.png"), U("d.png"), U("e.png"), U("j.png"), U("k.png"), U("l.pdf"), U("m-pdf.jpg"), U("m.pdf"), U("n.png"), U("o.png"), U("p.png"), U("q.png")].sort());
    for (const q of r.requests) {
      assert.equal(q.headers["user-agent"], OFFICE_UA);
      assert.equal("referer" in q.headers, false);
      assert.equal(q.referrer, null);
      if (!q.url.endsWith("/robots.txt")) assert.equal(q.headers.accept, OFFICE_ACCEPT);
    }

    // never the details themselves: not in the file, not in the log
    const text = fs.readFileSync(review, "utf8");
    for (const secret of ["name@example.org", "serenity", "30 years", "555-0123"]) {
      assert.equal(text.includes(secret), false, `review file must not contain ${secret}`);
      assert.equal(r.stdout.includes(secret), false, `output must not contain ${secret}`);
    }
    assert.match(rows.get(`${U("b.png")} ${B}`).notes, /found a personal e-mail address/);
    // a flyer is named in the log by its office and the hash of its address, never by its address or file name (an
    // office may name a file after its event); the review file keeps the address
    for (const [name, office] of [["a.png", "nocco"], ["b.png", "oc-central"], ["c.png", "haco"], ["d.png", "temecula"], ["l.pdf", "temecula"], ["o.png", "oc-central"]]) {
      assert.ok(r.stdout.includes(`${office} ${hashKey(U(name))}`), name);
    }
    assert.doesNotMatch(r.stdout, /wp-content\/uploads|\b[a-q](?:-pdf)?\.(?:png|pdf|jpg)\b/);

    // the file: header, comment rows kept, CRLF kept, rows sorted by url
    const lines = text.split("\r\n");
    assert.equal(lines[0], REVIEW_HEADER.join(","));
    assert.equal(lines.filter((l) => l.startsWith('"#') || l.startsWith("#")).length, REVIEW_COMMENTS.length);
    assert.equal(text.replace(/\r\n/g, "").includes("\n"), false);
    const order = readReview(review).rows.map((row) => row.url);
    assert.deepEqual(order, [...order].sort());

    // warnings and the step outputs
    assert.equal((r.stdout.match(/::warning::A central-office flyer is held/g) || []).length, 4);
    assert.match(r.stdout, /::warning::4 central-office flyer\(s\) could not be checked/);
    assert.match(r.output, /^checked=13$/m);
    assert.match(r.output, /^held=4$/m);

    // a second run the same day: nothing is due, nothing is fetched, the file stays byte for byte
    const again = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "main-again" });
    assert.equal(again.status, 0);
    assert.equal(again.requests.length, 0);
    assert.equal(fs.readFileSync(review, "utf8"), text);
    assert.match(again.output, /^held=0$/m);
  });

  test("--dry-run changes no file and writes no step output", () => {
    const dir = path.join(TMP, "dry");
    fs.mkdirSync(dir, { recursive: true });
    const s = serve("dry.png", png("RSVP name@example.org"));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [event("co-nocco-dry", "nocco", [flyer(U("dry.png"), s.sha)])]);
    const review = path.join(dir, "review.csv");
    const original = reviewText({ comments: REVIEW_COMMENTS.map((c) => [c]) });
    fs.writeFileSync(review, original);
    const r = runCheck(["--office-flyers", "--dry-run", "--mirror", mirror, "--review", review, "--now", NOW], { routes: { [robotsUrl("flyers.example.org")]: ROBOTS_OK, [U("dry.png")]: { file: s.file, type: "image/png" } }, name: "dry" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /hold: e-mail/);
    assert.match(r.stdout, /dry run: no file changed/);
    assert.equal(fs.readFileSync(review, "utf8"), original);
    assert.equal(r.output, "");
  });

  test("a missing review file is created with its header and comment rows; --limit is honoured", () => {
    const dir = path.join(TMP, "new");
    fs.mkdirSync(dir, { recursive: true });
    const one = serve("new-1.png", png("Picnic in the park"));
    const two = serve("new-2.png", png("Chili cook-off"));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [event("co-haco-n1", "haco", [flyer(U("new-1.png"), one.sha)]), event("co-haco-n2", "haco", [flyer(U("new-2.png"), two.sha)])]);
    const review = path.join(dir, "sub", "office-flyer-review.csv");
    const routes = { [robotsUrl("flyers.example.org")]: ROBOTS_OK, [U("new-1.png")]: { file: one.file, type: "image/png" }, [U("new-2.png")]: { file: two.file, type: "image/png" } };
    const r = runCheck(["--office-flyers", "--limit", "1", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "new" });
    assert.equal(r.status, 0, r.stderr);
    const back = readReview(review);
    assert.deepEqual(back.header, REVIEW_HEADER);
    assert.deepEqual(back.comments.map((c) => c[0]), REVIEW_COMMENTS);
    assert.equal(back.rows.length, 1);
    assert.equal(back.rows[0].url, U("new-1.png"));
    assert.equal(back.rows[0].result, "clean");
    assert.deepEqual(r.requests.map((q) => q.url), [robotsUrl("flyers.example.org"), U("new-1.png")]);
  });

  test("a flyer the importer already saved (<dir>/<sha256>.<ext>) is not downloaded again", () => {
    const dir = path.join(TMP, "saved");
    const saved = path.join(dir, "office-flyers");
    fs.mkdirSync(saved, { recursive: true });
    const buf = png("Traditions day workshop");
    fs.writeFileSync(path.join(saved, `${sha(buf)}.png`), buf);
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [event("co-nocco-s", "nocco", [flyer(U("saved.png"), sha(buf))])]);
    const review = path.join(dir, "review.csv");
    const r = runCheck(["--office-flyers", saved, "--mirror", mirror, "--review", review, "--now", NOW], { name: "saved" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.requests.length, 0);
    assert.equal(readReview(review).rows[0].result, "clean");
  });

  test("no events file, or a broken one: a message, exit 0, nothing written", () => {
    const dir = path.join(TMP, "none");
    fs.mkdirSync(dir, { recursive: true });
    const review = path.join(dir, "review.csv");
    const missing = runCheck(["--office-flyers", "--mirror", path.join(dir, "nope.json"), "--review", review], { name: "none" });
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.stdout, /No central-office events yet/);
    assert.match(missing.output, /^held=0$/m);
    const broken = path.join(dir, "broken.json");
    fs.writeFileSync(broken, "{ not json");
    const bad = runCheck(["--office-flyers", "--mirror", broken, "--review", review], { name: "broken" });
    assert.equal(bad.status, 0, bad.stderr);
    assert.match(bad.stdout, /::warning::.*could not be read/);
    assert.equal(fs.existsSync(review), false);
  });

  test("the Drive file check still starts as before (no file read, no request)", () => {
    const r = runCheck(["--dry-run", "--ids", "no-such-drive-id"], { name: "drive" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Drive files in the calendar and the published documents; .* 0 to check/);
    assert.match(r.stdout, /Checked 0 file\(s\): 0 held, 0 clean, 0 could not be read\. \(dry run: no file changed\)/);
    assert.equal(r.requests.length, 0);
  });
});

/* ------------------------------------------------------------------ robots.txt (scripts/lib/robots.mjs) */
describe("robots.txt rules (RFC 9309)", () => {
  const at = (p) => `https://www.example.net${p}`;

  test("the group for MSCA09-site-builder, else a shorter name it starts with, else *; empty or partial names name no one", () => {
    const text = [
      "User-agent: *",
      "Disallow: /private/",
      "",
      "User-agent: MSCA09-site-builder/1.0",
      "Disallow: /flyers/",
      "Crawl-delay: 7",
      "",
      "User-agent:",
      "Disallow: /",
      "",
      "User-agent: site",
      "User-agent: builder",
      "Disallow: /",
      "",
      "Sitemap: https://www.example.net/sitemap.xml",
      "user-agent: msca09-SITE-builder",
      "Disallow: /drafts/",
    ].join("\n");
    const mine = parseRobots(text);
    assert.deepEqual(mine.agents, ["msca09-site-builder"]);
    assert.deepEqual(mine.rules.map((r) => r.path), ["/flyers/", "/drafts/"], "two groups for this crawler are combined");
    assert.equal(mine.delay, 7);
    assert.equal(robotsAllows(mine, at("/private/a.png")), true, "the * group does not apply when there is a group for this crawler");
    assert.equal(robotsAllows(mine, at("/flyers/a.png")), false);
    assert.equal(robotsAllows(mine, at("/drafts/a.png")), false);

    const star = parseRobots("User-agent: * \nCrawl-Delay: 20\nDisallow: /private/\n\nUser-agent: MJ12bot\nDisallow: /\n");
    assert.deepEqual(star.agents, ["*"]);
    assert.equal(star.delay, 20, "Crawl-delay, any case");
    assert.equal(robotsAllows(star, at("/private/a.png")), false);
    assert.equal(robotsAllows(star, at("/wp-content/uploads/a.png")), true);

    const short = parseRobots("User-agent: *\nAllow: /\n\nUser-agent: MSCA09\nDisallow: /\n");
    assert.equal(robotsAllows(short, at("/a.png")), false, "a group for MSCA09 is ours when none names the full token");

    const none = parseRobots("User-agent: site\nUser-agent: builder\nUser-agent: msca\nUser-agent:\nDisallow: /\n");
    assert.equal(robotsAllows(none, at("/a.png")), true, "partial and empty names are not this crawler");
    assert.deepEqual(parseRobots(""), { agents: [], rules: [], delay: 0 });
    assert.deepEqual(parseRobots("Disallow: /\n"), { agents: [], rules: [], delay: 0 }, "rules before any User-agent line belong to no group");
  });

  test("the longest matching path wins, Allow wins a tie; * and $; /robots.txt is always allowed; percent-encoding", () => {
    const rules = parseRobots(
      [
        "﻿User-agent: *",
        "Disallow: /wp-content/",
        "Allow: /wp-content/uploads/",
        "Disallow: /wp-content/uploads/private",
        "Disallow: /*.pdf$",
        "Allow: /tie",
        "Disallow: /tie",
        "Disallow: /caf%c3%a9/",
        "Disallow: /ü/",
        "Disallow: /~staff/",
        "Disallow:",
        "Disallow: /robots",
      ].join("\r\n"),
    );
    assert.equal(robotsAllows(rules, at("/wp-content/themes/x.css")), false);
    assert.equal(robotsAllows(rules, at("/wp-content/uploads/2026/10/a.png")), true);
    assert.equal(robotsAllows(rules, at("/wp-content/uploads/private/a.png")), false);
    assert.equal(robotsAllows(rules, at("/files/flyer.pdf")), false);
    assert.equal(robotsAllows(rules, at("/files/flyer.pdf?v=2")), true, "$ anchors the end");
    assert.equal(robotsAllows(rules, at("/wp-content/uploads/flyer.pdf")), true, "the longer Allow beats /*.pdf$");
    assert.equal(robotsAllows(rules, at("/tie/a.png")), true);
    assert.equal(robotsAllows(rules, at("/café/menu.png")), false);
    assert.equal(robotsAllows(rules, at("/ü/a.png")), false);
    assert.equal(robotsAllows(rules, at("/%7Estaff/a.png")), false, "%7E is ~");
    assert.equal(robotsAllows(rules, at("/events/")), true, "an empty Disallow disallows nothing");
    assert.equal(robotsAllows(rules, at("/robots.txt")), true);
    assert.equal(robotsAllows({ rules: [{ allow: false, path: "/" }] }, at("/robots.txt")), true);
    assert.equal(robotsAllows({ rules: [] }, "not a url"), false);
  });

  test("the answer decides: 2xx is read, 4xx allows everything, 5xx / 429 / no answer disallow everything", () => {
    const ok = robotsFromResponse(200, "User-agent: *\nDisallow: /x/\n");
    assert.equal(ok.unreachable, false);
    assert.equal(robotsAllows(ok, at("/a.png")), true);
    assert.equal(robotsAllows(ok, at("/x/a.png")), false);
    for (const status of [401, 403, 404, 410]) {
      const r = robotsFromResponse(status);
      assert.equal(r.unreachable, false);
      assert.equal(robotsAllows(r, at("/anything.png")), true, `HTTP ${status}`);
    }
    for (const status of [429, 500, 503, 0]) {
      const r = robotsFromResponse(status);
      assert.equal(r.unreachable, true);
      assert.equal(robotsAllows(r, at("/a.png")), false, `HTTP ${status}`);
    }
    assert.equal(robotsFromResponse(503).error, "HTTP 503");
    assert.equal(robotsFromResponse(0, "", "timeout").error, "timeout");
  });

  test("fetchRobots: one GET of /robots.txt with the given User-Agent and no Referer; errors and timeouts disallow everything", async () => {
    const calls = [];
    const answer = (status, text = "") => async (url, init) => {
      calls.push({ url, init });
      return new Response(text, { status, headers: { "content-type": "text/plain" } });
    };
    const ok = await fetchRobots("https://www.example.net/events/list/?x=1", { ua: OFFICE_UA, fetchImpl: answer(200, "User-agent: *\nDisallow: /private/\n") });
    assert.equal(calls[0].url, "https://www.example.net/robots.txt");
    assert.equal(calls[0].init.headers["user-agent"], OFFICE_UA);
    assert.equal(calls[0].init.referrerPolicy, "no-referrer");
    assert.equal(Object.keys(calls[0].init.headers).some((h) => /referer/i.test(h)), false);
    assert.equal(ok.status, 200);
    assert.equal(robotsAllows(ok, at("/private/a.png")), false);
    assert.equal(robotsAllows(ok, at("/a.png")), true);

    assert.equal(robotsAllows(await fetchRobots("https://www.example.net", { fetchImpl: answer(404) }), at("/a.png")), true);
    const down = await fetchRobots("https://www.example.net", { fetchImpl: answer(503) });
    assert.equal(down.unreachable, true);
    assert.equal(robotsAllows(down, at("/a.png")), false);
    const lost = await fetchRobots("https://www.example.net", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
    });
    assert.equal(lost.unreachable, true);
    assert.match(lost.error, /ECONNREFUSED/);
    const slow = await fetchRobots("https://www.example.net", {
      timeoutMs: 30,
      fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    assert.equal(slow.unreachable, true);
    assert.equal(slow.error, "timeout");
    // a huge file: the first 500 KiB are read
    const huge = await fetchRobots("https://www.example.net", { fetchImpl: answer(200, "User-agent: *\nDisallow: /x/\n" + "#".repeat(600 * 1024)) });
    assert.equal(robotsAllows(huge, at("/x/a.png")), false);
    assert.equal(robotsAllows(huge, at("/a.png")), true);
  });
});

/* ------------------------------------------------------------------ re-checks and robots.txt in the command */
describe("check-media.mjs --office-flyers: files replaced in place, robots.txt", () => {
  // the review rows of a run, by "url sha256"
  const rowsOf = (file) => new Map(readReview(file).rows.map((row) => [`${row.url} ${row.sha256}`, row]));
  const write = (file, rows) => fs.writeFileSync(file, reviewText({ header: REVIEW_HEADER, comments: REVIEW_COMMENTS.map((c) => [c]), rows, nl: "\r\n" }));
  const flyerUrls = (r) => r.requests.map((q) => q.url).filter((u) => !u.endsWith("/robots.txt"));

  test("clean and cleared flyers are downloaded again once their check is 14 days old", () => {
    const dir = path.join(TMP, "again");
    fs.mkdirSync(dir, { recursive: true });
    const V = (name) => `https://again.example.org/wp-content/uploads/${name}`;
    const routes = { [robotsUrl("again.example.org")]: ROBOTS_OK };
    const add = (name, buf) => {
      const s = serve(`again-${name}`, buf);
      routes[V(name)] = { file: s.file, type: "image/png" };
      return s.sha;
    };
    const SAME = add("same.png", png("Gratitude potluck, all welcome"));
    add("swapped.png", png("The new version of the flyer. RSVP to name@example.org"));
    const SWAPPED = sha(Buffer.from("the flyer as the importer saw it"));
    const KEPT = add("kept.png", png("Banquet. RSVP to name@example.org")); // an editor cleared it (the address is the host's role mailbox)
    const RECENT = add("recent.png", png("Chili cook-off"));
    const HELD = add("held.png", png("Dance. RSVP to name@example.org"));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [
      event("co-oc-central-a1", "oc-central", [flyer(V("same.png"), SAME)]),
      event("co-oc-central-a2", "oc-central", [flyer(V("swapped.png"), SWAPPED)]),
      event("co-haco-a3", "haco", [flyer(V("kept.png"), KEPT)]),
      event("co-haco-a4", "haco", [flyer(V("recent.png"), RECENT)]),
      event("co-haco-a5", "haco", [flyer(V("held.png"), HELD)]),
    ]);
    const review = path.join(dir, "review.csv");
    write(review, [
      { url: V("same.png"), sha256: SAME, checked_on: "2026-10-10", result: "clean", notes: "read as picture · co-oc-central-a1" },
      { url: V("swapped.png"), sha256: SWAPPED, checked_on: "2026-10-01", result: "clean", notes: "read as picture · co-oc-central-a2" },
      { url: V("kept.png"), sha256: KEPT, checked_on: "2026-10-01", result: "cleared", notes: "an editor looked: the host's role mailbox" },
      { url: V("recent.png"), sha256: RECENT, checked_on: "2026-10-20", result: "clean", notes: "read as picture" },
      { url: V("held.png"), sha256: HELD, checked_on: "2025-01-01", result: "hold: e-mail", notes: "found a personal e-mail address" },
    ]);

    const r = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "again" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /2 already checked; .*3 to check \(at most 150 now\), 3 of them clean or cleared flyers downloaded again/);
    const rows = rowsOf(review);
    const row = (name, s) => rows.get(`${V(name)} ${s}`);
    assert.equal(row("same.png", SAME).result, "clean", "the same file: still clean");
    assert.equal(row("same.png", SAME).checked_on, "2026-10-30", "with a new checked_on");
    assert.equal(row("swapped.png", SWAPPED).result, "error: changed", "a file replaced at the same address is hidden");
    assert.equal(row("swapped.png", SWAPPED).checked_on, "2026-10-30");
    assert.match(row("swapped.png", SWAPPED).notes, /the importer fingerprints it again/);
    assert.equal(row("kept.png", KEPT).result, "cleared", "the editor's decision stands for the very file they looked at");
    assert.equal(row("kept.png", KEPT).notes, "an editor looked: the host's role mailbox");
    assert.equal(row("kept.png", KEPT).checked_on, "2026-10-30");
    assert.equal(row("recent.png", RECENT).checked_on, "2026-10-20", "checked 10 days ago: not yet");
    assert.equal(row("held.png", HELD).checked_on, "2025-01-01", "a held flyer is not downloaded again");
    assert.deepEqual(flyerUrls(r).sort(), [V("kept.png"), V("same.png"), V("swapped.png")]);
    assert.match(r.stdout, /clean \(checked again\)/);
    assert.match(r.output, /^checked=3$/m);
    assert.equal(r.stdout.includes("name@example.org"), false);
    assert.equal(fs.readFileSync(review, "utf8").includes("name@example.org"), false);

    // later the same day: nothing is due any more, nothing is fetched
    const text = fs.readFileSync(review, "utf8");
    const again = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "again-2" });
    assert.equal(again.status, 0);
    assert.equal(again.requests.length, 0);
    assert.equal(fs.readFileSync(review, "utf8"), text);
  });

  test("a cleared flyer keeps the editor's decision through an error and gets it back when the same file is read again", () => {
    const dir = path.join(TMP, "cleared");
    fs.mkdirSync(dir, { recursive: true });
    const W = "https://cleared.example.org/flyers/workshop.png";
    const looked = png("Traditions workshop. Questions: name@example.org");
    const s = serve("cleared-workshop.png", looked);
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [event("co-haco-c1", "haco", [flyer(W, s.sha)])]);
    const review = path.join(dir, "review.csv");
    write(review, [{ url: W, sha256: s.sha, checked_on: "2026-10-01", result: "cleared", notes: "an editor looked" }]);
    const run = (now, routes, name) => runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", now], { routes, name });

    // robots.txt answers 503: nothing on that site is read today, the flyer is hidden
    const down = run(NOW, { [robotsUrl("cleared.example.org")]: { status: 503, text: "busy", type: "text/plain" }, [W]: { file: s.file, type: "image/png" } }, "cleared-1");
    assert.equal(down.status, 0, down.stderr);
    assert.deepEqual(flyerUrls(down), [], "the flyer is not requested when robots.txt cannot be read");
    let row = rowsOf(review).get(`${W} ${s.sha}`);
    assert.equal(row.result, "error: robots");
    assert.equal(row.notes, "was cleared by an editor · an editor looked");

    // four days later: an error waits 7 days
    const wait = run("2026-11-03T12:00:00-08:00", { [robotsUrl("cleared.example.org")]: ROBOTS_OK, [W]: { file: s.file, type: "image/png" } }, "cleared-2");
    assert.equal(wait.requests.length, 0);

    // eight days later the same file can be read: "cleared" comes back (it is not read again, so it is not held)
    const back = run("2026-11-07T12:00:00-08:00", { [robotsUrl("cleared.example.org")]: ROBOTS_OK, [W]: { file: s.file, type: "image/png" } }, "cleared-3");
    assert.equal(back.status, 0, back.stderr);
    row = rowsOf(review).get(`${W} ${s.sha}`);
    assert.equal(row.result, "cleared");
    assert.equal(row.notes, "an editor looked");
    assert.equal(row.checked_on, "2026-11-07");

    // 18 days after that the office has replaced the file: hidden, the editor's note kept for the same file
    const other = serve("cleared-workshop-v2.png", png("Traditions workshop, new date. Questions: name@example.org"));
    const changed = run("2026-11-25T12:00:00-08:00", { [robotsUrl("cleared.example.org")]: ROBOTS_OK, [W]: { file: other.file, type: "image/png" } }, "cleared-4");
    assert.equal(changed.status, 0, changed.stderr);
    row = rowsOf(review).get(`${W} ${s.sha}`);
    assert.equal(row.result, "error: changed");
    assert.equal(row.notes, "was cleared by an editor · an editor looked");
    assert.equal(fs.readFileSync(review, "utf8").includes("name@example.org"), false);
  });

  test("a cleared flyer's PDF original: its fingerprint is noted, and a new PDF original is read like a new flyer", () => {
    const dir = path.join(TMP, "cleared-pdf");
    fs.mkdirSync(dir, { recursive: true });
    const P = "https://pdf.example.org/uploads/open-house-pdf.jpg";
    const O = "https://pdf.example.org/uploads/open-house.pdf";
    const preview = serve("cp-preview.jpg", png("Open House preview"));
    const v1 = serve("cp-v1.pdf", pdf("Open House at the office, November 14 from 11am. Coffee, cake and a tour. Questions to name@example.org, the host."));
    const v2 = serve("cp-v2.pdf", pdf("Open House at the office, November 21 from 11am. Coffee, cake and a tour. Questions to name@example.org any time."));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [event("co-oc-central-p1", "oc-central", [flyer(P, preview.sha, { mime: "image/jpeg", pdf: O })])]);
    const review = path.join(dir, "review.csv");
    write(review, [{ url: P, sha256: preview.sha, checked_on: "2026-10-01", result: "cleared", notes: "an editor looked" }]);
    const run = (now, original, name) =>
      runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", now], {
        routes: { [robotsUrl("pdf.example.org")]: ROBOTS_OK, [P]: { file: preview.file, type: "image/jpeg" }, [O]: { file: original.file, type: "application/pdf" } },
        name,
      });
    const print1 = v1.sha.slice(0, 16);

    // no fingerprint noted yet: the editor's decision stands and the PDF original's fingerprint is noted
    const first = run(NOW, v1, "cp-1");
    assert.equal(first.status, 0, first.stderr);
    let row = rowsOf(review).get(`${P} ${preview.sha}`);
    assert.equal(row.result, "cleared");
    assert.equal(row.notes, `an editor looked · PDF original fingerprint ${print1}`);
    assert.deepEqual(flyerUrls(first), [P, O]);

    // the same PDF original 15 days later: still cleared, notes unchanged
    const second = run("2026-11-14T12:00:00-08:00", v1, "cp-2");
    row = rowsOf(review).get(`${P} ${preview.sha}`);
    assert.equal(row.result, "cleared");
    assert.equal(row.notes, `an editor looked · PDF original fingerprint ${print1}`);
    assert.equal(row.checked_on, "2026-11-14");
    assert.equal(second.requests.length, 3);

    // the office replaced the PDF original (same address): read like a new flyer, so the editor's decision no longer applies
    const third = run("2026-11-29T12:00:00-08:00", v2, "cp-3");
    assert.equal(third.status, 0, third.stderr);
    row = rowsOf(review).get(`${P} ${preview.sha}`);
    assert.equal(row.result, "hold: e-mail");
    assert.match(row.notes, new RegExp(`PDF original fingerprint ${v2.sha.slice(0, 16)}`));
    assert.equal(fs.readFileSync(review, "utf8").includes("name@example.org"), false);
  });

  test("re-checks spread over the days: new flyers first, then the oldest checks, a few at a time", () => {
    const dir = path.join(TMP, "spread");
    fs.mkdirSync(dir, { recursive: true });
    const S = (name) => `https://spread.example.org/uploads/${name}`;
    const routes = { [robotsUrl("spread.example.org")]: ROBOTS_OK };
    const events = [];
    const rows = [];
    // eight clean flyers checked on September 8, 7, … 1 (listed newest check first), and one new flyer
    for (let i = 8; i >= 1; i--) {
      const s = serve(`spread-${i}.png`, png(`Fellowship night number ${i}`));
      routes[S(`${i}.png`)] = { file: s.file, type: "image/png" };
      events.push(event(`co-asbco-s${i}`, "asbco", [flyer(S(`${i}.png`), s.sha)]));
      rows.push({ url: S(`${i}.png`), sha256: s.sha, checked_on: `2026-09-0${i}`, result: "clean", notes: "read as picture" });
    }
    const fresh = serve("spread-new.png", png("Speaker meeting and potluck"));
    routes[S("new.png")] = { file: fresh.file, type: "image/png" };
    events.push(event("co-asbco-new", "asbco", [flyer(S("new.png"), fresh.sha)]));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, events);
    const review = path.join(dir, "review.csv");
    write(review, rows);

    const one = runCheck(["--office-flyers", "--limit", "2", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "spread-1" });
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /4 to check \(at most 2 now\), 3 of them clean or cleared flyers downloaded again \(their check is 14 days old or more; 5 more on the next days\)/);
    assert.deepEqual(flyerUrls(one), [S("new.png"), S("1.png")], "the new flyer first, then the oldest check");
    const two = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "spread-2" });
    assert.equal(two.status, 0, two.stderr);
    assert.deepEqual(flyerUrls(two), [S("2.png"), S("3.png"), S("4.png")], "at most 3 a day for 9 flyers");
    const after = rowsOf(review);
    assert.deepEqual(
      rows.map((r) => after.get(`${r.url} ${r.sha256}`).checked_on).reverse(),
      ["2026-10-30", "2026-10-30", "2026-10-30", "2026-10-30", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"],
    );
  });

  test("robots.txt: a disallowed address or an unreadable robots.txt gives error: robots; robots.txt is read once per site", () => {
    const dir = path.join(TMP, "robots");
    fs.mkdirSync(dir, { recursive: true });
    const routes = {
      [robotsUrl("down.example.org")]: { status: 503, text: "busy", type: "text/html" },
      // lost.example.org has no route at all: its robots.txt cannot be fetched
      [robotsUrl("rules.example.org")]: { text: "User-agent: *\nAllow: /\n\nUser-agent: MSCA09-site-builder\nDisallow: /private/\n", type: "text/plain" },
      [robotsUrl("gone.example.org")]: { status: 404, text: "not found", type: "text/html" },
    };
    const add = (url, buf, type = "image/png") => {
      const s = serve(`robots-${Object.keys(routes).length}`, buf);
      routes[url] = { file: s.file, type };
      return s.sha;
    };
    const DOWN = add("https://down.example.org/uploads/a.png", png("Picnic"));
    const LOST = add("https://lost.example.org/uploads/b.png", png("Bingo"));
    const PRIV = add("https://rules.example.org/private/c.png", png("Barbecue"));
    const PUB = add("https://rules.example.org/public/d.png", png("Hike and picnic"));
    const PREV = add("https://rules.example.org/public/e-pdf.jpg", png("Dinner preview"), "image/jpeg");
    add("https://rules.example.org/private/e.pdf", pdf("Dinner at the hall, all welcome, bring a dish to share with everyone."), "application/pdf");
    const GONE = add("https://gone.example.org/uploads/f.png", png("Retreat"));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [
      event("co-a-1", "nocco", [flyer("https://down.example.org/uploads/a.png", DOWN)]),
      event("co-a-2", "nocco", [flyer("https://lost.example.org/uploads/b.png", LOST)]),
      event("co-a-3", "nocco", [flyer("https://rules.example.org/private/c.png", PRIV), flyer("https://rules.example.org/public/d.png", PUB)]),
      event("co-a-4", "nocco", [flyer("https://rules.example.org/public/e-pdf.jpg", PREV, { mime: "image/jpeg", pdf: "https://rules.example.org/private/e.pdf" })]),
      event("co-a-5", "nocco", [flyer("https://gone.example.org/uploads/f.png", GONE)]),
    ]);
    const review = path.join(dir, "review.csv");
    const r = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", NOW], { routes, name: "robots" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const rows = rowsOf(review);
    const row = (url, s) => rows.get(`${url} ${s}`);
    assert.equal(row("https://down.example.org/uploads/a.png", DOWN).result, "error: robots", "robots.txt answers 503");
    assert.match(row("https://down.example.org/uploads/a.png", DOWN).notes, /robots\.txt could not be read \(HTTP 503\)/);
    assert.equal(row("https://lost.example.org/uploads/b.png", LOST).result, "error: robots", "robots.txt cannot be fetched");
    assert.equal(row("https://rules.example.org/private/c.png", PRIV).result, "error: robots", "disallowed for MSCA09-site-builder");
    assert.match(row("https://rules.example.org/private/c.png", PRIV).notes, /robots\.txt does not allow reading this address/);
    assert.equal(row("https://rules.example.org/public/d.png", PUB).result, "clean");
    assert.equal(row("https://rules.example.org/public/e-pdf.jpg", PREV).result, "error: robots", "the PDF original is disallowed");
    assert.match(row("https://rules.example.org/public/e-pdf.jpg", PREV).notes, /the PDF original: robots\.txt does not allow/);
    assert.equal(row("https://gone.example.org/uploads/f.png", GONE).result, "clean", "no robots.txt (404): everything is allowed");

    const urls = r.requests.map((q) => q.url);
    for (const host of ["down.example.org", "lost.example.org", "rules.example.org", "gone.example.org"]) {
      assert.equal(urls.filter((u) => u === robotsUrl(host)).length, 1, `robots.txt of ${host} once`);
      assert.ok(urls.indexOf(robotsUrl(host)) <= Math.min(...urls.map((u, i) => (new URL(u).host === host ? i : Infinity))), `robots.txt of ${host} first`);
    }
    assert.deepEqual(flyerUrls(r).sort(), ["https://gone.example.org/uploads/f.png", "https://rules.example.org/public/d.png", "https://rules.example.org/public/e-pdf.jpg"]);
    for (const q of r.requests) {
      assert.equal(q.headers["user-agent"], OFFICE_UA);
      assert.equal(q.referrer, null);
      assert.equal("referer" in q.headers, false);
    }

    // a week later robots.txt answers again: the robots errors are tried again like other errors
    routes[robotsUrl("down.example.org")] = ROBOTS_OK;
    const later = runCheck(["--office-flyers", "--mirror", mirror, "--review", review, "--now", "2026-11-06T12:00:00-08:00"], { routes, name: "robots-later" });
    assert.equal(later.status, 0, later.stderr);
    assert.equal(rowsOf(review).get(`https://down.example.org/uploads/a.png ${DOWN}`).result, "clean");
  });

  test("with no reading program installed, --dry-run still counts the flyers to check and downloads nothing", () => {
    const dir = path.join(TMP, "no-tools");
    const empty = path.join(dir, "empty-path");
    fs.mkdirSync(empty, { recursive: true });
    const s = serve("no-tools.png", png("Gratitude dinner"));
    const mirror = path.join(dir, "events.json");
    writeMirror(mirror, [event("co-haco-t1", "haco", [flyer("https://tools.example.org/a.png", s.sha)])]);
    const review = path.join(dir, "review.csv");
    const r = runCheck(["--office-flyers", "--dry-run", "--mirror", mirror, "--review", review, "--now", NOW], {
      routes: { [robotsUrl("tools.example.org")]: ROBOTS_OK, "https://tools.example.org/a.png": { file: s.file, type: "image/png" } },
      name: "no-tools",
      env: { MEDIA_OCR_CMD: "", MEDIA_PDFTEXT_CMD: "", MEDIA_RASTER_CMD: "", PATH: empty },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /tesseract is not installed/);
    assert.match(r.stdout, /\b1 to check\b/, "the workflow reads this count to decide whether to install the programs");
    assert.match(r.stdout, /Nothing to read with — no central-office flyer was checked/);
    assert.equal(r.requests.length, 0);
    assert.equal(fs.existsSync(review), false);
  });
});

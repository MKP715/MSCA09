// Anonymity cleaning: src/_lib/contact-rules.js (normalizeText, contactHits, summaryRisk, scrubText, maskText) and
// cleanRecord. This file is public history: its phone numbers are (714) 555-0100…0199 (besides the public OC office
// line and toll-free numbers), its e-mail addresses are name@example.org-style, and a free-mail address or a full name
// that a test needs is put together while the test runs (mail(), fullName()), so it never sits in the file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { contactHits, titleRisk, slugRisk, slugForms, summaryRisk, summaryRisky, normalizeText, scrubText, maskText } from "../../src/_lib/contact-rules.js";
import { cleanRecord, cleanUrl, blankRecord, stableStringify, isBusiness, recordId, hashKey, htmlToText, addressRisky, pageRisk, flyerRisk, adapters, SUMMARY_MAX, TITLE_MAX } from "../../src/_lib/office-import.js";
import { pipeline, tribePages, fixture, fixtureFiles, fixtureJson, NOW } from "./helpers.mjs";

// "now" is fixed (2026-10-30): this year's dates are an event's own, last year's and older ones can be a person's
const kinds = (t, o) => contactHits(t, { now: NOW, ...o }).map((h) => h.kind);
const risks = (t, o) => titleRisk(t, { now: NOW, ...o }).map((h) => h.kind);
// an address or a name put together at run time
const mail = (local, domain) => [local, domain].join("@");
const fullName = (first, last) => [first, last].join(" ");
const FREE = ["gmail", "com"].join(".");
// an address written so robots cannot read it ("name at example dot net"), or as a page address writes it: put together at run time
const spelled = (...parts) => parts.join(" ");

test("phone numbers in their usual forms; office lines, toll-free numbers and other numbers are not", () => {
  for (const p of ["(714) 555-0123", "714-555-0123", "714.555.0123", "714 555 0123", "+1 714 555 0123", "1-714-555-0123", "714‑555‑0123", "(714)555-0123", "714–555–0123"]) {
    assert.deepEqual(kinds(`Call Ana at ${p} today.`), ["phone"], p);
  }
  assert.deepEqual(kinds("OC Central Office: (714) 556-4555, 24 hours."), []); // data/central-offices.csv
  assert.deepEqual(kinds("Reservations 1-800-555-0199 or (888) 555-0101."), []);
  for (const t of ["Saturday 11/01/2026 de la 1:00PM 9:00pm", "Panel 79", "Tickets $1 – $10", "27574 Commerce Center Dr # 139, Temecula, CA 92590", "Room Rate: $229.00/night", "Code AA022026SD"]) {
    assert.deepEqual(kinds(t), [], t);
  }
});

test("e-mail addresses: free mail and other domains are personal; role mailboxes and the office's own domain are not", () => {
  assert.deepEqual(kinds(`Write to ${mail("ana.r", FREE)}`), ["email"]);
  assert.deepEqual(kinds(`Write to ${mail("msca09chair", FREE)}`), []); // a role address of data/contact-allowlist.csv
  assert.deepEqual(kinds("Write to registrar@msca09aa.org"), []);
  assert.deepEqual(kinds("Questions: events@hacoaa.org", { officeHost: "hacoaa.org" }), []);
  assert.deepEqual(kinds("Questions: events@hacoaa.org"), ["email"]);
  assert.deepEqual(kinds("Questions: info@hacoaa.org"), []); // listed in data/contact-allowlist.csv
  assert.deepEqual(kinds("Contact: [email protected]"), ["email"]); // Cloudflare's hidden address
  assert.deepEqual(kinds(`mail ${["ana", "(at)", "yahoo", "(dot)", "com"].join(" ")}`), ["email"]);
});

test("Zoom links, meeting IDs, passcodes and page passwords", () => {
  assert.ok(kinds("Join https://us02web.zoom.us/j/81234567890?pwd=abc").includes("zoom"));
  assert.ok(kinds("Meeting ID: 812 3456 7890").includes("zoom"));
  assert.ok(kinds("Zoom ID 714 555 0123").includes("zoom"));
  assert.ok(kinds("ID de reunión: 812 3456 7890").includes("zoom"));
  assert.deepEqual(kinds("Passcode: panel76"), ["password"]);
  assert.deepEqual(kinds("Contraseña: 1234"), ["password"]);
  assert.ok(kinds("Minutes (Password Protected: serenity)").includes("password"));
  assert.deepEqual(kinds("Hybrid: in person and on Zoom."), []);
});

test("sobriety DATES (contactHits): a date or a year next to its label, in English and Spanish, either order", () => {
  for (const t of [
    "Sober since March 3, 1999", "sober since 1999", "su fecha de sobriedad es el 3/4/90", "Sobriety Date: March 3, 1989", "sobrio desde 1998",
    "Ana R. está sobria desde el 3 de marzo de 1990", "sobria desde marzo de 1990", "sobrios desde 2001", "Ana R. 3/3/1990 sobriety birthday",
    "Ana R., March 3, 1990 sobriety date", "3 de marzo de 1990 (fecha de sobriedad)", "Tom R. (sobriety birthday 1989)", "Speaker: Tom R. DOS 3/14/1989.",
    "DOS: 3/14/89", "D.O.S. 1989", "DOS – 3/14/1989", "Sober since\n'89",
  ]) {
    assert.ok(kinds(t).includes("sobriety"), t);
  }
  // not a date: a length (summaryRisk finds those), a group's name, a year before 1940, Spanish "dos"
  for (const t of [
    "Aniversario #39 grupo Buscando Sobriedad", "Grupo AA:Sobriedad y Salvacion XXV Aniversario", "speaker with 30 years of sobriety", "Ana R. has 12 years sober",
    "celebra 10 años de sobriedad", "cumple 5 años sobrio", "sobrio desde hace 20 años", "Sober Since 1935: A.A. History Workshop", "Los dos 12/12/2026", "dos 3/14/2026",
  ]) {
    assert.deepEqual(kinds(t), [], t);
  }
});

test("scrubText drops whole sentences (and a label left alone before them); names with initials stay with their sentence", () => {
  const t = "Dinner at 6. Dr. Bob will speak.\nFor tickets contact:\nMonica H. — (714) 555-0180 · Irina U. — (714) 555-0181\nCall or text CJ at (714) 555-0182 to reserve your spot. Shoes included.";
  assert.equal(scrubText(t), "Dinner at 6. Dr. Bob will speak.\nShoes included.");
  assert.equal(scrubText(scrubText(t)), scrubText(t));
});

test("tracking wrappers and parameters are removed from links", () => {
  assert.equal(cleanUrl("https://urldefense.com/v3/__https://www.example.org/tickets?utm_source=chatgpt.com__;!!AbC123$"), "https://www.example.org/tickets");
  assert.equal(cleanUrl("https://urldefense.proofpoint.com/v2/url?u=https-3A__www.example.org_page-3Fid-3D5&d=DwMF&c=x"), "https://www.example.org/page?id=5");
  assert.equal(cleanUrl("https://www.google.com/url?q=https://www.example.org/x&sa=D&ust=1"), "https://www.example.org/x");
  assert.equal(cleanUrl("https://www.example.org/e/?fbclid=abc&id=7&mc_eid=1"), "https://www.example.org/e/?id=7");
  assert.equal(cleanUrl("mailto:someone@example.org"), "");
});

const dirty = blankRecord({
  id: "co-oc-central-1",
  office: "oc-central",
  src: "https://www.oc-aa.org/event/x/?utm_source=newsletter",
  title: `Picnic in memory of ${fullName("Maria", "Exampleton")} — info (714) 555-0123`,
  venue: `Hosted by ${fullName("Joe", "Sampleby")}`,
  summary:
    `Join us at the park!\nSpeaker: ${fullName("Maria", "Exampleton")} of Anaheim, sober since 1999.\nZoom ID 812 3456 7890 Passcode: picnic\nTickets at https://www.example.org/buy?utm_source=x\nQuestions? write ${mail("maria.g", FREE)} or office@oc-aa.org.\n` +
    "Bring a dish to share and your favorite chair. ".repeat(12),
  flyers: [
    { url: "https://www.oc-aa.org/wp-content/uploads/2026/10/7145550123.jpg" },
    { url: "https://www.oc-aa.org/wp-content/uploads/2026/10/picnic-flyer.jpg", sizes: [[300, "https://www.oc-aa.org/wp-content/uploads/2026/10/picnic-flyer-300x400.jpg"]] },
  ],
  flags: ["place-on-flyer", "place-on-flyer"],
});
const okSummary = "Join us at the park!\nTickets at https://www.example.org/buy?utm_source=x\nQuestions? Write to office@oc-aa.org.\n" + "Bring a dish to share and your favorite chair. ".repeat(12);

test("cleanRecord: names shortened, details removed, lengths capped, phone-like flyer addresses dropped; a risky summary goes whole", () => {
  let told = null;
  const c = cleanRecord(dirty, { officeHost: "oc-aa.org", now: NOW, onSummaryDropped: (d) => (told = d) });
  assert.equal(c.title, "Picnic in memory of Maria E. — info");
  assert.equal(c.venue, "Hosted by Joe S.");
  // the title lost a name and a phone number: its page's address (made from the same words) gives way to the office's
  // website (no events page given) or its events page; a title that came through whole keeps its page, without trackers
  assert.equal(c.src, "https://oc-aa.org/");
  assert.equal(cleanRecord(dirty, { officeHost: "oc-aa.org", now: NOW, eventsPage: "https://www.oc-aa.org/events/" }).src, "https://www.oc-aa.org/events/");
  assert.equal(cleanRecord({ ...dirty, title: "Picnic" }, { officeHost: "oc-aa.org", now: NOW }).src, "https://www.oc-aa.org/event/x/");
  // all or nothing: a personal address, a sobriety date, a meeting ID and a passcode were in it
  assert.equal(c.summary, "");
  assert.deepEqual(told, { id: "co-oc-central-1", kind: "email" });
  // a summary without anything risky: links go, one paragraph of at most 300 characters; the office's own address stays
  const ok = cleanRecord({ ...dirty, summary: okSummary }, { officeHost: "oc-aa.org", onSummaryDropped: () => assert.fail("not risky") });
  assert.match(ok.summary, /^Join us at the park! Tickets · Questions\? Write to office@oc-aa\.org\. Bring a dish/);
  assert.doesNotMatch(ok.summary, /https?:|utm/);
  assert.ok(ok.summary.length <= SUMMARY_MAX);
  assert.match(ok.summary, /…$/);
  assert.equal(cleanRecord({ ...dirty, summary: "Questions? Write to office@oc-aa.org." }, { officeHost: "oc-aa.org" }).summary, "Questions? Write to office@oc-aa.org.");
  assert.deepEqual(c.flyers.map((f) => f.url), ["https://www.oc-aa.org/wp-content/uploads/2026/10/picnic-flyer.jpg"]);
  assert.deepEqual(c.flags, ["place-on-flyer"]);
  const long = cleanRecord({ ...dirty, title: "A very long title ".repeat(12) });
  assert.ok(long.title.length <= TITLE_MAX);
  assert.deepEqual(Object.keys(c), Object.keys(blankRecord()));
});

test("cleanRecord gives the same record when run twice (on every fixture record too)", () => {
  for (const s of [dirty.summary, okSummary]) {
    const once = cleanRecord({ ...dirty, summary: s }, { officeHost: "oc-aa.org" });
    assert.deepEqual(cleanRecord(once, { officeHost: "oc-aa.org" }), once);
  }
  const details = Object.fromEntries(fixtureFiles("nocco").filter((f) => f.startsWith("detail-")).map((f) => [`https://www.aanoc.org/events/${f.slice(7, -5)}/`, fixture("nocco", f)]));
  const all = [
    ...pipeline("oc-central", tribePages("oc-central")).records,
    ...pipeline("haco", tribePages("haco")).records,
    ...pipeline("sur-bahia", tribePages("sur-bahia")).records,
    ...pipeline("sureste-riverside", tribePages("sureste-riverside")).records,
    ...pipeline("temecula", fixtureJson("temecula", "page.json")).records,
    ...pipeline("nocco", { html: fixture("nocco", "events.html"), rss: fixture("nocco", "index.xml"), details }, { base: "https://www.aanoc.org/" }).records,
  ];
  assert.ok(all.length >= 25);
  for (const r of all) {
    assert.equal(stableStringify(cleanRecord(r)), stableStringify(r), r.id);
    assert.deepEqual(contactHits([r.title, r.title_es, r.venue, r.address, r.cost, r.summary].join("\n")), [], r.id);
    assert.equal(summaryRisk(r.summary), "", r.id);
  }
});

test("maskText (test fixtures): look-alike phone numbers and addresses, passcodes and meeting IDs hidden", () => {
  const m = maskText(`Call (714) 555-0123 or 714-555-0123, or (714) 556-4555. Mail ${mail("ana.r", FREE)} or info@hacoaa.org. Passcode: panel76`, { officeHost: "hacoaa.org", now: NOW });
  assert.equal(m, "Call (714) 555-0100 or (714) 555-0100, or (714) 556-4555. Mail name@example.org or info@hacoaa.org. Passcode: xxxxxx");
  assert.equal(maskText("Zoom: 812 3456 7890 · PW – 774411 · PIN 1234 · Código de la reunión: 7788", { now: NOW }), "Zoom: 000 0000 0000 · PW – xxxxxx · PIN xxxxxx · Código de la reunión: xxxxxx");
  assert.equal(maskText("Código postal 92590 · PW 2026 Forum · Pin 2026", { now: NOW }), "Código postal 92590 · PW 2026 Forum · Pin 2026");
  // round 4: the other ways to write them, a 3-3-2-2 phone number, an address with its dots spelled out
  assert.equal(
    maskText(`Potluck PW is 774411 · Clave para entrar: 7788 · Online (812 3456 7890) · text 714 555 01 23 · ${spelled("ana.r", "at", "cox", "dot", "net")}`, { now: NOW }),
    "Potluck PW is xxxxxx · Clave para entrar: xxxxxx · Online (000 0000 0000) · text (714) 555-0100 · name at example dot org",
  );
  // not a web address's or a file name's numbers, not dates
  for (const t of ["https://www.oc-aa.org/wp-content/uploads/2026/10/20260927_210553-scaled.jpg", "doc01079620260909101242-pdf.jpg", "11/14/2026 – 11/16/2026", "2026-10-30 12:00:00"]) {
    assert.equal(maskText(t, { now: NOW }), t, t);
  }
});

/* ------------------------------------------------------------------ spellings missed before (verifier, Oct 30) */

test("Zoom IDs without the word meeting, Spanish 'clave', 'sobrio desde', spaced and Spanish e-mail addresses, '/' in phone numbers", () => {
  for (const t of ["Zoom 812 3456 7890", "Zoom: 812 3456 7890", "Join on Zoom - 81234567890", "ID: 812 3456 7890", "ID# 714 555 0142"]) {
    assert.ok(kinds(t).includes("zoom"), t);
  }
  for (const t of ["Clave: 7788", "clave es 7788", "Clave 7788", "Clave de acceso: panel"]) assert.ok(kinds(t).includes("password"), t);
  for (const t of ["sobrio desde 1998", "Ana R. está sobria desde el 3 de marzo de 1990", "sobrios desde 2001"]) assert.ok(kinds(t).includes("sobriety"), t);
  for (const t of ["name @ example.org", "name@ example.org", "name @example.org", "name @ example . org", "name arroba example punto org"]) {
    assert.deepEqual(kinds(`Write to ${t} today`), ["email"], t);
  }
  for (const t of ["714/555-0123", "(714) 555/0123", "714/555/0123"]) assert.deepEqual(kinds(`Call ${t}.`), ["phone"], t);
  // the summary the verifier tried: both details go with their sentences
  assert.equal(scrubText("Join us on Zoom: 812 3456 7890. Clave: 7788. Everyone welcome."), "Everyone welcome.");
});

test("…and ordinary event text is not caught by them", () => {
  for (const t of [
    "Hybrid: in person and on Zoom.",
    "Join us on Zoom at 7 pm on 11/14/2026",
    "Photo ID required at the door",
    "Bring your ID: tickets $25",
    "Grupo fundado en 1998",
    "Celebrating 1998 to 2026",
    "Aniversario de Grupo Sobriedad desde el Principio",
    "La clave del éxito es la unidad.",
    "Sober fun for all ages",
    "Sober for the holidays party",
    "Dinner @ 6. Dance @ 8.",
    "Meet @ St. Mary's Church",
    "Register @ www.example.com",
    "Rooms $229.00/night, 11/14/2026 to 11/16/2026",
    "https://www.oc-aa.org/wp-content/uploads/2026/10/picnic-flyer-300x400.jpg",
  ]) {
    assert.deepEqual(kinds(t), [], t);
  }
  // the office's own address stays, spaces or not
  assert.deepEqual(kinds("Questions: office @ oc-aa.org", { officeHost: "oc-aa.org" }), []);
});

test("normalizeText: NFC, every dash as '-', full-width signs, Unicode spaces, no zero-width characters, P.W. and I.D.", () => {
  assert.equal(normalizeText("Co\u0301digo Contrasen\u0303a"), "Código Contraseña");
  assert.equal(normalizeText("812\u20103456\u20117890 \u2012 \u2013 \u2014 \u2015 \u2212 \uFE58 \uFE63 \uFF0D"), "812-3456-7890 - - - - - - - -");
  assert.equal(normalizeText("PW\uFF1A\uFF17\uFF17\uFF14\uFF14\uFF11\uFF11 \uFF20 \uFE6B"), "PW:774411 @ @");
  assert.equal(normalizeText("a\u00a0b\u202fc\u2007d\u2009e\u3000f"), "a b c d e f");
  assert.equal(normalizeText("P\u200bW\u00ad: 1\u200d2\uFEFF"), "PW: 12");
  assert.equal(normalizeText("P.W. 774411 · P/W: 1 · I.D. 812 · A.I.D.S."), "PW 774411 · PW: 1 · ID 812 · A.I.D.S.");
  // cleanRecord keeps the office's dashes in what it stores
  assert.equal(normalizeText("Dinner \u2014 Dance, 4\u20136 pm", { dashes: false }), "Dinner \u2014 Dance, 4\u20136 pm");
  for (const s of ["Co\u0301digo\u00a0\u2013 P.W.\uFF1A1", "I.D. \u200b\u2014", "plain text"]) assert.equal(normalizeText(normalizeText(s)), normalizeText(s));
});

test("every hit says where it starts, in the text as given (the rules read it normalised)", () => {
  const t = "Workshop on Zoom ID 812 3456 7890 Passcode 1234";
  for (const h of contactHits(t)) assert.equal(t.slice(h.index, h.index + h.value.length), h.value, h.kind);
  // an accent typed as a separate mark, a full-width colon, a zero-width space and en dashes
  const odd = "Taller\u00a0\u00b7 Co\u0301digo\uFF1A7788 \u00b7 P\u200bW \u2013 774411 \u00b7 Zoom: 812\u20133456\u20137890";
  const hs = contactHits(odd);
  assert.deepEqual(hs.map((h) => h.kind).sort(), ["password", "zoom"]);
  for (const h of hs) assert.equal(odd.slice(h.index, h.index + h.value.length), h.value, h.kind);
  assert.equal(hs.find((h) => h.kind === "password").index, odd.indexOf("Co\u0301digo"));
  assert.equal(hs.find((h) => h.kind === "zoom").value, "Zoom: 812\u20133456\u20137890");
});

test("scrubText (a cautious fallback; summaries are all or nothing): a detail split over lines goes, and so does a bare value under its label", () => {
  const t = "Online workshop for everyone.\nMeeting ID:\n812 3456 7890\nPasscode:\n7788\nAll are welcome.";
  assert.equal(scrubText(t), "Online workshop for everyone.\nAll are welcome.");
  assert.equal(scrubText("Join us! Zoom ID:\n812 3456 7890. See you there!"), "Join us!\nSee you there!");
  assert.equal(scrubText("Contraseña:\nserenidad\nTodos bienvenidos."), "Todos bienvenidos.");
  assert.equal(scrubText(scrubText(t)), scrubText(t));
  // every kind of detail takes its whole sentence
  for (const bad of ["Call Ana R. at (714) 555-0123 for a ride.", "Write to name@example.org for a ride.", "Ana R. has been sober since 1999 and will share.", "Zoom ID 812 3456 7890 for those at home.", "Passcode is 7788 for those at home."]) {
    assert.equal(scrubText(`Dinner at six. ${bad} Bring a dish.`), "Dinner at six. Bring a dish.", bad);
  }
});

const rec0 = blankRecord({ id: "co-oc-central-99", office: "oc-central", title: "Picnic", start: "2026-11-14T11:00:00-08:00" });
const clean0 = (o) => cleanRecord({ ...rec0, ...o }, { officeHost: "oc-aa.org", now: NOW });

test("cleanRecord: a title with a Zoom ID, passcode or sobriety date is cut before it (not just its label taken out)", () => {
  assert.equal(clean0({ title: "Online Workshop – Zoom ID 812 3456 7890 Passcode 123456" }).title, "Online Workshop");
  assert.equal(clean0({ title: "Workshop via Zoom – ID: 812 3456 7890" }).title, "Workshop");
  assert.equal(clean0({ title: "Ana's sobriety date: March 3, 1990 celebration" }).title, "Ana's");
  assert.equal(clean0({ title: "Taller en Zoom: 812 3456 7890 clave: 7788" }).title, "Taller");
  // phone numbers and e-mail addresses: only the value goes, as before
  assert.equal(clean0({ title: "Picnic – info (714) 555-0123" }).title, "Picnic – info");
  for (const t of ["Online Workshop – Zoom ID 812 3456 7890 Passcode 123456", "Ana's sobriety date: March 3, 1990 celebration"]) {
    const c = clean0({ title: t });
    assert.deepEqual(contactHits(c.title), [], t);
    assert.doesNotMatch(c.title, /\d/, t);
    assert.deepEqual(cleanRecord(c, { officeHost: "oc-aa.org" }), c, t);
  }
});

test("cleanRecord: a title with less than 3 letters left throws (the record is left out); a Spanish title is emptied", () => {
  for (const t of ["Zoom ID 812 3456 7890 – Online Workshop", "Sober since 1999 Speaker Meeting", "(714) 555-0123", "Passcode: 7788"]) {
    assert.throws(() => clean0({ title: t }), (e) => e.code === "OFFICE_RECORD_DROPPED" && e.id === "co-oc-central-99" && /personal details/.test(e.message), t);
  }
  assert.equal(clean0({ title_es: "Clave: 7788" }).title_es, "");
  assert.equal(clean0({ title_es: "Taller sobria desde el 3 de marzo de 1990" }).title_es, "Taller");
  // an empty title is not a detail: no throw
  assert.equal(clean0({ title: "" }).title, "");
});

test("cleanRecord: a venue with Zoom details, a passcode or a sobriety date is emptied (place-on-flyer when no address)", () => {
  for (const v of ["Zoom Meeting ID: 812 3456 7890 Passcode: 123456", "Salon; contraseña: 4455", "Hall – clave 4455", "Zoom: 812–3456–7890", "Online: 812–3456–7890 (Zoom)"]) {
    const c = clean0({ venue: v });
    assert.equal(c.venue, "", v);
    assert.deepEqual(c.flags, ["place-on-flyer"], v);
    assert.deepEqual(cleanRecord(c, { officeHost: "oc-aa.org" }), c, v);
  }
  const withAddress = clean0({ venue: "Salon; contraseña: 4455", address: "123 Main St", city: "Anaheim" });
  assert.deepEqual([withAddress.venue, withAddress.address, withAddress.flags], ["", "123 Main St", []]);
  assert.equal(clean0({ venue: "Unity Hall (714) 555-0123" }).venue, "Unity Hall");
});

test("business meetings: group conscience, intergroup rep meetings, group inventories; workshops on them stay", () => {
  for (const t of ["Group Conscience", "Conciencia de Grupo", "Intergroup Rep Meeting", "Intergroup Representatives Meeting", "IGR Meeting", "Inventario de Grupo", "Group Inventory"]) {
    assert.equal(isBusiness({ title: t }), true, t);
  }
  for (const t of ["Inventory Workshop", "Taller de Inventario", "Group Conscience Workshop", "Step Four Inventory Study"]) assert.equal(isBusiness({ title: t }), false, t);
});

/* ------------------------------------------------------------------ rounds 2 and 3 (verifiers, Oct 30 evening) */

test("passcodes written PW, Pass, PIN, Code, Código or Clave, with any dash, a full-width colon or dots", () => {
  for (const t of [
    "PW: 774411", "PW 774411", "PW-774411", "Pass: 7788", "Pass code: serenity", "Pass-code 7788", "PIN: 1234", "PIN 1234", "Code: 7788", "Zoom code 7788", "access code 4455",
    "Código 7788", "Código: 7788", "código de acceso", "Meeting ID: 812 3456 7890 | PW: 7788",
    // round 3: dashes (WordPress turns " - " into " – "), full-width signs, dotted and slashed PW, no space, Spanish labels, NFD accents
    "Potluck – PW – 774411", "PW—774411", "Pass – 7788", "Code – 7788", "PIN – 1234", "Código – 7788", "Clave – 7788", "PW：774411", "PW. 774411",
    "P.W. 774411", "P/W: 774411", "Passcode7788", "PIN-1234", "código de la reunión: 7788", "Código de Zoom: 7788", "código de entrada 7788",
    "Código 7788", "Contraseña: 7788", "PW: serenity", "Zoom PW: PLBB12345", "PIN #1234", "PIN number 1234",
  ]) {
    assert.ok(kinds(t).includes("password"), t);
  }
  // ordinary words, ticket passes, merchandise, years, a hotel's group code, and real titles
  for (const t of [
    "Pass the basket", "Pass it on!", "Pass out flyers", "Code of conduct", "Dress code", "Dress Code: Business casual", "Book online (Group Code: AA022026SD).",
    "Group Code: AA022026SD", "Code AA022026SD", "Zip code: 92590", "Barcode: 12345", "Código postal 92590", "Código de Conducta", "Passport", "Pine", "Pinnacle",
    "Codependency", "Weekend Pass: $60", "Day Pass: $25", "Lapel Pin: $5", "Pin 2026 commemorative", "PW 2026 Forum", "Pass: 7th Tradition", "Pass: Free admission",
    "Taller: La Clave es la Humildad", "La clave es la unidad", "Area Code: 951", "Promo code SOBER26", "Pass Code Workshop for Secretaries",
  ]) {
    assert.deepEqual(kinds(t), [], t);
  }
});

test("a meeting ID or a sobriety date written before its label is a hit, starting at the number", () => {
  for (const t of [
    "Online Workshop 812 3456 7890 (Zoom ID)", "Group anniversary — 81234567890 passcode 7788", "Online: 812 3456 7890 (Zoom)", "714 555 0142 is the meeting ID",
    "Zoom (812) 3456 7890", "Meeting 812 3456 7890", "MEETING I.D: 81234567890", "Online Workshop – Meeting ID – 812 3456 7890", "Zoom: 812–3456–7890",
    "Workshop · Zoom: 812–3456–7890", "Meeting ID – 812 3456 7890", "ID – 812 3456 7890", "Reunión – 812 3456 7890", "812 3456 7890 Zoom",
  ]) {
    assert.ok(kinds(t).includes("zoom"), t);
  }
  assert.equal(contactHits("Online Workshop 812 3456 7890 (Zoom ID)").find((h) => h.kind === "zoom").index, 16);
  for (const t of ["Ana R. 3/3/1990 sobriety birthday", "Ana R., March 3, 1990 sobriety date", "3 de marzo de 1990 (fecha de sobriedad)"]) {
    assert.ok(kinds(t).includes("sobriety"), t);
  }
  assert.equal(contactHits("Ana R. 3/3/1990 sobriety birthday").find((h) => h.kind === "sobriety").index, 7);
  // not: the office's own line or a toll-free number next to the word Zoom, "Photo ID", an event's date before its
  // name, a group's age, a date range
  for (const t of [
    "Call the office at (714) 556-4555. Photo ID required.",
    "(714) 556-4555 or join on Zoom",
    "1-800-555-0199 (Zoom help line)",
    "Room 101 – ID required",
    "The Zoom Room Group 10th Anniversary",
    "Saturday 11/14/2026 – Sober Halloween Dance",
    "Nov 14, 2026: Emotional Sobriety Workshop",
    "11/14/2026 Sobriety Workshop",
    "Celebrando 39 años del Grupo Buscando Sobriedad.",
    "Aniversario 25 años Sobriedad y Salvacion",
    "Celebrating 10 years. Sober Fun Run follows.",
    "Rooms $229.00/night, 11/14/2026 to 11/16/2026",
  ]) {
    assert.deepEqual(kinds(t), [], t);
  }
});

test("cleanRecord cuts a title before its earliest detail, also one written before its label, with any dash; '&' does not dangle", () => {
  const cases = [
    ["Online Workshop 812 3456 7890 (Zoom ID)", "Online Workshop"],
    ["Group anniversary — 81234567890 passcode 7788", "Group anniversary"],
    ["Ana R. 3/3/1990 sobriety birthday", "Ana R."],
    ["Ana R. – sober since 1990", "Ana R."],
    ["Potluck – PW: 774411", "Potluck"],
    ["Young & PW: 7788", "Young"],
    ["Children’s Holiday Potluck – PW – 774411", "Children’s Holiday Potluck"],
    ["Online Workshop – Meeting ID – 812 3456 7890", "Online Workshop"],
    ["Workshop · Zoom: 812–3456–7890", "Workshop"],
    ["Potluck PW：774411", "Potluck"],
    ["Potluck P.W. 774411", "Potluck"],
    ["Potluck P/W: 774411", "Potluck"],
    ["Taller – Código de la reunión: 7788", "Taller"],
    ["Taller – Contraseña: 7788", "Taller"],
  ];
  for (const [t, want] of cases) {
    const c = clean0({ title: t });
    assert.equal(c.title, want, t);
    assert.deepEqual(contactHits(c.title), [], t);
    assert.deepEqual(cleanRecord(c, { officeHost: "oc-aa.org" }), c, t);
  }
  assert.equal(clean0({ venue: "Online: 812 3456 7890 (Zoom)" }).venue, "");
  assert.throws(() => clean0({ title: "3/3/1990 sobriety birthday" }), (e) => e.code === "OFFICE_RECORD_DROPPED");
  assert.throws(() => clean0({ title: "PW – 774411" }), (e) => e.code === "OFFICE_RECORD_DROPPED");
});

test("ordinary event titles stay whole: a sobriety length, a year, Spanish 'dos', 'La Clave es…', ticket passes, dress and group codes", () => {
  for (const t of [
    "Unity Day 2026 – Taller de Sobriedad", "Convención Hispana 2026: Unidos en Sobriedad", "Emotional Sobriety: 12 Steps to Freedom",
    "Sobriety: 12 Steps and 12 Traditions Workshop", "Sobriedad: 12 Pasos y 12 Tradiciones", "Grupo Sobriedad: 35 Aniversario", "Taller de Sobriedad: 3 de diciembre",
    "Sobriety: March Madness Bowling", "Sober 30 Years Club Anniversary", "Clean & Sober 30 Years Car Show", "Los DOS 12/12/2026 Talleres", "DOS 2026 Aniversarios",
    "91 Years and Still Sober!", "Celebrating 60 Years of Sober Fun!", "Sober Since 1935: A.A. History Workshop", "Two Years Sober Speaker Meeting",
    "Taller: La Clave es la Humildad", "Pass: 7th Tradition", "Pass: Free admission", "Weekend Pass: $60", "Dress code", "Group Code: AA022026SD",
    "New Year's Eve Dance 2026 — Celebrate Sober!", "Aniversario 2026: Unidos y Sobrios", "Fiesta 2026: ¡Felices y Sobrios!", "Taller 2026 – Vivir Sobrio",
    "Halloween 2026: Spooky & Sober", "Dec 31, 2026 – Party Sober!", "1935–2026: Still Sober", "Años sin tomar? Taller para recién llegados",
    "Celebrating 30 years of sobriety with Ana R.", "Ana R. celebrates 30 years! (sobriety birthday)", "Sober for 24 Hours Alcathon", "Sober for One Day: a Workshop",
    "Young & Sober for 10 Days Challenge", "Aniversario Grupo Sobrios desde el Principio", "A.I.D.S. Awareness Walk",
  ]) {
    assert.deepEqual(kinds(t), [], t);
    assert.equal(clean0({ title: t }).title, t, t);
  }
});

test("a website written with a spaced '@' is not an e-mail address; a free-mail address always is", () => {
  for (const t of [
    "Tickets available @ eventbrite.com.", "Book your room @ hilton.com today.", "Register @ acypaa.org.", "Follow us @ instagram.com/acypaa", "More info @ scypaa.org",
    "Info @ acypaa.org", "RSVP @ evite.com", "Sign up @ signupgenius.com", "Lodging @ marriott.com", "Get yours @ grapevine.org", "Más información @ aanoc.org",
    "Inscríbete @ aanoc.org", "Regístrate @ aanoc.org", "Details @ praasa.org",
  ]) {
    assert.deepEqual(kinds(t), [], t);
  }
  for (const t of [`write name @ ${FREE}`, `write us @ ${FREE}`, `write info @ ${FREE}`, "write name @ example.org", `write name arroba ${FREE}`, `write name＠${FREE}`, `escribe a José @ ${FREE}`]) {
    assert.deepEqual(kinds(t), ["email"], t);
  }
  // the accented word is read whole: "Más información @ aanoc.org" is not the address "n @ aanoc.org"
  assert.deepEqual(kinds("escribe a joséluis @ example.org").length, 1);
});

test("summaries are all or nothing: summaryRisk flags codes, meetings, sobriety wording and long numbers anywhere", () => {
  const flagged = [
    ["Meeting ID: 812 3456 7890\nPW – 774411", "zoom"],
    ["Join us on Zoom!\nMeeting ID:\n\n812 3456 7890\n\nPasscode:\n\n7788", "zoom"],
    ["Hybrid event on Zoom.", "label"],
    ["Format: Zoom", "label"],
    ["PW 1999", "password"],
    ["Bring a dish. Pin the tail on the donkey.", "label"],
    ["PIN 2026", "label"],
    ["Meeting Password\n042582", "password"],
    ["La clave es 7788", "password"],
    ["Speaker: Tom R. (Sobriety — 1989)", "sobriety"],
    ["Tom R., sobriety 1989", "sobriety"],
    ["Sobriedad – 1989", "sobriety"],
    ["Orador: Juan P., sobrio 30 años.", "sobriety"],
    ["con 30 años limpio y sobrio en el programa", "sobriety"],
    ["Ana R. 3/3/90 (sober)", "sobriety"],
    ["Speaker Tom R., sober 30 years.", "sobriety"],
    ["Celebrating 25 years in sobriety!", "sobriety"],
    ["Orador Juan P. con 30 años sin beber.", "sobriety"],
    ["sobria por 20 años", "sobriety"],
    ["25 years clean and sober", "sobriety"],
    ["Ana R. has 12 years sober", "sobriety"],
    ["speaker with 30 years of sobriety", "sobriety"],
    ["sober for 10 years", "sobriety"],
    ["sobrio desde hace 20 años", "sobriety"],
    ["Ana R. celebrates 30 years! (sobriety birthday)", "sobriety"],
    ["Speaker: Tom R.\nDOS:\n\n3/14/1989", "sobriety"],
    ["Hybrid.\n812\n3456\n7890", "zoom"],
    ["Join at 81234567890.", "zoom"],
    ["Tickets: 812-3456-7890", "zoom"],
    ["Hybrid.\n812\n3456", "digits"],
    ["Ref. 812-3456", "digits"],
    ["Join: 812/3456/7890", "zoom"],
    ["Join: 812·3456·7890", "zoom"],
    ["Join: 812_3456_7890", "zoom"],
    ["Ana R. – AA birthday 3/3/1990", "sobriety"],
    ["A.A. Birthday: March 3, 1990", "sobriety"],
    ["clean date 3/3/1990", "sobriety"],
    ["last drink 3/3/2026", "sobriety"],
    ["sin beber desde el 3 de marzo de 1990", "sobriety"],
    ["d.o.s. 3/14/1989", "sobriety"],
    ["Code is 7788", "password"],
    ["Key code: 4455", "password"],
    ["P W: 774411", "password"],
    ["\u0420W: 774411", "password"],
    ["Call (714) 555-0123.", "phone"],
    ["Contact: name@example.org", "email"],
  ];
  for (const [t, kind] of flagged) {
    assert.equal(summaryRisk(t, { now: NOW }), kind, t);
    assert.equal(summaryRisky(t, { now: NOW }), true, t);
  }
  for (const t of [
    "Hybrid event — attend in person or online.", "Doors open at 6 pm on 11/14/2026.", "Tickets $25. Rooms $229.00/night, 11/14/2026 to 11/16/2026.",
    "Call the office at (714) 556-4555.", "Reservations 1-800-555-0199.", "December 4–6, 2026 at the Wyndham.", "11-14-2026 to 11-16-2026", "Saturday, October 31 2026 7 pm",
    "Celebrating 39 years of the group!", "More info @ scypaa.org.", "Open to areas 03, 05, 06, 07, 08, 09 and 93.", "Pass it on!", "AA Meeting at 7pm. DJ at 8:30pm.",
    "7.30 - 9.30 pm, 2026", "Sober fun for all ages!", "Tickets $1,500.00 for a table", "Book online (Group Code: AA022026SD).",
    "Doors open 6 pm, 11/14/2026. Dress code: casual.", "Code of Conduct applies. Tickets $25 – $35.", "Workshops in rooms 101, 102 and 103.",
  ]) {
    assert.equal(summaryRisk(t, { now: NOW }), "", t);
  }
});

test("cleanRecord: a summary with a code, a meeting, a sobriety detail or a long number is left out whole, and the reason is told", () => {
  const cases = [
    ["<p>Hybrid.</p><p>Meeting ID: 812 3456 7890</p><p>PW &#8211; 774411</p>", "zoom"],
    ["<p>Hybrid.</p><p>Zoom: 812&#8211;3456&#8211;7890</p>", "zoom"],
    ["<p>Join us on Zoom!</p><p>Meeting ID:</p><p>&nbsp;</p><p>812 3456 7890</p><p>&nbsp;</p><p>Passcode:</p><p>7788</p>", "zoom"],
    ["<p>Speaker: Tom R.</p><p>Sobriety Date:</p><p>&nbsp;</p><p>March 3, 1989</p>", "sobriety"],
    ["<p>Join us for Unity Day 2026 – Taller de Sobriedad.</p>", "sobriety"],
    ["<p>Join: <a href=\"https://us02web.zoom.us/j/81234567890\">https://us02web.zoom.us/j/81234567890</a></p>", "zoom"],
    ["<p>Doors at 6.</p><p>812<br>3456<br>7890</p>", "zoom"],
    ["<p>Doors at 6.</p><p>812<br>3456</p>", "digits"],
  ];
  for (const [html, kind] of cases) {
    const told = [];
    assert.equal(clean0({ summary: htmlToText(html) }).summary, "", html);
    cleanRecord({ ...rec0, summary: htmlToText(html) }, { officeHost: "oc-aa.org", now: NOW, onSummaryDropped: (d) => told.push(d) });
    assert.deepEqual(told, [{ id: "co-oc-central-99", kind }], html);
  }
  // a link's own number does not count (the link is not shown), and nothing is told for a summary that stays
  const told = [];
  const c = cleanRecord({ ...rec0, summary: "Tickets: https://www.eventbrite.com/e/tickets-813456789012 — see you there!" }, { officeHost: "oc-aa.org", onSummaryDropped: (d) => told.push(d) });
  assert.equal(c.summary, "Tickets: — see you there!");
  assert.deepEqual(told, []);
});

test("business meetings: intergroup, GSR and district meetings in both languages; a district's Traditions Day is an event", () => {
  for (const t of ["Reunión de Intergrupo", "Reunion del Intergrupo", "GSR Meeting", "Reunión de RSG", "District 12 Meeting", "Distrito 12 reunión", "Reunión del Distrito 12"]) {
    assert.equal(isBusiness({ title: t }), true, t);
  }
  for (const t of ["District 12 Traditions Day", "Taller de Intergrupo", "GSR Workshop", "Intergroup Holiday Party", "32 Aniversario del Grupo AA 12 Pasos", "MSCA Area 09 Panel 79 Servathon"]) {
    assert.equal(isBusiness({ title: t }), false, t);
  }
});

test("ids: a hashed key has letters only, and an id whose words read as a personal detail is hashed", () => {
  assert.match(hashKey("x"), /^e[a-p]{10}$/);
  // with hex keys, about 0.7% of them were ten digits: a phone number
  for (let i = 0; i < 3000; i++) {
    const id = recordId("temecula", `${hashKey(`title ${i}`)}-20261219`);
    assert.deepEqual(contactHits(`${id} ${id.replace(/-/g, " ")}`), [], id);
  }
  assert.match(recordId("temecula", "potluck-pw-774411-20261212"), /^co-temecula-e[a-p]{10}$/);
  assert.match(recordId("x", "714-555-0142"), /^co-x-e[a-p]{10}$/);
  assert.match(recordId("x", "zoom-812-3456-7890"), /^co-x-e[a-p]{10}$/);
  assert.match(recordId("x", "ana-r-sober-since-1990"), /^co-x-e[a-p]{10}$/);
  // ordinary keys are kept as they are
  assert.equal(recordId("temecula", "bingo-at-unity-hall-20261114"), "co-temecula-bingo-at-unity-hall-20261114");
  assert.equal(recordId("oc-central", 70135), "co-oc-central-70135");
  assert.equal(recordId("nocco", "11th-hispanic-womens-a.a.-workshop"), "co-nocco-11th-hispanic-womens-a-a-workshop");
  assert.equal(recordId("x", "unity-day-2026-taller-de-sobriedad"), "co-x-unity-day-2026-taller-de-sobriedad");
});

/* ------------------------------------------------------------------ round 4: titles, venues and ids (titleRisk) */

test("normalizeText: typographic apostrophes and quotes, P W / P-W / P_W, the named entities the HTML readers leave, look-alike letters", () => {
  assert.equal(normalizeText("sober since ’90 ‘x’ ʼ ′ ` ´ “y”"), "sober since '90 'x' ' ' ' ' \"y\"");
  assert.equal(normalizeText("P W: 1 · P-W: 2 · P_W 3 · p–w 4"), "PW: 1 · PW: 2 · PW 3 · pw 4");
  assert.equal(normalizeText("PW&colon; 774411"), "PW: 774411");
  assert.equal(normalizeText("PW&ensp;7&emsp;7&thinsp;4"), "PW 7 7 4");
  assert.equal(normalizeText("&ndash;&mdash;&lsquo;&rsquo;&ldquo;&rdquo;&period;&comma;&sol;&num;&commat;"), "--''\"\".,/#@");
  assert.equal(normalizeText("PW&amp;colon; 1 &#58; &#x3a;"), "PW: 1 : :");
  assert.equal(normalizeText("Fish &unknown; Chips"), "Fish &unknown; Chips");
  // Cyrillic Р and а in a Latin word
  assert.equal(normalizeText("РW: 774411 · Pаsscode"), "PW: 774411 · Passcode");
  // what cleanRecord stores keeps the office's typography (dashes, quotes, other alphabets), entities decoded
  assert.equal(normalizeText("Children’s — “Party” &colon; Р", { dashes: false }), "Children’s — “Party” : Р");
  for (const s of ["Ana R. – sober since ’90", "PW&amp;amp;colon; 1", "P W – P.W. · РW", "plain text"]) {
    assert.equal(normalizeText(normalizeText(s)), normalizeText(s), s);
    const h = titleRisk(s, { now: NOW });
    for (const x of h) assert.equal(s.slice(x.index, x.index + x.value.length), x.value, s);
  }
});

test("titleRisk: a meeting number of 9 digits or more with any separator, not a phone line, a date, a time, a price or a ZIP+4", () => {
  for (const t of [
    "Online Workshop – Teams: 812 3456 7890", "Teams: 812 345 678 90", "Zoom: 812/3456/7890", "Zoom: 812_3456_7890", "Zoom: 812·3456·7890", "Zoom: 81234 567890",
    "Online – 812 3456 7890", "Online (812 3456 7890)", "Online Workshop – 812 3456 7890 / 7788 (Zoom / PW)", "Online Workshop – Zoom ID\n812\n3456\n7890",
    "Join: 812 | 3456 | 7890", "Join: 812,3456,7890",
  ]) {
    assert.ok(risks(t).includes("zoom"), t);
  }
  // it starts at the number: "Teams:" stays, the number goes
  const teams = "Online Workshop – Teams: 812 3456 7890 / Passcode Ab3x";
  assert.equal(Math.min(...titleRisk(teams, { now: NOW }).filter((h) => h.kind === "zoom").map((h) => h.index)), teams.indexOf("812"));
  for (const t of [
    "Join by Zoom or call 800-555-0199", "Call the office at (714) 556-4555 or 714-556-4555", "11/14/2026 – 11/16/2026", "Christmas Alcathon – Dec 24–25, 2026",
    "Saturday 11/01/2026 de la 1:00PM 9:00pm", "Rooms $229.00/night, 11/14/2026 to 11/16/2026", "Tickets 125.00 – 150.00", "Unity Hall, Temecula CA 92590-1234",
    "Hilton – Suite 101-102, 1915 S Manchester Ave", "Open to areas 03, 05, 06, 07, 08, 09 and 93", "Panel 76 · 2026 · 2027", "1935–2026: Still Sober",
  ]) {
    assert.deepEqual(risks(t), [], t);
  }
});

test("titleRisk: a code (PW, PIN, clave, código, code, key/gate/access code) with a value of 3 digits or more, however it is joined", () => {
  for (const t of [
    "Potluck PW is 774411", "Potluck – PW was 774411", "Potluck PW, 774411", "Potluck PW; 774411", "Potluck PW/774411", "Potluck PW [774411]", "Potluck PW “774411”",
    "Potluck PW \"774411\"", "Potluck PW → 774411", "Potluck PW » 774411", "Potluck PW · 774411", "Potluck PW | 774411", "Potluck PW for Zoom: 774411",
    "Potluck P W: 774411", "Potluck P-W: 774411", "Potluck PW&colon; 774411", "Potluck PW&ensp;774411", "Workshop – PIN is 1234", "Taller – Clave, 7788",
    "Taller – Clave para entrar: 7788", "Taller – Clave: siete siete ocho ocho", "Workshop – Pass-code: serenity", "Workshop – Code is 7788",
    "Workshop – Key code: 4455", "Workshop – Gate code 4455", "The code is 7788", "PW 1999", "Potluck РW: 774411", "Workshop – Pаsscode: serenity",
  ]) {
    assert.ok(risks(t).includes("password"), t);
  }
  // the hit starts at the label
  assert.equal(titleRisk("Potluck PW is 774411", { now: NOW }).find((h) => h.kind === "password").index, 8);
  for (const t of [
    "Weekend Pass: $60", "Dress Code", "Code of Conduct", "Code of Conduct Workshop – Room 101", "Group Code: AA022026SD", "Book online (Group Code: AA022026SD)",
    "Taller Código 12", "Taller: Clave 1 – La Rendición", "PW 2026 Forum", "Lapel Pin 2026", "PIN 2027 Fundraiser", "PW Group 40th Anniversary", "Code 7 Picnic",
    "Promo code SOBER26", "Area Code: 951", "Zip code: 92590", "Barcode: 12345", "Lapel Pin: $5", "Código de Conducta y Tradiciones", "Clave de la Felicidad – Taller",
  ]) {
    assert.deepEqual(risks(t), [], t);
  }
});

test("titleRisk: a sobriety word within 25 characters of a date or a year from 1940 to last year; this year and later are the event's own", () => {
  for (const t of [
    "Joe's sobriety date celebration March 3 1990", "Sobriety: 3/3/1989", "Ana R. (Sobriety: 3/3/1990)", "Celebrating Ana R.'s 3/3/1990 sobriety",
    "Ana R. – Sobriety Anniversary 3/3/1990", "Ana R. – sober 3/3/1990", "Ana R. – sobriety since 1990", "Our speaker Tom R. got sober on March 3, 1989.",
    "Speaker: Tom R. (Sobriety — March 1989)", "Tom R., sobriety 3/89", "Sobriety – 3/3/1989", "Sobriedad – 3 de marzo de 1989", "Ana R. – sober since ’90",
    "Ana R. – sobria desde ’90", "Ana R. – AA birthday 3/3/1990", "Ana R. – A.A. Birthday: March 3, 1990", "Ana R. – clean date 3/3/1990",
    "Ana R. – last drink 3/3/1990", "Ana R. – sin beber desde el 3 de marzo de 1990", "Ana R. d.o.s. 3/14/1989", "Ana R. dos: 3/14/89", "Ana R. DOS 3/14/1989",
    "Ana R. – sober since March 2026",
  ]) {
    assert.ok(risks(t).includes("sobriety"), t);
  }
  for (const t of [
    "2026 Sobriety Birthday Bash", "Nov 2026 Sobriety Birthday Meeting", "Unity Day 2026 – Taller de Sobriedad", "Sober Since 1935: A.A. History Workshop",
    "Los DOS 12/12/2026 Talleres", "91 Years and Still Sober!", "Grupo Sobrios Desde 1985: 40 Aniversario", "Sober Since the 1980s: Old-Timers Panel",
    "Sobriety Birthday Night – Nov 14", "AA Birthday Night – 11/14/2026", "Sober Date Night – Feb 14, 2027", "Speaker: Ana R. (DOS 2026 Panel)",
    "LOS DOS AMIGOS 1985", "Taller de los Dos Legados 1985", "Celebrating 60 Years of Sober Fun!", "Aniversario #39 grupo Buscando Sobriedad",
    // a year alone next to a sobriety word on its own (not a label) is not a date (round 5): last year's event, a
    // group's founding year; a summary still leaves these out (summaryRisk)
    "Tom R. 1990 sober!", "Sobriety: 1989", "Speaker: Tom R. (Sobriety — 1989)", "Tom R., sobriety 1989", "Sobriety – 1989", "Sobriedad – 1989",
  ]) {
    assert.deepEqual(risks(t), [], t);
  }
  // the year that counts is "now"'s: in 2027, a date in 2026 is a person's
  assert.deepEqual(risks("Ana R. – sober 3/3/2026"), []);
  assert.ok(risks("Ana R. – sober 3/3/2026", { now: "2027-01-15" }).includes("sobriety"));
});

test("phone numbers with ·, _ or | and written 3-3-2-2; e-mail addresses with accents or with their dots spelled out", () => {
  for (const t of ["714 · 555 · 0123", "714_555_0123", "714 | 555 | 0123", "714 555 01 23", "714-555-01-23"]) assert.deepEqual(kinds(`Picnic – call Ana ${t}`), ["phone"], t);
  for (const t of [spelled("ana.r", "at", "cox", "dot", "net"), `ana.r @ ${spelled("gmail", "dot", "com")}`, `${mail("ana.r", "gmail")} dot com`, mail("José", FREE), mail("José", FREE), "ana.r at example dot org"]) {
    assert.deepEqual(kinds(`Picnic – RSVP ${t}`), ["email"], t);
  }
  for (const t of ["Join us at aanoc dot org", "Tickets at eventbrite dot com", "Find us at aanoc.org", "Office (714) 556-4555 · 1-800-555-0199"]) assert.deepEqual(kinds(t), [], t);
});

test("cleanRecord with titleRisk: titles cut before their first detail, venues emptied, ordinary titles whole, the same record twice", () => {
  const cases = [
    ["Potluck – PW is 774411", "Potluck"],
    ["Tom R. – Sobriety: 3/3/1989", "Tom R."],
    ["Online Workshop – 812 3456 7890 / 7788 (Zoom / PW)", "Online Workshop"],
    ["Ana R. – sober since ’90", "Ana R."],
    ["Ana R. – AA birthday 3/3/1990", "Ana R."],
    ["Joe’s sobriety date celebration March 3 1990", "Joe’s"],
    ["Online Workshop – Teams: 812 3456 7890 / Passcode Ab3x", "Online Workshop – Teams"],
    ["Potluck PW&colon; 774411", "Potluck"],
    ["Taller – Clave para entrar: 7788", "Taller"],
    ["Picnic – call Ana 714 · 555 · 0123", "Picnic – call Ana"],
  ];
  for (const [t, want] of cases) {
    const c = clean0({ title: t, venue: t });
    assert.equal(c.title, want, t);
    assert.deepEqual(titleRisk(c.title, { now: NOW }), [], t);
    assert.deepEqual(cleanRecord(c, { officeHost: "oc-aa.org", now: NOW }), c, t);
    if (!/call Ana/.test(t)) assert.equal(c.venue, "", t);
  }
  assert.throws(() => clean0({ title: "Sobriety: 3/3/1989" }), (e) => e.code === "OFFICE_RECORD_DROPPED");
  for (const t of [
    "2026 Sobriety Birthday Bash", "Nov 2026 Sobriety Birthday Meeting", "Unity Day 2026 – Taller de Sobriedad", "Sober Since 1935: A.A. History Workshop",
    "Los DOS 12/12/2026 Talleres", "91 Years and Still Sober!", "Weekend Pass: $60", "Dress Code", "Code of Conduct", "Group Code: AA022026SD", "Taller Código 12",
    "Taller: Clave 1 – La Rendición", "PW 2026 Forum", "Lapel Pin 2026", "Join by Zoom or call 800-555-0199", "Grupo Sobrios Desde 1985: 40 Aniversario",
    "Children’s Holiday Party", "Hilton – Suite 101-102, 1915 S Manchester Ave",
  ]) {
    assert.equal(clean0({ title: t }).title, t, t);
    assert.equal(clean0({ venue: t }).venue, t, t);
  }
});

test("ids and event pages are read as words every way: digit groups joined as dates, letters spelled apart joined (slugRisk)", () => {
  assert.ok(slugForms("ana-r-sobriety-date-3-3-1990", { now: NOW }).includes("ana r sobriety date 3/3/1990"));
  assert.ok(slugForms("potluck-p-w-774411", { now: NOW }).includes("potluck PW 774411"));
  assert.ok(slugForms("ana-r-d-o-s-3-14-1989", { now: NOW }).includes("ana r DOS 3/14/1989"));
  assert.ok(slugForms("ana-r-sober-since-331990", { now: NOW }).includes("ana r sober since 3/3/1990"));
  const mariaSlug = ["maria", ...FREE.split(".")].join("-");
  assert.ok(slugForms(mariaSlug, { now: NOW }).includes(mail("maria", FREE)));
  for (const key of [
    "ana-r-sobriety-date-3-3-1990", "ana-r-dos-3-14-1989", "potluck-p-w-774411", "workshop-i-d-812-3456-7890", "ana-r-fecha-de-sobriedad-3-3-1990", "ana-r-sober-since-331990",
    "ana-r-sober-since-3390", "potluck-pw-is-774411", "workshop-code-is-7788", "online-812-3456-7890-7788-zoom-pw", "ana-r-aa-birthday-3-3-1990", mariaSlug,
  ]) {
    assert.ok(slugRisk(key, { now: NOW }).length, key);
    assert.match(recordId("nocco", key, { now: NOW }), /^co-nocco-e[a-p]{10}$/, key);
  }
  // an event's own date at the end of a Temecula id is a date, not the end of a long number
  for (const key of ["gratitude-dinner-2026-20261212", "room-101-20261212", "weekend-pass-60-20261212", "traditions-workshop-tradition-7-20261212"]) {
    assert.equal(recordId("temecula", key, { now: NOW }), `co-temecula-${key}`, key);
  }
  // NOCCO: the card's title and its page address are both read; a card with a detail gets a hashed id
  const html = fixture("nocco", "events.html");
  for (const [slug, title] of [
    ["ana-r-sobriety-date-3-3-1990", "Ana R. Sobriety Date 3/3/1990"], ["ana-r-dos-3-14-1989", "Ana R. DOS 3/14/1989"], ["potluck-p-w-774411", "Potluck P.W. 774411"],
    ["workshop-i-d-812-3456-7890", "Workshop I.D. 812 3456 7890"], ["ana-r-sober-since-331990", "Ana R. Sober Since 3/3/1990"],
    ["picnic-rsvp-anar1990-example-net", "Picnic – RSVP anar1990 @ example.net"],
  ]) {
    const changed = html.split("/events/practicing-principles/").join(`/events/${slug}/`).replace(/Practicing Principles/g, title);
    const got = adapters.aanoc({ html: changed, rss: "", details: {} }, { office: "nocco", host: "aanoc.org", now: NOW, base: "https://www.aanoc.org/" });
    const r = got.records.find((x) => x.src.includes(slug));
    assert.match(r.id, /^co-nocco-e[a-p]{10}$/, slug);
    // and its page address is not shown: the office's events page is
    assert.equal(cleanRecord(r, { officeHost: "aanoc.org", now: NOW, eventsPage: "https://www.aanoc.org/events/" }).src, "https://www.aanoc.org/events/", slug);
  }
  // Temecula: the title as typed and its slug read every way
  const page = fixtureJson("temecula", "page.json");
  page.content.rendered = "<p><strong>Ana R. &#8211; sober since &#8217;90</strong><br />\nSaturday, December 26, 2026 2pm-4pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>";
  const tv = adapters.tvco(page, { office: "temecula", host: "temeculacentraloffice.org", now: NOW });
  assert.match(tv.records[0].id, /^co-temecula-e[a-p]{10}-20261226$/);
  // an event page whose address carries a detail or a full name
  assert.equal(addressRisky("https://www.oc-aa.org/event/potluck-pw-is-774411/", { now: NOW }), true);
  assert.equal(addressRisky(`https://www.oc-aa.org/event/speaker-${fullName("maria", "exampleton").replace(" ", "-")}/`, { now: NOW }), true);
  assert.equal(addressRisky("https://www.oc-aa.org/event/32-aniversario-del-grupo-aa-12-pasos-11-01-2026-de-la-100pm-900pm/", { now: NOW }), false);
  // the committed mirror's ids (events and the offices' sources) read clean every way
  const mirror = JSON.parse(fs.readFileSync(new URL("../../data/central-office-events.json", import.meta.url), "utf8"));
  for (const id of [...mirror.events.map((e) => e.id), ...Object.values(mirror.offices).flatMap((o) => Object.keys(o.sources || {}))]) {
    assert.deepEqual(slugRisk(id, { now: NOW }), [], id);
  }
});

/* ------------------------------------------------------------------ round 5: wordings, codes, page and flyer addresses */

// free-mail names and endings put together at run time
const GM = ["g", "mail"].join("");
const SBC = ["sbcglobal", "net"].join(".");
const PROTON = ["proton", "me"].join(".");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// WordPress's page address of a title, near enough: accents off, "." and dashes to "-", other signs ("’", "@", ":") dropped
const wpSlug = (t) =>
  String(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[‐-―−.]/g, "-").replace(/[^a-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
const hashed = (id) => /-e[a-p]{10}(?:-\d{8})?$/.test(id);
// the real adapters, one entry each, then cleanRecord as the importer runs it (with the office's events page)
function viaTvco(title) {
  const page = fixtureJson("temecula", "page.json");
  page.content.rendered = `<p><strong>${esc(title)}</strong><br />\nSaturday, December 12, 2026 2pm-4pm<br />\n27574 Commerce Center Dr # 139, Temecula, CA 92590</p>`;
  const eventsPage = "https://www.temeculacentraloffice.org/events/";
  const r = adapters.tvco(page, { office: "temecula", host: "temeculacentraloffice.org", now: NOW, eventsPage }).records[0];
  return { raw: r, c: cleanRecord(r, { officeHost: "temeculacentraloffice.org", now: NOW, eventsPage }) };
}
function viaAanoc(title, slug) {
  const html = fixture("nocco", "events.html").split("/events/practicing-principles/").join(`/events/${slug}/`).replace(/Practicing Principles/g, esc(title));
  const got = adapters.aanoc({ html, rss: "", details: {} }, { office: "nocco", host: "aanoc.org", now: NOW, base: "https://www.aanoc.org/" });
  const r = got.records.find((x) => x.src.includes(`/events/${slug}/`));
  return { raw: r, c: cleanRecord(r, { officeHost: "aanoc.org", now: NOW, eventsPage: "https://www.aanoc.org/events/" }) };
}
function viaTribe(title, slug = wpSlug(title), venue = "Fellowship Hall") {
  const ev = {
    id: 99001, title: esc(title), url: `https://www.oc-aa.org/event/${slug}/`, description: "", start_date: "2026-12-12 14:00:00", end_date: "2026-12-12 16:00:00",
    utc_start_date: "2026-12-12 22:00:00", utc_end_date: "2026-12-13 00:00:00", all_day: false,
    venue: { venue: esc(venue), address: "123 Main St", city: "Anaheim", zip: "92806" }, cost: "", categories: [], image: false,
  };
  const r = adapters.tribe({ events: [ev] }, { office: "oc-central", host: "oc-aa.org", now: NOW, options: {} }).records[0];
  return { raw: r, c: cleanRecord(r, { officeHost: "oc-aa.org", now: NOW, eventsPage: "https://www.oc-aa.org/events/" }) };
}

test("round 5, titleRisk: soberversary, AA anniversary, recovery date, clean time since, no drinking / sin alcohol / libre de alcohol desde, birthday with a full past date, month and 2-digit years, NFKC look-alikes", () => {
  for (const t of [
    "Ana R. – soberversary 3/3/1990", "Ana R. – soberversary ’90", "Ana R. – AA anniversary 3/3/1990", "Ana R. – A.A. anniversary ’90", "Ana R. – recovery date 3/3/1990",
    "Ana R. – recovery date 1990", "Ana R. – clean time since 3/3/1990", "Ana R. – clean time since 1990", "Ana R. – sober date 1990", "Ana R. – no drinking since 3/3/1990",
    "Ana R. – sin alcohol desde 1990", "Ana R. – libre de alcohol desde el 3/3/1990", "Ana R. – birthday 3/3/1990", "Ana R. – birthday March 3, 1990",
    "Ana R. – sober since 3/90", "Ana R. – DOS 03/90", "Ana R. – sober since 90", "Ana R. – sobria desde 90", "Ana R. – sobriety anniversary on March 3rd, '90",
    "Ana R. – sobriety date 3 3 1990", "Ana R. – 𝐒𝐨𝐛𝐞𝐫 𝐬𝐢𝐧𝐜𝐞 𝟏𝟗𝟗𝟎", "Speaker: Joe S. (Sober since 1985, Long Beach)", "Ana R. – sober since 3/14",
    "Tom R. (AA birthday 1989)",
  ]) {
    assert.ok(risks(t).includes("sobriety"), t);
    assert.equal(clean0({ title: t }).title.includes("1990"), false, t);
  }
  // a year alone counts only right after a label; never a group's year; "birthday" needs a full date in the past
  for (const t of [
    "Since 1988 – Proud & Sober.", "Celebrating 25 Years Sober Together – Since 2001", "Sober Since 1979 Group – 47th Anniversary", "Sober in the Sun 2025 Recap & 2026 Kickoff",
    "Clean & Sober Car Show 2025 Awards Night", "Sobriety Fest 2025 Highlights", "Sobriety Fest 2025 Highlights Video Premiere", "Grupo Nueva Vida 1985 – Sobriedad y Servicio",
    "Unidos en Sobriedad – Fotos de la Convención 2025", "Sobriety Birthday 2025 Recap", "2025 Sobriety Birthday Recap", "Birthday Meeting & Potluck – 11/14/2026",
    "Monthly Birthday Night – November 2026", "Sober Since 90 Days Workshop", "AA Anniversary Dinner 2025", "Soberversary Night – Nov 14", "Clean Time Countdown 2025",
    "AA Birthday 2025 Recap", "AA Birthday Night 2025",
  ]) {
    assert.deepEqual(risks(t), [], t);
    assert.equal(clean0({ title: t }).title, t, t);
  }
});

test("round 5, titleRisk: codes of letters and digits mixed after ':' or 'is', digits typed with spaces; e-mail addresses written 'name at domain'", () => {
  for (const t of [
    "Taller – Clave: Ab3x9Q", "Taller – Código: 8Hk2pX", "Workshop – Code: 8Hk2pX", "Workshop – Code is 8Hk2pX", "Workshop code: 8Hk2pX", "Potluck – PIN: Ab3x9Q",
    "Taller – Clave: 7 7 8 8", "Potluck – PIN 1 2 3 4", "Workshop – Door code 4 4 5 5", "Potluck – PW 𝟕𝟕𝟒𝟒𝟏𝟏", "Potluck – PW ⁷⁷⁴⁴¹¹", "Online – Passcode: Ab3x9Q",
  ]) {
    assert.ok(risks(t).includes("password"), t);
    assert.doesNotMatch(clean0({ title: t }).title, /\d|Ab3x9Q|8Hk2pX/, t);
  }
  for (const t of [
    "Group Code: AA022026SD", "Book online (Group Code: AA022026SD)", "Promo code: SOBER26", "Promo code SOBER26", "Code 7 Picnic", "Taller: Clave 1 – La Rendición",
    "PIN Night: Celebrate Your 24-Hour Chip", "Pass Code Workshop for Secretaries", "Zip code: 92590", "Clave 1 2: Los Primeros Pasos", "Código de Vestimenta: Blanco – Fiesta 2026",
  ]) {
    assert.deepEqual(risks(t), [], t);
  }
  for (const t of [`Picnic – RSVP anar1990 at ${SBC}`, `Picnic – anar1990 at ${PROTON}`, "Picnic – RSVP anar1990 at example.net", "Picnic – contact Ana at example.org", `Picnic – email anar1990 at ${GM}`, `Potluck and fellowship. Picnic – email anar1990 at ${GM}. All welcome!`]) {
    assert.deepEqual(kinds(t), ["email"], t);
  }
  assert.equal(clean0({ title: `Picnic – RSVP anar1990 at ${SBC}` }).title, "Picnic – RSVP");
  for (const t of ["Join us at aanoc.org", "Find us at aanoc.org", "Contact us at scypaa.org", "RSVP at evite.com", "RSVP: Dinner at Live Oak Park", "Dinner at Verizon Amphitheater – RSVP by email", "Tickets at eventbrite.com"]) {
    assert.deepEqual(kinds(t), [], t);
  }
  // a summary: all or nothing
  for (const t of ["Bring a dish. Workshop code: 8Hk2pX.", "Ana R. celebrates her soberversary 3/3/1990 with the Unity Group.", "Online too. Code is Ab3x9Q."]) assert.notEqual(summaryRisk(t, { now: NOW }), "", t);
});

test("round 5, cleanRecord: a title that lost anything gives way to the events page (or the website); street address, city and price read like a venue", () => {
  const ctx = { officeHost: "oc-aa.org", now: NOW, eventsPage: "https://www.oc-aa.org/events/" };
  const own = (slug) => `https://www.oc-aa.org/event/${slug}/`;
  const mariaGlued = ["picnic-rsvp-maria", GM, "-com"].join("");
  // the page's address is made from the title as WordPress writes it (apostrophes and "@" dropped)
  for (const [title, slug, want] of [
    ["Ana R. – sober since ’90", "ana-r-sober-since-90", "Ana R."],
    [`Picnic – RSVP ${mail("maria", FREE)}`, mariaGlued, "Picnic – RSVP"],
    ["Potluck – PW: serenity", "potluck-pw-serenity", "Potluck"],
    [`Speaker ${fullName("Maria", "Exampleton")}`, "speaker-maria-e", "Speaker Maria E."],
    ["Taller – Clave: Ab3x9Q", "taller-clave-ab3x9q", "Taller"],
  ]) {
    const c = cleanRecord({ ...rec0, title, src: own(slug) }, ctx);
    assert.equal(c.title, want, title);
    assert.equal(c.src, "https://www.oc-aa.org/events/", title);
    assert.deepEqual(cleanRecord(c, ctx), c, title);
    // no events page given: the office's website
    assert.equal(cleanRecord({ ...rec0, title, src: own(slug) }, { officeHost: "oc-aa.org", now: NOW }).src, "https://oc-aa.org/", title);
  }
  // a Spanish title cut or emptied, a venue emptied: the same
  assert.equal(cleanRecord({ ...rec0, title_es: "Picnic – Clave: 7788", src: own("picnic") }, ctx).src, "https://www.oc-aa.org/events/");
  assert.equal(cleanRecord({ ...rec0, venue: "Online (812 3456 7890)", src: own("picnic") }, ctx).src, "https://www.oc-aa.org/events/");
  // a clean title whose address carries a detail as WordPress writes it
  for (const slug of ["ana-r-sober-since-90", "ana-r-sobria-desde-90", mariaGlued, ["picnic-rsvp-jose", GM, "-com"].join(""), ["picnic-rsvp-ana-r", GM, "dot-com"].join("-"), "picnic-rsvp-anar1990-at-example-net"]) {
    assert.equal(cleanRecord({ ...rec0, title: "Picnic", src: own(slug) }, ctx).src, "https://www.oc-aa.org/events/", slug);
    assert.equal(addressRisky(own(slug), { now: NOW }), true, slug);
  }
  // titles that come through whole keep their own page
  for (const [title, slug] of [["Picnic", "picnic"], ["Zip code: 92590", "zip-code-92590"], ["Pass Code Workshop for Secretaries", "pass-code-workshop-for-secretaries"], ["Sober Since 1979 Group – 47th Anniversary", "sober-since-1979-group-47th-anniversary"]]) {
    const c = cleanRecord({ ...rec0, title, src: own(slug) }, ctx);
    assert.equal(c.title, title);
    assert.equal(c.src, own(slug), title);
    assert.deepEqual(pageRisk(own(slug), { now: NOW }), [], slug);
  }
  assert.deepEqual(pageRisk("https://www.oc-aa.org/event/picnic/?pwd=abc", { now: NOW }), ["password"]);
  assert.ok(pageRisk(`https://www.oc-aa.org/event/${mail("maria", FREE)}/`, { now: NOW }).includes("email"));
  // street address, city and price: any titleRisk detail empties the field
  for (const [k, v] of [["address", "123 Main St – PW is 774411"], ["address", "Online (812 3456 7890)"], ["address", "123 Main St – Ana R. AA birthday 3/3/1990"], ["city", "Anaheim (Ana R., sober since ’90)"], ["cost", "$10 – Clave: 7788"], ["cost", "Free – Code is 7788"], ["address", "123 Main St – Clave: 7 7 8 8"]]) {
    assert.equal(clean0({ [k]: v })[k], "", v);
  }
  for (const [k, v] of [["address", "27574 Commerce Center Dr # 139"], ["address", "1915 S Manchester Ave, Suite 101-102"], ["city", "Anaheim"], ["cost", "$25; table of 8 $180"], ["cost", "Free – 7th Tradition"]]) {
    assert.equal(clean0({ [k]: v })[k], v, v);
  }
});

test("round 5, flyers: a file name or folder with a sobriety date, a code, an e-mail address or a full name is left out; camera and size numbers are not meeting numbers", () => {
  const U = (name) => `https://www.oc-aa.org/wp-content/uploads/2026/10/${name}`;
  const risky = [
    "Ana-R-sober-since-3-3-1990.jpg", "ana-r-sobriety-date-3-3-1990.jpg", "Ana-R-soberversary-3-3-1990.pdf", "Potluck-PW-774411.pdf", "Taller-Clave-Ab3x9Q.png",
    `${fullName("Maria", "Exampleton").replace(" ", "-")}-flyer.jpg`, ["RSVP-maria", GM, "-com.jpg"].join(""), "Ana-R-AA-anniversary-331990.jpg",
  ];
  const fine = [
    "doc01079620260909101242-pdf.jpg", "20260927_210553.jpg", "Buscando-sobriedad-1.jpg", "Sobriedad-y-Salvacion-Aniversario_Page_2.jpg", "2026ChildrensHolidayParty.pdf",
    "28-CONGRESO-scaled.jpg", "Sober-Since-1979-Group-47th.jpg",
  ];
  for (const n of risky) assert.notDeepEqual(flyerRisk(U(n), { now: NOW }), [], n);
  for (const n of fine) assert.deepEqual(flyerRisk(U(n), { now: NOW }), [], n);
  const c = clean0({
    flyers: [
      ...risky.map((n) => ({ url: U(n) })),
      ...fine.map((n) => ({ url: U(n) })),
      { url: U("Buscando-sobriedad-2.jpg"), sizes: [[188, U("Buscando-sobriedad-2-188x300.jpg")], [642, U("Buscando-sobriedad-2-642x1024.jpg")]] },
    ],
  });
  assert.deepEqual(c.flyers.map((f) => f.url), [...fine, "Buscando-sobriedad-2.jpg"].map(U));
  assert.deepEqual(c.flyers.at(-1).sizes.map(([w]) => w), [188, 642]);
});

test("round 5, through the real adapters: ordinary titles come through whole with a readable id and their own page; ids and pages of the new details do not", () => {
  for (const t of [
    "Since 1988 – Proud & Sober.", "Celebrating 25 Years Sober Together – Since 2001", "Sober Since 1979 Group – 47th Anniversary", "Sober in the Sun 2025 Recap & 2026 Kickoff",
    "Clean & Sober Car Show 2025 Awards Night", "Sobriety Fest 2025 Highlights", "Pass Code Workshop for Secretaries", "Zip code: 92590", "Bill W. & Dr. Bob History Workshop",
    "Grupo Nueva Vida 1985 – Sobriedad y Servicio", "Unidos en Sobriedad – Fotos de la Convención 2025",
  ]) {
    const tv = viaTvco(t);
    assert.equal(tv.c.title, t, t);
    assert.equal(hashed(tv.c.id), false, `${t}: ${tv.c.id}`);
    const slug = wpSlug(t);
    const a = viaAanoc(t, slug);
    assert.equal(a.c.title, t, t);
    assert.equal(a.c.id, `co-nocco-${slug}`, t);
    assert.equal(a.c.src, `https://www.aanoc.org/events/${slug}/`, t);
    const tr = viaTribe(t);
    assert.equal(tr.c.title, t, t);
    assert.equal(tr.c.src, `https://www.oc-aa.org/event/${slug}/`, t);
  }
  // NOCCO: an ordinary card title on an address with a detail; Temecula and NOCCO: a title with one
  for (const slug of ["taller-clave-ab3x9q", "ana-r-aa-anniversary-3-3-1990", "ana-r-sober-since-90", "ana-r-dos-390", "ana-r-sin-alcohol-desde-1990", "ana-r-sober-since-3-90", ["picnic-rsvp-maria", GM, "-com"].join("")]) {
    const a = viaAanoc("Picnic", slug);
    assert.match(a.c.id, /^co-nocco-e[a-p]{10}$/, slug);
    assert.equal(a.c.src, "https://www.aanoc.org/events/", slug);
  }
  for (const t of ["Taller – Clave: Ab3x9Q", "Ana R. – AA anniversary 3/3/1990", "Ana R. – soberversary 3/3/1990", "Workshop – Pass Code: Ab3x9Q", "Taller – Clave: 7 7 8 8", `Picnic – RSVP anar1990 at ${SBC}`]) {
    const tv = viaTvco(t);
    assert.match(tv.c.id, /^co-temecula-e[a-p]{10}-20261212$/, t);
    const a = viaAanoc(t, wpSlug(t));
    assert.match(a.c.id, /^co-nocco-e[a-p]{10}$/, t);
    assert.equal(a.c.src, "https://www.aanoc.org/events/", t);
    const tr = viaTribe(t);
    assert.equal(tr.c.src, "https://www.oc-aa.org/events/", t);
    assert.notEqual(tr.c.title, t, t);
  }
});

// Oficina Intergrupal Sureste de Riverside (oiaasriverside.org): dates and times typed into the titles, flyers in the
// description, no place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeline, tribePages, clone } from "./helpers.mjs";
import { cleanupTitle } from "../../src/_lib/office-import.js";

const pages = tribePages("sureste-riverside");
const run = pipeline("sureste-riverside", pages);

test("6 read, 6 kept; titles without their typed date and time, ALL CAPS in title case", () => {
  assert.equal(run.stats.read, 6);
  assert.equal(run.records.length, 6);
  assert.deepEqual(
    run.records.map((r) => r.title),
    [
      "32 Aniversario del Grupo AA 12 Pasos",
      "Grupo AA:El Lenguaje del Corazon 3er Aniversario",
      "MSCA Area 09 Panel 79 Servathon",
      "Aqui Empieza y Termina una etapa VIII Aniversario",
      "XXVIII Congreso de Alcoholicos Anonimos",
      "Grupo AA:Sobriedad y Salvacion XXV ANIVERSARIO",
    ],
  );
  assert.equal(cleanupTitle("32 ANIVERSARIO DEL GRUPO AA 12 PASOS 11/01/2026 DE LA 1:00PM 9:00pm", "2026-11-01").title, "32 Aniversario del Grupo AA 12 Pasos");
});

test("a title whose dates contradict the event's dates is flagged (the event's dates are kept)", () => {
  const c = run.byTitle(/congreso/i);
  assert.ok(c.flags.includes("title-date-mismatch")); // "27,28,29 de noviembre" but it starts on the 26th
  assert.equal(c.start, "2026-11-26T08:00:00-08:00");
  assert.equal(c.endDate, "2026-11-29");
  assert.equal(c.type, "Convention");
  for (const r of run.records.filter((x) => x !== c)) assert.ok(!r.flags.includes("title-date-mismatch"), r.title);
});

test("the Servathon is an Event (never an Area type), stray description words are dropped, flyers from the description", () => {
  const s = run.byTitle(/servathon/i);
  assert.equal(s.type, "Event");
  assert.equal(s.summary, ""); // the description holds only the flyer and the word "MSCA"
  assert.ok(s.flags.includes("place-on-flyer"));
  assert.match(s.flyers[0].url, /^https:\/\/oiaasriverside\.org\/wp-content\/uploads\/2026\/10\/20260927_210553-scaled\.jpg$/);
  const a = run.byTitle(/12 Pasos/);
  assert.equal(a.flyers.length, 2);
});

test("an office service event (Planificada) is dropped", () => {
  const planned = { ...clone(pages[0].events[0]), id: 1390, url: "https://oiaasriverside.org/event/oficina-planificada/", title: "Oficina Sureste de Riverside Planificada 11/25/26", start_date: "2026-11-25 19:00:00", end_date: "2026-11-25 21:00:00", utc_start_date: "2026-11-26 03:00:00", utc_end_date: "2026-11-26 05:00:00" };
  const r2 = pipeline("sureste-riverside", [{ events: [...clone(pages[0].events), planned] }]);
  assert.equal(r2.dropped.meetings, 1);
  assert.equal(r2.records.length, 6);
  assert.ok(!r2.records.some((r) => /planificada/i.test(r.title)));
});

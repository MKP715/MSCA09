// Reads the CSV files in data/. Every editable thing on the site comes through here.
//
// Rules for the CSV files (also in data/README.md):
//  - first row is the header; keep it
//  - UTF-8 (Excel: "CSV UTF-8"); a byte-order mark is fine
//  - a row whose first cell starts with "#" is a comment and is ignored
//  - blank rows are ignored
//  - every row has as many values as the header (add commas at the end of a short row)
//  - a value that contains a comma, a line break or a " is wrapped in "double quotes",
//    and a " inside it is written twice ("")
//
// A file that breaks these rules still builds (the reader recovers what it can), but
// the problems are printed during the build, saved in .cache/csv-problems.json, and
// `npm run check` (scripts/check-site.mjs) refuses to publish until they are fixed —
// a broken row would otherwise lose data silently (e.g. a name sliding into the
// e-mail column, or the Spanish text disappearing).
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
const PROBLEMS_FILE = path.join(ROOT, ".cache", "csv-problems.json");

const clean = (v) => (v == null ? "" : String(v).replace(/\r/g, "").trim());

const RELAXED = { skip_empty_lines: true, relax_column_count: true, relax_quotes: true, bom: true, info: true };

/* ------------------------------------------------------------------ problems */

const problems = new Map(); // file -> [{ file, line, message }]
const printed = new Set();

/** All CSV problems found so far in this build: [{ file, line, message }]. */
export function csvProblems() {
  return [...problems.values()].flat();
}

/** Forget the problems of earlier builds (called when a build starts). */
export function resetCsvProblems() {
  problems.clear();
  printed.clear();
  saveProblems();
}

function saveProblems() {
  try {
    fs.mkdirSync(path.dirname(PROBLEMS_FILE), { recursive: true });
    fs.writeFileSync(PROBLEMS_FILE, JSON.stringify(csvProblems(), null, 1));
  } catch {
    /* read-only checkout: the console message is enough */
  }
}

function report(rel, list) {
  problems.set(rel, list);
  for (const p of list) {
    const msg = `[csv] data/${p.file}${p.line ? ` line ${p.line}` : ""}: ${p.message}`;
    if (printed.has(msg)) continue;
    printed.add(msg);
    console.warn(msg);
  }
  saveProblems();
}

const QUOTE_HELP = 'Wrap a value that contains a comma or a " in "double quotes", and write a " inside it twice ("").';

/**
 * Parse CSV text leniently and return { records: [{ record, line }], problems }.
 * Never throws: a value with an unclosed quote is dropped and reported, and the
 * rest of the file is still read.
 */
export function parseCsvText(text, rel = "file.csv") {
  const found = [];
  const add = (line, message) => found.push({ file: rel, line, message });
  text = String(text || "").replace(/^﻿/, "");

  // 1) Strict pass: catches stray quotes that GitHub refuses to show as a table.
  try {
    parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true });
  } catch (e) {
    if (/QUOTE/.test(e.code || "")) add(e.lines || 0, `${e.message.replace(/\s+/g, " ")}. ${QUOTE_HELP}`);
  }

  // 2) Lenient pass, recovering from an unclosed quote by skipping that line.
  const lines = text.split("\n");
  const records = [];
  const parseFrom = (startLine, withHeader) => {
    // startLine is 1-based; text from that line on (header prepended when needed)
    const body = lines.slice(startLine - 1).join("\n");
    const head = withHeader ? lines[0] + "\n" : "";
    const offset = startLine - 1 - (withHeader ? 1 : 0);
    const run = (opts) => parse(head + body, { ...RELAXED, ...opts });
    let out;
    try {
      out = run({});
    } catch (e) {
      if (e.code !== "CSV_QUOTE_NOT_CLOSED") {
        add(0, `could not be read: ${e.message}`);
        return;
      }
      // Largest number of lines that still parse: the quote opens on the next line.
      const total = (head + body).split("\n").length;
      let lo = 0;
      let hi = total;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        try {
          run({ to_line: mid });
          lo = mid;
        } catch {
          hi = mid - 1;
        }
      }
      out = lo > 0 ? run({ to_line: lo }) : [];
      const badLine = lo + 1 + offset;
      add(badLine, `a value starts with " (double quote) that is never closed, so this row was skipped. ${QUOTE_HELP}`);
      for (const r of out) if (!(withHeader && r.info.records === 1)) records.push({ record: r.record, line: r.info.lines + offset });
      if (badLine < lines.length) parseFrom(badLine + 1, true);
      return;
    }
    for (const r of out) if (!(withHeader && r.info.records === 1)) records.push({ record: r.record, line: r.info.lines + offset });
  };
  parseFrom(1, false);
  records.sort((a, b) => a.line - b.line);
  // r.line is where a record ends; find where it starts (a quoted value may span lines)
  let prevEnd = 0;
  for (const r of records) {
    let start = prevEnd + 1;
    while (start < r.line && !String(lines[start - 1] || "").trim()) start++;
    r.end = r.line;
    r.line = start;
    prevEnd = r.end;
  }

  // 3) Every row as wide as the header; no value that swallowed the following rows.
  const width = records.length ? records[0].record.length : 0;
  for (const { record, line, end } of records.slice(1)) {
    const isComment = clean(record[0]).startsWith("#");
    if (record.length !== width) {
      const extra = record.slice(width);
      const onlyEmptyExtra = record.length > width && extra.every((v) => clean(v) === "");
      add(
        line,
        record.length < width
          ? `this row has ${record.length} values but the header has ${width}. Add ${width - record.length} comma(s) at the end of the row${isComment ? " (comment rows too, so GitHub can show the file as a table)" : ""}.`
          : onlyEmptyExtra
            ? `this row has ${record.length} values but the header has ${width}. Remove ${record.length - width} comma(s) from the end of the row.`
            : `this row has ${record.length} values but the header has ${width}. ${QUOTE_HELP}`,
      );
    }
    for (const v of record) {
      if (/\n[a-z0-9#][\w.-]*,/i.test(String(v))) {
        add(line, `a value runs on over several lines (to line ${end}) and looks like it swallowed the next row(s) — probably a missing closing " (double quote).`);
        break;
      }
    }
  }
  return { records, problems: found };
}

/* ------------------------------------------------------------------ reading */

/** Parse one CSV file in data/ into an array of row objects. Missing file → []. */
export function readCsv(rel, { required = false } = {}) {
  const file = path.join(DATA_DIR, rel);
  const relName = rel.replace(/\\/g, "/");
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing data file: data/${relName}`);
    return [];
  }
  const text = fs.readFileSync(file, "utf8");
  const { records, problems: found } = parseCsvText(text, relName);
  report(relName, found);
  if (!records.length) return [];

  const header = records[0].record.map((h) => clean(h).toLowerCase());
  return records
    .slice(1)
    .map(({ record }, i) => {
      const out = {};
      header.forEach((k, j) => {
        if (k) out[k] = clean(record[j]);
      });
      out._row = i + 2; // spreadsheet row number, for error messages
      out._file = relName;
      return out;
    })
    .filter((row) => {
      const first = Object.entries(row).find(([k]) => !k.startsWith("_"));
      if (!first) return false;
      if (first[1].startsWith("#")) return false;
      return Object.entries(row).some(([k, v]) => !k.startsWith("_") && v !== "");
    });
}

/** Check one CSV file in data/ without keeping its rows: [{ file, line, message }]. */
export function checkCsvFile(rel) {
  const file = path.join(DATA_DIR, rel);
  if (!fs.existsSync(file)) return [];
  return parseCsvText(fs.readFileSync(file, "utf8"), rel.replace(/\\/g, "/")).problems;
}

/** Read every .csv in a sub-folder of data/ and concatenate the rows. */
export function readCsvDir(relDir) {
  const dir = path.join(DATA_DIR, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort()
    .flatMap((f) => readCsv(`${relDir}/${f}`));
}

/** "yes" / "y" / "true" / "1" / "x" / "sí" → true. */
export function yes(v) {
  return /^(y|yes|true|1|x|s[ií])$/i.test(clean(v));
}

/** Split a list cell: "a; b; c" (also accepts "|" ) → ["a","b","c"]. */
export function list(v, sep = /\s*[;|]\s*/) {
  return clean(v)
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Number or fallback. */
export function num(v, fallback = 0) {
  const n = Number(clean(v));
  return Number.isFinite(n) && clean(v) !== "" ? n : fallback;
}

/** Is this row live today? Uses optional start/end (YYYY-MM-DD) columns. */
export function isLive(row, today = new Date()) {
  const d = today.toISOString().slice(0, 10);
  const start = clean(row.start || row.show_from);
  const end = clean(row.end || row.show_until);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

// The Area's trusted servants, from data/trusted-servants.csv.
//
// One row per service position: Area officers, committee chairs and support
// positions, district officers — for the current panel and the previous one.
// ANONYMITY (Tradition Eleven): the CSV holds first name + last initial only and
// service (role) e-mail addresses only (the one exception, a servant's own address published at an explicit
// request, is explained at altEmail below). Nothing else about a person is published.
//
// Shape (BUILD-SPEC §9.4):
//   { panel, previousPanel, current:[Servant], previous:[Servant], officers:[Servant],
//     byDistrict:{slug:[Servant]}, byCommittee:{slug:[Servant]},
//     bodies:[{ key, label_en, label_es, sort, level, district, items }], previousBodies:[…],
//     vacancies:[Servant], stats:{ filled, open, total, officers, committeeSeats, districtSeats, districts } }
//   Servant = { panel, level, body_en, body_es, body_key, body_sort, position_en, position_es,
//               role_en, role_es (same as position_*), position_sort, name, email, email_alt, email_alt_own,
//               district, committee, language, status, open, filled, unnamed, unconfirmed, completed, notes }
//   status: Filled | Open | Unnamed (role mailbox only) | Unconfirmed (pages mark the name "to be confirmed",
//   or say "name to be confirmed" when the name column is empty) | Unknown (nobody has told the Area who holds
//   the seat, or that it is open: pages say "not provided yet") | Completed.
import { readCsv, num } from "../_lib/csv.js";
// the status column, read the same way here and in scripts/check-site.mjs
import { normStatus, holdsSeat } from "../_lib/status.js";

const slugify = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Belt and braces: never let a full surname slip through (keep "First L." / "First").
function safeName(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  const parts = n.split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[A-Za-zÁÉÍÓÚÑáéíóúñ'’-]{3,}$/.test(last) && !/^".*"$/.test(last)) {
    // last word looks like a surname: reduce it to an initial
    parts[parts.length - 1] = last[0].toUpperCase() + ".";
  }
  return parts.join(" ");
}

// A second address is shown only when it adds something: a free-mail box (gmail, outlook …) next to the
// seat's own @msca09aa.org address is dropped — the Area address is the one that stays with the position.
// The exception: a servant's own address published at an explicit, dated request (an email_alt listed as kind
// email-approved in data/contact-allowlist.csv, checked by scripts/check-site.mjs) is shown next to the role mailbox.
const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|att|sbcglobal|comcast|cox|verizon|charter|protonmail|proton)\.[a-z.]+$/i;
const AREA_MAIL = /@msca09aa\.org$/i;
function altEmail(email, alt, approved) {
  const e = String(email || "").trim();
  const a = String(alt || "").trim();
  if (!a || a.toLowerCase() === e.toLowerCase()) return "";
  if (AREA_MAIL.test(e) && FREE_MAIL.test(a) && !approved.has(a.toLowerCase())) return "";
  return a;
}

// (Only a default export: Eleventy would otherwise expose the whole module.)
function loadServants() {
  const settings = {};
  for (const r of readCsv("settings.csv")) if (r.key) settings[r.key] = r.value;
  const rows = readCsv("trusted-servants.csv").filter((r) => r.panel && /^\d+$/.test(r.panel));
  const approved = new Set(readCsv("contact-allowlist.csv").filter((r) => r.kind === "email-approved").map((r) => r.value.toLowerCase()));

  const panels = [...new Set(rows.map((r) => num(r.panel)))].sort((a, b) => b - a);
  const panel = num(settings.panel, panels[0] || 0);
  const previousPanel = num(settings.previous_panel, panels.find((p) => p < panel) || 0);

  const all = rows.map((r) => {
    const status = normStatus(r);
    const name = status === "Open" || status === "Unknown" ? "" : safeName(r.name);
    let email_alt = altEmail(r.email, r.email_alt, approved);
    // A servant's own address belongs to that servant while they serve: only on a named, Filled or Unconfirmed row of
    // the current panel — never under an open or unreported seat, nor on a previous panel's row (scripts/check-site.mjs
    // refuses such a row too).
    if (approved.has(email_alt.toLowerCase()) && !holdsSeat(r, panel)) email_alt = "";
    return {
      panel: num(r.panel),
      level: (r.level || "").toLowerCase(),
      body_en: r.body_en || "",
      body_es: r.body_es || r.body_en || "",
      body_key: slugify(r.body_en),
      body_sort: num(r.body_sort, 999),
      position_en: r.position_en || "",
      position_es: r.position_es || r.position_en || "",
      role_en: r.position_en || "",
      role_es: r.position_es || r.position_en || "",
      position_sort: num(r.position_sort, 999),
      name,
      email: (r.email || "").trim(),
      email_alt,
      // the servant's own address, not a role mailbox: pages label it "Own e-mail (not a service mailbox)" instead of "Also"
      email_alt_own: approved.has(email_alt.toLowerCase()),
      district: r.district || "",
      committee: r.committee || "",
      language: r.language || "",
      status,
      open: status === "Open",
      // Unconfirmed: someone serves, but the name still has to be confirmed by the Area
      filled: status === "Filled" || status === "Unconfirmed",
      unnamed: status === "Unnamed",
      unconfirmed: status === "Unconfirmed",
      // Unknown: an empty row that keeps every district's roster the same shape until the district sends the details
      unknown: status === "Unknown",
      completed: status === "Completed",
      notes: r.notes || "",
    };
  });
  const sorter = (a, b) => a.body_sort - b.body_sort || a.body_key.localeCompare(b.body_key) || a.position_sort - b.position_sort;
  all.sort(sorter);

  const current = all.filter((s) => s.panel === panel);
  const previous = all.filter((s) => s.panel === previousPanel);

  const group = (list) => {
    const map = new Map();
    for (const s of list) {
      if (!map.has(s.body_key))
        map.set(s.body_key, { key: s.body_key, label_en: s.body_en, label_es: s.body_es, sort: s.body_sort, level: s.level, district: s.district, items: [] });
      map.get(s.body_key).items.push(s);
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  };

  const byDistrict = {};
  const byCommittee = {};
  for (const s of current) {
    if (s.district) (byDistrict[s.district] ||= []).push(s);
    if (s.committee) (byCommittee[s.committee] ||= []).push(s);
  }

  const vacancies = current.filter((s) => s.open);
  return {
    panel,
    previousPanel,
    current,
    previous,
    officers: current.filter((s) => s.level === "area"),
    byDistrict,
    byCommittee,
    bodies: group(current),
    previousBodies: group(previous),
    vacancies,
    stats: {
      total: current.length,
      filled: current.filter((s) => s.filled).length,
      open: vacancies.length,
      officers: current.filter((s) => s.level === "area").length,
      committeeSeats: current.filter((s) => s.committee && s.level !== "area").length,
      districtSeats: current.filter((s) => s.level === "district").length,
      districts: Object.keys(byDistrict).length,
    },
  };
}

export default function () {
  return loadServants();
}

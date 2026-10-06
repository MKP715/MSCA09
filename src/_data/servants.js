// The Area's trusted servants, from data/trusted-servants.csv.
//
// One row per service position: Area officers, committee chairs and support
// positions, district officers — for the current panel and the previous one.
// ANONYMITY (Tradition Eleven): the CSV holds first name + last initial only and
// service (role) e-mail addresses only. Nothing else about a person is published.
//
// Shape (BUILD-SPEC §9.4):
//   { panel, previousPanel, current:[Servant], previous:[Servant], officers:[Servant],
//     byDistrict:{slug:[Servant]}, byCommittee:{slug:[Servant]},
//     bodies:[{ key, label_en, label_es, sort, level, district, items }], previousBodies:[…],
//     vacancies:[Servant], stats:{ filled, open, total, officers, committeeSeats, districtSeats, districts } }
//   Servant = { panel, level, body_en, body_es, body_key, body_sort, position_en, position_es,
//               role_en, role_es (same as position_*), position_sort, name, email, email_alt,
//               district, committee, language, status, open, filled, unnamed, unconfirmed, completed, notes }
//   status: Filled | Open | Unnamed (role mailbox only) | Unconfirmed (pages mark the name "to be confirmed",
//   or say "name to be confirmed" when the name column is empty) | Completed.
import { readCsv, num } from "../_lib/csv.js";

const slugify = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Normalise the status column: Filled | Open | Unnamed | Unconfirmed | Completed. */
function normStatus(row) {
  const s = String(row.status || "").trim().toLowerCase();
  if (/^(open|vacant|vacante|abierto)/.test(s)) return "Open";
  if (/^unnamed/.test(s)) return "Unnamed";
  if (/^(unconfirmed|to confirm|tbc|por confirmar)/.test(s)) return "Unconfirmed";
  if (/^complet/.test(s)) return "Completed";
  if (!row.name && !s) return "Open";
  return "Filled";
}

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
const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|att|sbcglobal|comcast|cox|verizon|charter|protonmail|proton)\.[a-z.]+$/i;
const AREA_MAIL = /@msca09aa\.org$/i;
function altEmail(email, alt) {
  const e = String(email || "").trim();
  const a = String(alt || "").trim();
  if (!a || a.toLowerCase() === e.toLowerCase()) return "";
  if (AREA_MAIL.test(e) && FREE_MAIL.test(a)) return "";
  return a;
}

// (Only a default export: Eleventy would otherwise expose the whole module.)
function loadServants() {
  const settings = {};
  for (const r of readCsv("settings.csv")) if (r.key) settings[r.key] = r.value;
  const rows = readCsv("trusted-servants.csv").filter((r) => r.panel && /^\d+$/.test(r.panel));

  const panels = [...new Set(rows.map((r) => num(r.panel)))].sort((a, b) => b - a);
  const panel = num(settings.panel, panels[0] || 0);
  const previousPanel = num(settings.previous_panel, panels.find((p) => p < panel) || 0);

  const all = rows.map((r) => {
    const status = normStatus(r);
    const name = status === "Open" ? "" : safeName(r.name);
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
      email_alt: altEmail(r.email, r.email_alt),
      district: r.district || "",
      committee: r.committee || "",
      language: r.language || "",
      status,
      open: status === "Open",
      // Unconfirmed: someone serves, but the name still has to be confirmed by the Area
      filled: status === "Filled" || status === "Unconfirmed",
      unnamed: status === "Unnamed",
      unconfirmed: status === "Unconfirmed",
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

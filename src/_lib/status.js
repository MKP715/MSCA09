// The status of a seat in data/trusted-servants.csv, read the same way by the site (src/_data/servants.js)
// and by the site check (scripts/check-site.mjs, which guards a servant's own address by it).
//
//   normStatus(row)        → Filled | Open | Unnamed | Unconfirmed | Unknown | Completed
//   holdsSeat(row, panel)  → true for a named servant on a Filled or Unconfirmed row of that panel
import { num } from "./csv.js";

/** Normalise the status column: Filled | Open | Unnamed | Unconfirmed | Unknown | Completed. */
export function normStatus(row) {
  const s = String(row.status || "").trim().toLowerCase();
  if (/^(open|vacant|vacante|abierto)/.test(s)) return "Open";
  if (/^unnamed/.test(s)) return "Unnamed";
  if (/^(unconfirmed|to confirm|tbc|por confirmar)/.test(s)) return "Unconfirmed";
  if (/^(unknown|not provided|pending|sin informaci)/.test(s)) return "Unknown";
  if (/^complet/.test(s)) return "Completed";
  if (!row.name && !s) return "Open";
  return "Filled";
}

/** A named servant who holds the seat now: a Filled or Unconfirmed row of that panel (an empty status with a name is Filled). */
export function holdsSeat(row, panel) {
  const status = normStatus(row);
  return String(row.name || "").trim() !== "" && (status === "Filled" || status === "Unconfirmed") && num(row.panel) === num(panel);
}

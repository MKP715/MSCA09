// Area motions, from data/motions.csv.
// Columns: id, panel, date_introduced, title_en, title_es, summary_en, summary_es, status,
//          decided_date, body, vote, background_url, agenda_url_en, agenda_url_es, notes, label_en, label_es
// status = new business | old business | passed | failed | tabled | withdrawn
//
// A motion of an EARLIER panel that is still "new", "old" or "tabled" in the CSV is shown as
// "Result not recorded" (grey, in its own archive column) — not as waiting for a vote — until the
// Secretary records the result from the approved minutes. Only the current panel's open motions
// (data/settings.csv → panel) count as "on the floor".
import { readCsv } from "../_lib/csv.js";

// Board columns, in display order. Colours are palette names (see src/_lib/filters.js).
// Labels: data/text/service.csv → service.motions.status_<key>; label_en/_es here are fallbacks.
const STATUSES = [
  { key: "new", label_en: "New business", label_es: "Asuntos nuevos", color: "sun", icon: "sparkles", open: true },
  { key: "old", label_en: "Old business", label_es: "Asuntos pendientes", color: "ocean", icon: "messages-square", open: true },
  { key: "passed", label_en: "Passed", label_es: "Aprobadas", color: "sage", icon: "circle-check", open: false },
  { key: "tabled", label_en: "Tabled", label_es: "Aplazadas", color: "lilac", icon: "circle-pause", open: false },
  { key: "failed", label_en: "Failed", label_es: "Rechazadas", color: "coral", icon: "circle-x", open: false },
  { key: "withdrawn", label_en: "Withdrawn", label_es: "Retiradas", color: "slate", icon: "undo-2", open: false },
  { key: "unrecorded", label_en: "Result not recorded", label_es: "Resultado no registrado", color: "stone", icon: "file-question", open: false, archive: true },
];

function statusKey(raw) {
  const s = String(raw || "").toLowerCase();
  if (/new|nuev/.test(s)) return "new";
  if (/old|pend|anterior/.test(s)) return "old";
  if (/pass|carri|approv|aprob/.test(s)) return "passed";
  if (/fail|defeat|rechaz|lost/.test(s)) return "failed";
  if (/tabl|postpon|aplaz/.test(s)) return "tabled";
  if (/withdr|retir/.test(s)) return "withdrawn";
  return "old";
}

function bodyKey(raw) {
  const s = String(raw || "").toLowerCase();
  if (/assembl|asa|asamb/.test(s)) return "asa";
  if (/asc|csa|committee|comit/.test(s)) return "asc";
  return "";
}

export default function () {
  const rows = readCsv("motions.csv");
  const statusMap = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
  // the current panel (data/settings.csv → panel)
  const setting = readCsv("settings.csv").find((r) => r.key === "panel");
  const currentPanel = String((setting && setting.value) || "").replace(/\D/g, "");

  const list = rows
    .filter((r) => r.id || r.title_en)
    .map((r) => {
      const panel = String(r.panel || "").replace(/\D/g, "");
      const recorded = statusKey(r.status);
      // still undecided in the CSV, but its panel is over → archive, not "waiting for a vote"
      const stale = ["new", "old", "tabled"].includes(recorded) && currentPanel && panel && panel !== currentPanel;
      const status = stale ? "unrecorded" : recorded;
      return {
        ...r,
        id: r.id || "",
        panel,
        status,
        // what the CSV says (shown on "result not recorded" cards as the last known step)
        recordedStatus: recorded,
        recordedInfo: statusMap[recorded],
        statusInfo: statusMap[status],
        bodyKey: bodyKey(r.body),
        sortDate: r.decided_date || r.date_introduced || "",
        year: (r.decided_date || r.date_introduced || "").slice(0, 4),
        open: statusMap[status].open,
        current: !currentPanel || panel === currentPanel,
      };
    })
    // newest first
    .sort((a, b) => (b.sortDate || "").localeCompare(a.sortDate || "") || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s.key, list.filter((m) => m.status === s.key)]));
  const panels = [...new Set(list.map((m) => m.panel).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  const counts = Object.fromEntries(STATUSES.map((s) => [s.key, byStatus[s.key].length]));
  // "on the floor" = open motions of the current panel. Because open motions of earlier panels become
  // "unrecorded", open.length always equals counts.new + counts.old (the hero and the tiles agree).
  const open = list.filter((m) => m.open);
  // the current panel's counts (for the panel the board opens on)
  const current = list.filter((m) => m.current);
  const currentCounts = Object.fromEntries(STATUSES.map((s) => [s.key, current.filter((m) => m.status === s.key).length]));

  return {
    statuses: STATUSES,
    list,
    byStatus,
    counts,
    currentCounts,
    panels,
    open,
    openAll: open,
    unrecorded: byStatus.unrecorded,
    currentPanel,
    total: list.length,
  };
}

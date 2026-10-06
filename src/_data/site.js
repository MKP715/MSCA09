// Site-wide settings from data/settings.csv (columns: key, value, notes),
// plus facts about this build.
import { readCsv } from "../_lib/csv.js";
import { TZ } from "../_lib/filters.js";
import { DateTime } from "luxon";

export default function () {
  const settings = {};
  for (const row of readCsv("settings.csv")) if (row.key) settings[row.key] = row.value;

  const now = DateTime.now().setZone(TZ);
  const url = (process.env.SITE_URL || settings.site_url || "https://msca09aa.org").replace(/\/$/, "");

  return {
    ...settings,
    url,
    // Path prefix when served from https://<user>.github.io/<repo>/ (set by the deploy workflow).
    base: (process.env.ELEVENTY_PATH_PREFIX || "/").replace(/\/?$/, "/"),
    timezone: TZ,
    build: {
      iso: now.toISO(),
      date: now.toISODate(),
      year: now.year,
      ms: now.toMillis(),
      label: now.toFormat("yyyy-LL-dd HH:mm ZZZZ"),
      sha: (process.env.GITHUB_SHA || "").slice(0, 7),
      run: process.env.GITHUB_RUN_ID || "",
    },
    repo: settings.github_repo || process.env.GITHUB_REPOSITORY || "",
    // Branch the footer's "Edit this page" links open (optional github_branch row in settings.csv).
    branch: settings.github_branch || "main",
  };
}

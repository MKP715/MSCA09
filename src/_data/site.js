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

  // The mailing address in parts ("Irvine, CA 92619-1446" → city, state, ZIP code) for the Organization
  // markup in base.njk. When mailing_city is not written that way, the markup leaves the address out.
  const m = String(settings.mailing_city || "").trim().match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  const mailing = { mailing_locality: m ? m[1].trim() : "", mailing_region: m ? m[2] : "", mailing_postal: m ? m[3] : "" };

  return {
    ...settings,
    ...mailing,
    postalAddress: m && settings.mailing_po_box
      ? {
          "@type": "PostalAddress",
          streetAddress: settings.mailing_po_box,
          addressLocality: mailing.mailing_locality,
          addressRegion: mailing.mailing_region,
          postalCode: mailing.mailing_postal,
          addressCountry: "US",
        }
      : undefined,
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
    // The installable app (settings.csv "app"; scripts/build-pwa.mjs): on unless the row says off
    appOn: !/^(off|no|false|0)$/i.test(String(settings.app || "on").trim()),
    repo: settings.github_repo || process.env.GITHUB_REPOSITORY || "",
    // Branch the footer's "Edit this page" links open (optional github_branch row in settings.csv).
    branch: settings.github_branch || "main",
  };
}

// /assets/data/documents.json — the whole document library in a compact form, for the
// instant search and filters on /documents/ (assets/js/documents.js). Both languages share it.
//
// Row keys (kept short: ~2,500 rows):
//   i id · t title · e Spanish title (only when different) · c category key · a 1 = archive collection
//   d date (YYYY-MM-DD or YYYY-MM) · y year · l language (en|es|bi) · f format key · z size in KB
//   g Google Drive file id (the link is https://drive.google.com/file/d/<g>/view) · u any other link
//   D district slug · C committee slugs (;-joined) · m meeting type (ASC, ASA, Board …)
//   p pair number: the English and Spanish copies of one document share it (shown as one card)
//   s 1 = kept by the Area 09 Archives Committee (msca09aa-archives.org)
import { docLang } from "../_lib/plugins/documents.js";

export default class {
  data() {
    return {
      permalink: "/assets/data/documents.json",
      eleventyExcludeFromCollections: true,
      layout: null,
    };
  }

  render({ documents, site }) {
    const all = (documents && documents.all) || [];
    // Same shelf, date and title in another language = one document in two versions (as docPairs does).
    const pairKey = (d) => [d.category, d.date || d.year, String(d.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()].join("|");
    const groups = new Map();
    all.forEach((d, i) => {
      const k = pairKey(d);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    const pairOf = new Map();
    let n = 0;
    for (const idx of groups.values()) {
      const langs = new Set(idx.map((i) => docLang(all[i].language) || "?"));
      if (idx.length > 1 && langs.size === idx.length) {
        n++;
        idx.forEach((i) => pairOf.set(i, n));
      }
    }
    const rows = all.map((d, i) => {
      const r = { i: d.id, t: d.title, c: d.category };
      if (d.title_es) r.e = d.title_es;
      if (d.collection === "archive") r.a = 1;
      if (d.date) r.d = d.date;
      if (d.year) r.y = Number(d.year);
      const l = docLang(d.language);
      if (l) r.l = l;
      if (d.fmt) r.f = d.fmt;
      if (d.size_kb) r.z = d.size_kb;
      const drive = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})\/view$/.exec(d.url || "");
      if (drive) r.g = drive[1];
      else r.u = d.url;
      if (d.district) r.D = d.district;
      if (d.committees && d.committees.length) r.C = d.committees.join(";");
      if (d.meeting_type) r.m = d.meeting_type;
      if (pairOf.has(i)) r.p = pairOf.get(i);
      if (d.archives) r.s = 1;
      return r;
    });
    return JSON.stringify({ v: 1, built: site && site.build ? site.build.iso : "", count: rows.length, rows });
  }
}

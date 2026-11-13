// The photo banner at the top of the home page, from data/hero.csv.
//
// Columns: order, file, file_mobile, alt_en, alt_es, credit_en, credit_es, source_url, license,
//          license_url, position_desktop, position_mobile, start, end
//  - file: a photo in src/assets/img/hero/ (at least 2560 px wide; the site makes the smaller sizes)
//  - file_mobile (optional): an upright photo in the same folder to show on phones instead.
//    When it is empty, phones get a tall crop of `file`, cut around position_mobile
//    (src/_lib/plugins/home.js, homeHeroPicture).
//  - position_desktop / position_mobile: which part of the photo stays in view when it is
//    cropped, as "left% top%" (e.g. "50% 30%"). Phones show a tall crop, desktops a wide one.
//  - start / end (YYYY-MM-DD, optional): show the photo only between these dates (seasonal photos)
//  - the first live row is the photo everyone sees first (and the only one for people who
//    turn off animations); the others cross-fade in turn.
import fs from "node:fs";
import path from "node:path";
import { readCsv, num, isLive } from "../_lib/csv.js";

const HERO_DIR = path.join(process.cwd(), "src", "assets", "img", "hero");

export default function () {
  const slides = readCsv("hero.csv")
    .filter((r) => r.file)
    .filter((r) => {
      const ok = fs.existsSync(path.join(HERO_DIR, r.file));
      if (!ok) console.warn(`[hero] data/hero.csv row ${r._row}: no file src/assets/img/hero/${r.file} — row skipped`);
      if (ok && r.file_mobile && !fs.existsSync(path.join(HERO_DIR, r.file_mobile))) {
        console.warn(`[hero] data/hero.csv row ${r._row}: no file src/assets/img/hero/${r.file_mobile} — phones get a crop of ${r.file}`);
        r.file_mobile = "";
      }
      return ok;
    })
    .filter((r) => isLive(r))
    .map((r) => ({
      ...r,
      order: num(r.order, 999),
      src: `src/assets/img/hero/${r.file}`,
      posDesktop: r.position_desktop || "50% 50%",
      posMobile: r.position_mobile || r.position_desktop || "50% 50%",
    }))
    .sort((a, b) => a.order - b.order);

  return { slides, first: slides[0] || null };
}

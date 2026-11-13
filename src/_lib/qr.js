// QR codes drawn at build time: an inline <svg> of dark squares, made from the address it opens.
// No picture file, no outside QR service, and the code always matches the address in the data.
// Used by the {{ url | qrSvg(label, classes) }} filter (src/_lib/filters.js).
import QRCode from "qrcode";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The QR code of `text` as an <svg> string ("" when there is no text).
 * label = what a screen reader says ("QR code: District 8 on Venmo"); cls = classes for the <svg>.
 * Quiet zone: `margin` modules of light around the code (scanners need some; 2 is enough on a white card).
 */
export function qrSvg(text, { label = "", cls = "", dark = "#0d2b36", light = "#ffffff", margin = 2 } = {}) {
  if (!text) return "";
  const { modules } = QRCode.create(String(text), { errorCorrectionLevel: "M" });
  const n = modules.size;
  const full = n + margin * 2;
  // one path: each run of dark squares in a row is one rectangle (smaller than one rect per square)
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(y, x)) continue;
      let run = 1;
      while (x + run < n && modules.get(y, x + run)) run++;
      d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : `aria-hidden="true"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" ${a11y}${cls ? ` class="${esc(cls)}"` : ""}>` +
    `<rect width="${full}" height="${full}" fill="${light}"/><path fill="${dark}" d="${d}"/></svg>`
  );
}

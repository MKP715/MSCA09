// Seventh Tradition online: the PayPal, Venmo and Zelle columns of data/districts.csv (paypal_url, venmo, zelle_email,
// zelle_qr). Read by src/_data/districts.js (what the district page shows) and scripts/check-site.mjs (what may be
// published): a payment link must lead to PayPal, Venmo or Zelle themselves, so anything else is left off the page and
// stops a deploy.

/**
 * paypal_url → the address to link to: "" when empty, null when it is not a PayPal donation-button page.
 * Only https://www.paypal.com/donate/?hosted_button_id=… is accepted: the district page's wording describes that page
 * (its Donate with PayPal / Venmo / Debit or Credit Card buttons, no PayPal account needed). A PayPal.Me link needs an
 * account and has none of those buttons, and it carries a person's or account's name — so it is refused too.
 */
export function paypalUrl(cell) {
  const s = String(cell || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    const ok =
      u.protocol === "https:" &&
      /^(www\.)?paypal\.com$/i.test(u.hostname) &&
      !u.port &&
      !u.username &&
      !u.password &&
      /^\/donate\/?$/i.test(u.pathname) &&
      /^[A-Z0-9]{6,}$/i.test(u.searchParams.get("hosted_button_id") || "");
    if (ok) return u.href;
  } catch {}
  return null;
}

/**
 * venmo → the Venmo username without "@": "" when empty, null when it is not one.
 * Venmo usernames are 5–30 letters, digits, - or _. "@username" and the profile link "https://venmo.com/u/username"
 * (or account.venmo.com/u/…) are read as username; any other venmo.com page (…/about, …/settings) is refused.
 */
export function venmoHandle(cell) {
  const s = String(cell || "").trim();
  if (!s) return "";
  const m =
    s.match(/^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/u\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i) ||
    s.match(/^@?([A-Za-z0-9_-]+)$/);
  return m && m[1].length >= 5 && m[1].length <= 30 ? m[1] : null;
}

/**
 * Does a Venmo username name a service role? It is published as written, so a treasurer's own account
 * ("First-Last-1234") would publish a member's full name. One of its parts (split at - and _, e.g. "AreaNine-D8" →
 * AreaNine, D8) must START with a role word — district, dist8, d8, msca, area, treas…; a role word inside a name
 * ("Davina", "Cecilia") does not count. scripts/check-site.mjs also runs the full-name detector on it.
 */
const ROLE_START = /^(district|distrito|dist\d|d\d|msca|area|treas|tesor|dcm|gsr|rsg|intergroup|office|oficina|committee|comit|seventh|7th)/i;
export const venmoRoleLike = (handle) => String(handle || "").split(/[-_]+/).some((part) => ROLE_START.test(part));

/** The Venmo profile page of a username (opens the Venmo app on a phone that has it). */
export const venmoUrl = (handle) => (handle ? `https://venmo.com/u/${handle}` : "");

/**
 * zelle_email → the e-mail ID the district's Zelle account uses, lower-cased: "" when empty, null when it is not an
 * e-mail address. It is published as written, so (like every address on the site) it must be a role mailbox:
 * scripts/check-site.mjs checks it against data/contact-allowlist.csv.
 */
export function zelleEmail(cell) {
  const s = String(cell || "").trim().toLowerCase();
  if (!s) return "";
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/**
 * What a Zelle QR code holds: https://enroll.zellepay.com/qr-codes?data=<base64 of {"name","action","token"}>.
 * Returns { name, token, action } or null when the address is not a Zelle QR address.
 */
export function zelleQrData(cell) {
  const s = String(cell || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !/^enroll\.zellepay\.com$/i.test(u.hostname) || u.port || u.username || u.password) return null;
    if (!/^\/qr-codes\/?$/i.test(u.pathname)) return null;
    // exactly one parameter (data) and no #fragment: a second data= could hold another payee
    if (u.hash || [...u.searchParams.keys()].join(",") !== "data") return null;
    // URLSearchParams reads a raw "+" as a space; base64 never holds a space, so it goes back to "+"
    const data = (u.searchParams.get("data") || "").replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
    const buf = Buffer.from(data, "base64");
    // strict: Node's decoder stops at padding, so anything glued after it would be ignored here but read by a scanner
    if (buf.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) return null;
    const o = JSON.parse(buf.toString("utf8"));
    if (!o || typeof o !== "object" || Array.isArray(o) || typeof o.token !== "string" || o.action !== "payment") return null;
    return { name: String(o.name || ""), token: o.token.trim().toLowerCase(), action: o.action };
  } catch {
    return null;
  }
}

/**
 * zelle_qr → the address the district's own Zelle QR code holds (copied from its QR picture), to draw the code again
 * at build time: "" when empty, null when it is not a Zelle QR address or it pays someone other than zelle_email
 * (a QR code that sends money elsewhere must never be shown).
 */
export function zelleQr(cell, email) {
  const s = String(cell || "").trim();
  if (!s) return "";
  const q = zelleQrData(s);
  if (!(q && email && q.token === String(email).trim().toLowerCase())) return null;
  // draw only what was checked: the address is rebuilt from the decoded payload (the same bytes for a bank's own code)
  return "https://enroll.zellepay.com/qr-codes?data=" + Buffer.from(JSON.stringify({ name: q.name, action: q.action, token: q.token }), "utf8").toString("base64");
}

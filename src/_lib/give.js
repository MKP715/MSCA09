// Seventh Tradition online: the PayPal and Venmo columns of data/districts.csv (paypal_url, venmo).
// Read by src/_data/districts.js (what the district page shows) and scripts/check-site.mjs (what may be published):
// a payment link must lead to PayPal or Venmo themselves, so anything else is left off the page and stops a deploy.

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

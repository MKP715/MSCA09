// robots.txt for the scripts that read the central offices' websites (scripts/office-events.mjs and
// `scripts/check-media.mjs --office-flyers`), as RFC 9309 (the Robots Exclusion Protocol) says:
//
// - The group that applies is the one whose User-agent names this crawler's product token, MSCA09-site-builder
//   (case does not matter; "MSCA09-site-builder/1.0" names it too). A group for a shorter name that the token
//   starts with, up to a hyphen ("MSCA09", "MSCA09-site"), is honoured when no group names the full token; then the
//   "*" group; with none of these, nothing is disallowed. Several groups for the same name are combined. An empty
//   User-agent value, or one that is only part of the token ("site", "builder"), names no one.
// - Allow and Disallow: the rule with the longest path that matches wins; an Allow wins a tie. "*" matches any
//   characters and a "$" at the end anchors the path's end. /robots.txt itself is always allowed.
// - The answer to GET /robots.txt: 2xx = parse it (the first 500 KiB); 4xx = the file is "unavailable", everything
//   is allowed (except 429 Too Many Requests, below); 5xx, 429, a timeout or a failed connection = "unreachable",
//   everything is disallowed for this run (RFC 9309 section 2.3.1.4). Redirects are followed by fetch.
// - Crawl-delay (not in the RFC, but sites use it: oc-aa.org asks 20 s) is kept as `delay` in seconds; the larger
//   value wins when groups are combined.
//
// Pure except fetchRobots, which makes the one request (fetch is passed in, or the global one).
//
//   parseRobots(text, token?)          -> { agents: [names], rules: [{ allow, path }], delay }
//   robotsAllows(robots, url)          -> true | false
//   robotsFromResponse(status, text)   -> the same object plus { status, unreachable, error }
//   fetchRobots(origin, { ua, timeoutMs, fetchImpl }) -> robotsFromResponse(...) of the site's /robots.txt

export const ROBOTS_TOKEN = "MSCA09-site-builder";
export const ROBOTS_MAX_BYTES = 500 * 1024;

const allowAll = () => ({ agents: [], rules: [], delay: 0 });
const disallowAll = () => ({ agents: [], rules: [{ allow: false, path: "/" }], delay: 0 });

/** The product token at the start of a User-agent value, lower case ("MSCA09-site-builder/1.0" -> "msca09-site-builder"). */
function agentName(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v.startsWith("*")) return "*";
  return (/^[a-z0-9_-]+/.exec(v) || [""])[0];
}

/**
 * How well a User-agent name fits our token: the token's length for the token itself, the name's length for a
 * shorter name the token starts with up to a hyphen, 0 for "*", -1 for anything else (an empty name too).
 */
function fit(name, token) {
  if (!name) return -1;
  if (name === "*") return 0;
  if (name === token) return token.length;
  if (token.startsWith(name + "-")) return name.length;
  return -1;
}

/** The rules of a robots.txt that apply to `token` (MSCA09-site-builder unless another is given). */
export function parseRobots(text, token = ROBOTS_TOKEN) {
  const me = String(token || ROBOTS_TOKEN).toLowerCase();
  const groups = [];
  let cur = null;
  let inAgents = false; // the line before was a User-agent line (the next one joins the same group)
  for (const raw of String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !inAgents) groups.push((cur = { names: [], rules: [], delay: 0 }));
      const name = agentName(val);
      if (name) cur.names.push(name);
      inAgents = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      inAgents = false;
      if (cur) cur.rules.push({ allow: key === "allow", path: val });
    } else if (key === "crawl-delay") {
      inAgents = false;
      const n = Number(val);
      if (cur && Number.isFinite(n) && n > 0) cur.delay = Math.max(cur.delay, n);
    }
    // Sitemap and unknown lines belong to no group and do not end one
  }
  let best = -1;
  for (const g of groups) for (const n of g.names) best = Math.max(best, fit(n, me));
  if (best < 0) return allowAll();
  const mine = groups.filter((g) => g.names.some((n) => fit(n, me) === best));
  return {
    agents: [...new Set(mine.flatMap((g) => g.names.filter((n) => fit(n, me) === best)))],
    rules: mine.flatMap((g) => g.rules),
    delay: Math.max(0, ...mine.map((g) => g.delay)),
  };
}

const UNRESERVED = /%([0-9A-Fa-f]{2})/g;
/** Percent-encoding made comparable: non-ASCII characters encoded, %xx in upper case, unreserved ones decoded. */
function normPath(p) {
  return String(p)
    .replace(/[^\x00-\x7f]+/g, (s) => encodeURIComponent(s))
    .replace(UNRESERVED, (all, hex) => {
      const c = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
    });
}
function ruleRegex(path) {
  const p = normPath(path);
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** May `url` be read under these rules? (The object from parseRobots / robotsFromResponse / fetchRobots.) */
export function robotsAllows(robots, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.pathname === "/robots.txt") return true;
  const target = normPath(u.pathname + u.search);
  let best = null;
  for (const r of (robots && robots.rules) || []) {
    if (!r || !r.path) continue; // "Disallow:" with nothing after it disallows nothing
    let re;
    try {
      re = ruleRegex(r.path);
    } catch {
      continue;
    }
    if (!re.test(target)) continue;
    const len = normPath(r.path).length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: !!r.allow };
  }
  return !best || best.allow;
}

/** The rules that follow from the answer to GET /robots.txt (status 0 = no answer: timeout or no connection). */
export function robotsFromResponse(status, text = "", error = "") {
  const s = Number(status) || 0;
  if (s >= 200 && s < 300) return { ...parseRobots(String(text || "").slice(0, ROBOTS_MAX_BYTES)), status: s, unreachable: false, error: "" };
  if (s >= 300 && s < 500 && s !== 429) return { ...allowAll(), status: s, unreachable: false, error: "" };
  return { ...disallowAll(), status: s, unreachable: true, error: error || (s ? `HTTP ${s}` : "no answer") };
}

/**
 * Read a site's robots.txt once: `origin` is the site ("https://www.example.org", or any address on it).
 * ua = the User-Agent to send (callers pass OFFICE_UA from scripts/lib/media-read.mjs). Never throws.
 */
export async function fetchRobots(origin, { ua = ROBOTS_TOKEN, timeoutMs = 20000, fetchImpl } = {}) {
  let url;
  try {
    url = new URL("/robots.txt", origin).href;
  } catch {
    return robotsFromResponse(0, "", "not a web address");
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r;
    try {
      r = await doFetch(url, { redirect: "follow", signal: ctrl.signal, referrerPolicy: "no-referrer", headers: { "user-agent": ua, accept: "text/plain,*/*;q=0.5" } });
    } catch (e) {
      return robotsFromResponse(0, "", ctrl.signal.aborted ? "timeout" : `could not connect (${String(e?.cause?.code || e?.message || e).slice(0, 60)})`);
    }
    if (!(r.status >= 200 && r.status < 300)) {
      r.body?.cancel().catch(() => {});
      return robotsFromResponse(r.status);
    }
    // the first 500 KiB are enough (RFC 9309 section 2.5); the rest is not read
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of r.body || []) {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= ROBOTS_MAX_BYTES) break; // leaving the loop cancels the rest of the download
      }
    } catch {
      if (size < ROBOTS_MAX_BYTES) return robotsFromResponse(0, "", ctrl.signal.aborted ? "timeout" : "download interrupted");
    }
    const text = new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, ROBOTS_MAX_BYTES));
    return robotsFromResponse(r.status, text);
  } finally {
    clearTimeout(timer);
  }
}

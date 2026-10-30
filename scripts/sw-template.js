/*
  MSCA09 — the service worker of the installable app. scripts/build-pwa.mjs writes it to the site as /sw.js, with CONFIG
  filled in (the path prefix, the Workbox version, the files kept for offline use). Edit this template, never _site/sw.js;
  README "The app" explains the whole thing.

  What it does, by kind of request (anything not listed goes to the network untouched):
    pages            network first, always revalidated, so a visitor online sees the newest page at every click; a copy
                     of each page opened is kept (80 pages, 30 days from its last download) and shown offline; on a
                     very slow connection a copy downloaded within the hour stands in after 4 s; a page never opened
                     shows /offline/ (/es/offline/). Saving a copy never decides what the visitor sees
    files with ?v=   cache first: asset-hash.mjs gives them a new address whenever they change. GitHub's servers ignore
                     the ?v=, so each file's SHA-1 is checked against its address before it is kept
    offline set      the offline pages and what they and the home pages load (styles, scripts, fonts, logo), kept at
                     install (Workbox precaching; each file checked against its SHA-256, the offline pages against
                     their fingerprint)
    search index     Pagefind's chunks (their names change with their content): cache first
    other code/data  scripts, styles and data without a version (events.json, Pagefind's entry …): network first, the
                     last copy offline
    images, fonts    from the cache at once, refreshed in the background
    flyers           Drive pictures (lh3.googleusercontent.com): always from Drive while online (through the browser's
                     own cache), so a flyer replaced or removed on Drive is never shown from here; the copy is for
                     offline use only, for 7 days from its last download (at most 120)
  A new sw.js takes over at once (skipWaiting + clientsClaim); open pages keep working and update themselves (pwa.js).
*/
/* global workbox */
"use strict";

const CONFIG = /*__MSCA_CONFIG__*/ { base: "/", wb: "0.0.0", precache: [] };
const BASE = CONFIG.base;

importScripts(
  ...["core", "routing", "strategies", "precaching", "expiration"].map(
    (m) => `${BASE}assets/vendor/workbox-${CONFIG.wb}/workbox-${m}.prod.js`,
  ),
);
const { core, routing, strategies, precaching, expiration } = workbox;

core.setCacheNameDetails({ prefix: "msca", suffix: "v1", precache: "precache", runtime: "runtime" });
self.addEventListener("install", () => self.skipWaiting());
core.clientsClaim();

const PAGES = "msca-pages-v1";
const ASSETS = "msca-assets-v1";
const CODE = "msca-code-v1";
const STATIC = "msca-static-v1";
const SEARCH = "msca-search-v1";
const FLYERS = "msca-flyers-v1";
const DAY = 24 * 60 * 60;
const pagesExpiry = new expiration.CacheExpiration(PAGES, { maxEntries: 80, maxAgeSeconds: 30 * DAY });
const flyersExpiry = new expiration.CacheExpiration(FLYERS, { maxEntries: 120, maxAgeSeconds: 7 * DAY });

const sameOrigin = (url) => url.origin === self.location.origin;
const inSite = (url) => sameOrigin(url) && url.pathname.startsWith(BASE);
const inBase = (url) => url.pathname.slice(BASE.length); // "calendar/", "assets/css/site.css" …
const quiet = () => {};

// Requests left alone whatever their address: the page's own update check (version.json, sw.js), downloads of parts of
// a file (Range), requests that must not use a cache (no-store, reload), and the odd only-if-cached request.
function handled(request) {
  if (request.headers.has("range")) return false;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return false;
  if (request.mode !== "navigate" && (request.cache === "no-store" || request.cache === "reload")) return false;
  return !/\/(sw\.js|version\.json)$/.test(new URL(request.url).pathname);
}

// a complete answer from this site (not an error, not another site's, not a redirect)
const okOnly = {
  cacheWillUpdate: async ({ response }) => (response && response.status === 200 && response.type === "basic" && !response.redirected ? response : null),
};
async function sha(algorithm, response) {
  const bytes = new Uint8Array(await crypto.subtle.digest(algorithm, await response.clone().arrayBuffer()));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
// a file at an address with ?v=<first 8 hex characters of its SHA-1> is kept only when its content has that SHA-1
const sameHash = {
  cacheWillUpdate: async ({ request, response }) => {
    if (!(await okOnly.cacheWillUpdate({ response }))) return null;
    const want = new URL(request.url).searchParams.get("v");
    return (await sha("SHA-1", response)).startsWith(want) ? response : null;
  },
};
// offline, an address whose exact version was never kept: any kept version of the same file (an older page)
const anyVersion = {
  handlerDidError: async ({ request }) => (await caches.match(request.url, { ignoreSearch: true })) || undefined,
};
// one cache entry per file, whatever the query (Pagefind adds ?ts=… to its entry file)
const withoutQuery = {
  cacheKeyWillBeUsed: async ({ request }) => {
    const url = new URL(request.url);
    url.search = "";
    return url.href;
  },
};

/* ---------------------------------------------------------------- offline set */
// The offline pages carry the build's fingerprint and date, which change with every build, so they are checked by
// their own fingerprint (the list's revision) instead of an SRI hash: a copy from an older build with the same content
// is fine, one with other content is refused (the install fails and is tried again at the next update check).
// (A plugin's cacheWillUpdate replaces Workbox's own check, so it checks the status too.)
const pageRevision = new Map(CONFIG.precache.filter((e) => !e.integrity).map((e) => [new URL(e.url, self.location.href).href, e.revision]));
precaching.addPlugins([
  {
    cacheWillUpdate: async ({ request, response }) => {
      if (!response || response.status !== 200 || response.redirected) return null;
      const url = new URL(request.url);
      url.searchParams.delete("__WB_REVISION__");
      const want = pageRevision.get(url.href);
      if (!want) return response;
      const got = ((await response.clone().text()).match(/<meta name="msca-page" content="([a-p]{16})">/) || [])[1];
      return got === want ? response : null;
    },
  },
]);
precaching.precacheAndRoute(CONFIG.precache, { ignoreURLParametersMatching: [/^source$/, /^utm_/, /^fbclid$/] });

/* ---------------------------------------------------------------- pages */
// a page address: ends in "/" or ".html", or has no extension. Other navigations (.ics, .pdf, .xml …) are left alone.
const isPage = (path) => path.endsWith("/") || path.endsWith(".html") || !/\.[a-z0-9]+$/i.test(path.split("/").pop());

async function offlinePage(url) {
  const es = inBase(url).startsWith("es/");
  return (
    (await precaching.matchPrecache(`${BASE}${es ? "es/" : ""}offline/`)) ||
    new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
  );
}

// a device short of storage: give back what can be fetched again, so the pages and the offline set keep their room
const freeRoom = (error) =>
  error && error.name === "QuotaExceededError" ? Promise.all([FLYERS, STATIC, SEARCH, CODE].map((n) => caches.delete(n))).catch(quiet) : null;

async function page({ event, request, url }) {
  // one copy per page, whatever the query (?highlight=, ?district= … give the same file)
  const key = url.origin + url.pathname;
  let cache = null;
  let kept = null;
  try {
    cache = await caches.open(PAGES);
    kept = (await cache.match(key)) || (!url.pathname.endsWith("/") && (await cache.match(key + "/"))) || null;
  } catch {} // storage out of order: the network alone
  // always asked of the server (no-cache: a 304 when unchanged); redirects stay with the browser (manual). The page goes
  // to the browser as soon as it starts arriving; the copy is saved alongside and never holds it up or fails it
  const network = fetch(
    new Request(request, { cache: "no-cache", referrer: request.referrer, referrerPolicy: request.referrerPolicy }),
  ).then((response) => {
    if (cache && response.status === 200 && response.type === "basic" && /text\/html/i.test(response.headers.get("content-type") || "")) {
      const copy = response.clone();
      event.waitUntil(
        (async () => {
          await cache.put(key, copy);
          await pagesExpiry.updateTimestamp(key); // 30 days count from the last download
          await pagesExpiry.expireEntries();
        })().catch(freeRoom),
      );
    }
    return response;
  });
  event.waitUntil(network.catch(quiet));
  if (kept) {
    // offline: the copy. Online but very slow: a copy downloaded within the hour may stand in after 4 s; an older one
    // waits for the network like the plain website would (so a page changed since is never shown from an old copy)
    const age = Date.now() - (Date.parse(kept.headers.get("date") || "") || 0);
    const slow = age < 60 * 60 * 1000 ? new Promise((resolve) => setTimeout(resolve, 4000, null)) : new Promise(() => {});
    return (await Promise.race([network.catch(() => null), slow])) || kept;
  }
  try {
    return await network; // every answer as it comes: the page, the 404 page, a redirect, a server error
  } catch {
    return offlinePage(url); // only when the network itself failed
  }
}
routing.registerRoute(
  ({ request, url }) => request.mode === "navigate" && inSite(url) && isPage(url.pathname),
  page,
);

/* ---------------------------------------------------------------- files with a version in their address */
routing.registerRoute(
  ({ request, url }) => handled(request) && inSite(url) && inBase(url).startsWith("assets/") && /^[0-9a-f]{8}$/.test(url.searchParams.get("v") || ""),
  new strategies.CacheFirst({
    cacheName: ASSETS,
    plugins: [sameHash, new expiration.ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * DAY, purgeOnQuotaError: true }), anyVersion],
  }),
);

/* ---------------------------------------------------------------- the site search's index chunks */
const SEARCH_CHUNK = /^pagefind(-posts)?\/((index|fragment|filter)\/[^/]+|pagefind\.[\w-]+_[0-9a-f]+\.pf_meta)$/;
routing.registerRoute(
  ({ request, url }) => handled(request) && inSite(url) && SEARCH_CHUNK.test(inBase(url)),
  new strategies.CacheFirst({
    cacheName: SEARCH,
    plugins: [okOnly, new expiration.ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true })],
  }),
);

/* ---------------------------------------------------------------- other scripts, styles and data */
routing.registerRoute(
  ({ request, url }) => handled(request) && inSite(url) && /\.(m?js|css|json|wasm|pagefind)$/i.test(url.pathname),
  new strategies.NetworkFirst({
    cacheName: CODE,
    plugins: [okOnly, withoutQuery, new expiration.ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true })],
  }),
);

/* ---------------------------------------------------------------- images and fonts */
routing.registerRoute(
  ({ request, url }) => handled(request) && inSite(url) && /\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i.test(url.pathname),
  new strategies.StaleWhileRevalidate({
    cacheName: STATIC,
    plugins: [okOnly, new expiration.ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true })],
  }),
);

/* ---------------------------------------------------------------- flyers on Google Drive */
// Always from Drive while online (the browser's own cache keeps repeat views fast: lh3 allows a day), so a flyer that
// was replaced, held or removed on Drive is never shown from an old copy. Fetched with CORS (lh3 allows it), so the
// copy is a readable answer, not an opaque one that would take megabytes of the device's storage each; without a
// Referer, like the page's own request (base.njk: Drive serves flyers reliably only without one). The copy is for
// offline use only, for 7 days from its last download.
async function flyer({ event, request }) {
  let cache = null;
  try {
    cache = await caches.open(FLYERS);
  } catch {}
  const drop = () => cache && cache.delete(request.url, { ignoreVary: true }).catch(quiet);
  try {
    const response = await fetch(request.url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
    if (response.ok && /^image\//i.test(response.headers.get("content-type") || "")) {
      if (cache) {
        const copy = response.clone();
        event.waitUntil(
          (async () => {
            await cache.put(request.url, copy);
            await flyersExpiry.updateTimestamp(request.url);
            await flyersExpiry.expireEntries();
          })().catch(freeRoom),
        );
      }
      return response;
    }
    drop(); // Drive answered, but not with the picture (gone, no longer shared): forget the copy
    return fetch(request);
  } catch {}
  try {
    const answer = await fetch(request); // the page's own request
    drop(); // Drive answers without CORS only with an error page: forget the copy
    return answer;
  } catch {}
  // offline: the copy, unless it is more than 7 days old
  if (!cache) return Response.error();
  await flyersExpiry.expireEntries().catch(quiet);
  return (await cache.match(request.url, { ignoreVary: true })) || Response.error();
}
routing.registerRoute(
  ({ request, url }) => handled(request) && url.hostname === "lh3.googleusercontent.com" && request.destination === "image",
  flyer,
);

/* ---------------------------------------------------------------- the start pages */
// pwa.js asks once per visit: the English and Spanish home pages are kept too, so the installed app opens offline
// even for a visitor who installed it from another page. Never blocks anything; a page already kept is left as it is.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "warm" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      for (const u of data.urls) {
        const url = new URL(u, self.location.origin);
        if (!inSite(url)) continue;
        const key = url.origin + url.pathname;
        if (await cache.match(key)) continue;
        try {
          const response = await fetch(key, { credentials: "same-origin" });
          if (response.status === 200 && !response.redirected && /text\/html/i.test(response.headers.get("content-type") || "")) {
            await cache.put(key, response);
            await pagesExpiry.updateTimestamp(key);
          }
        } catch {}
      }
    })(),
  );
});

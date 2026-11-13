/*
  MSCA09 — the installable app, on every page (README "The app"). scripts/build-pwa.mjs makes the manifest, the icons,
  the service worker (scripts/sw-template.js) and the fingerprints this file reads from <meta name="msca-build"> (the
  whole site) and <meta name="msca-page"> (this page).

  - Registers the service worker: pages saved for offline use, and every page fetched fresh while online.
  - Keeps an open page up to date without the visitor reloading it. Every click already brings the newest page; a page
    left open is checked when it comes back to the screen, when the device comes back online, and every 10 minutes:
    version.json names the newest build; when it is not this page's, the newest copy of this page is fetched and its
    fingerprint compared. Only a page that really changed is reloaded, and only at a moment that cannot disturb anyone:
    while it is not on screen, or the instant it comes back (before the visitor has touched anything). Never while
    something is being typed, a window or the photo viewer is open, a recording plays, text is selected, or on a page
    with a form (data-no-auto-reload). The place on the page is kept, and screen readers hear "This page has been updated".
  - The footer's "Install the app" button (Alpine store "app"; its window: partials/app-install.njk).
  - Inside the installed app: a Back button on iPhones and iPads (header.njk), and links to other sites open in the
    browser instead of inside the app.
  - The app's launch language: the language of the last page read on this device (base.njk reads it).
  - The offline page (pages/offline.njk): which main pages are saved, "Try again", and back by itself once online.
  - With the app switched off (data/settings.csv app = off), and on a local preview (`npm start`, no fingerprints),
    any service worker of this site is unregistered and its caches emptied.
*/
(function () {
  "use strict";

  const M = (window.MSCA = window.MSCA || {});
  const html = document.documentElement;
  const meta = (name) => (document.querySelector(`meta[name="${name}"]`) || {}).content || "";
  const BUILD = meta("msca-build");
  const PAGE = meta("msca-page");
  const BASE = (html.dataset.base || "/").replace(/\/?$/, "/");
  const LANG = html.dataset.lang === "es" ? "es" : "en";
  const FINGERPRINT = /^[a-p]{16}$/;
  const live = FINGERPRINT.test(BUILD); // a published build (not `npm start`, not switched off)
  const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const hasSW = "serviceWorker" in navigator && secure;

  const storage = (kind) => {
    try {
      return window[kind];
    } catch (e) {
      return null;
    }
  };
  const get = (key, kind = "localStorage") => {
    try {
      return storage(kind).getItem(key);
    } catch (e) {
      return null;
    }
  };
  const set = (key, value, kind = "localStorage") => {
    try {
      storage(kind).setItem(key, value);
    } catch (e) {}
  };
  const del = (key, kind = "localStorage") => {
    try {
      storage(kind).removeItem(key);
    } catch (e) {}
  };

  /* ---------------------------------------------------------- inside the installed app */
  const standalone = () =>
    navigator.standalone === true ||
    ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
  const inApp = standalone();
  if (inApp) {
    html.classList.add("is-app");
    set("msca-installed", "1"); // the browser shares this storage on Android and computers: its tabs hide the install button
  }

  // iPhone / iPad app: no back button of its own. Shown only where there is a page to go back to: asked of the browser
  // where it can tell (Navigation API), else worked out from how this page was opened and kept with its history entry
  const back = document.querySelector("[data-app-back]");
  if (back && navigator.standalone === true) {
    back.addEventListener("click", () => history.back());
    const nav = window.navigation;
    if (nav && "canGoBack" in nav) {
      const sync = () => (back.hidden = !nav.canGoBack);
      sync();
      nav.addEventListener("currententrychange", sync);
    } else {
      const entry = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || {};
      let saved = null;
      try {
        saved = JSON.parse(get("msca-reloaded", "sessionStorage") || "null");
      } catch (e) {}
      const st = history.state;
      const can =
        entry.type === "navigate"
          ? history.length > 1 // a new entry is always the last one
          : entry.type === "reload" && saved && saved.at === location.pathname + location.search && typeof saved.back === "boolean"
            ? saved.back
            : !!(st && st.mscaBack); // unknown: no button (one that does nothing is worse than none)
      back.hidden = !can;
      try {
        history.replaceState(Object.assign({}, st, { mscaBack: can }), "");
      } catch (e) {}
    }
  }

  // The page is being left (a link, the back button, closing): nothing here may reload it then, or the reload would
  // replace the page the visitor is going to. Browsers send "hidden" (and sometimes "online") on the way out, and iPhones
  // send no beforeunload, so a click on a link that opens in this window counts too. Cleared when the page shows again.
  let leaving = false;
  const leave = () => (leaving = true);
  window.addEventListener("beforeunload", leave);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", () => (leaving = false));
  document.addEventListener("submit", (e) => e.defaultPrevented || leave());
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || !/^https?:$/.test(a.protocol)) return;
    if (a.origin === location.origin && a.pathname === location.pathname && a.search === location.search) return; // #part of this page
    leave();
  });
  if (window.navigation)
    window.navigation.addEventListener("navigate", (e) => {
      if (!e.destination.sameDocument && !e.downloadRequest) leave();
    });

  // links to other sites open in the browser, not inside the app window (clicks a script already handled are left alone)
  if (inApp)
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch (err) {
        return;
      }
      if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
      a.target = "_blank";
      a.rel = (a.rel ? a.rel + " " : "") + "noopener";
    });

  /* ---------------------------------------------------------- the app's language */
  // the language of the last page read on this device (base.njk opens the app in it). The offline page is shown in
  // place of other pages, so it does not count.
  const offlinePage = !!document.querySelector("[data-offline-retry]");
  if (!offlinePage) set("msca-lang", LANG);
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[hreflang]");
    // this site's language links only: aa.org pages and PDFs say which language they open in, they are not a choice
    if (a && (a.hreflang === "en" || a.hreflang === "es") && a.origin === location.origin && a.pathname.startsWith(BASE)) set("msca-lang", a.hreflang);
  });

  /* ---------------------------------------------------------- service worker */
  let registration = null;

  // switched off, or a local preview: no app here; take away any service worker of this site, its copies and its log
  // of saved addresses
  function removeApp() {
    if (!("serviceWorker" in navigator)) return;
    const wipe = () => {
      if (window.caches)
        caches
          .keys()
          .then((names) => Promise.all(names.filter((n) => n.startsWith("msca-")).map((n) => caches.delete(n))))
          .catch(() => {});
      try {
        indexedDB.deleteDatabase("workbox-expiration"); // the dates Workbox keeps per saved address
      } catch (e) {}
    };
    navigator.serviceWorker
      .getRegistrations()
      .then((list) =>
        list.forEach((r) => {
          const w = r.active || r.waiting || r.installing;
          if (r.scope !== location.origin + BASE || !w || w.scriptURL !== location.origin + BASE + "sw.js") return;
          // switched off, sw.js is the switch-off worker: installing it takes this page from the old one (so nothing
          // more is saved) and empties everything; unregister either way
          r.update()
            .catch(() => {})
            .finally(() => r.unregister().catch(() => {}));
        }),
      )
      .catch(() => {});
    wipe();
    // the old worker still answers this page until it is left: clean up again on the way out
    if (navigator.serviceWorker.controller) {
      document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && wipe());
      window.addEventListener("pagehide", wipe);
    }
  }

  function register() {
    if (!hasSW || !live) return;
    navigator.serviceWorker
      .register(BASE + "sw.js", { scope: BASE, updateViaCache: "none" })
      .then((r) => {
        registration = r;
        // once a visit: the home pages are saved too, so the app opens offline whichever page it was installed from
        const warm = () => {
          const c = navigator.serviceWorker.controller;
          if (!c || get("msca-warm", "sessionStorage")) return;
          c.postMessage({ type: "warm", urls: [BASE, BASE + "es/"] });
          set("msca-warm", "1", "sessionStorage");
        };
        if (navigator.serviceWorker.controller) warm();
        else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
      })
      .catch(() => {});
  }

  /* ---------------------------------------------------------- keeping an open page up to date */
  const EVERY = 10 * 60 * 1000; // a page on screen is checked this often
  const GAP = 60 * 1000; // never more often than this (a check that a visitor's return starts goes at once)
  const RETRY = 3 * 60 * 1000; // GitHub's servers keep a copy for up to 10 minutes: ask again after this
  const RETRIES = 5;
  let lastCheck = 0;
  let checking = null;
  let retries = 0;
  let retryTimer = 0;
  let known = BUILD; // the newest build this page has looked at
  let wanted = false; // this page changed in a newer build: reload at the next good moment
  let shownAt = Date.now();
  let touched = false; // the visitor has done something since the page came back on screen
  let stoppedFor = null; // the reload brought back the same page (an old copy on GitHub's side): wait for a newer build
  let reloading = false;

  // what each box held when the visitor first went into it: a box they changed holds their work. (Not the page's own
  // markup: scripts fill some boxes in by themselves, the document library's sort and year lists for one.)
  const before = new WeakMap();
  const valueOf = (el) =>
    el.type === "checkbox" || el.type === "radio" ? String(el.checked) : el.tagName === "SELECT" ? [...el.selectedOptions].map((o) => o.value).join("\n") : el.value;
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (e.isTrusted && el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !before.has(el)) before.set(el, valueOf(el));
  });
  const edited = new Set();
  document.addEventListener("input", (e) => e.isTrusted && edited.add(e.target), true);
  document.addEventListener("change", (e) => e.isTrusted && edited.add(e.target), true);
  // what the visitor opened on the page (a "Show more", a fold, a section): a reload would close it again
  const opened = new Set();
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted || !e.target.closest) return;
      const t = e.target.closest("[aria-expanded], summary");
      if (!t || t.closest("header, [aria-modal]")) return;
      opened.add(t.tagName === "SUMMARY" ? t.parentElement : t);
    },
    true,
  );

  // something the visitor would lose, or be startled by, if the page reloaded now
  function busy() {
    if (html.hasAttribute("data-no-auto-reload") || html.hasAttribute("data-busy")) return true;
    if (document.querySelector("iframe")) return true; // the recordings' players
    if (document.fullscreenElement || document.pictureInPictureElement) return true;
    if (document.querySelector(".pswp--open")) return true;
    for (const el of document.querySelectorAll('[aria-modal="true"]')) if (el.getClientRects().length) return true;
    for (const m of document.querySelectorAll("video, audio")) if (!m.paused) return true;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return true;
    const active = document.activeElement;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return true;
    for (const el of edited) {
      if (!el.isConnected || el.closest("[data-reload-safe]") || !el.getClientRects().length) continue;
      if (!before.has(el) || valueOf(el) !== before.get(el)) return true;
    }
    for (const el of opened) if (el.isConnected && (el.tagName === "DETAILS" ? el.open : el.getAttribute("aria-expanded") === "true")) return true;
    return false;
  }

  // the newest copy of this page, read past any copy the browser keeps: { build, page } from its fingerprints, or null
  async function newestCopy() {
    const res = await fetch(location.pathname, { cache: "no-cache", credentials: "same-origin" });
    if (!res.ok) return null;
    const text = await res.text();
    const build = (text.match(/<meta name="msca-build" content="([a-p]{16})">/) || [])[1];
    const page = (text.match(/<meta name="msca-page" content="([a-p]{16})">/) || [])[1];
    return build && page ? { build, page } : null;
  }

  // the reload itself: only once the new page really arrives (so never offline, never for a copy GitHub's servers still
  // hold from before), and only if the moment is still a good one after that
  async function reload(why) {
    if (reloading) return;
    reloading = true;
    try {
      const copy = await newestCopy();
      if (!copy || copy.page === PAGE) return;
      if (!wanted || leaving || busy()) return;
      if (!(document.visibilityState === "hidden" || (why === "resume" && !touched))) return;
      const backShown = !!(back && !back.hidden);
      set("msca-reloaded", JSON.stringify({ at: location.pathname + location.search, y: Math.round(window.scrollY), from: PAGE, to: copy.build, back: backShown, t: Date.now() }), "sessionStorage");
      location.reload();
    } catch (e) {
      // no network after all: the next good moment tries again
    } finally {
      reloading = false;
    }
  }

  // "check": a check just found a change; "resume": the page has just come back on screen; "hidden": it has just left it
  function maybeReload(why) {
    if (!wanted || stoppedFor || leaving || !navigator.onLine || busy()) return;
    if (document.visibilityState === "hidden" || (why === "resume" && Date.now() - shownAt < 2000 && !touched)) reload(why);
  }

  function check(now) {
    if (!live || !navigator.onLine || checking) return checking || Promise.resolve();
    if (!now && Date.now() - lastCheck < GAP) return Promise.resolve();
    lastCheck = Date.now();
    if (registration) registration.update().catch(() => {});
    checking = (async () => {
      try {
        const res = await fetch(BASE + "version.json", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) return;
        const newest = (await res.json()).v;
        if (!FINGERPRINT.test(newest || "")) return;
        if (stoppedFor) {
          if (newest === stoppedFor) return; // still the build whose copy came back unchanged
          stoppedFor = null;
          known = BUILD;
        }
        if (newest === known) return;
        // a newer build is out: is this page different in it?
        const copy = await newestCopy();
        if (!copy || copy.build !== newest) {
          // GitHub's servers still hand out an older copy of this page than version.json names: ask again in a few minutes
          clearTimeout(retryTimer);
          if (retries++ < RETRIES) retryTimer = setTimeout(() => check(true), RETRY);
          return;
        }
        retries = 0;
        known = copy.build;
        if (copy.page !== PAGE) {
          wanted = true;
          maybeReload("check");
        }
      } catch (e) {
        // offline or a server hiccup: the next check tries again
      }
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  function resumed() {
    shownAt = Date.now();
    touched = false;
    check(true).then(() => maybeReload("resume"));
  }

  // after a reload made here: back to the same place, and say so (or, when the page did not change, wait for a newer build)
  function afterReload() {
    let saved = null;
    try {
      saved = JSON.parse(get("msca-reloaded", "sessionStorage") || "null");
    } catch (e) {}
    del("msca-reloaded", "sessionStorage");
    if (!saved || saved.at !== location.pathname + location.search || Date.now() - saved.t > 2 * 60 * 1000) return;
    if (offlinePage) return; // the device went offline in between: the offline page says so itself
    if (saved.from === PAGE) {
      stoppedFor = saved.to || BUILD;
      return;
    }
    let moved = false;
    const mark = () => (moved = true);
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach((t) => window.addEventListener(t, mark, { once: true, passive: true }));
    const restore = () => {
      if (!moved && saved.y > 0 && Math.abs(window.scrollY - saved.y) > 40) window.scrollTo({ top: saved.y, behavior: "instant" });
    };
    window.addEventListener("load", () => {
      restore();
      // content drawn later (the calendar from events.json): try again whenever the page grows, for a few seconds
      if ("ResizeObserver" in window) {
        const watch = new ResizeObserver(() => (moved ? watch.disconnect() : restore()));
        watch.observe(document.documentElement);
        setTimeout(() => watch.disconnect(), 10000);
      } else [400, 1500, 4000].forEach((ms) => setTimeout(restore, ms));
      if (M.announce) M.announce(M.tr ? M.tr("app.updated") : "");
    });
  }

  if (live) {
    afterReload();
    ["pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach((t) =>
      window.addEventListener(t, () => (touched = true), { passive: true, capture: true }),
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        leaving = false;
        resumed();
      } else setTimeout(() => maybeReload("hidden"), 1000); // never runs when the page is being left: it is gone by then
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) resumed(); // back from the back/forward cache
    });
    window.addEventListener("online", () => check(true));
    setInterval(() => {
      if (document.visibilityState === "visible") check(false);
    }, EVERY);
  }

  window.addEventListener("load", () => {
    if (!live) return removeApp();
    register();
    setTimeout(() => check(true), 5000);
  });

  /* ---------------------------------------------------------- the offline page */
  const retry = document.querySelector("[data-offline-retry]");
  if (retry) {
    // shown in place of a page that is not saved, at that page's address; or opened at its own address (/offline/,
    // /es/offline/), which has nothing to come back to: the home page in its language instead
    const own = location.pathname === BASE + "offline/" || location.pathname === BASE + "es/offline/";
    const go = () => (own ? location.replace(BASE + (LANG === "es" ? "es/" : "")) : location.reload());
    retry.addEventListener("click", go);
    // back online: open the page once the site really answers. Asked when the browser says "online" and every 5 s while
    // this page is on screen (browsers also say "online" when a page is left, or not at all when the connection returns).
    // version.json always comes from the network (the service worker leaves it alone); a page might come from its copy.
    let probing = false;
    const backOnline = () => {
      if (probing || leaving || !navigator.onLine || document.visibilityState === "hidden") return;
      probing = true;
      fetch(own ? BASE + "version.json" : location.pathname, { cache: "no-store", credentials: "same-origin" })
        .then((r) => {
          if (!leaving && (r.ok || r.status === 404)) go();
        })
        .catch(() => {})
        .finally(() => (probing = false));
    };
    window.addEventListener("online", () => setTimeout(backOnline, 300));
    setInterval(backOnline, 5000);
    const list = document.querySelector("[data-offline-list]");
    const items = list ? [...list.children] : [];
    const show = (sel, on) => {
      const el = document.querySelector(sel);
      if (el) el.hidden = !on;
    };
    if (window.caches && items.length)
      Promise.all(
        items.map((li) => {
          const a = li.querySelector("a");
          return caches.match(a.href, { ignoreSearch: true }).then((r) => (li.hidden = !r), () => (li.hidden = true));
        }),
      ).then(() => {
        const any = items.some((li) => !li.hidden);
        show("[data-offline-saved]", any);
        show("[data-offline-none]", !any);
      });
    else show("[data-offline-none]", true);
  }

  /* ---------------------------------------------------------- "Install the app" */
  // The invitation (partials/app-install.njk): from the second page a visitor opens on this device, a few seconds after
  // it opens, where the app can be installed and is not; not on the newcomers page (data-no-app-banner: someone may be
  // looking for help), the pages with a form, or the offline page. "Not now" hides it here for 30 days.
  const BANNER_LATER = "msca-app-banner"; // when "Not now" was pressed
  const BANNER_PAUSE = 30 * 24 * 60 * 60 * 1000;
  const views = (+get("msca-app-views") || 0) + 1;
  set("msca-app-views", String(Math.min(views, 99)));
  const bannerWanted = () =>
    live && !offlinePage && views >= 2 && !html.hasAttribute("data-no-app-banner") && !html.hasAttribute("data-no-auto-reload") &&
    Date.now() - (+get(BANNER_LATER) || 0) > BANNER_PAUSE;

  let prompt = null; // Chrome, Edge, Samsung Internet: their own install window, saved for the button
  window.addEventListener("beforeinstallprompt", (e) => {
    // where the invitation will show, it replaces the browser's own little install bar (the menu and the address
    // bar keep theirs); elsewhere the browser shows its own as usual
    if (bannerWanted()) e.preventDefault();
    prompt = e; // offered again, so not installed (any more): the button may show
    del("msca-installed");
    window.dispatchEvent(new CustomEvent("msca:installable"));
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    set("msca-installed", "1");
    set("msca-lang", LANG); // installed from a page in this language: the app opens in it
    window.dispatchEvent(new CustomEvent("msca:installed"));
  });

  // which install steps this browser needs ("" = it cannot install apps)
  function platform() {
    const ua = navigator.userAgent;
    const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPads say they are Macs
    const ios = /iPhone|iPad|iPod/.test(ua) || iPad;
    if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|musical_ly|TikTok|; wv\)|\bGSA\//.test(ua)) return "inapp";
    if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios_other" : "ios";
    if (/Android/.test(ua)) return /Firefox\//.test(ua) ? "firefox_android" : "chromium";
    const firefox = ua.match(/Firefox\/(\d+)/);
    if (firefox) return /Windows/.test(ua) && +firefox[1] >= 143 ? "firefox_windows" : "";
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) {
      const v = ua.match(/Version\/(\d+)/);
      return v && +v[1] >= 17 ? "mac_safari" : "";
    }
    return /Chrome\/|Chromium\/|Edg\//.test(ua) ? "chromium" : "";
  }

  document.addEventListener("alpine:init", () => {
    window.Alpine.store("app", {
      can: false,
      open: false,
      banner: false,
      steps: "",
      opener: null,
      init() {
        const update = () => (this.can = live && !standalone() && get("msca-installed") !== "1" && (!!prompt || !!platform()));
        update();
        window.addEventListener("msca:installable", update);
        window.addEventListener("msca:installed", () => {
          this.can = false;
          this.open = false;
          this.banner = false;
        });
        if (bannerWanted())
          setTimeout(() => {
            if (this.can && !this.open && bannerWanted()) this.banner = true;
          }, 6000);
      },
      // the invitation's two buttons
      fromBanner() {
        this.banner = false;
        this.install(null); // no focus to give back: the invitation is gone, and the footer button would scroll the page
      },
      later() {
        set(BANNER_LATER, String(Date.now()));
        this.banner = false;
      },
      async install(button) {
        this.opener = button || null;
        if (prompt) {
          const e = prompt;
          prompt = null; // the browser's window can be shown once per offer
          try {
            await e.prompt();
            const choice = await e.userChoice;
            if (choice && choice.outcome === "accepted") {
              set("msca-installed", "1");
              this.can = false;
            }
            return;
          } catch (err) {
            // the browser would not show it: the steps instead
          }
        }
        this.steps = platform() || "chromium";
        this.open = true;
      },
      close() {
        this.open = false;
        const b = this.opener;
        if (b) setTimeout(() => b.focus(), 0);
      },
      // iPhones, iPads and Mac Safari keep the app's storage apart from the browser's and never say it was installed:
      // "Already installed? Don't show this again" hides the button in this browser
      dismiss() {
        set("msca-installed", "1");
        this.can = false;
        this.open = false;
        this.banner = false;
        const footer = document.querySelector("footer");
        if (footer) {
          footer.setAttribute("tabindex", "-1");
          setTimeout(() => footer.focus(), 0);
        }
      },
    });
  });
})();

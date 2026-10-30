/*
  MSCA09 — browser-side behaviour shared by every page.
  Alpine.js components (registered on "alpine:init") plus a few small
  vanilla helpers. Page-specific scripts (calendar, documents, …) live in
  their own files and register their own components the same way.

  Time-awareness — the site keeps itself current between builds:
    data-hide-after="ISO"   element is removed once that moment has passed
    data-show-after="ISO"   element is hidden until that moment
    data-reveal-after="ISO" element sent hidden is un-hidden once that moment has passed (an event page's
                            "this event has ended" banner)
    data-when="ISO"         a [data-rel] child gets "Today" / "Tomorrow" / "In 3 days"
    data-limit="N"          on a list: after pruning, only the first N children stay visible
    data-series="key"       on a data-limit list's children: only the first child with that key shows
                            (a repeating event's next date; its following date takes over once it has passed)
    data-empty="#id"        on a list: if it ends up empty, the element #id is shown

  Motion: endless decorative animations can be paused by the visitor (footer button, or any
  element with x-data="motionToggle"). The choice is remembered on this device and sets
  <html data-motion="paused">; CSS pauses every animation, and scripts can read MSCA.motionPaused
  or listen for the "msca:motion" window event. prefers-reduced-motion is honoured as well.
*/
(function () {
  "use strict";

  const M = (window.MSCA = window.MSCA || {});
  M.t = M.t || {};
  const tr = (k, vars) => {
    let s = M.t[k] || k;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
    return s;
  };
  M.tr = tr;
  M.url = (p) => (M.base || "/").replace(/\/$/, "") + p;
  M.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------- motion pause (WCAG 2.2.2) */
  const MOTION_KEY = "msca-motion";
  M.motionPaused = document.documentElement.dataset.motion === "paused";
  M.setMotionPaused = (paused) => {
    M.motionPaused = !!paused;
    if (paused) document.documentElement.dataset.motion = "paused";
    else delete document.documentElement.dataset.motion;
    try {
      if (paused) localStorage.setItem(MOTION_KEY, "paused");
      else localStorage.removeItem(MOTION_KEY);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("msca:motion", { detail: { paused: M.motionPaused } }));
  };

  /* ---------------------------------------------------------- a list that a click has just changed */
  // A filter, a tab or a view the visitor picked has just redrawn a list: its box dips to 45% and comes back (0.2 s,
  // opacity only, so nothing moves and sticky rows inside keep working). One animation on the whole box, never one per
  // row. Not with reduced motion or animations paused (a script animation: the CSS pause rule cannot reach it), not
  // for a box that is not shown. A second change during the fade restarts it
  M.fadeChange = (el) => {
    if (!el || typeof el.animate !== "function" || M.reducedMotion || M.motionPaused || !el.getClientRects().length) return;
    if (el._fade) el._fade.cancel();
    el._fade = el.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  };

  /* ---------------------------------------------------------- screen-reader announcements */
  // One polite live region for the whole page: "Copied!", "Link copied" ... are read out.
  let live = null;
  M.announce = (text) => {
    if (!live) {
      live = document.createElement("div");
      live.className = "sr-only";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);
    }
    live.textContent = "";
    setTimeout(() => (live.textContent = text || ""), 60);
  };

  /* ---------------------------------------------------------- time */
  // Calendar-day difference in the Area's time zone.
  const dayKey = (d) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: M.tz || "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  M.dayDiff = (iso) => {
    const a = new Date(dayKey(new Date()) + "T00:00:00Z");
    const b = new Date(dayKey(new Date(iso)) + "T00:00:00Z");
    return Math.round((b - a) / 86400000);
  };
  M.relative = (iso, endIso) => {
    const now = Date.now();
    const start = new Date(iso).getTime();
    const end = endIso ? new Date(endIso).getTime() : start;
    if (now >= start && now <= end) return { text: tr("time.in_progress"), tone: "live" };
    if (now > end) return { text: tr("time.ended"), tone: "past" };
    if (start - now < 60 * 60 * 1000) return { text: tr("time.starting_soon"), tone: "soon" };
    const d = M.dayDiff(iso);
    if (d === 0) return { text: tr("time.today"), tone: "today" };
    if (d === 1) return { text: tr("time.tomorrow"), tone: "soon" };
    return { text: tr("time.in_days", { n: d }), tone: d <= 7 ? "week" : "later" };
  };

  M.applyTime = function (root = document) {
    const now = Date.now();
    root.querySelectorAll("[data-hide-after]").forEach((el) => {
      const t = Date.parse(el.dataset.hideAfter);
      if (!isNaN(t) && now > t) el.remove();
    });
    root.querySelectorAll("[data-show-after]").forEach((el) => {
      const t = Date.parse(el.dataset.showAfter);
      if (!isNaN(t) && now < t) el.remove();
    });
    root.querySelectorAll("[data-reveal-after]").forEach((el) => {
      const t = Date.parse(el.dataset.revealAfter);
      if (!isNaN(t) && now > t) el.hidden = false;
    });
    root.querySelectorAll("[data-when]").forEach((el) => {
      const slot = el.querySelector("[data-rel]");
      if (!slot) return;
      const r = M.relative(el.dataset.when, el.dataset.until);
      slot.textContent = r.text;
      slot.dataset.tone = r.tone;
      slot.hidden = false;
    });
    root.querySelectorAll("[data-limit]").forEach((list) => {
      const n = parseInt(list.dataset.limit, 10);
      const series = new Set();
      let i = 0;
      [...list.children].forEach((c) => {
        // the later dates of a series stay hidden and do not count
        const s = c.dataset.series;
        if (s && series.has(s)) return void (c.hidden = true);
        if (s) series.add(s);
        if (!c.matches("[data-keep]")) c.hidden = i >= n;
        i++;
      });
    });
    root.querySelectorAll("[data-empty]").forEach((list) => {
      const target = document.querySelector(list.dataset.empty);
      const visible = [...list.children].some((c) => !c.hidden);
      if (target) target.hidden = visible;
      if (!visible) list.hidden = true;
    });
  };

  /* ---------------------------------------------------------- reveal on scroll */
  // .reveal blocks fade up as they come into view (hidden only while html.js is set: partials/i18n-js.njk, which
  // shows them anyway after 4 s if this never runs; M.revealing tells it that it did).
  // A block shows as soon as 40px of it is on screen, however tall. Cards in a sideways rail (phones) never scroll
  // into view by themselves (nor in a search engine's render): the rail is watched, and its cards come in together.
  function initReveal() {
    M.revealing = true;
    const els = [...document.querySelectorAll(".reveal")];
    const show = (el) => el.classList.add("is-visible");
    if (!("IntersectionObserver" in window) || M.reducedMotion || M.motionPaused) return els.forEach(show);
    const groups = new Map(); // watched element (the block, or its rail) -> the blocks it shows
    els.forEach((el) => {
      const p = el.parentElement;
      const key = p && /auto|scroll/.test(getComputedStyle(p).overflowX) ? p : el;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          groups.get(e.target).forEach(show);
          io.unobserve(e.target);
        });
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0 }
    );
    groups.forEach((_, key) => io.observe(key));
    // Pause pressed part-way down the page: the blocks still waiting are shown now (site.css already shows them; this
    // marks them, so the triangle's bands are released too). The page's style is read first, so the browser has
    // applied the paused rule (shown, no transition) before .is-visible comes: marked in the same instant, the blocks
    // went straight from hidden to .is-visible and faded in for up to a second after Pause
    window.addEventListener("msca:motion", (e) => {
      if (!(e.detail && e.detail.paused)) return;
      void getComputedStyle(document.documentElement).opacity;
      els.forEach((el) => getComputedStyle(el).opacity);
      els.forEach(show);
      io.disconnect();
    });
  }

  /* ---------------------------------------------------------- lazy script loader */
  const loaded = {};
  M.load = (src, isCss) => {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const el = document.createElement(isCss ? "link" : "script");
      if (isCss) {
        el.rel = "stylesheet";
        el.href = M.url(src);
      } else {
        el.src = M.url(src);
        el.async = true;
      }
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
    return loaded[src];
  };

  /* ---------------------------------------------------------- flyers: PhotoSwipe lightbox */
  // Any element with data-gallery holding <a data-pswp-width data-pswp-height href="big.jpg"> children.
  function initLightbox() {
    const galleries = document.querySelectorAll("[data-gallery]");
    if (!galleries.length) return;
    Promise.all([
      M.load("/assets/vendor/photoswipe/photoswipe.css", true),
      M.load("/assets/vendor/photoswipe/photoswipe.umd.min.js"),
      M.load("/assets/vendor/photoswipe/photoswipe-lightbox.umd.min.js"),
    ])
      .then(() => {
        galleries.forEach((g) => {
          const lb = new window.PhotoSwipeLightbox({
            gallery: g,
            children: "a[data-pswp]",
            pswpModule: window.PhotoSwipe,
            bgOpacity: 0.92,
            showHideAnimationType: M.reducedMotion ? "none" : "zoom",
            // controls in the page's language
            closeTitle: tr("gallery.close"),
            zoomTitle: tr("gallery.zoom"),
            arrowPrevTitle: tr("gallery.prev"),
            arrowNextTitle: tr("gallery.next"),
            errorMsg: tr("gallery.error"),
            indexIndicatorSep: " / ",
          });
          // give the lightbox dialog a name
          lb.on("afterInit", () => {
            const el = lb.pswp && lb.pswp.element;
            if (el) el.setAttribute("aria-label", tr("gallery.label"));
          });
          // Drive flyers have unknown sizes (data-pswp-width="0"). Open with the shape of the thumbnail already on
          // the page (a letter-size guess if it has not loaded), then measure the full image: its real size goes
          // on the link (data-pswp-*, which PhotoSwipe reads) and the slide is redrawn only when the shape was
          // off — PhotoSwipe sizes a slide from these numbers, so a wrong guess stretched wide flyers.
          // The thumbnail: a gallery tile's picture, or the picture of a flyer card that opens its flyers (eventCard gallery).
          const flyerThumb = (a) => a && a.querySelector(".flyer-gallery__img, .ev-flyer__img");
          lb.addFilter("itemData", (data) => {
            const a = data.element;
            if (a && (!a.dataset.pswpWidth || a.dataset.pswpWidth === "0")) {
              const t = flyerThumb(a);
              data.width = 1600;
              data.height = t && t.naturalWidth ? Math.round((1600 * t.naturalHeight) / t.naturalWidth) : 2067;
            }
            return data;
          });
          lb.on("contentLoad", (e) => {
            const { content } = e;
            const a = content.data && content.data.element;
            if (content.type !== "image" || !a || (a.dataset.pswpWidth && a.dataset.pswpWidth !== "0")) return;
            const img = new Image();
            img.onload = () => {
              const w = img.naturalWidth, h = img.naturalHeight, d = content.data;
              if (!w || !h) return;
              a.dataset.pswpWidth = String(w);
              a.dataset.pswpHeight = String(h);
              const off = d.width && d.height ? Math.abs(w / h - d.width / d.height) / (w / h) : 1;
              if (off > 0.01 && lb.pswp && content.index != null) lb.pswp.refreshSlideContent(content.index);
            };
            img.src = content.data.src;
          });
          // zoom in from the picture itself: in the gallery tiles the flyer is contain-fitted with padding,
          // so the <img> box is bigger than the flyer you see. A flyer that is not on the page (a card's other pages,
          // sent as hidden links) has no box: it fades in and out instead of zooming from the corner of the screen.
          lb.addFilter("thumbBounds", (bounds, data) => {
            if (bounds && !bounds.w) return undefined;
            const img = flyerThumb(data && data.element);
            if (!img || !img.naturalWidth) return bounds;
            const r = img.getBoundingClientRect(), cs = getComputedStyle(img);
            const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
            const cw = r.width - pl - (parseFloat(cs.paddingRight) || 0), ch = r.height - pt - (parseFloat(cs.paddingBottom) || 0);
            if (cw <= 0 || ch <= 0) return bounds;
            const s = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
            const w = img.naturalWidth * s, h = img.naturalHeight * s;
            return { x: r.left + pl + (cw - w) / 2, y: r.top + pt + (ch - h) / 2, w };
          });
          lb.init();
        });
      })
      .catch(() => {});
  }

  /* ---------------------------------------------------------- Alpine components */
  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    Alpine.data("siteHeader", () => ({
      scrolled: false,
      menu: false,
      init() {
        // two thresholds: the bar shrinks 64px down and grows back only near the top. With one (24px), the 16px it loses
        // moved the page back across it (the browser keeps the content still), so the header could grow and shrink over and over
        const onScroll = () => { const y = window.scrollY; this.scrolled = this.scrolled ? y > 8 : y > 64; };
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
      },
      closeAll() {
        this.menu = false;
        window.dispatchEvent(new CustomEvent("close-menus"));
      },
    }));

    // A desktop menu dropdown (partials/header.njk). A mouse opens it on hover; a click, a tap or
    // Enter toggles it (a click right after hovering keeps it open); Escape closes it and puts
    // focus back on its button. The panel is nudged sideways if it would run off the screen.
    let navWarmUntil = 0; // a menu was open a moment ago: the next one opens at once
    Alpine.data("navDrop", () => ({
      open: false,
      hov: false,
      init() {
        this.$watch("open", (v) => v && this.$nextTick(() => this.fit()));
      },
      enter(e) {
        if (e.pointerType !== "mouse") return;
        this.hov = true;
        clearTimeout(this._t);
        // a short wait, so a pointer that only crosses the menu bar opens nothing; at once when moving along open menus
        const go = () => { if (this.hov) this.open = true; };
        if (performance.now() < navWarmUntil) go(); else this._t = setTimeout(go, 90);
      },
      leave(e) {
        if (e.pointerType !== "mouse") return;
        clearTimeout(this._t);
        if (this.open) navWarmUntil = performance.now() + 300;
        this.open = false;
        this.hov = false;
      },
      toggle() {
        this.open = this.hov ? true : !this.open;
        this.hov = false;
      },
      esc() {
        if (!this.open) return;
        this.open = false;
        this.$refs.btn && this.$refs.btn.focus();
      },
      fit() {
        const p = this.$refs.panel;
        if (!p) return;
        p.style.marginLeft = "0px";
        const r = p.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const pad = 12;
        let shift = 0;
        if (r.right > vw - pad) shift = vw - pad - r.right;
        if (r.left + shift < pad) shift = pad - r.left;
        p.style.marginLeft = shift + "px";
      },
    }));

    // "Pause animations" / "Play animations" button (partials/footer.njk): <button x-data="motionToggle" @click="toggle()">
    // with <span x-show="!paused">…Pause…</span><span x-show="paused">…Play…</span>. The label says what a press does,
    // so it is a plain action button, not a toggle with aria-pressed (whose label would have to stay the same).
    Alpine.data("motionToggle", () => ({
      paused: M.motionPaused,
      reduced: M.reducedMotion,
      init() {
        this._sync = () => (this.paused = M.motionPaused);
        window.addEventListener("msca:motion", this._sync);
      },
      toggle() {
        M.setMotionPaused(!M.motionPaused);
      },
      destroy() {
        window.removeEventListener("msca:motion", this._sync);
      },
    }));

    // Site search (partials/search.njk): Pagefind's search box, loaded the first time it opens.
    // Pagefind keeps one index per language and searches the one named by <html lang>.
    // A bare "H&I" would be read as the prefix "hi" (High Desert, Hindsight, Hispanic …) and bury the H&I pages:
    // search the exact word instead. "and"/"y"/"e" must stand alone, so "handi" (handisocal.org) is left as typed.
    const HANDI = /^\s*h\s*(?:[&+]|\s(?:and|y|e)\s)\s*i\s*$/i;
    // Every word is matched as a prefix, so "District 2" also matches 2026, 20, 21 …:
    // termSimilarity 10 ranks the whole word (the page's own title) above words that only start with it;
    // pageLength 0.5 (default 0.75) keeps long hub pages (districts, committees) above short event pages.
    const RANKING = { termSimilarity: 10, pageLength: 0.5 };
    Alpine.data("searchModal", () => ({
      open: false,
      ready: false,
      failed: false,
      lang: "", // the language of the index the box is searching now
      ui: null,
      init() {
        // An address with a search in it opens the box with that search: ?s=… (the old WordPress site's search
        // address, still in old links) and ?q=… on the home page, or on any page without a search box of its
        // own (documents, the calendar, committees … read ?q= into their own box).
        const p = new URLSearchParams(location.search);
        const home = [M.url("/"), M.url("/es/")].includes(location.pathname);
        const own = !home && document.querySelector('main input[type="search"], main input[type="text"]');
        const q = (p.get("s") || (own ? "" : p.get("q")) || "").trim();
        if (q) this.show({ detail: { q } });
      },
      show(e) {
        // The 404 page is in both languages and says which one each of its buttons is for; elsewhere: the page's own.
        const d = (e && e.detail) || {};
        this.open = true;
        this.$nextTick(() => this.mount(d.lang || M.lang || "en", d.q));
      },
      hide() {
        this.open = false;
      },
      // A result was followed: close the box (it would stay open when the link only moves within this page).
      picked(e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
        if (e.target.closest("a[href]")) this.hide();
      },
      // Pagefind's "N results for …" line is not announced: read it out once it stops changing.
      announce() {
        clearTimeout(this._say);
        this._say = setTimeout(() => {
          const m = this.$refs.mount.querySelector(".pagefind-ui__message");
          const text = m ? m.textContent.trim() : "";
          if (text !== this.$refs.live.textContent) this.$refs.live.textContent = text;
        }, 700);
      },
      // The box's wording in a language (data-words-en / data-words-es on the modal), or null.
      words(lang) {
        try {
          return JSON.parse(this.$root.dataset["words" + lang.charAt(0).toUpperCase() + lang.slice(1)] || "null");
        } catch (e) {
          return null;
        }
      },
      async mount(lang, q) {
        if (this.ready && lang === this.lang) {
          const input = this.$refs.mount.querySelector("input");
          input && input.focus();
          if (q) this.ui.triggerSearch(q);
          return;
        }
        const w = this.words(lang) || {};
        const say = (k) => w[k] || tr("search." + k);
        this.$refs.panel.lang = lang;
        this.$refs.title.textContent = say("title");
        this.$refs.failed.textContent = say("unavailable");
        try {
          await M.load("/pagefind/pagefind-ui.css", true);
          await M.load("/pagefind/pagefind-ui.js");
          // Spanish: the Delegate's Corner posts are English text, so their Spanish copies have a small English index
          // of their own (pagefind-posts, npm run build:search), searched alongside the Spanish one. Only when it was
          // built: a missing index would stop the whole search.
          const posts = M.url("/pagefind-posts/");
          const withPosts = lang === "es" && (await fetch(posts + "pagefind-entry.json", { method: "HEAD" }).then((r) => r.ok, () => false));
          // Pagefind takes its language (which index, and its own wording) from <html lang> when it starts.
          // To search the other language (404 page): stop the running search, start again with lang set
          // just for that moment, then put the page's own lang back.
          const pf = await import(M.url("/pagefind/pagefind.js"));
          if (this.ui) {
            await pf.destroy(); // before the box's own destroy, which does not wait for it
            this.ui.destroy();
            this.ui = null;
          }
          const html = document.documentElement;
          const own = html.lang;
          html.lang = lang;
          try {
            pf.init();
            this.ui = new window.PagefindUI({
              element: "#site-search",
              bundlePath: M.url("/pagefind/"),
              showSubResults: true,
              showImages: false,
              resetStyles: false,
              autofocus: true,
              ranking: RANKING,
              mergeIndex: withPosts ? [{ bundlePath: posts, language: "en", ranking: RANKING }] : [],
              processTerm: (term) => (HANDI.test(term) ? '"H&I"' : term),
              // Result links carry the words searched (?highlight=…): the motions board opens on them (service.js).
              // Other pages ignore the parameter (Pagefind's own highlighting script is not loaded).
              highlightParam: "highlight",
              // Each page stores its kind as meta "type", an internal word (district, committee, post …) that stays
              // in the index; show it in the box's language instead: "Tipo: Distrito".
              processResult: (r) => {
                const m = r && r.meta;
                if (m && m.type) {
                  const { type, ...rest } = m;
                  const label = w.types && w.types[type];
                  r.meta = label ? { ...rest, [say("meta_type")]: label } : rest;
                }
                return r;
              },
              translations: {
                placeholder: say("placeholder"),
                zero_results: say("zero_results"),
                many_results: say("many_results"),
                one_result: say("one_result"),
                load_more: say("load_more"),
              },
            });
          } finally {
            html.lang = own;
          }
          if (q) this.ui.triggerSearch(q);
          if (!this._watch) {
            this._watch = new MutationObserver(() => this.announce());
            this._watch.observe(this.$refs.mount, { childList: true, subtree: true, characterData: true });
          }
          this.lang = lang;
          this.ready = true;
        } catch (e) {
          this.failed = true;
        }
      },
    }));

    Alpine.data("copyText", (value) => ({
      copied: false,
      async copy() {
        try {
          await navigator.clipboard.writeText(value);
        } catch (e) {
          const ta = document.createElement("textarea");
          ta.value = value;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        this.copied = true;
        M.announce(tr("ui.copied"));
        setTimeout(() => (this.copied = false), 1800);
      },
    }));

    Alpine.data("countUp", (target) => ({
      display: target, // the real number until it counts up (search engines, cards not yet swiped into view, print)
      // declared here so each tile keeps its own: a property init() adds later is written to the outermost x-data
      // scope, which all the tiles share, so the last tile's answer (often below the first screen) became everyone's
      seen: false,
      init() {
        // a number already on screen when the page opens keeps its value: it is painted in the first screen, and
        // counting it from 0 would take it away again. Numbers scrolled (or swiped, in a rail) into view still count up.
        // A tile hidden at this size (display: none) has no box, so it is not "seen"
        const r = this.$el.getBoundingClientRect();
        this.seen = r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      },
      start() {
        if (M.reducedMotion || M.motionPaused || this.seen) return;
        const n = Number(target) || 0;
        const t0 = performance.now();
        const dur = 1200;
        const step = (t) => {
          // the first frame's time can be a little before t0: never below 0 (it showed "-1" for a moment)
          const p = Math.min(1, Math.max(0, (t - t0) / dur));
          this.display = Math.round(n * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
    }));

    // Live countdown to an ISO moment. Use: x-data="countdown('2026-11-08T09:00:00-08:00')"
    // With reduced motion (or animations paused) it updates once a minute and the seconds tile
    // (the parent of the element whose x-text uses `s`) is hidden; the container gets data-cd-calm.
    Alpine.data("countdown", (iso) => ({
      d: 0, h: 0, m: 0, s: 0, past: false, calm: false, timer: null,
      init() {
        this.run();
        this._onMotion = () => this.run();
        window.addEventListener("msca:motion", this._onMotion);
      },
      run() {
        clearInterval(this.timer);
        this.calm = M.reducedMotion || M.motionPaused;
        this.tick();
        if (this.past) return;
        if (this.calm) {
          // first update on the next full minute, then every minute
          this.timer = setTimeout(() => {
            this.tick();
            this.timer = setInterval(() => this.tick(), 60000);
          }, 60000 - (Date.now() % 60000) + 50);
        } else {
          this.timer = setInterval(() => this.tick(), 1000);
        }
        setTimeout(() => this.secondsTile(), 0);
      },
      tick() {
        const diff = new Date(iso).getTime() - Date.now();
        if (diff <= 0) {
          this.past = true;
          clearInterval(this.timer);
          return;
        }
        this.d = Math.floor(diff / 86400000);
        this.h = Math.floor((diff % 86400000) / 3600000);
        this.m = Math.floor((diff % 3600000) / 60000);
        this.s = Math.floor((diff % 60000) / 1000);
      },
      secondsTile() {
        this.$el.toggleAttribute("data-cd-calm", this.calm);
        this.$el.querySelectorAll("[x-text]").forEach((n) => {
          if (/(^|[^\w.$])s(?![\w$])/.test(n.getAttribute("x-text") || "") && n.parentElement) n.parentElement.hidden = this.calm;
        });
      },
      destroy() {
        clearInterval(this.timer);
        window.removeEventListener("msca:motion", this._onMotion);
      },
    }));

    // Leaflet map. points: [{ lat, lng, label, url, color, num, html }]
    // Nearby pins merge into numbered clusters (Leaflet.markercluster) that split apart as you zoom (cluster = false: never).
    // On touch screens one finger scrolls the page; two fingers move the map.
    Alpine.data("leafletMap", (points, zoom, cluster = true) => ({
      map: null,
      async load() {
        if (this.map) return;
        try {
          await M.load("/assets/vendor/leaflet/leaflet.css", true);
          await M.load("/assets/vendor/leaflet/MarkerCluster.css", true);
          await M.load("/assets/vendor/leaflet/leaflet.js");
          await M.load("/assets/vendor/leaflet/leaflet.markercluster.js");
        } catch (e) {
          return;
        }
        const L = window.L;
        const touch = matchMedia("(pointer: coarse)").matches;
        const map = (this.map = L.map(this.$el, {
          scrollWheelZoom: false,
          zoomControl: true,
          attributionControl: false,
          dragging: !touch,
          tap: !touch,
        }));
        // OpenStreetMap's tile policy asks for a Referer; the site-wide no-referrer meta (kept for Drive images) would drop it.
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          subdomains: "abc",
          referrerPolicy: "strict-origin-when-cross-origin",
        }).addTo(map);
        const link = (u) => (u && u.startsWith("/") && !u.startsWith("//") ? M.url(u) : u);
        const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const pts = (points || []).filter((p) => p && isFinite(p.lat) && isFinite(p.lng));
        const group = L.markerClusterGroup && cluster !== false
          ? L.markerClusterGroup({
              showCoverageOnHover: false,
              maxClusterRadius: 38,
              spiderfyOnMaxZoom: true,
              iconCreateFunction: (c) =>
                L.divIcon({ className: "", html: `<div class="msca-cluster">${c.getChildCount()}</div>`, iconSize: [42, 42] }),
            })
          : L.featureGroup();
        const markers = pts.map((p) => {
          // -700: the white 12px number passes AA (4.5:1) on every palette colour (sun-700 4.9:1, sun-600 only 2.8:1)
          const color = p.color ? `var(--color-${p.color}-700)` : "var(--color-iris-700)";
          const icon = L.divIcon({
            className: "",
            html: `<div class="district-pin" style="background:${color}"><span>${p.num != null ? esc(p.num) : "•"}</span></div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 34],
            popupAnchor: [0, -30],
          });
          const m = L.marker([p.lat, p.lng], { icon, title: p.label || "" });
          const body = p.html || (p.url ? `<a href="${esc(link(p.url))}" style="font-weight:700">${esc(p.label)}</a>` : `<strong>${esc(p.label)}</strong>`);
          m.bindPopup(body);
          group.addLayer(m);
          return m;
        });
        map.addLayer(group);
        if (markers.length === 1) map.setView(markers[0].getLatLng(), zoom || 14);
        else if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.08));
        else map.setView([33.75, -117.85], 9);
        if (touch) {
          // two-finger pan/zoom; show a hint when someone tries one finger
          const hint = document.createElement("div");
          hint.className = "leaflet-tap-hint";
          hint.textContent = M.t["map.two_fingers"] || "Use two fingers to move the map";
          this.$el.appendChild(hint);
          let timer;
          this.$el.addEventListener("touchstart", (e) => {
            if (e.touches.length >= 2) {
              map.dragging.enable();
              hint.classList.remove("show");
            } else {
              map.dragging.disable();
              hint.classList.add("show");
              clearTimeout(timer);
              timer = setTimeout(() => hint.classList.remove("show"), 1200);
            }
          }, { passive: true });
          this.$el.addEventListener("touchend", () => map.dragging.disable(), { passive: true });
        }
        this.$el.addEventListener("focus-point", (e) => {
          const m = markers[e.detail];
          if (!m) return;
          if (group.zoomToShowLayer) group.zoomToShowLayer(m, () => m.openPopup());
          else {
            map.flyTo(m.getLatLng(), 13, { duration: M.reducedMotion ? 0 : 0.8 });
            m.openPopup();
          }
        });
        setTimeout(() => map.invalidateSize(), 200);
      },
    }));

    // Simple tabs: x-data="tabs('first')" then :class="tab==='x'" / @click="set('x')"; give each tab button
    // data-tab="x". A URL hash opens a tab only when an element [data-tab="<hash>"] exists inside this
    // component; any other hash (#main, #some-heading) keeps the first tab, so the panel never goes blank.
    Alpine.data("tabs", (first) => ({
      tab: first,
      init() {
        let h = "";
        try {
          h = decodeURIComponent((location.hash || "").slice(1));
        } catch (e) {}
        if (h && h !== first && this.isTab(h)) this.tab = h;
      },
      isTab(h) {
        try {
          return !!this.$el.querySelector('[data-tab="' + CSS.escape(h) + '"]');
        } catch (e) {
          return false;
        }
      },
      set(name) {
        this.tab = name;
        history.replaceState(null, "", "#" + name);
      },
    }));
  });

  /* ---------------------------------------------------------- share */
  // Every share button (shareButton in macros/ui.njk: <button data-share data-share-title data-share-url data-share-hash>),
  // also the ones Alpine draws later (calendar details, document cards), is handled here by one listener.
  // A phone or tablet with a share sheet of its own (navigator.share on a touch screen) opens it. Everywhere else the
  // page's one menu (partials/share-menu.njk) opens beside the button. The menu is moved next to that button, so Tab goes
  // on from it in page order and it works inside a modal dialog (the calendar's details), and it is shown in the
  // browser's top layer (popover), so no card, band or dialog clips or covers it. In the menu: ↑ ↓ Home End move,
  // Escape closes it and puts focus back on the button, Tab moves on (and closes it); a click elsewhere closes it.
  // What is shared is always a full address: the button's own (data-share-url: a path of this site, with or without the
  // /MSCA09/ prefix, or https://…) or this page as it is now, with the item's #id (data-share-hash) when it has one.
  const sitePrefix = () => (M.base || "/").replace(/\/?$/, "/");
  M.absUrl = (u) => {
    u = String(u || "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    if (u.charAt(0) !== "/" || u.charAt(1) === "/") return new URL(u, location.href).href;
    const b = sitePrefix();
    return location.origin + (b !== "/" && u.indexOf(b) === 0 ? u : M.url(u));
  };
  M.shareUrl = (btn) => {
    const d = btn.dataset;
    const hash = d.shareHash ? "#" + d.shareHash : "";
    if (d.shareUrl) {
      const u = M.absUrl(d.shareUrl).replace(/\?(?=#|$)/, ""); // "…/calendar/?" with no filters → "…/calendar/"
      return hash ? u.split("#")[0] + hash : u;
    }
    if (hash) return location.origin + location.pathname + hash;
    // this page as the visitor sees it: its filters (?…) and the part it shows (#…), not the words a search result highlighted
    const q = new URLSearchParams(location.search);
    q.delete("highlight");
    const s = q.toString();
    return location.origin + location.pathname + (s ? "?" + s : "") + (location.hash === "#main" ? "" : location.hash);
  };

  let shareMenu = null; // the page's menu (#share-menu)
  let shareHome = null; // where it lives while closed (a comment node)
  let shareBtn = null; // the button whose menu is open
  let shareTimer = 0;
  const menuEl = () => shareMenu || (shareMenu = document.getElementById("share-menu"));
  const hasPopover = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;
  const shareItems = () => [...menuEl().querySelectorAll('[role="menuitem"]')];
  // the language a button speaks: the page's, or its section's (the Spanish section of the English Newcomers page)
  const langOf = (el) => (el.closest("[lang]") || document.documentElement).getAttribute("lang") || "";
  // "District 5" → "District 5 · A.A. Area 09": a shared title says where it comes from, in the button's language
  const shareText = (title, code) => {
    const d = menuEl() ? menuEl().dataset : {};
    const key = (c) => "site" + c.charAt(0).toUpperCase() + c.charAt(1).toLowerCase(); // "es-US" → data-site-es
    const site = d[key(code)] || d[key(document.documentElement.lang || "")] || "";
    return site && !/(?:area|área)\s*0?9(?!\d)/iu.test(title) ? title + " · " + site : title;
  };

  function shareCopied(done) {
    const b = menuEl().querySelector('[data-share-act="copy"]');
    const words = b.querySelector("[data-share-copy]");
    b.classList.toggle("is-done", done);
    words.textContent = done ? words.dataset.shareCopied : words.dataset.shareCopy;
    b.querySelector('[data-share-ico="link"]').hidden = done;
    b.querySelector('[data-share-ico="done"]').hidden = !done;
  }

  function placeShare() {
    const m = menuEl();
    const btn = shareBtn;
    if (!btn) return;
    // the button was redrawn (Alpine re-rendered its list) or is hidden now (the calendar's phone and computer
    // "Share this view" buttons, when the window crosses 640px): close, so the menu never floats away from it
    if (!btn.isConnected || !btn.getClientRects().length) return closeShare(false);
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const pad = 8;
    const gap = 6;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    let left = r.left;
    if (left + w > vw - pad) left = r.right - w;
    left = Math.max(pad, Math.min(left, vw - pad - w));
    const up = r.bottom + gap + h > vh - pad && r.top - gap - h >= pad;
    // kept on screen while its button is; once the button scrolls away the menu goes with it
    const inView = r.bottom > 0 && r.top < vh;
    let top = up ? r.top - gap - h : r.bottom + gap;
    if (inView && !up) top = Math.max(pad, Math.min(top, vh - pad - h));
    m.style.left = Math.round(left) + "px";
    m.style.top = Math.round(top) + "px";
    m.classList.toggle("is-up", up);
  }

  // a press on the open menu's own button: its click closes the menu (the focus it takes first must not)
  let shareToggling = false;
  function outsideShare(e) {
    const m = menuEl();
    if (!shareBtn || m.contains(e.target)) return;
    if (shareBtn.contains(e.target)) {
      shareToggling = true;
      setTimeout(() => (shareToggling = false), 800); // the press never became a click (dragged away)
    } else closeShare(false);
  }

  function keyShare(e) {
    if (!shareBtn) return;
    const active = document.activeElement;
    if (e.key === "Escape") {
      // only the menu closes (not the calendar's details around it)
      e.preventDefault();
      e.stopPropagation();
      closeShare(true);
      return;
    }
    if (active && active.matches("input")) return;
    if (e.key === " " && active && active.tagName === "A") {
      e.preventDefault();
      active.click();
      return;
    }
    const list = shareItems();
    const i = list.indexOf(active);
    const to = { ArrowDown: (i + 1) % list.length, ArrowUp: (i - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    list[to].focus();
  }

  function openShare(btn, url, text, title, code) {
    const m = menuEl();
    if (!m) return;
    if (shareBtn) closeShare(false);
    if (!shareHome) {
      shareHome = document.createComment("share menu");
      m.before(shareHome);
      m.addEventListener("keydown", keyShare);
      // Tab (or a click) took focus somewhere else on the page
      m.addEventListener("focusout", (e) => {
        if (shareBtn && !shareToggling && e.relatedTarget && !m.contains(e.relatedTarget)) closeShare(false);
      });
    }
    const enc = encodeURIComponent;
    const links = {
      email: "mailto:?subject=" + enc(text) + "&body=" + enc(text + "\n" + url),
      sms: "sms:?&body=" + enc(text + " " + url),
      whatsapp: "https://wa.me/?text=" + enc(text + " " + url),
      facebook: "https://www.facebook.com/sharer/sharer.php?u=" + enc(url),
      x: "https://x.com/intent/post?text=" + enc(text) + "&url=" + enc(url),
    };
    m.querySelectorAll("a[data-share-act]").forEach((a) => (a.href = links[a.dataset.shareAct] || a.href));
    const what = m.querySelector("[data-share-what]");
    what.textContent = title;
    what.setAttribute("lang", code); // the title in its own language, the menu in the page's
    m.querySelector('[role="menu"]').setAttribute("aria-label", btn.getAttribute("aria-label") || title);
    m.querySelector("[data-share-url-box]").hidden = true;
    m.querySelector("[data-share-status]").textContent = "";
    m.dataset.url = url;
    shareCopied(false);
    // next to its button; a modal dialog's x-trap.inert may have hidden it from screen readers while it sat outside
    btn.after(m);
    m.removeAttribute("aria-hidden");
    shareBtn = btn;
    btn.setAttribute("aria-expanded", "true");
    m.classList.add("is-open");
    if (hasPopover) {
      try {
        m.showPopover();
      } catch (e) {}
    }
    placeShare();
    window.addEventListener("scroll", placeShare, true);
    window.addEventListener("resize", placeShare);
    document.addEventListener("pointerdown", outsideShare, true);
    const first = shareItems()[0];
    if (first) first.focus({ preventScroll: true });
  }

  function closeShare(focusButton) {
    const m = menuEl();
    const btn = shareBtn;
    if (!btn) return;
    shareBtn = null;
    clearTimeout(shareTimer);
    window.removeEventListener("scroll", placeShare, true);
    window.removeEventListener("resize", placeShare);
    document.removeEventListener("pointerdown", outsideShare, true);
    const hadFocus = m.contains(document.activeElement);
    if (hasPopover) {
      try {
        m.hidePopover();
      } catch (e) {}
    }
    m.classList.remove("is-open", "is-up");
    btn.setAttribute("aria-expanded", "false");
    if (shareHome && shareHome.parentNode) shareHome.after(m);
    if ((focusButton || hadFocus) && btn.isConnected) btn.focus({ preventScroll: true });
  }

  async function copyShare() {
    const m = menuEl();
    const url = m.dataset.url || "";
    const item = m.querySelector('[data-share-act="copy"]');
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch (e) {
      // no Clipboard API (an http:// address, an older browser): the old way, inside the menu (a dialog's focus trap allows it)
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
        m.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch (e2) {}
      item.focus({ preventScroll: true });
    }
    if (!ok) {
      // the browser would not copy: show the link, selected, to copy by hand
      const box = m.querySelector("[data-share-url-box]");
      box.value = url;
      box.hidden = false;
      box.focus();
      box.select();
      placeShare();
      return;
    }
    shareCopied(true);
    const status = m.querySelector("[data-share-status]");
    status.textContent = "";
    setTimeout(() => (status.textContent = tr("ui.link_copied")), 60);
    clearTimeout(shareTimer);
    const btn = shareBtn;
    shareTimer = setTimeout(() => shareBtn === btn && closeShare(m.contains(document.activeElement)), 1500);
  }

  async function startShare(btn) {
    const url = M.shareUrl(btn);
    const title = (btn.dataset.shareTitle || "").trim() || document.title;
    const code = langOf(btn);
    const text = shareText(title, code);
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      const data = { title: text, text, url };
      if (!navigator.canShare || navigator.canShare(data)) {
        try {
          await navigator.share(data);
          return;
        } catch (e) {
          if (e && e.name === "AbortError") return; // the visitor closed the share sheet
        }
      }
    }
    openShare(btn, url, text, title, code);
  }
  M.share = { open: startShare, close: closeShare };

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest("[data-share]");
    if (btn) {
      e.preventDefault();
      shareToggling = false;
      if (btn === shareBtn) closeShare(true);
      else startShare(btn);
      return;
    }
    const item = shareBtn && t.closest("#share-menu [data-share-act]");
    if (!item) return;
    if (item.dataset.shareAct === "copy") {
      e.preventDefault();
      copyShare();
    } else {
      // a link (mail app, text message, a new tab): let the browser follow it, then close
      setTimeout(() => closeShare(true), 0);
    }
  });
  // ↓ on a share button opens its menu, as on any menu button
  document.addEventListener("keydown", (e) => {
    const btn = e.key === "ArrowDown" && e.target && e.target.closest && e.target.closest("[data-share]");
    if (btn && btn !== shareBtn) {
      e.preventDefault();
      startShare(btn);
    }
  });

  /* ---------------------------------------------------------- links into folded content */
  // A link to #some-id inside a closed <details> or a hidden tab panel (a site-search hit such as a district's
  // documents of 2019, a shared link) opens it first, so the visitor sees what the link points to. A hidden panel
  // is opened by the control that names it (aria-controls), as a click would.
  // A fold that a script opens as the page loads (a link's #target, ?highlight=, a search in the address) shows at
  // once, like one open in the HTML: the fade (site.css .fold-fade) is off (html.fold-now) while its style is applied
  M.openFoldNow = (d) => {
    const html = document.documentElement;
    html.classList.add("fold-now");
    d.open = true;
    void getComputedStyle(d, "::details-content").opacity;
    html.classList.remove("fold-now");
  };
  function openToHash() {
    let id = "";
    try {
      id = decodeURIComponent((location.hash || "").slice(1));
    } catch (e) {}
    const target = id && document.getElementById(id);
    if (!target) return;
    let opened = false;
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      if (el.tagName === "DETAILS" && !el.open) {
        M.openFoldNow(el);
        opened = true;
      } else if (el.id && getComputedStyle(el).display === "none") {
        const ctl = document.querySelector('[aria-controls="' + CSS.escape(el.id) + '"]');
        if (ctl) {
          ctl.click();
          opened = true;
        }
      }
    }
    if (opened) setTimeout(() => target.scrollIntoView({ block: "start" }), 60);
  }
  // A site-search result whose words sit in a <details> (an FAQ answer, a committee's folded list) — no heading inside
  // to link to — arrives with ?highlight=<words>: the <details> that hold all the words open, and the smallest part
  // holding them (a document row, an answer) comes into view when the link has no #target of its own. A general word
  // that is in more than three of them ("minutes" on the minutes shelf) leaves the page as it is.
  function openToHighlight() {
    let q = "";
    try {
      q = new URLSearchParams(location.search).getAll("highlight").join(" ");
    } catch (e) {}
    const S = window.MSearch;
    if (!q || !S) return;
    const parsed = S.query(q);
    if (parsed.empty) return;
    const has = (el) => S.test(S.index(el.textContent), parsed);
    const hits = [...document.querySelectorAll("main details")].filter(has);
    // the innermost ones: opening them opens their parents too
    const inner = hits.filter((d) => !hits.some((o) => o !== d && d.contains(o)));
    if (!inner.length || inner.length > 3) return;
    inner.forEach((d) => {
      for (let el = d; el; el = el.parentElement) if (el.tagName === "DETAILS" && !el.open) M.openFoldNow(el);
    });
    if (location.hash) return;
    let spot = inner[0];
    for (let c; (c = [...spot.children].find(has)); ) spot = c;
    setTimeout(() => spot.scrollIntoView({ block: "center" }), 60);
  }
  // after Alpine has hidden the panels it shows one at a time
  document.addEventListener("alpine:initialized", openToHash);
  document.addEventListener("alpine:initialized", openToHighlight);
  window.addEventListener("hashchange", openToHash);

  /* ---------------------------------------------------------- boot */
  function boot() {
    M.applyTime();
    initReveal();
    initLightbox();
    // Re-check the clock every minute so long-open pages stay right.
    setInterval(() => M.applyTime(), 60 * 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

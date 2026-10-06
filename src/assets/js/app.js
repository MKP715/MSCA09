/*
  MSCA09 — browser-side behaviour shared by every page.
  Alpine.js components (registered on "alpine:init") plus a few small
  vanilla helpers. Page-specific scripts (calendar, documents, …) live in
  their own files and register their own components the same way.

  Time-awareness — the site keeps itself current between builds:
    data-hide-after="ISO"   element is removed once that moment has passed
    data-show-after="ISO"   element is hidden until that moment
    data-when="ISO"         a [data-rel] child gets "Today" / "Tomorrow" / "In 3 days"
    data-limit="N"          on a list: after pruning, only the first N children stay visible
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
      [...list.children].forEach((c, i) => {
        if (c.matches("[data-keep]")) return;
        c.hidden = i >= n;
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
  function initReveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || M.reducedMotion) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    els.forEach((el) => io.observe(el));
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
          // Drive flyers have unknown sizes: measure on open.
          lb.addFilter("itemData", (data) => {
            const a = data.element;
            if (a && (!a.dataset.pswpWidth || a.dataset.pswpWidth === "0")) {
              data.width = 1200;
              data.height = 1550;
            }
            return data;
          });
          lb.on("contentLoad", (e) => {
            const { content } = e;
            if (content.type !== "image") return;
            const img = new Image();
            img.onload = () => {
              content.width = img.naturalWidth;
              content.height = img.naturalHeight;
              content.slide && content.slide.updateContentSize(true);
            };
            img.src = content.data.src;
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
        const onScroll = () => (this.scrolled = window.scrollY > 24);
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
    Alpine.data("navDrop", () => ({
      open: false,
      hov: false,
      init() {
        this.$watch("open", (v) => v && this.$nextTick(() => this.fit()));
      },
      enter(e) {
        if (e.pointerType !== "mouse") return;
        this.open = true;
        this.hov = true;
      },
      leave(e) {
        if (e.pointerType !== "mouse") return;
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

    // "Pause animations" button: <button x-data="motionToggle" @click="toggle()" :aria-pressed="paused.toString()">
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

    Alpine.data("searchModal", () => ({
      open: false,
      ready: false,
      failed: false,
      show() {
        this.open = true;
        this.$nextTick(() => this.mount());
      },
      hide() {
        this.open = false;
      },
      async mount() {
        if (this.ready) {
          const input = this.$refs.mount.querySelector("input");
          input && input.focus();
          return;
        }
        try {
          await M.load("/pagefind/pagefind-ui.css", true);
          await M.load("/pagefind/pagefind-ui.js");
          new window.PagefindUI({
            element: "#site-search",
            showSubResults: true,
            showImages: false,
            resetStyles: false,
            autofocus: true,
            translations: {
              placeholder: tr("search.placeholder"),
              zero_results: tr("search.zero_results"),
              many_results: tr("search.many_results"),
              one_result: tr("search.one_result"),
              load_more: tr("search.load_more"),
            },
          });
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

    Alpine.data("shareLink", (title) => ({
      done: false,
      async share() {
        const url = window.location.href;
        if (navigator.share && matchMedia("(pointer: coarse)").matches) {
          try {
            await navigator.share({ title: title || document.title, url });
            return;
          } catch (e) {
            /* fall through to copy */
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          this.done = true;
          M.announce(tr("ui.link_copied"));
          setTimeout(() => (this.done = false), 2000);
        } catch (e) {}
      },
    }));

    Alpine.data("countUp", (target) => ({
      display: M.reducedMotion ? target : 0,
      start() {
        if (M.reducedMotion) return;
        const n = Number(target) || 0;
        const t0 = performance.now();
        const dur = 1200;
        const step = (t) => {
          const p = Math.min(1, (t - t0) / dur);
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
    // Nearby pins merge into numbered clusters (Leaflet.markercluster) that split apart as you zoom.
    // On touch screens one finger scrolls the page; two fingers move the map.
    Alpine.data("leafletMap", (points, zoom) => ({
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
        const group = L.markerClusterGroup
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

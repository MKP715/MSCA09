/*
  MSCA09 — home page behaviour (loaded before app.js and Alpine; see src/pages/index.njk).
    homeHero        cross-fading banner photos (each added just before its turn; never when
                    the visitor prefers reduced motion or saves data), pause button, photo credit
    homeCarousel    Swiper carousel of upcoming events, loaded when it scrolls near; stops
                    moving on focus, swipe or Pause
    homeCitySearch  "type your city" → district page
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fold = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  const load = (src, css) => (M.load ? M.load(src, css) : Promise.reject(new Error("MSCA.load missing")));

  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    /* ------------------------------------------------------------ hero slideshow */
    // Only the first photo comes with the page. Each of the others is added to the page (and so
    // downloaded) just before its turn, so a visitor who leaves early downloads one photo only.
    // No slideshow when the visitor prefers less motion or their browser asks to save data.
    const slowNet = () => {
      const c = navigator.connection;
      return !!(c && (c.saveData || /(^|-)2g$|^3g$/.test(c.effectiveType || "")));
    };
    Alpine.data("homeHero", (credits) => ({
      credits: credits && credits.length ? credits : [{ text: "", source: "", license: "", licenseUrl: "" }],
      i: 0, // the photo on screen (its credit is shown)
      cur: 0, // where the slideshow is up to
      paused: false,
      rotating: false,
      visible: true,
      slides: [],
      later: [],
      timer: null,
      init() {
        const box = this.$refs.slides;
        if (!box || reduced() || slowNet() || this.credits.length < 2) return;
        this.slides = [...box.querySelectorAll(".hm-hero-slide")];
        this.later = [...box.querySelectorAll("template[data-hero-slide]")];
        if (!this.slides.length || !this.later.length) return;
        const start = () =>
          setTimeout(() => {
            this.rotating = true;
            this.schedule();
          }, 1500);
        if (document.readyState === "complete") start();
        else window.addEventListener("load", start, { once: true });
        if ("IntersectionObserver" in window) {
          new IntersectionObserver(([e]) => (this.visible = e.isIntersecting), { threshold: 0.05 }).observe(this.$el);
        }
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden && this.rotating && !this.paused) this.schedule();
        });
      },
      count() {
        return this.slides.length + this.later.length;
      },
      // The slide element for position n, adding it to the page the first time it is needed.
      slide(n) {
        while (n >= this.slides.length && this.later.length) {
          const t = this.later.shift();
          const node = t.content.firstElementChild && t.content.firstElementChild.cloneNode(true);
          t.remove();
          if (!node) continue;
          node.setAttribute("aria-hidden", "true");
          const img = node.querySelector("img");
          if (img) img.loading = "eager";
          this.$refs.slides.appendChild(node);
          this.slides.push(node);
        }
        return this.slides[n] || null;
      },
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.advance(), 7500);
      },
      async advance() {
        if (this.paused) return;
        if (!this.visible || document.hidden) return this.schedule();
        const next = (this.cur + 1) % this.count();
        this.cur = next;
        const el = this.slide(next);
        const img = el && el.querySelector("img");
        if (!img) return this.schedule();
        try {
          if (!img.complete) await Promise.race([img.decode(), new Promise((r) => setTimeout(r, 8000))]);
        } catch (e) {
          /* a photo that fails to load is simply skipped */
        }
        if (this.paused) return;
        if (!img.complete || img.naturalWidth === 0) return this.schedule();
        this.show(next);
        this.schedule();
      },
      show(n) {
        this.slides.forEach((s, k) => {
          s.classList.toggle("is-active", k === n);
          if (k === n) s.removeAttribute("aria-hidden");
          else s.setAttribute("aria-hidden", "true");
        });
        this.i = Math.min(n, this.credits.length - 1);
      },
      toggle() {
        this.paused = !this.paused;
        if (this.paused) clearTimeout(this.timer);
        else this.schedule();
      },
      pause() {
        this.paused = true;
        clearTimeout(this.timer);
      },
    }));

    /* ------------------------------------------------------------ events carousel */
    // Swiper carousel of upcoming events. It moves on by itself every 6 seconds, but stops for good
    // as soon as the visitor tabs into it, swipes it or presses Pause (WCAG 2.2.2), and never
    // moves for visitors who prefer less motion. Up to 7 events get dots; more get "3 / 12".
    Alpine.data("homeCarousel", () => ({
      swiper: null,
      auto: false, // the carousel can move by itself (shows the Pause button)
      paused: false,
      init() {
        const el = this.$refs.swiper;
        if (!el) return;
        el.addEventListener("focusin", () => this.pause());
        if ("IntersectionObserver" in window) {
          const io = new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) {
                io.disconnect();
                this.start();
              }
            },
            { rootMargin: "400px 0px" }
          );
          io.observe(el);
        } else this.start();
      },
      async start() {
        const el = this.$refs.swiper;
        try {
          await Promise.all([
            load("/assets/vendor/swiper/swiper-bundle.min.css", true),
            load("/assets/vendor/swiper/swiper-bundle.min.js"),
          ]);
        } catch (e) {
          return; // the plain scrolling row keeps working
        }
        if (!window.Swiper || !el.isConnected) return;
        const slides = el.querySelectorAll(".swiper-slide");
        if (!slides.length) return;
        const es = M.lang === "es";
        const many = slides.length > 7;
        const moving = !reduced() && slides.length > 1;
        this.swiper = new window.Swiper(el, {
          slidesPerView: "auto",
          spaceBetween: 16,
          grabCursor: true,
          watchOverflow: true,
          watchSlidesProgress: true,
          keyboard: { enabled: true, onlyInViewport: true },
          a11y: {
            enabled: true,
            prevSlideMessage: es ? "Anterior" : "Previous",
            nextSlideMessage: es ? "Siguiente" : "Next",
            paginationBulletMessage: es ? "Ir al evento {{index}}" : "Go to event {{index}}",
            slideLabelMessage: es ? "{{index}} de {{slidesLength}}" : "{{index}} of {{slidesLength}}",
            slideRole: "group",
          },
          navigation: this.$refs.prev ? { prevEl: this.$refs.prev, nextEl: this.$refs.next, disabledClass: "is-disabled" } : false,
          pagination: this.$refs.pagination
            ? many
              ? { el: this.$refs.pagination, type: "fraction" }
              : { el: this.$refs.pagination, type: "bullets", clickable: true }
            : false,
          autoplay: moving ? { delay: 6000, pauseOnMouseEnter: true, disableOnInteraction: true } : false,
          breakpoints: { 1024: { spaceBetween: 24 } },
          on: {
            // a swipe or an arrow press stops the autoplay (disableOnInteraction); show it as paused
            autoplayStop: () => {
              this.paused = true;
            },
          },
        });
        this.auto = moving && !!this.swiper.autoplay;
        if (this.paused && this.swiper.autoplay) this.swiper.autoplay.stop();
      },
      pause() {
        this.paused = true;
        if (this.swiper && this.swiper.autoplay && this.swiper.autoplay.running) this.swiper.autoplay.stop();
      },
      toggle() {
        if (!this.swiper || !this.swiper.autoplay) return;
        if (this.paused) {
          this.paused = false;
          this.swiper.autoplay.start();
        } else this.pause();
      },
    }));

    /* ------------------------------------------------------------ find your district */
    Alpine.data("homeCitySearch", (id) => ({
      q: "",
      open: false,
      active: -1,
      index: [],
      init() {
        try {
          const el = document.getElementById(id);
          const raw = el ? JSON.parse(el.textContent) : null;
          // { p: "/es" | "", d: { slug: [label, number, "en"|"es", colour] }, c: [[city, slug], …] }
          this.index = raw && raw.c
            ? raw.c.map(([c, s]) => {
                const x = raw.d[s] || [s, s, "en", ""];
                return { c, s, f: fold(c), l: x[0], n: x[1], k: x[2], col: x[3], u: (raw.p || "") + "/districts/" + s + "/" };
              })
            : [];
        } catch (e) {
          this.index = [];
        }
      },
      get results() {
        const f = fold(this.q);
        if (!f) return [];
        const starts = [];
        const words = [];
        const inside = [];
        for (const r of this.index) {
          if (r.f.startsWith(f)) starts.push(r);
          else if (r.f.split(/[\s\-–/().]+/).some((w) => w.startsWith(f))) words.push(r);
          else if (f.length > 2 && r.f.includes(f)) inside.push(r);
        }
        return starts.concat(words, inside).slice(0, 8);
      },
      move(d) {
        const n = this.results.length;
        if (!n) return;
        this.open = true;
        this.active = (this.active + d + n) % n;
      },
      go(n) {
        const list = this.results;
        const r = list[n != null ? n : this.active >= 0 ? this.active : 0];
        if (r && r.u) window.location.href = M.url ? M.url(r.u) : r.u;
      },
    }));
  });
})();

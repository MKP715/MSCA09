/*
  MSCA09 — home page behaviour (loaded before app.js and Alpine; see src/pages/index.njk).
    homeHero        cross-fading banner photos (each added just before its turn; never when
                    the visitor prefers reduced motion or saves data), pause button, photo credit
    homeCarousel    Swiper carousel of upcoming events, loaded when it scrolls near; stops
                    moving on focus, swipe or Pause
    homeCitySearch  "type your city" (or a district number, an area, a county) → district page
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const load = (src, css) => (M.load ? M.load(src, css) : Promise.reject(new Error("MSCA.load missing")));

  /* ------------------------------------------------------------ city search rules
     The same rules as the Districts page finder (src/assets/js/districts.js: keep the two in step).
     Matching uses MSearch (src/assets/js/search.js, loaded first): accents, case, punctuation, word order,
     plurals, "District 5" = "D5" = "Distrito 05". */
  const S = window.MSearch;
  // a name for "starts with" tests: folded, punctuation as spaces ("Coto-de-Caza" = "coto de caza")
  const fold = (s) => S.fold(s).replace(/[^a-z0-9]+/g, " ").trim();
  // the end of an address, as fold() leaves it: state, ZIP (+4) and country ("ca 92501 1234", "california usa")
  const ADDR = /(?: (?:ca|calif|california))?(?: \d{5}(?: \d{4})?)?(?: (?:usa|us|u s a|united states|estados unidos|ee uu|eeuu))?$/;
  const CITY_CAP = 12; // cities listed at most (with all their districts; the list scrolls); the list says how many more match

  // the query as MSearch reads it (the word still being typed matches the start of a word: "San J" → San Jacinto)
  const parse = (q) => S.query(q);

  // "5", "05", "D5", "#5", "District 22", "Distrito 1 y 3", "1 & 3", "1-3", "d01-03", "districts 20-25"
  // → [numbers] (any of them); anything else → null
  function numbers(p) {
    if (!p.terms.length || p.emails.length || (p.partial || []).length) return null;
    const num = (v) => /^d?\d{1,3}$/.test(v);
    const out = [];
    for (const t of p.terms) {
      // "1-3" is read as "13" or as 1 and 3: the parts
      const vs = t.parts && t.parts.every((x) => x.v.every(num)) ? t.parts.flatMap((x) => x.v) : t.v;
      if (!vs.every(num)) return null;
      vs.forEach((v) => out.push(Number(v.replace("d", ""))));
    }
    return out;
  }

  // "Orange County", "Riverside Co", "County of San Bernardino", "Condado de Orange" → the county's name
  function countyName(f, counties) {
    const m = f.match(/^(?:condado de|county of) (.+)$/) || f.match(/^(.+?) (?:co|cnty|county|condado)$/);
    if (!m) return "";
    return counties.find((c) => c === m[1] || (m[1].length > 2 && /^condado|^county/.test(f) && c.startsWith(m[1]))) || "";
  }

  // Rows for one query, best first: 0 = the city starts with it, 1 = a word of the city does, 2 = the name
  // without spaces only ("laquinta"), 3 = every word typed starts a word of the city, in any order ("beach long";
  // fewest words first: "springs palm" → Palm Springs, then North Palm Springs), 4 = another name does ("29 Palms",
  // "Two Harbors": via = that name), 5 = the city contains it ("ville"), 6 = the part of the city the district
  // serves does ("north of Carson St"). → { strong: tiers 0-5, weak: tier 6 }, each [{ c: row, via }]
  function matchCities(list, q, f) {
    const p = parse(q);
    const flat = f.replace(/ /g, "");
    // words MSearch leaves out ("la", "de", "el") still have to start a word ("la h" → La Habra and Laguna Hills, not Hemet)
    const used = new Set(p.terms.flatMap((t) => t.v));
    const extra = f.split(" ").filter((w) => !used.has(w) && !used.has(String(Number(w))));
    const ok = (hay) => !p.empty && S.test(hay, p) && extra.every((w) => hay.includes(" " + w));
    const tiers = [[], [], [], [], [], [], []];
    // another name: one that starts with what was typed first ("isla Catalina" → Isla Catalina, not Catalina Island)
    const other = (xs) => xs.find((x) => x.f.startsWith(f) || x.flat.startsWith(flat)) || xs.find((x) => ok(x.h));
    for (const c of list) {
      let t = -1;
      let via = "";
      if (c.f.startsWith(f)) t = 0;
      else if (c.w.some((w) => w.startsWith(f))) t = 1;
      else if (flat.length > 2 && c.flat.startsWith(flat)) t = 2;
      else if (ok(c.hn)) t = 3;
      else if (f.length > 1 && (c.names.length || c.miss.length)) {
        const n = other(c.names);
        if (n) [t, via] = [4, n.n];
        else if (other(c.miss)) t = 4;
      }
      if (t < 0 && f.length > 2 && c.f.includes(f)) t = 5;
      if (t < 0 && f.length > 1 && ok(c.hq)) t = 6;
      if (t >= 0) tiers[t].push({ c, via });
    }
    tiers[3].sort((a, b) => a.c.w.length - b.c.w.length);
    return { strong: [].concat(...tiers.slice(0, 6)), weak: tiers[6] };
  }

  // Prepares one row for matchCities: name = the city, other = { names, misspellings }, quals = the part of
  // the city the district serves, in both languages ("outside District 10" counts as "outside": not a number).
  function prepCity(c, name, other, quals) {
    const one = (n) => ({ n, f: fold(n), flat: fold(n).replace(/ /g, ""), h: S.index(n) });
    c.f = fold(name);
    c.w = c.f.split(" ");
    c.flat = c.f.replace(/ /g, "");
    c.hn = S.index(name);
    c.names = (other.names || []).map(one);
    c.miss = (other.misspellings || []).map(one);
    const q = quals.filter(Boolean).map((s) => s.replace(/\b(?:district|distrito)\s*\d*/gi, " "));
    c.hq = S.index(name, other.names || [], other.misspellings || [], q);
    return c;
  }

  // The districts whose region names the area typed ("Coachella Valley", "High Desert", "Alto Desierto"): its
  // words, in that order ("cañon lake" is not "the canyon communities … Lake Forest"); with the districts that
  // share their groups: an English-speaking district brings the Spanish-speaking ones that cover it; one or two
  // Spanish-speaking districts alone bring the English-speaking ones they cover ("Inland Empire" → District 23
  // and Districts 8, 14, 17). Slugs in the districts' order.
  function matchAreas(districts, q) {
    const p = parse(q);
    if (p.empty) return [];
    const qw = fold(q).split(" ");
    const phrase = (aw) => aw.some((_, i) => qw.every((w, j) => aw[i + j] && aw[i + j].startsWith(w)));
    const hits = Object.keys(districts).filter((s) => districts[s].ha && S.test(districts[s].ha, p) && phrase(districts[s].aw));
    const want = new Set(hits);
    const en = hits.filter((s) => districts[s].kind !== "es");
    if (en.length) en.forEach((s) => (districts[s].spanish || []).forEach((x) => want.add(x)));
    else if (hits.length <= 2) hits.forEach((s) => (districts[s].covers || []).forEach((x) => want.add(x)));
    return Object.keys(districts).filter((s) => want.has(s));
  }

  // Everything the box lists for a query: { ds: [district slugs], cs: [{ c: row, via }] } (uncapped).
  // A district number lists only its district; a county lists its districts (the same as the county chips of
  // the Districts page); otherwise cities, then — when no city name matches — the districts of the area typed.
  // "Torrance, CA 90501" is read as "Torrance"; "Palm Springs airport" offers Palm Springs.
  function find(data, q) {
    const f = fold(q);
    if (!f) return { ds: [], cs: [] };
    const D = data.districts;
    const ns = numbers(parse(q));
    if (ns) {
      const ds = Object.keys(D).filter((s) => (D[s].nums || []).some((n) => ns.includes(n)));
      if (ds.length) return { ds, cs: [] };
    }
    const g = f.replace(ADDR, "").trim(); // without the state, ZIP and country
    const county = countyName(g || f, data.counties);
    if (county) return { ds: Object.keys(D).filter((s) => D[s].cf.includes(county)), cs: [] };
    let r = matchCities(data.cities, q, f);
    if (!r.strong.length && g.length > 2 && g !== f) {
      const r2 = matchCities(data.cities, g, g);
      if (r2.strong.length || !r.weak.length) r = r2;
    }
    let ds = [];
    const cs = r.strong.concat(r.weak);
    if (!r.strong.length) {
      if (f.length > 2) ds = matchAreas(D, q);
      if (!ds.length && g.length > 2 && g !== f) ds = matchAreas(D, g);
      // a city followed by other words ("Coachella Valley", "Palm Springs airport"), longest name first
      const lead = data.cities.filter((c) => (g || f).startsWith(c.f + " ") && !cs.some((x) => x.c === c));
      lead.sort((a, b) => b.f.length - a.f.length).forEach((c) => cs.push({ c, via: "" }));
    }
    return { ds, cs };
  }

  // "Dis…", "Distr…", "Distrito" on the way to "District 5": not a miss yet
  const typingDistrict = (q) => {
    const f = fold(q);
    return f.length > 1 && ["district", "distrito", "dto"].some((w) => w.startsWith(f) || f === w + "s");
  };

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
    // Index: <script id="home-city-index"> from homeCityIndex (src/_lib/plugins/home.js). One row per city and
    // district; a district number, a county or an area ("Coachella Valley") lists district rows. Rules: find() above.
    Alpine.data("homeCitySearch", (id) => {
      // the search data (outside Alpine's reactive state: it never changes) and the last query's rows
      // (results is read several times per keystroke)
      const memo = { data: null, q: null, r: null };
      return {
        q: "",
        open: false,
        active: -1,
        init() {
          try {
            const el = document.getElementById(id);
            const raw = el ? JSON.parse(el.textContent) : null;
            if (!raw || !raw.c) return;
            // { p, d: { slug: [label, number, "en"|"es", colour, numbers, counties, area, spanish, covers] },
            //   c: [[city, slug, part?, other?], …], a: { city: [other name, …] }, m: { city: [misspelling, …] } }
            const url = (s) => (raw.p || "") + "/districts/" + s + "/";
            const districts = {};
            for (const [s, x] of Object.entries(raw.d || {})) {
              districts[s] = {
                l: x[0], n: x[1], kind: x[2], col: x[3], nums: x[4] || [], cf: (x[5] || []).map(fold),
                ha: x[6] ? S.index(x[6]) : "", aw: fold(x[6] || "").split(" "), spanish: x[7] || [], covers: x[8] || [], u: url(s),
              };
            }
            const al = raw.a || {};
            const ms = raw.m || {};
            const cities = raw.c.map(([c, s, part, other]) => {
              const x = districts[s] || { l: s, n: s, kind: "en", col: "" };
              const row = { c, s, part: part || "", l: x.l, n: x.n, k: x.kind, col: x.col, u: url(s) };
              return prepCity(row, c, { names: al[c], misspellings: ms[c] }, [part, other]);
            });
            memo.data = { cities, districts, counties: [...new Set(Object.values(districts).flatMap((x) => x.cf))] };
          } catch (e) {
            memo.data = null;
          }
        },
        // { rows, more }: district rows, then the rows of the first CITY_CAP cities (every district of each);
        // more = how many more cities match
        get found() {
          if (memo.q === this.q) return memo.r;
          let r = { rows: [], more: 0 };
          if (memo.data) {
            const { ds, cs } = find(memo.data, this.q);
            const D = memo.data.districts;
            const rows = ds.map((s) => ({ c: D[s].l, s, part: "", via: "", l: "", n: D[s].n, k: D[s].kind, col: D[s].col, u: D[s].u }));
            const names = [...new Set(cs.map((x) => x.c.c))];
            const keep = new Set(names.slice(0, CITY_CAP));
            for (const { c, via } of cs)
              if (keep.has(c.c)) rows.push({ c: c.c, s: c.s, part: c.part, via, l: c.l, n: c.n, k: c.k, col: c.col, u: c.u });
            r = { rows, more: names.length - keep.size };
          }
          memo.q = this.q;
          memo.r = r;
          return r;
        },
        get results() {
          return this.found.rows;
        },
        // cities that match but are not listed: the list says so ("keep typing")
        get more() {
          return this.found.more;
        },
        // something to show for what was typed: rows, or the "no city by that name" line (not for spaces only,
        // nor for "Dis…" on the way to "District 5")
        get shown() {
          return !!this.q.trim() && (this.results.length > 0 || !typingDistrict(this.q));
        },
        onInput() {
          this.open = true;
          this.active = this.results.length ? 0 : -1;
          this.$nextTick(() => {
            const list = document.getElementById("home-city-list");
            if (list) list.scrollTop = 0;
          });
        },
        move(d) {
          const n = this.results.length;
          if (!n) return;
          this.open = true;
          this.active = (this.active + d + n) % n;
          // keep the highlighted row in sight in the scrolling list
          this.$nextTick(() => {
            const el = document.getElementById("home-city-opt-" + this.active);
            if (el) el.scrollIntoView({ block: "nearest" });
          });
        },
        go(n) {
          const list = this.results;
          const r = list[n != null ? n : this.active >= 0 ? this.active : 0];
          if (r && r.u) window.location.href = M.url ? M.url(r.u) : r.u;
        },
      };
    });
  });
})();

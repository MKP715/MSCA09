/*
  MSCA09 — scripts for the informational pages (About, Policy, Newcomers,
  Resources, Contribute, 404). Loaded before Alpine via the page's
  front matter `scripts: ["/assets/js/content.js"]`.
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});

  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    // Highlights the in-page link of the section being read.
    // <nav x-data="sectionNav" data-sections="a,b,c">
    // The active section is the last one whose top has passed a reading line about a
    // quarter of the way down the window. Above the first section (the page hero) the
    // first link is active; at the very bottom of the page, the last section on screen is.
    // Sections a filter has hidden (the Resources text filter) are skipped; the filter
    // sends "msca:sections" when it changes them.
    Alpine.data("sectionNav", () => ({
      active: "",
      init() {
        const ids = (this.$el.dataset.sections || "").split(",").filter(Boolean);
        const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
        if (!els.length) return;
        this.active = els[0].id;
        let queued = false;
        const update = () => {
          queued = false;
          const shown = els.filter((el) => !el.hidden);
          if (!shown.length) return;
          const line = window.innerHeight * 0.28;
          let current = shown[0];
          for (const el of shown) {
            if (el.getBoundingClientRect().top <= line) current = el;
            else break;
          }
          const doc = document.documentElement;
          if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
            const onScreen = shown.filter((el) => el.getBoundingClientRect().top < window.innerHeight);
            if (onScreen.length) current = onScreen[onScreen.length - 1];
          }
          this.active = current.id;
        };
        const queue = () => {
          if (!queued) {
            queued = true;
            requestAnimationFrame(update);
          }
        };
        window.addEventListener("scroll", queue, { passive: true });
        window.addEventListener("resize", queue, { passive: true });
        window.addEventListener("hashchange", queue);
        window.addEventListener("msca:sections", queue);
        update();
      },
    }));

    // Filters office cards by language, region and the reader's city.
    // Cards carry data-office, data-lang (en|es|multi), data-region, data-districts ("d05 d06").
    // The city list (<script id="city-districts">, from cityIndex in src/_lib/plugins/content.js) gives each
    // city its districts, its other names (aliases: "Catalina" → Avalon) and common misspellings ("Torrence").
    Alpine.data("officeFinder", () => {
      // every name a city answers to, folded once by the shared matcher (MSearch, search.js);
      // kept out of Alpine's reactive state. kind: 0 = the city, 1 = another name, 2 = a misspelling
      let names = [];
      const squash = (s) => s.replace(/[^a-z0-9]/g, "");
      return {
        lang: "all",
        region: "all",
        city: "",
        cityMatch: null, // { label, districts: [{slug,label,url,related}], none, zip, suggest: [{name,label}] }
        cityFallback: "", // "near" | "all": the city's own districts have no phone office in the chosen language
        cities: [],
        shown: 0,
        filtersOpen: false,
        init() {
          try {
            const src = document.getElementById("city-districts");
            this.cities = src ? JSON.parse(src.textContent || "[]") : [];
            // the district links in the JSON are site paths ("/districts/d05/"): add the path prefix
            // (https://<user>.github.io/<repo>/), which the build does not add inside JSON
            const base = M.base || "/";
            for (const c of this.cities)
              for (const d of c.districts || [])
                if (d.url && d.url.charAt(0) === "/" && d.url.charAt(1) !== "/" && M.url && !(base !== "/" && d.url.indexOf(base) === 0))
                  d.url = M.url(d.url);
          } catch (e) {
            this.cities = [];
          }
          const S = window.MSearch;
          names = [];
          for (const c of this.cities) {
            const add = (name, kind, label) => {
              const f = S.fold(name);
              names.push({ c, name, kind, label, f, sq: squash(f), hay: S.index(name) });
            };
            add(c.city, 0, c.city);
            (c.aliases || []).forEach((a) => add(a, 1, a + " (" + c.city + ")"));
            (c.misspellings || []).forEach((a) => add(a, 2, c.city));
          }
          this.$watch("lang", () => this.apply());
          this.$watch("region", () => this.apply());
          this.$nextTick(() => this.apply());
        },
        setLang(v) {
          this.lang = v;
        },
        setRegion(v) {
          this.region = v;
        },
        // Finds the typed city with the shared matcher (MSearch: case, accents, spaces, punctuation):
        //  1. the whole name, also typed without spaces ("LaQuinta"), or a common misspelling ("Torrence");
        //  2. names whose words start with the words typed ("Santa", "San Bern", "Mirage") — a name with a word
        //     exactly as typed first, then a real city before another name for one ("Santa" is Santa Ana, not
        //     Santa Catalina Island), then a name that starts with it;
        //  3. names that contain the letters typed ("ville").
        // "Santa Ana, CA 92701" is read as "Santa Ana"; a ZIP code on its own asks for the city's name.
        // When nothing is found, up to three names a letter or two away are offered ("Did you mean …?").
        findCity() {
          const S = window.MSearch;
          const typed = S.fold(this.city);
          const exact = (q) => {
            const qs = squash(q);
            return names.filter((x) => x.f === q || (qs !== "" && x.sq === qs)).sort((a, b) => a.kind - b.kind);
          };
          let q = typed;
          let hits = exact(q);
          if (!hits.length) {
            // a bare name is used as typed ("Mecca", "Rancho California"); otherwise drop a ZIP code
            // and a separate ", CA" / "Calif." / "California" at the end
            q = typed
              .replace(/\s*\b\d{5}(?:-\d{4})?$/, "")
              .replace(/[\s,.;]+$/, "")
              .replace(/(?:^|,\s*|\s+)(?:ca|calif\.?|california)$/, "")
              .replace(/[\s,.;]+$/, "");
            if (!q) {
              // an empty box clears; a ZIP code or "CA" on its own is not a city in our lists: say so
              this.cityMatch = typed ? { label: this.city.trim(), districts: [], none: true, zip: /\d/.test(typed), suggest: [] } : null;
              this.apply();
              return;
            }
            hits = exact(q);
          }
          if (!hits.length) {
            const parsed = S.query(q);
            const qs = squash(q);
            const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 1);
            const rank = (x) => [-words.filter((w) => x.hay.includes(" " + w + " ")).length, x.kind, x.f.startsWith(q) ? 0 : 1, -S.score(x.hay, parsed)];
            const order = (list) =>
              list
                .map((x, i) => ({ x, r: rank(x).concat(i) }))
                .sort((a, b) => {
                  for (let k = 0; k < a.r.length; k++) if (a.r[k] !== b.r[k]) return a.r[k] - b.r[k];
                  return 0;
                })
                .map((o) => o.x);
            const named = names.filter((x) => x.kind < 2);
            hits = parsed.empty ? [] : order(named.filter((x) => S.test(x.hay, parsed)));
            if (!hits.length && qs.length >= 4) hits = order(named.filter((x) => x.sq.includes(qs)));
          }
          if (!hits.length) {
            this.cityMatch = { label: this.city.trim(), districts: [], none: true, zip: false, suggest: this.nearCities(squash(q)) };
          } else {
            const first = hits[0];
            // another name shared by several cities ("Big Bear Valley": Big Bear City and Big Bear Lake) gives them all
            const same = hits.filter((x) => x.c === first.c || (first.kind === 1 && x.kind === 1 && x.f === first.f));
            const towns = [...new Set(same.map((x) => x.c.city))];
            const districts = [];
            same.forEach((x) => (x.c.districts || []).forEach((d) => districts.find((y) => y.slug === d.slug) || districts.push(d)));
            const label = towns.length > 1 ? first.name + " (" + towns.join(", ") + ")" : first.label;
            this.cityMatch = { label, districts, none: false };
            this.region = "all";
          }
          this.apply();
        },
        // Names one typo away (two for names of 8+ letters), closest first, offered as "Did you mean …?" buttons
        // rather than taken as the answer: a place outside the Area (Lynwood, Glendale) must not silently turn
        // into another city (Lenwood, Helendale).
        nearCities(qs) {
          if (qs.length < 4) return [];
          const max = qs.length >= 8 ? 2 : 1;
          // optimal string alignment distance: two swapped neighbouring letters count as one typo
          const dist = (a, b) => {
            const d = [];
            for (let i = 0; i <= a.length; i++) d.push([i]);
            for (let j = 1; j <= b.length; j++) d[0][j] = j;
            for (let i = 1; i <= a.length; i++)
              for (let j = 1; j <= b.length; j++) {
                d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
              }
            return d[a.length][b.length];
          };
          const seen = new Set();
          return names
            .filter((x) => Math.abs(x.sq.length - qs.length) <= max)
            .map((x) => ({ x, d: dist(x.sq, qs) }))
            .filter((o) => o.d <= max)
            .sort((a, b) => a.d - b.d || a.x.kind - b.x.kind)
            .filter((o) => !seen.has(o.x.c) && seen.add(o.x.c))
            .slice(0, 3)
            .map((o) => (o.x.kind === 1 ? { name: o.x.name, label: o.x.label } : { name: o.x.c.city, label: o.x.c.city }));
        },
        pickCity(name) {
          this.city = name;
          this.findCity();
        },
        // A name picked from the suggestion list, or filled in by the browser, is looked up at once (Safari fires
        // "change" only when the box loses focus). Typing is left alone until Enter, so the answer does not jump
        // about while a longer name ("Orange" → "Orange Park Acres") is still being typed.
        picked(e) {
          if (e.inputType && e.inputType !== "insertReplacementText") return;
          const v = window.MSearch.fold(e.target.value);
          if (v && names.some((x) => x.kind < 2 && x.f === v)) this.pickCity(e.target.value);
        },
        clearCity() {
          this.city = "";
          this.cityMatch = null;
          this.apply();
        },
        apply() {
          const cards = [...this.$root.querySelectorAll("[data-office]")];
          const okLang = (c) => this.lang === "all" || c.dataset.lang === this.lang || c.dataset.lang === "multi";
          const okRegion = (c) => this.region === "all" || c.dataset.region === this.region;
          const serves = (c, slugs) => (c.dataset.districts || "").split(" ").some((d) => d && slugs.includes(d));
          // The offices of the city's own districts. When none of them has a phone office in the chosen language,
          // the offices of the districts that share their groups (Big Bear Lake, District 25 → Districts 8, 19, 14);
          // failing that, every office. A city the lists give only a Spanish-speaking district also gets those
          // offices, so an English speaker still finds one (the build log asks for its English district).
          // The region chip is left out of this test, so a region picked after the city still empties the list
          // (and "Choose All" is then the right advice).
          let want = null;
          this.cityFallback = "";
          if (this.cityMatch && !this.cityMatch.none) {
            const has = (slugs) => cards.some((c) => c.dataset.lang !== "multi" && okLang(c) && serves(c, slugs));
            const own = this.cityMatch.districts.map((d) => d.slug);
            const near = [...new Set(this.cityMatch.districts.flatMap((d) => d.related || []))];
            if (has(own)) want = own;
            if (!want || this.cityMatch.districts.every((d) => d.spanish)) {
              if (near.length && has(near)) {
                want = (want || []).concat(near);
                this.cityFallback = "near";
              } else if (!want) this.cityFallback = "all";
            }
          }
          let n = 0;
          cards.forEach((card) => {
            const l = card.dataset.lang;
            const show = okLang(card) && okRegion(card) && (!want || l === "multi" || serves(card, want));
            (card.closest("[data-office-wrap]") || card).hidden = !show;
            if (show && l !== "multi") n++;
          });
          this.$root.querySelectorAll("[data-region-group]").forEach((g) => {
            g.hidden = ![...g.querySelectorAll("[data-office]")].some((c) => !(c.closest("[data-office-wrap]") || c).hidden);
          });
          this.shown = n;
        },
      };
    });

    // Text filter for resource cards: <input x-model="q"> inside x-data="resourceFilter".
    // Each card's data-search is built at build time with the shared matcher (MSearch.index, see resourceSearch and
    // officeSearch in src/_lib/plugins/content.js): everything the card shows in both languages, the heading it sits
    // under, and for offices their phones, districts and the cities of those districts.
    Alpine.data("resourceFilter", () => {
      let items = []; // { el, wrap, hay }, built once and kept out of Alpine's reactive state
      return {
        q: "",
        count: 0,
        init() {
          items = [...this.$root.querySelectorAll("[data-resource]")].map((el) => ({
            el,
            wrap: el.closest("[data-resource-wrap]") || el,
            hay: el.dataset.search || " ",
          }));
          this.count = items.length;
          this.$watch("q", () => this.apply());
        },
        apply() {
          const S = window.MSearch;
          const parsed = S.query(this.q);
          let oks = items.map((it) => S.test(it.hay, parsed));
          // Numbers match whole ("Area 9" is Area 09, not Area 93). When that finds nothing and the query ends in a
          // number, it may still be being typed ("Area 0" on the way to "Area 05"): match the start of a number.
          const typed = S.fold(this.q);
          const num = /(?:^|[^a-z0-9])(\d+)$/.exec(typed);
          if (num && !oks.includes(true)) {
            const rest = S.query(typed.slice(0, num.index + num[0].length - num[1].length));
            oks = items.map((it) => S.test(it.hay, rest) && it.hay.includes(" " + num[1]));
          }
          let n = 0;
          items.forEach((it, i) => {
            it.wrap.hidden = !oks[i];
            if (oks[i]) n++;
          });
          this.$root.querySelectorAll("[data-resource-group]").forEach((g) => {
            g.hidden = !items.some((it) => !it.wrap.hidden && g.contains(it.el));
          });
          // hide the "On this page" links (side list and chips) whose section the filter hid
          this.$root.querySelectorAll('nav a[href^="#"]').forEach((a) => {
            const sec = document.getElementById(a.getAttribute("href").slice(1));
            if (sec && sec.hasAttribute("data-resource-group")) (a.closest("li") || a).hidden = sec.hidden;
          });
          this.count = n;
          window.dispatchEvent(new Event("msca:sections"));
        },
      };
    });

    // Floating "Call" button on phones — hidden while the call section is on screen.
    Alpine.data("callFab", (targetId) => ({
      hidden: false,
      init() {
        const target = document.getElementById(targetId);
        if (!target || !("IntersectionObserver" in window)) return;
        const io = new IntersectionObserver((entries) => entries.forEach((e) => (this.hidden = e.isIntersecting)), { threshold: 0.05 });
        io.observe(target);
        const hero = document.querySelector("[data-hero]");
        if (hero) {
          const io2 = new IntersectionObserver((entries) => entries.forEach((e) => (this.inHero = e.isIntersecting)), { threshold: 0.3 });
          io2.observe(hero);
        }
      },
      inHero: true,
      get off() {
        return this.hidden || this.inHero;
      },
    }));

    // 404: show the address that was not found, and put Spanish first for /es/ links.
    Alpine.data("notFound", () => ({
      path: "",
      spanish: false,
      init() {
        this.path = decodeURIComponent(location.pathname + location.search);
        const base = (M.base || "/").replace(/\/$/, "");
        const p = location.pathname.slice(base.length);
        this.spanish = /^\/es(\/|$)/.test(p) || /^es\b/i.test(navigator.language || "");
      },
      get mailto() {
        const body = "Broken link / Enlace roto: " + location.href + (document.referrer ? "\nFrom / Desde: " + document.referrer : "");
        const to = this.$root.dataset.email || "";
        return "mailto:" + to + "?subject=" + encodeURIComponent("404 — " + location.host) + "&body=" + encodeURIComponent(body);
      },
    }));
  });
})();

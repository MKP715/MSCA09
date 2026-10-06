/*
  MSCA09 — scripts for the informational pages (About, Policy, Newcomers,
  Resources, Contribute, 404). Loaded before Alpine via the page's
  front matter `scripts: ["/assets/js/content.js"]`.
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();

  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    // Highlights the in-page link of the section being read.
    // <nav x-data="sectionNav" data-sections="a,b,c">
    // The active section is the last one whose top has passed a reading line about a
    // quarter of the way down the window. Above the first section (the page hero) the
    // first link is active; at the very bottom of the page, the last section on screen is.
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
          const line = window.innerHeight * 0.28;
          let current = els[0];
          for (const el of els) {
            if (el.getBoundingClientRect().top <= line) current = el;
            else break;
          }
          const doc = document.documentElement;
          if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
            const onScreen = els.filter((el) => el.getBoundingClientRect().top < window.innerHeight);
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
        update();
      },
    }));

    // Filters office cards by language, region and the reader's city.
    // Cards carry data-office, data-lang (en|es|multi), data-region, data-districts ("d05 d06").
    Alpine.data("officeFinder", () => ({
      lang: "all",
      region: "all",
      city: "",
      cityMatch: null, // { label, districts: [{slug,label,url}] }
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
      // Finds the typed city: exact name first, then names that start with it, then names
      // that contain it. Each city also answers to its other names (aliases: "Catalina" → Avalon).
      // "Santa Ana, CA 92701" is read as "Santa Ana".
      findCity() {
        const q = norm(this.city)
          .replace(/\s*\d{5}(-\d{4})?$/, "")
          .replace(/,?\s*(ca|calif\.?|california)$/, "")
          .replace(/[,.]+$/, "")
          .trim();
        if (!q) {
          this.cityMatch = null;
          this.apply();
          return;
        }
        // every name a city answers to, with the name to show when it matches
        const names = [];
        this.cities.forEach((c) => {
          names.push({ c, name: c.city, label: c.city });
          (c.aliases || []).forEach((a) => names.push({ c, name: a, label: a + " (" + c.city + ")" }));
        });
        const tests = [(n) => n === q, (n) => n.startsWith(q), (n) => q.length >= 3 && n.includes(q)];
        let hits = [];
        for (const test of tests) {
          hits = names.filter((x) => test(norm(x.name)));
          if (hits.length) break;
        }
        if (!hits.length) {
          this.cityMatch = { label: this.city, districts: [], none: true };
        } else {
          const first = hits[0];
          const same = hits.filter((x) => x.c === first.c || norm(x.c.city) === norm(first.c.city));
          const districts = [];
          same.forEach((x) => (x.c.districts || []).forEach((d) => districts.find((y) => y.slug === d.slug) || districts.push(d)));
          this.cityMatch = { label: first.label, districts, none: false };
          this.region = "all";
        }
        this.apply();
      },
      clearCity() {
        this.city = "";
        this.cityMatch = null;
        this.apply();
      },
      apply() {
        const want = this.cityMatch && !this.cityMatch.none ? this.cityMatch.districts.map((d) => d.slug) : null;
        let n = 0;
        this.$root.querySelectorAll("[data-office]").forEach((card) => {
          const l = card.dataset.lang;
          const okLang = this.lang === "all" || l === this.lang || l === "multi";
          const okRegion = this.region === "all" || card.dataset.region === this.region;
          const ds = (card.dataset.districts || "").split(" ").filter(Boolean);
          const okCity = !want || l === "multi" || ds.some((d) => want.includes(d));
          const show = okLang && okRegion && okCity;
          (card.closest("[data-office-wrap]") || card).hidden = !show;
          if (show && l !== "multi") n++;
        });
        this.$root.querySelectorAll("[data-region-group]").forEach((g) => {
          g.hidden = ![...g.querySelectorAll("[data-office]")].some((c) => !(c.closest("[data-office-wrap]") || c).hidden);
        });
        this.shown = n;
      },
    }));

    // Text filter for resource cards: <input x-model="q"> inside x-data="resourceFilter".
    Alpine.data("resourceFilter", () => ({
      q: "",
      count: 0,
      init() {
        this.$watch("q", () => this.apply());
        this.count = this.$root.querySelectorAll("[data-resource]").length;
      },
      apply() {
        const words = norm(this.q).split(/\s+/).filter(Boolean);
        let n = 0;
        this.$root.querySelectorAll("[data-resource]").forEach((el) => {
          const hay = norm(el.dataset.search);
          const ok = words.every((w) => hay.includes(w));
          (el.closest("[data-resource-wrap]") || el).hidden = !ok;
          if (ok) n++;
        });
        this.$root.querySelectorAll("[data-resource-group]").forEach((g) => {
          g.hidden = ![...g.querySelectorAll("[data-resource]")].some((c) => !(c.closest("[data-resource-wrap]") || c).hidden);
        });
        this.count = n;
      },
    }));

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

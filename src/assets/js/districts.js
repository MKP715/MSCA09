/*
  District pages: "Which district am I in?" city search, the filter chips on
  /districts/, and the in-page section navigation on /districts/<slug>/.
  Registered as Alpine components (this file loads before Alpine starts).
*/
(function () {
  "use strict";

  const fold = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9& ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  function readJson(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    /* ------------------------------------------------------------ city search */
    // Data: <script type="application/json" id="dx-data">{ cities:[{c,k,d:[{s,q,qes}]}], districts:{slug:{…}} }</script>
    Alpine.data("districtFinder", () => ({
      q: "",
      open: false,
      active: -1,
      picked: null,
      data: { cities: [], districts: {} },
      lang: (window.MSCA && window.MSCA.lang) || "en",
      init() {
        const d = readJson("dx-data");
        if (d) this.data = d;
        this.data.cities.forEach((c) => (c.f = fold(c.c)));
      },
      get results() {
        const q = fold(this.q);
        if (!q) return [];
        const out = [];
        const num = q.replace(/^(district|distrito|dist|d)\s*/, "");
        // "5", "district 20", "d1"
        if (/^\d{1,2}$/.test(num)) {
          const n = Number(num);
          for (const [slug, x] of Object.entries(this.data.districts)) {
            if ((x.nums || []).includes(n)) out.push({ type: "district", slug, label: x.name });
          }
        }
        const starts = [];
        const contains = [];
        for (const c of this.data.cities) {
          if (c.f.startsWith(q) || c.f.split(" ").some((w) => w.startsWith(q))) starts.push(c);
          else if (c.f.includes(q) || c.d.some((x) => fold(x.q).includes(q))) contains.push(c);
        }
        starts.sort((a, b) => (a.f.startsWith(q) ? 0 : 1) - (b.f.startsWith(q) ? 0 : 1));
        return out.concat([...starts, ...contains].slice(0, 8).map((c) => ({ type: "city", city: c, label: c.c })));
      },
      district(slug) {
        return this.data.districts[slug] || {};
      },
      qual(x) {
        return this.lang === "es" ? x.qes || x.q : x.q;
      },
      onInput() {
        this.open = true;
        this.active = this.results.length ? 0 : -1;
        if (!this.q) this.picked = null;
      },
      move(step) {
        const n = this.results.length;
        if (!n) return;
        this.open = true;
        this.active = (this.active + step + n) % n;
        this.$nextTick(() => {
          const el = document.getElementById("dx-opt-" + this.active);
          if (el) el.scrollIntoView({ block: "nearest" });
        });
      },
      choose(i) {
        const r = this.results[i == null ? this.active : i];
        if (!r) return;
        if (r.type === "district") {
          window.location.href = this.district(r.slug).url;
          return;
        }
        this.picked = r.city;
        this.q = r.city.c;
        this.open = false;
        this.$nextTick(() => {
          const first = this.$refs.answer && this.$refs.answer.querySelector("a");
          if (first) first.focus({ preventScroll: true });
        });
      },
      clear() {
        this.q = "";
        this.picked = null;
        this.open = false;
        this.$refs.input && this.$refs.input.focus();
      },
    }));

    /* ------------------------------------------------------------ filter chips on /districts/ */
    // meta: [{ kind, counties:[…] }] — one per card, to count matches.
    // view: "list" | "map" — the List | Map switch on phones and tablets (laptops show both).
    Alpine.data("districtFilter", (meta) => ({
      f: "all",
      view: "list",
      meta: meta || [],
      init() {
        const h = (location.hash || "").replace("#", "");
        if (/^(en|es|county-[a-z-]+)$/.test(h)) this.f = h;
        if (h === "map") this.view = "map";
      },
      setView(v) {
        this.view = v === "map" ? "map" : "list";
      },
      set(v) {
        this.f = v;
        try {
          history.replaceState(null, "", v === "all" ? location.pathname : "#" + v);
        } catch (e) {}
      },
      slug(s) {
        return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      },
      show(kind, counties) {
        const f = this.f;
        if (f === "all") return true;
        if (f === "en") return kind !== "linguistic";
        if (f === "es") return kind === "linguistic";
        if (f.startsWith("county-")) return (counties || []).some((c) => "county-" + this.slug(c) === f);
        return true;
      },
      get count() {
        return this.meta.filter((m) => this.show(m.kind, m.counties)).length;
      },
    }));

    /* ------------------------------------------------------------ section nav (detail page) */
    // The active section is the last one whose top has reached the line where a jump link puts
    // it (the page's scroll-padding + the section's scroll-margin, from the CSS). A clicked link
    // is marked at once and stays marked while the page scrolls to it.
    Alpine.data("sectionNav", () => ({
      current: "",
      init() {
        const links = [...document.querySelectorAll("[data-secnav] a[href^='#']")];
        const ids = [...new Set(links.map((a) => a.getAttribute("href").slice(1)))];
        const sections = ids.map((id) => document.getElementById(id)).filter(Boolean);
        if (!sections.length) return;
        const bar = document.querySelector("[data-secnav-bar]");
        const px = (v) => parseFloat(v) || 0;
        const lineFor = (sec) =>
          px(getComputedStyle(document.documentElement).scrollPaddingTop) + px(getComputedStyle(sec).scrollMarginTop) + 16;
        let lockUntil = 0;
        const mark = (cur) => {
          if (cur === this.current) return;
          this.current = cur;
          links.forEach((a) => {
            const on = cur && a.getAttribute("href") === "#" + cur;
            a.classList.toggle("is-active", !!on);
            if (on) a.setAttribute("aria-current", "location");
            else a.removeAttribute("aria-current");
          });
          const chip = bar && bar.querySelector("a.is-active");
          if (!chip && bar) bar.scrollTo({ left: 0 });
          if (chip && bar.scrollWidth > bar.clientWidth) {
            const left = chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2;
            bar.scrollTo({ left: Math.max(0, left), behavior: window.MSCA && window.MSCA.reducedMotion ? "auto" : "smooth" });
          }
        };
        const update = () => {
          if (Date.now() < lockUntil) return;
          let cur = "";
          for (const s of sections) if (s.getBoundingClientRect().top <= lineFor(s)) cur = s.id;
          // at the very bottom of the page, the last section wins
          if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = sections[sections.length - 1].id;
          mark(cur);
        };
        links.forEach((a) =>
          a.addEventListener("click", () => {
            const id = a.getAttribute("href").slice(1);
            if (!document.getElementById(id)) return;
            lockUntil = Date.now() + 1500; // until the smooth scroll has arrived
            mark(id);
          })
        );
        // the scroll a click started has ended: the user's next scroll moves the mark again
        window.addEventListener("scrollend", () => {
          if (lockUntil) lockUntil = Math.min(lockUntil, Date.now() + 120);
        });
        let ticking = false;
        window.addEventListener(
          "scroll",
          () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
              ticking = false;
              update();
            });
          },
          { passive: true }
        );
        update();
      },
    }));
  });
})();

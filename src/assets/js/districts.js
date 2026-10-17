/*
  District pages: "Which district am I in?" city search, the filter chips on
  /districts/, and the in-page section navigation on /districts/<slug>/.
  Registered as Alpine components (this file loads before Alpine starts).
*/
(function () {
  "use strict";

  // Matching uses MSearch (src/assets/js/search.js, loaded first): accents, case, punctuation, word order,
  // plurals, "District 5" = "D5" = "Distrito 05". The home page box (home.js homeCitySearch) follows the same rules.
  const S = window.MSearch;
  // a name for "starts with" tests: folded, punctuation as spaces ("Coto-de-Caza" = "coto de caza")
  const fold = (s) => S.fold(s).replace(/[^a-z0-9]+/g, " ").trim();
  // the end of an address, as fold() leaves it: state, ZIP (+4) and country ("ca 92501 1234", "california usa")
  const ADDR = /(?: (?:ca|calif|california))?(?: \d{5}(?: \d{4})?)?(?: (?:usa|us|u s a|united states|estados unidos|ee uu|eeuu))?$/;
  const CITY_CAP = 12; // cities listed at most (the list scrolls); the list says how many more match

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

  // Cities for one query, best first: 0 = the name starts with it, 1 = a word of the name does, 2 = the name
  // without spaces only ("laquinta"), 3 = every word typed starts a word of the name, in any order ("beach long";
  // fewest words first: "springs palm" → Palm Springs, then North Palm Springs), 4 = another name does ("29 Palms",
  // "Two Harbors": via = that name), 5 = the name contains it ("ville"), 6 = the part of the city a district serves
  // does ("north of Carson St", "isla Catalina"). → { strong: tiers 0-5, weak: tier 6 }, each [{ c, via }]
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

  // Prepares one city for matchCities: name = the city, other = { names, misspellings }, quals = the parts of
  // the city its districts serve, in both languages ("outside District 10" counts as "outside": not a number).
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

  // Everything the finder lists for a query: { ds: [district slugs], cs: [{ c, via }] } (cities uncapped).
  // A district number lists only its district; a county lists its districts (the same as the county chips);
  // otherwise cities, then — when no city name matches — the districts of the area typed. "Torrance, CA 90501"
  // is read as "Torrance"; "Palm Springs airport" offers Palm Springs.
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
    // Data: <script type="application/json" id="dx-data">{ cities:[{c,k,d:[{s,q,qes}],a?,m?}], districts:{slug:{…}} }</script>
    // (src/_lib/plugins/districts.js finderData). The search rules are in find() above.
    Alpine.data("districtFinder", () => {
      // the search data (outside Alpine's reactive state: it never changes) and the last query's matches
      // (results is read several times per keystroke)
      const memo = { data: null, q: null, r: null };
      return {
        q: "",
        open: false,
        active: -1,
        picked: null,
        data: { cities: [], districts: {} },
        lang: (window.MSCA && window.MSCA.lang) || "en",
        init() {
          const d = readJson("dx-data") || { cities: [], districts: {} };
          // folded and indexed once: names, other names, the parts of a city each district serves; areas, counties
          d.cities.forEach((c) => prepCity(c, c.c, { names: c.a, misspellings: c.m }, c.d.flatMap((x) => [x.q, x.qes])));
          const counties = new Set();
          for (const x of Object.values(d.districts)) {
            x.ha = x.area ? S.index(x.area) : "";
            x.aw = fold(x.area || "").split(" ");
            x.cf = (x.counties || []).map(fold);
            x.cf.forEach((c) => counties.add(c));
          }
          d.counties = [...counties];
          memo.data = d;
          this.data = d;
        },
        // { ds, cs, more }: the district and city matches, cities capped at CITY_CAP, more = how many cities are left out
        get found() {
          if (memo.q === this.q) return memo.r;
          if (!memo.data) return { ds: [], cs: [], more: 0 };
          const r = find(memo.data, this.q);
          memo.q = this.q;
          memo.r = { ds: r.ds, cs: r.cs.slice(0, CITY_CAP), more: Math.max(0, r.cs.length - CITY_CAP) };
          return memo.r;
        },
        get results() {
          const { ds, cs } = this.found;
          return ds
            .map((slug) => ({ type: "district", slug, label: this.district(slug).name }))
            .concat(cs.map((x) => ({ type: "city", city: x.c, via: x.via, label: x.via ? `${x.via} (${x.c.c})` : x.c.c })));
        },
        // cities that match but are not listed: the list says so ("keep typing")
        get more() {
          return this.found.more;
        },
        // the "No city found" message: a real query that finds nothing (not "Dis…" on the way to "District 5")
        get none() {
          return this.q.trim().length > 1 && !this.results.length && !typingDistrict(this.q);
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
          // the answer belongs to the city that was picked: editing the box takes it away
          if (!this.q || (this.picked && fold(this.q) !== fold(this.picked.c))) this.picked = null;
          this.$nextTick(() => {
            const list = document.getElementById("dx-list");
            if (list) list.scrollTop = 0;
          });
        },
        // Escape closes the list and keeps the text (a second Escape clears it, as the browser does)
        escape(e) {
          if (this.open && (this.results.length || this.none)) {
            e.preventDefault();
            this.open = false;
          }
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
          this.active = -1;
          this.$refs.input && this.$refs.input.focus();
        },
      };
    });

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

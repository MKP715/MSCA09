/*
  MSCA09 — the document library on /documents/ (owner: documents).

  Loads /assets/data/documents.json (every published document, compact) and gives the page
  instant search, facet filters with live counts, sorting, card/list views and "show more"
  paging. Filter state lives in the address bar (?q=&cat=&col=&from=&to=&lang=&d=&c=&fmt=&sort=&view=)
  so any filtered view can be bookmarked or shared.

  Search: every word typed must appear somewhere in the document's title (English or Spanish),
  shelf, year, month, district, committee, meeting, language or format — accents ignored.
  When nothing matches exactly, Fuse.js (loaded on first search) finds close matches for typos.

  The page prints its wording and shelf colours/icons into <script id="doc-config"> (both languages).
*/
(function () {
  "use strict";

  const M = (window.MSCA = window.MSCA || {});
  const PAGE = 60;
  const fold = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const lsGet = (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  const lsSet = (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch (e) {
      /* private mode */
    }
  };

  // Shelf and archive pages (no Alpine component needed):
  //  - years folded on phones (<details data-fold>) open on wide screens, and when a year link points at them;
  //  - the archive chart's bars ([data-href]) open the library for that year.
  document.addEventListener("DOMContentLoaded", () => {
    const folds = document.querySelectorAll("details[data-fold]");
    if (folds.length) {
      const wide = window.matchMedia("(min-width: 1024px)");
      const sync = () => wide.matches && folds.forEach((d) => (d.open = true));
      sync();
      if (wide.addEventListener) wide.addEventListener("change", sync);
      const openId = (id) => {
        const el = id && document.getElementById(id);
        const d = el && el.querySelector("details[data-fold]");
        if (d) d.open = true;
      };
      openId(decodeURIComponent(window.location.hash.slice(1)));
      window.addEventListener("hashchange", () => openId(decodeURIComponent(window.location.hash.slice(1))));
      document.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest('a[href^="#y"]');
        if (a) openId(a.getAttribute("href").slice(1));
      });
    }
    document.addEventListener("click", (e) => {
      const bar = e.target.closest && e.target.closest("[data-href]");
      if (!bar) return;
      // data-href is not rewritten by the build (HtmlBasePlugin): add the path prefix here, once.
      const href = bar.getAttribute("data-href") || "";
      const base = M.base || "/";
      const local = href.charAt(0) === "/" && href.charAt(1) !== "/" && !(base !== "/" && href.indexOf(base) === 0);
      window.location.href = local && M.url ? M.url(href) : href;
    });
  });

  document.addEventListener("alpine:init", () => {
    window.Alpine.data("docLibrary", () => {
      // Plain (non-reactive) data — 2,000+ rows stay out of Alpine's proxies.
      let cfg = { str: {}, cats: [], districts: [], committees: [], formats: [], langs: [], meetings: {}, meetingsAll: {} };
      let ROWS = [];
      let FILTERED = [];
      let matched = null; // Set of row indexes matching the search, or null when there is no search
      let fuzzyRank = null;
      let Fuse = null;
      let fuseIndex = null;
      let fusePromise = null;
      let urlTimer = null;
      let lastQ = null;
      let defaultView = "cards";
      const maps = { cat: {}, dist: {}, comm: {}, fmt: {}, lang: {} };

      return {
        ready: false,
        loading: false,
        failed: false,
        // filters
        q: "",
        cats: [],
        col: "",
        from: "",
        to: "",
        langs: [],
        dists: [],
        comms: [],
        fmts: [],
        sort: "new",
        view: "cards",
        // ui
        panel: false,
        phone: false,
        wide: false,
        shown: PAGE,
        total: 0,
        fuzzy: false,
        groups: [],
        active: [],
        collOptions: [],
        catOptions: [],
        yearOptions: [],
        yearList: [],
        decades: [],
        langOptions: [],
        districtOptions: [],
        committeeOptions: [],
        formatOptions: [],
        yearMin: "",
        yearMax: "",

        tr(k, vars) {
          let s = cfg.str[k] || k;
          if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
          return s;
        },
        fmtNum(n) {
          return Number(n || 0).toLocaleString(cfg.locale || "en-US");
        },

        boot() {
          try {
            cfg = Object.assign(cfg, JSON.parse(document.getElementById("doc-config").textContent));
          } catch (e) {
            this.failed = true;
            return;
          }
          cfg.cats.forEach((c) => (maps.cat[c.key] = c));
          cfg.districts.forEach((d) => (maps.dist[d.slug] = d));
          cfg.committees.forEach((c) => (maps.comm[c.slug] = c));
          cfg.formats.forEach((f) => (maps.fmt[f.key] = f));
          cfg.langs.forEach((l) => (maps.lang[l.key] = l));

          const mqPhone = window.matchMedia("(max-width: 767.98px)");
          const mqWide = window.matchMedia("(min-width: 1024px)");
          const onMq = () => {
            this.phone = mqPhone.matches;
            this.wide = mqWide.matches;
            if (!this.phone && this.wide) this.panel = false;
          };
          onMq();
          (mqPhone.addEventListener ? mqPhone.addEventListener("change", onMq) : mqPhone.addListener(onMq));
          (mqWide.addEventListener ? mqWide.addEventListener("change", onMq) : mqWide.addListener(onMq));

          defaultView = lsGet("msca-doc-view") || (this.phone ? "list" : "cards");
          this.view = defaultView;
          const hadFilters = this.readParams(new URLSearchParams(window.location.search));
          this.load(hadFilters);
        },

        async load(scrollToLibrary) {
          this.loading = true;
          try {
            const res = await fetch(M.url("/assets/data/documents.json"), { cache: "no-cache" });
            if (!res.ok) throw new Error(res.status);
            const json = await res.json();
            this.prepare(json.rows || []);
            this.ready = true;
            this.update();
            if (this.q) this.ensureFuse();
            if (scrollToLibrary && !window.location.hash && window.scrollY < 80) {
              this.$nextTick(() => document.getElementById("library")?.scrollIntoView({ block: "start" }));
            }
          } catch (e) {
            this.failed = true;
          } finally {
            this.loading = false;
          }
        },

        // ------------------------------------------------------------ data
        prepare(rows) {
          const L = cfg.lang;
          const loc = cfg.locale || "en-US";
          const fMonth = new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: "UTC" });
          const fFull = new Intl.DateTimeFormat(loc, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
          const monthsEn = [];
          const monthsEs = [];
          for (let m = 0; m < 12; m++) {
            const d = Date.UTC(2020, m, 15);
            monthsEn.push(new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d));
            monthsEs.push(new Intl.DateTimeFormat("es-US", { month: "long", timeZone: "UTC" }).format(d));
          }
          const seen = new Set();
          const misc = maps.cat.misc || cfg.cats[cfg.cats.length - 1] || {};
          ROWS = rows.map((r, idx) => {
            const c = maps.cat[r.c] || misc;
            let id = String(r.i || idx);
            if (seen.has(id)) id = id + "~" + idx;
            seen.add(id);
            const title = L === "es" && r.e ? r.e : r.t;
            const other = L === "es" ? (r.e ? r.t : "") : r.e || "";
            let when = "";
            let month = 0;
            const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(r.d || "");
            if (m) {
              month = +m[2];
              const dt = Date.UTC(+m[1], month - 1, +(m[3] || 1));
              when = m[3] && m[3] !== "01" ? fFull.format(dt) : fMonth.format(dt);
            } else if (r.y) when = String(r.y);
            const lang = maps.lang[r.l];
            const comms = r.C ? String(r.C).split(";").filter(Boolean) : [];
            const dist = r.D ? maps.dist[r.D] : null;
            const distLabel = dist ? this.tr("district_n", { n: dist.label }) : "";
            const commLabel = comms.map((s) => (maps.comm[s] ? maps.comm[s].name : s)).join(", ");
            const where = [distLabel, commLabel].filter(Boolean).join(" · ");
            const meeting = r.m ? cfg.meetings[r.m] || r.m : "";
            const size = r.z ? (r.z < 1000 ? Math.max(1, Math.round(r.z)) + " KB" : (r.z / 1024 >= 10 ? Math.round(r.z / 1024) : (r.z / 1024).toFixed(1)) + " MB") : "";
            const url = r.g ? `https://drive.google.com/file/d/${r.g}/view` : r.u && r.u.charAt(0) === "/" ? M.url(r.u) : r.u || "#";
            const hay = fold(
              [
                r.t,
                r.e,
                c.label_en,
                c.label_es,
                r.y,
                month ? monthsEn[month - 1] + " " + monthsEs[month - 1] : "",
                dist ? `district ${dist.label} distrito ${dist.label} ${r.D}` : "",
                comms.map((s) => (maps.comm[s] ? maps.comm[s].all : s)).join(" "),
                r.m ? r.m + " " + (cfg.meetingsAll[r.m] || "") : "",
                lang ? lang.label_en + " " + lang.label_es : "",
                maps.fmt[r.f] ? maps.fmt[r.f].label + " " + r.f : r.f,
                r.a ? "archive archivo" : "",
                r.c === "minutes" ? "minutas" : "", // what many Spanish speakers call minutes
              ].join(" ")
            );
            return {
              idx,
              i: id,
              p: r.p || 0,
              c: r.c,
              a: !!r.a,
              y: +r.y || 0,
              l: r.l || "",
              f: r.f || "",
              D: r.D || "",
              C: comms,
              key: (r.d || (r.y ? String(r.y) : "0000")).padEnd(10, "-00"),
              title,
              titleF: fold(title + " " + other),
              // Title sort key: accents and leading punctuation ignored; titles starting with a digit file under "#".
              tk: (() => {
                const t = fold(title).replace(/^[^a-z0-9]+/, "");
                return /^[a-z]/.test(t) ? t : "#" + t;
              })(),
              url,
              style: c.style || "",
              icon: c.icon || "",
              catShort: c.label || "",
              catLine: (c.label || "") + (meeting ? " · " + meeting : ""),
              when,
              size,
              where,
              dist: distLabel,
              comm: commLabel,
              archive: !!r.a,
              langShort: lang ? lang.short : "",
              langName: lang ? lang.label : "",
              fmt: maps.fmt[r.f] ? maps.fmt[r.f].label : (r.f || "").toUpperCase(),
              hay,
            };
          });
          const ys = ROWS.map((r) => r.y).filter(Boolean);
          this.yearMin = ys.length ? Math.min(...ys) : "";
          this.yearMax = ys.length ? Math.max(...ys) : "";
          const list = [];
          for (let y = this.yearMax; y && y >= this.yearMin; y--) list.push(y);
          this.yearList = list;
        },

        ensureFuse() {
          if (fusePromise) return fusePromise;
          fusePromise = import(M.url("/assets/vendor/fuse.min.mjs"))
            .then((mod) => {
              Fuse = mod.default || mod.Fuse;
              fuseIndex = new Fuse(ROWS, {
                keys: [
                  { name: "titleF", weight: 3 },
                  { name: "hay", weight: 1 },
                ],
                threshold: 0.34,
                ignoreLocation: true,
                useExtendedSearch: true,
                minMatchCharLength: 3,
                includeScore: true,
              });
              // Re-run a search that found nothing before the fuzzy index was ready.
              if (this.ready && this.q && matched && matched.size === 0) this.update(true, true);
            })
            .catch(() => {});
          return fusePromise;
        },

        search(force) {
          const q = fold(this.q).trim();
          if (q === lastQ && !force) return;
          lastQ = q;
          this.fuzzy = false;
          fuzzyRank = null;
          if (!q) {
            matched = null;
            return;
          }
          const tokens = q.split(/[\s,;]+/).filter((t) => t.length > 1 || /\d/.test(t));
          const set = new Set();
          if (tokens.length) {
            for (const r of ROWS) if (tokens.every((t) => r.hay.includes(t))) set.add(r.idx);
          }
          if (!set.size && fuseIndex && q.length >= 3) {
            // Typos: every word roughly matches (AND); failing that, any word roughly matches (OR).
            const words = tokens.filter((t) => t.length >= 3).map((t) => t.replace(/[|'"!^$=]/g, ""));
            let res = words.length ? fuseIndex.search(words.join(" "), { limit: 300 }) : [];
            if (!res.length && words.length > 1) res = fuseIndex.search(words.join(" | "), { limit: 300 });
            res.forEach((x) => set.add(x.refIndex));
            fuzzyRank = new Map(res.map((x, k) => [x.refIndex, k]));
            this.fuzzy = set.size > 0;
          } else if (!set.size && !fuseIndex) {
            this.ensureFuse();
          }
          matched = set;
        },

        pass(r, except) {
          if (except !== "q" && matched && !matched.has(r.idx)) return false;
          if (except !== "cats" && this.cats.length && !this.cats.includes(r.c)) return false;
          if (except !== "col" && this.col && (this.col === "archive") !== r.a) return false;
          if (except !== "year") {
            const f = +this.from || 0;
            const t = +this.to || 0;
            if ((f || t) && !r.y) return false;
            if (f && r.y < f) return false;
            if (t && r.y > t) return false;
          }
          if (except !== "langs" && this.langs.length) {
            const ok = this.langs.includes(r.l) || (r.l === "bi" && (this.langs.includes("en") || this.langs.includes("es")));
            if (!ok) return false;
          }
          if (except !== "dists" && this.dists.length && !this.dists.includes(r.D)) return false;
          if (except !== "comms" && this.comms.length && !r.C.some((c) => this.comms.includes(c))) return false;
          if (except !== "fmts" && this.fmts.length && !this.fmts.includes(r.f)) return false;
          return true;
        },

        // ------------------------------------------------------------ the main loop
        update(resetPaging = true, forceSearch = false) {
          if (!this.ready) return;
          if (this.from && this.to && +this.from > +this.to) [this.from, this.to] = [this.to, this.from];
          this.search(forceSearch);
          const out = ROWS.filter((r) => this.pass(r, null));
          const coll = cfg.locale || "en-US";
          if (this.sort === "title") out.sort((a, b) => (a.tk.charAt(0) === "#" ? 0 : 1) - (b.tk.charAt(0) === "#" ? 0 : 1) || a.tk.localeCompare(b.tk, coll, { numeric: true, sensitivity: "base" }));
          else if (this.sort === "old") out.sort((a, b) => (a.y ? 0 : 1) - (b.y ? 0 : 1) || a.key.localeCompare(b.key) || a.title.localeCompare(b.title, coll));
          else out.sort((a, b) => b.key.localeCompare(a.key) || a.title.localeCompare(b.title, coll));
          FILTERED = out;
          this.total = out.length;
          if (resetPaging !== false) this.shown = PAGE;
          this.render();
          this.facets();
          this.buildActive();
          this.syncUrl();
        },

        render() {
          const slice = FILTERED.slice(0, this.shown);
          const byTitle = this.sort === "title";
          const keyOf = (r) => (byTitle ? (/^[a-z]/.test(r.tk) ? r.tk.charAt(0).toUpperCase() : "#") : r.y ? String(r.y) : "");
          const counts = {};
          for (const r of FILTERED) {
            const k = keyOf(r);
            counts[k] = (counts[k] || 0) + 1;
          }
          const groups = [];
          let cur = null;
          // English and Spanish copies of one document (same pair number, next to each other) → one item
          // with a button per language; the copy in the page's language leads.
          const items = [];
          for (const r of slice) {
            const last = items[items.length - 1];
            if (r.p && last && last.p === r.p && !last.versions.some((v) => v.l === r.l)) {
              last.versions.push(this.version(r));
              if (r.l === cfg.lang && last.l !== cfg.lang) Object.assign(last, this.lead(r, last.versions));
              continue;
            }
            items.push({ ...r, versions: [this.version(r)] });
          }
          const order = { en: cfg.lang === "es" ? 2 : 0, es: cfg.lang === "es" ? 0 : 2, bi: 1, "": 3 };
          for (const it of items) if (it.versions.length > 1) it.versions.sort((a, b) => order[a.l || ""] - order[b.l || ""]);
          for (const r of items) {
            const k = keyOf(r);
            if (!cur || cur.k !== k) {
              const n = counts[k] || 0;
              cur = {
                k,
                key: "g-" + (k || "undated") + "-" + groups.length,
                label: k || this.tr("undated"),
                countLabel: this.tr(n === 1 ? "count_one" : "count_many", { n: this.fmtNum(n) }),
                items: [],
              };
              groups.push(cur);
            }
            cur.items.push(r);
          }
          this.groups = groups;
        },

        version(r) {
          return { i: r.i, l: r.l, url: r.url, langShort: r.langShort, langName: r.langName, fmt: r.fmt };
        },
        // The copy in the page's language becomes the item's title and main link.
        lead(r, versions) {
          return { i: r.i, l: r.l, url: r.url, title: r.title, langShort: r.langShort, langName: r.langName, versions };
        },

        more() {
          this.shown = Math.min(this.total, this.shown + PAGE);
          this.render();
        },

        facets() {
          const count = (except, keysOf) => {
            const m = {};
            for (const r of ROWS) {
              if (!this.pass(r, except)) continue;
              const ks = keysOf(r);
              if (Array.isArray(ks)) ks.forEach((k) => k && (m[k] = (m[k] || 0) + 1));
              else if (ks) m[ks] = (m[ks] || 0) + 1;
            }
            return m;
          };
          const cc = count("col", (r) => (r.a ? "archive" : "current"));
          this.collOptions = [
            { key: "", label: this.tr("coll_all"), n: this.fmtNum((cc.archive || 0) + (cc.current || 0)) },
            { key: "current", label: this.tr("coll_current"), n: this.fmtNum(cc.current || 0) },
            { key: "archive", label: this.tr("coll_archive"), n: this.fmtNum(cc.archive || 0) },
          ];
          const ct = count("cats", (r) => r.c);
          this.catOptions = cfg.cats
            .filter((c) => c.count > 0)
            .map((c) => ({ key: c.key, label: c.label, style: c.style, icon: c.iconSm, n: this.fmtNum(ct[c.key] || 0) }));
          const cy = count("year", (r) => r.y);
          const maxY = Math.max(1, ...Object.values(cy));
          const f = +this.from || 0;
          const t = +this.to || 0;
          const opts = [];
          for (let y = this.yearMin; y && y <= this.yearMax; y++) {
            const n = cy[y] || 0;
            opts.push({
              year: y,
              n,
              h: n ? Math.max(6, Math.round((n / maxY) * 100)) : 0,
              inRange: (f || t) ? (!f || y >= f) && (!t || y <= t) : true,
              aria: this.tr("hist_aria", { year: y, n: this.fmtNum(n) }),
            });
          }
          this.yearOptions = opts;
          const decs = [];
          if (this.yearMin) {
            for (let d = Math.floor(this.yearMin / 10) * 10; d <= this.yearMax; d += 10) {
              const a = Math.max(d, this.yearMin);
              const b = Math.min(d + 9, this.yearMax);
              decs.push({ from: a, to: b, label: d + "–" + String(d + 9).slice(2), on: f === a && t === b });
            }
          }
          this.decades = decs;
          const cl = count("langs", (r) => r.l);
          this.langOptions = cfg.langs
            .map((l) => ({ key: l.key, short: l.short, label: l.label, n: this.fmtNum(cl[l.key] || 0), raw: cl[l.key] || 0 }))
            .filter((l) => l.raw || this.langs.includes(l.key));
          const cd = count("dists", (r) => r.D);
          this.districtOptions = cfg.districts.map((d) => ({
            key: d.slug,
            label: d.label,
            aria: this.tr("district_n", { n: d.label }),
            n: this.fmtNum(cd[d.slug] || 0),
          }));
          const cm = count("comms", (r) => r.C);
          this.committeeOptions = cfg.committees
            .map((c) => ({ key: c.slug, label: c.name, n: cm[c.slug] || 0 }))
            .sort((a, b) => a.label.localeCompare(b.label, cfg.locale));
          const cf = count("fmts", (r) => r.f);
          this.formatOptions = cfg.formats
            .map((x) => ({ key: x.key, label: x.label, n: this.fmtNum(cf[x.key] || 0), raw: cf[x.key] || 0 }))
            .filter((x) => x.raw || this.fmts.includes(x.key));
        },

        buildActive() {
          const a = [];
          if (this.q.trim()) a.push({ id: "q", type: "q", label: this.tr("query_chip", { q: this.q.trim() }) });
          this.cats.forEach((k) => maps.cat[k] && a.push({ id: "c-" + k, type: "cats", value: k, label: maps.cat[k].label, style: maps.cat[k].style }));
          if (this.col) a.push({ id: "col", type: "col", label: this.tr(this.col === "archive" ? "coll_archive" : "coll_current") });
          if (this.from || this.to) {
            const label =
              this.from && this.to
                ? this.from === this.to
                  ? String(this.from)
                  : this.tr("year_range", { from: this.from, to: this.to })
                : this.from
                  ? this.tr("year_from", { y: this.from })
                  : this.tr("year_to", { y: this.to });
            a.push({ id: "year", type: "year", label });
          }
          this.langs.forEach((k) => maps.lang[k] && a.push({ id: "l-" + k, type: "langs", value: k, label: maps.lang[k].label }));
          this.dists.forEach((k) => a.push({ id: "d-" + k, type: "dists", value: k, label: this.tr("district_n", { n: maps.dist[k] ? maps.dist[k].label : k }) }));
          this.comms.forEach((k) => a.push({ id: "m-" + k, type: "comms", value: k, label: maps.comm[k] ? maps.comm[k].name : k }));
          this.fmts.forEach((k) => a.push({ id: "f-" + k, type: "fmts", value: k, label: maps.fmt[k] ? maps.fmt[k].label : k }));
          this.active = a;
        },

        // ------------------------------------------------------------ actions
        changed() {
          this.update();
        },
        // Phones: a drawer. Tablets: a panel that opens above the results — bring it into view.
        togglePanel() {
          this.panel = !this.panel;
          if (this.panel && !this.phone && !this.wide) {
            this.$nextTick(() => document.getElementById("doc-filters")?.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "start", inline: "nearest" }));
          }
        },
        onQuery() {
          if (this.q && !fusePromise) this.ensureFuse();
          this.update();
        },
        toggle(list, key) {
          const arr = this[list];
          this[list] = arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key];
          this.update();
        },
        pickYear(y) {
          if (+this.from === y && +this.to === y) this.from = this.to = "";
          else this.from = this.to = String(y);
          this.update();
        },
        pickDecade(d) {
          if (d.on) this.from = this.to = "";
          else {
            this.from = String(d.from);
            this.to = String(d.to);
          }
          this.update();
        },
        removeFilter(a) {
          if (a.type === "q") this.q = "";
          else if (a.type === "col") this.col = "";
          else if (a.type === "year") this.from = this.to = "";
          else this[a.type] = this[a.type].filter((k) => k !== a.value);
          this.update();
        },
        clearAll() {
          this.q = "";
          this.cats = [];
          this.col = "";
          this.from = this.to = "";
          this.langs = [];
          this.dists = [];
          this.comms = [];
          this.fmts = [];
          this.update();
        },
        setView(v) {
          this.view = v;
          lsSet("msca-doc-view", v);
          this.syncUrl();
        },
        jump() {
          this.panel = false;
          const el = document.getElementById("library");
          if (el) el.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "start" });
        },
        // A link like "/documents/?cat=minutes#library": apply it in place instead of reloading the page.
        applyHref(href) {
          let u;
          try {
            u = new URL(href, window.location.href);
          } catch (e) {
            return;
          }
          this.q = "";
          this.cats = [];
          this.col = "";
          this.from = this.to = "";
          this.langs = [];
          this.dists = [];
          this.comms = [];
          this.fmts = [];
          this.readParams(u.searchParams);
          if (this.q) this.ensureFuse();
          this.update();
          this.jump();
        },

        // ------------------------------------------------------------ address bar
        readParams(p) {
          const listOf = (k) => (p.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
          this.q = p.get("q") || "";
          this.cats = listOf("cat").filter((k) => maps.cat[k]);
          const col = p.get("col") || "";
          this.col = col === "archive" || col === "current" ? col : "";
          this.from = /^\d{4}$/.test(p.get("from") || "") ? p.get("from") : "";
          this.to = /^\d{4}$/.test(p.get("to") || "") ? p.get("to") : "";
          if (/^\d{4}$/.test(p.get("year") || "")) this.from = this.to = p.get("year");
          this.langs = listOf("lang").filter((k) => maps.lang[k]);
          this.dists = listOf("d");
          this.comms = listOf("c");
          this.fmts = listOf("fmt");
          const sort = p.get("sort");
          if (sort === "old" || sort === "title" || sort === "new") this.sort = sort;
          const view = p.get("view");
          if (view === "cards" || view === "list") this.view = view;
          return !!(this.q || this.cats.length || this.col || this.from || this.to || this.langs.length || this.dists.length || this.comms.length || this.fmts.length);
        },
        syncUrl() {
          clearTimeout(urlTimer);
          urlTimer = setTimeout(() => {
            const p = new URLSearchParams();
            if (this.q.trim()) p.set("q", this.q.trim());
            if (this.cats.length) p.set("cat", this.cats.join(","));
            if (this.col) p.set("col", this.col);
            if (this.from) p.set("from", this.from);
            if (this.to) p.set("to", this.to);
            if (this.langs.length) p.set("lang", this.langs.join(","));
            if (this.dists.length) p.set("d", this.dists.join(","));
            if (this.comms.length) p.set("c", this.comms.join(","));
            if (this.fmts.length) p.set("fmt", this.fmts.join(","));
            if (this.sort !== "new") p.set("sort", this.sort);
            if (this.view !== defaultView) p.set("view", this.view);
            const s = p.toString().replace(/%2C/g, ",");
            const next = window.location.pathname + (s ? "?" + s : "") + window.location.hash;
            if (next !== window.location.pathname + window.location.search + window.location.hash) {
              try {
                history.replaceState(history.state, "", next);
              } catch (e) {
                /* ignore */
              }
            }
          }, 250);
        },
      };
    });
  });
})();

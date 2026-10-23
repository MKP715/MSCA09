/*
  MSCA09 — the document library on /documents/ (owner: documents).

  Loads /assets/data/documents.json (every published document, compact) and gives the page
  instant search, facet filters with live counts, sorting, card/list views and "show more"
  paging. Filter state lives in the address bar (?q=&cat=&col=&from=&to=&lang=&d=&c=&fmt=&sort=&view=)
  so any filtered view can be bookmarked or shared.

  Search (MSearch, the site's shared matcher in assets/js/search.js): every word typed must be found at the start
  of a word of the document's titles (English and Spanish), its date as the card shows it (month and year, in both
  languages), shelf, district (District 5 = Distrito 5 = D5), committee, meeting, language (a bilingual document is
  also English and Spanish), format, collection or Area 09 Archives badge — in either language, with accents,
  plurals, apostrophes and dots ignored. A full date ("June 12, 1988", "12 de junio de 1988", 2026-10-11) is
  matched against the document's own date. The documents whose title (or date) matches the words best come first;
  the rest follow under "Other matches", best first. When nothing matches, a misspelt word is replaced by the
  library's words closest to it in spelling, or else Fuse.js (loaded on first search) finds close matches — listed
  best first. Counts count documents: the English and Spanish copies of one are one card.

  The page prints its wording and shelf colours/icons into <script id="doc-config"> (both languages).
*/
(function () {
  "use strict";

  const M = (window.MSCA = window.MSCA || {});
  const MS = window.MSearch; // the shared matcher (assets/js/search.js, loaded before this file)
  const PAGE = 60;
  const fold = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

  // ---------------------------------------------------------------- search words (folded, as MSearch.fold gives them)
  // Library words the shared matcher's English ↔ Spanish list does not have. A document whose text has one of a
  // group's words or phrases also gets the others, so a Spanish word finds an English-only title and back.
  const MORE_WORDS = [
    ["conference", "conferencia"], ["inventory", "inventario"], ["women", "womens", "mujeres"],
    ["hispanic", "hispanas", "hispanos"], ["school", "escuela"], ["election", "eleccion"], ["survey", "encuesta"],
    ["schedule", "horario"], ["letter", "carta"], ["form", "formulario"], ["income", "ingresos"], ["expense", "gastos"],
    ["profit and loss", "pl", "ingresos y gastos"], ["statement of activity", "estado de actividades"],
    ["round table", "roundtable", "mesa redonda"], ["open house", "casa abierta"], ["pacific", "pacifico"],
    ["map", "mapa"], ["presentation", "presentacion"], ["slides", "diapositivas"], ["registration", "inscripcion"],
    ["self support", "automantenimiento"], ["quarter", "trimestre"], ["annual", "anual"], ["request", "solicitud"],
    ["proposed", "propuesto"], ["draft", "borrador"], ["approved", "aprobado"], ["notes", "notas"],
    ["tradition", "tradicion"], ["step", "paso"], ["concept", "concepto"], ["workbook", "cuaderno de trabajo"],
    ["information", "informacion"], ["update", "novedades", "actualizacion"], ["coordinator", "coordinador"],
    ["anniversary", "aniversario"], ["guide", "guia"], ["region", "regional"], ["ypaa", "young people in aa", "jovenes en aa"],
  ].map((g) => g.map((p) => " " + p + " "));
  // One way only: a Board (of directors) is a "junta", but a Spanish "junta" is usually just a meeting.
  const ONE_WAY = { board: "junta" };
  // Other forms of a title word, for the groups above and the matcher's own list: a plural's singular
  // ("budgets" → budget → presupuesto, "talleres" → taller) and English -y / -ies (assembly ↔ assemblies).
  const forms = (w) => {
    if (w.length < 5 || !/^[a-z]+$/.test(w)) return [];
    if (/[^aeiou]ies$/.test(w)) return [w.slice(0, -3) + "y"];
    if (/[^aeiou]y$/.test(w)) return [w.slice(0, -1) + "ies"];
    const out = [];
    if (w.length >= 6 && /(?:[lnrdjzx]|ch|sh)es$/.test(w)) out.push(w.slice(0, -2));
    if (/[^su]s$/.test(w)) out.push(w.slice(0, -1));
    return out;
  };
  const moreWords = (f) => {
    const ws = f.split(/[^a-z0-9]+/).filter(Boolean);
    const out = [];
    for (const w of ws) {
      out.push(...forms(w));
      if (ONE_WAY[w]) out.push(ONE_WAY[w]);
    }
    const text = " " + ws.concat(out).join(" ") + " ";
    for (const g of MORE_WORDS) if (g.some((p) => text.includes(p))) out.push(...g);
    return out.join(" ");
  };
  // A district number followed by a spaced dash or a comma starts something else ("Distrito 8 – 20 de diciembre",
  // "Distrito 18, 20 de mayo"): break it there, so the matcher does not read "District 8 and 20".
  const DIST_STOP = /(\b(?:districts?|distritos?|dist|dto|d)\s*[.#-]?\s*\d{1,2})(?:\s*,\s+|\s+-\s*|\s*-\s+)(?=\d)/g;
  // A title naming several districts ("Districts 01-19,20,21", "District 1-12,14-15,18,20-22", "Districts 1–31")
  // names each of them: "District 22" finds it too. Only a tight "-" or "," (or "and" / "y") joins a list.
  const DIST_LIST = /\b(?:districts?|distritos?)\s*#?\s*(\d{1,2}(?:(?:\s+(?:and|y)\s+|[-,])\d{1,2}\b)+)/g;
  const distList = (f) => {
    const out = [];
    for (const m of f.matchAll(DIST_LIST)) {
      for (const part of m[1].split(/\s+(?:and|y)\s+|,/)) {
        const [a, b] = part.split("-").map(Number);
        if (b > a && b - a <= 40) for (let n = a; n <= b; n++) out.push("d" + n);
        else out.push("d" + a); // "18-08", "14-09-14b": a code, not a range
      }
    }
    return out.join(" ");
  };
  // The library's filters as bits (see failMasks()): the search, then each facet.
  const FILTER_BIT = { q: 1, cats: 2, col: 4, year: 8, langs: 16, dists: 32, comms: 64, fmts: 128 };
  // Words that never decide a close match (the typo fallback).
  const FUZZY_SKIP = new Set("and the for with para por con del los las".split(" "));
  const DIST_WORD = new Set("district districts distrito distritos dist dto d".split(" "));
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
  //  - years folded on phones (<details data-fold>) open on wide screens, and when a link points at them — at the
  //    year's section (#y2019) or at its heading inside the fold's <summary> (#h-y2019, as the site search links it);
  //  - the archive chart's bars ([data-href]) open the library for that year.
  document.addEventListener("DOMContentLoaded", () => {
    const folds = document.querySelectorAll("details[data-fold]");
    if (folds.length) {
      const wide = window.matchMedia("(min-width: 1024px)");
      const sync = () => wide.matches && folds.forEach((d) => (d.open = true));
      sync();
      if (wide.addEventListener) wide.addEventListener("change", sync);
      // scroll: bring the opened year into view (from the address bar; a clicked link scrolls by itself)
      const openId = (id, scroll) => {
        const el = id && document.getElementById(id);
        const d = el && (el.closest("details[data-fold]") || el.querySelector("details[data-fold]"));
        if (!d) return;
        d.open = true;
        // the year's section keeps its place below the sticky header and year chips (scroll-margin)
        const target = d.closest("[id]") || el;
        if (scroll) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
      };
      const fromHash = (scroll) => {
        try {
          openId(decodeURIComponent(window.location.hash.slice(1)), scroll);
        } catch (e) {
          /* a malformed address */
        }
      };
      // open at once; scroll once the page has loaded (the browser's own jump to the anchor happens before)
      fromHash(false);
      if (document.readyState === "complete") fromHash(true);
      else window.addEventListener("load", () => fromHash(true), { once: true });
      window.addEventListener("hashchange", () => fromHash(true));
      document.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest('a[href^="#y"], a[href^="#h-y"]');
        if (a) openId(a.getAttribute("href").slice(1), false);
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
      let ITEMS = []; // FILTERED as documents: [row] or [row, row…] for the language copies of one document (same pair number)
      let MASKS = new Uint8Array(0); // per row: the filters it fails (see failMasks())
      let matched = null; // Set of row indexes matching the search, or null when there is no search
      let lastQuery = null; // the search as parsed: { qr: MSearch.query(…), dq: dateQuery(…) }, or null
      let fuzzyRank = null; // close matches: row index → place (best first)
      let Fuse = null;
      let fuseIndex = null;
      let fusePromise = null;
      let urlTimer = null;
      let statusTimer = null;
      let statusOn = false; // the first update (page load) is not announced
      let lastQ = null;
      let defaultView = "cards";
      let collTitle = null; // Intl.Collator for the title sort (much faster than localeCompare with options)
      let collText = null;
      const maps = { cat: {}, dist: {}, comm: {}, fmt: {}, lang: {} };
      // Month names (English and Spanish, full and 3-letter, folded) → 1–12; filled in prepare().
      const monthNo = { sept: 9, setiembre: 9 };

      // A date typed the way a card prints it ("June 12, 1988", "12 de junio de 1988", "oct 11 2026") or in ISO form
      // ("2026-10-11", "1988-06") is matched against the document's own date, so day numbers stay out of the search
      // text ("district 12" or "5" never find a document only because it is dated the 12th or the 5th).
      // Returns { test(row), rest: the other words as an MSearch query } or null.
      const dateQuery = (q) => {
        const iso = /(?:^|[^0-9])((\d{4})[-‐-―−](\d{1,2})(?:[-‐-―−](\d{1,2}))?)(?![0-9])/.exec(q);
        if (iso) {
          const pre = iso[2] + "-" + iso[3].padStart(2, "0") + (iso[4] ? "-" + iso[4].padStart(2, "0") : "");
          return { test: (r) => r.ds.startsWith(pre), rest: MS.query(q.replace(iso[1], " ")) };
        }
        const ws = MS.fold(q).split(/[^a-z0-9]+/).filter(Boolean);
        // a day number next to a month name ("june 12", "12 junio", "12 de junio"), not a district's ("district 5 may")
        const isDay = (k) => k >= 0 && k < ws.length && /^\d{1,2}$/.test(ws[k]) && +ws[k] >= 1 && +ws[k] <= 31 && !DIST_WORD.has(ws[k - 1]);
        for (let i = 0; i < ws.length; i++) {
          const mo = monthNo[ws[i]];
          if (!mo) continue;
          const k = isDay(i + 1) ? i + 1 : isDay(i - 1) ? i - 1 : ws[i - 1] === "de" && isDay(i - 2) ? i - 2 : -1;
          if (k < 0) continue;
          const day = +ws[k];
          // the rest: what was typed without that day number (letter case and a final space kept for MSearch.query)
          let nth = ws.slice(0, k).filter((w) => w === ws[k]).length;
          const rest = q.replace(new RegExp("\\b" + ws[k] + "\\b", "g"), (m) => (nth-- === 0 ? " " : m));
          return { test: (r) => r.mo === mo && r.dd === day, rest: MS.query(rest) };
        }
        return null;
      };
      // Each row's search text is built after the list is on screen, in short slices between which the browser handles
      // taps and keys (MSearch.index takes about 0.1 ms a row, half a second for the whole library on a laptop), or all
      // at once when a search finds nothing without it.
      let indexRow = null; // (row) → fills row.ti and row.hay; set by prepare()
      let indexed = 0; // ROWS[0 … indexed - 1] have their search text
      let indexBusy = false;
      let partial = false; // the last search ran before every row had its search text (see search())
      // Runs fn as the next task, without setTimeout's minimum delay between slices.
      const channel = typeof MessageChannel === "function" ? new MessageChannel() : null;
      let nextSlice = null;
      if (channel)
        channel.port1.onmessage = () => {
          const f = nextSlice;
          nextSlice = null;
          if (f) f();
        };
      const soon = (fn) => {
        if (!channel) return setTimeout(fn, 0);
        nextSlice = fn;
        channel.port2.postMessage(0);
      };
      const indexUpTo = (n) => {
        for (const end = Math.min(n, ROWS.length); indexed < end; indexed++) indexRow(ROWS[indexed]);
      };
      // A row's plain words, with its district as "d5" (the matcher's form): what a search tries until the row's
      // search text is built.
      const quickHay = (r) => " " + (r.titleF + " " + r.fz + " " + (r.D.match(/\d+/g) || []).map((n) => "d" + +n).join(" ")).replace(/[^a-z0-9]+/g, " ") + " ";
      // One term of a parsed search as a search of its own (to test the words one by one).
      const oneTerm = (t) => ({ terms: [t], emails: [], partial: [], empty: false });
      // The edit distance between two words (a letter added, dropped, changed, or two swapped) when it is at most k,
      // otherwise -1; it stops as soon as k is passed.
      const distance = (a, b, k) => {
        if (Math.abs(a.length - b.length) > k) return -1;
        let prev2 = null;
        let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
          const cur = [i];
          let low = i;
          for (let j = 1; j <= b.length; j++) {
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur.push(v);
            if (v < low) low = v;
          }
          if (low > k) return -1;
          prev2 = prev;
          prev = cur;
        }
        return prev[b.length] <= k ? prev[b.length] : -1;
      };
      // Every word of the library's search text (built the first time a typo needs it).
      let vocab = null;
      // The search with each word that no document has (4+ letters) replaced by the library's words nearest to it in
      // spelling (1 change for words of up to 5 letters, 2 for longer ones); null when there is nothing to respell.
      const respell = (qr) => {
        let changed = false;
        const terms = [];
        for (const t of qr.terms) {
          if (ROWS.some((r) => MS.test(r.hay, oneTerm(t)))) {
            terms.push(t);
            continue;
          }
          const w = (t.v || [])[0] || "";
          if (t.parts || !/^[a-z]{4,}$/.test(w)) return null;
          if (!vocab) {
            const all = new Set();
            for (const r of ROWS) for (const x of r.hay.split(" ")) if (x.length >= 3 && x.length <= 20 && /^[a-z]+$/.test(x)) all.add(x);
            vocab = [...all];
          }
          let best = w.length <= 5 ? 1 : 2;
          let near = [];
          for (const x of vocab) {
            const d = distance(w, x, best);
            if (d < 0) continue;
            if (d < best) {
              best = d;
              near = [];
            }
            near.push(x);
          }
          if (!near.length) return null;
          terms.push({ v: near.slice(0, 12), whole: true });
          changed = true;
        }
        return changed ? { terms, emails: qr.emails, partial: qr.partial || [], empty: false } : null;
      };
      // English and Spanish copies of one document (same pair number) → one entry, wherever they sit in the list;
      // the entry keeps the place of its first copy.
      const pairUp = (list) => {
        const items = [];
        const byPair = new Map();
        for (const r of list) {
          const g = r.p ? byPair.get(r.p) : null;
          if (g && !g.some((x) => x.l === r.l)) {
            g.push(r);
            continue;
          }
          const n = [r];
          if (r.p) byPair.set(r.p, n);
          items.push(n);
        }
        return items;
      };

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
        status: "", // what the screen-reader status line says (see announce())
        searching: false, // the results may still grow: the search text of some rows is being built (see search())
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
          if (!MS) {
            this.failed = true;
            return;
          }
          try {
            cfg = Object.assign(cfg, JSON.parse(document.getElementById("doc-config").textContent));
          } catch (e) {
            this.failed = true;
            return;
          }
          collTitle = new Intl.Collator(cfg.locale || "en-US", { numeric: true, sensitivity: "base" });
          collText = new Intl.Collator(cfg.locale || "en-US");
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
            this.indexLater();
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
          monthsEn.concat(monthsEs).forEach((name, k) => {
            const n = MS.fold(name);
            monthNo[n] = monthNo[n.slice(0, 3)] = (k % 12) + 1;
          });
          const seen = new Set();
          const misc = maps.cat.misc || cfg.cats[cfg.cats.length - 1] || {};
          // Search text. Most rows share their shelf, district, committee, language … so that part is built once per
          // combination; the year and month once per month; the titles once per row (indexRow below).
          const W = cfg.words || {};
          const metaCache = new Map();
          const metaOf = (r) => {
            const key = [r.c, r.D, r.C, r.m, r.l, r.f, r.a ? 1 : 0, r.s ? 1 : 0].join("|");
            let v = metaCache.get(key);
            if (!v) {
              const c = maps.cat[r.c] || misc;
              const dist = r.D ? maps.dist[r.D] : null;
              const comms = r.C ? String(r.C).split(";").filter(Boolean) : [];
              const langs = r.l === "bi" ? ["en", "es", "bi"] : r.l ? [r.l] : []; // a bilingual document is English and Spanish too
              const parts = [
                c.label_en,
                c.label_es,
                dist ? `District ${dist.label} Distrito ${dist.label} ${r.D}` : "",
                comms.map((s) => (maps.comm[s] ? maps.comm[s].all : s.replace(/-/g, " "))).join(" • "),
                r.m ? r.m + " " + (cfg.meetingsAll[r.m] || "") : "",
                langs.map((k) => maps.lang[k]).filter(Boolean).map((x) => x.label_en + " " + x.label_es).join(" "),
                maps.fmt[r.f] ? (maps.fmt[r.f].all || maps.fmt[r.f].label) + " " + r.f : r.f || "",
                r.a ? W.archive || "Archive Archivo" : W.current || "",
                r.s ? W.archives || "Area 09 Archives" : "",
                r.c === "minutes" ? "minutas" : "", // what many Spanish speakers call minutes
              ].filter(Boolean);
              v = { parts, plain: fold(parts.join(" ")), idx: "" };
              metaCache.set(key, v);
            }
            return v;
          };
          const dateCache = new Map();
          const dateOf = (y, month) => {
            const key = y + "-" + month;
            let v = dateCache.get(key);
            if (v == null) {
              v = MS.index(y ? String(y) : "", month ? monthsEn[month - 1] + " " + monthsEs[month - 1] : "");
              dateCache.set(key, v);
            }
            return v;
          };
          // ti: the titles (both languages) and the date the card shows — what "in the title" means when ranking;
          // hay: ti plus the shelf, district, committee, meeting, language, format and collection.
          const titleCache = new Map(); // the English and Spanish copies of a document share their titles
          indexRow = (row) => {
            const r = row.src;
            const tkey = r.t + "\n" + (r.e || "");
            let ti = titleCache.get(tkey);
            if (ti == null) {
              const tf = MS.fold([r.t, r.e].filter(Boolean).join(" • ")).replace(DIST_STOP, "$1 • ");
              ti = MS.index(tf, moreWords(tf), distList(tf));
              titleCache.set(tkey, ti);
            }
            const meta = metaOf(r);
            if (!meta.idx) meta.idx = MS.index(meta.parts, moreWords(MS.fold(meta.parts.join(" • "))));
            row.ti = ti + dateOf(row.y, row.mo).slice(1);
            row.hay = row.ti + meta.idx.slice(1);
          };
          indexed = 0;
          vocab = null;
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
              arch: !!r.s,
              langShort: lang ? lang.short : "",
              langName: lang ? lang.label : "",
              fmt: maps.fmt[r.f] ? maps.fmt[r.f].label : (r.f || "").toUpperCase(),
              src: r,
              ti: "", // search text, filled by indexRow()
              hay: "",
              fz: metaOf(r).plain + " " + (r.y || "") + (month ? " " + fold(monthsEn[month - 1] + " " + monthsEs[month - 1]) : ""), // for Fuse.js
              ds: r.d || "", // ISO date as stored: 2026-10-11, 1988-06 or 1988
              mo: month,
              dd: m && m[3] && m[3] !== "01" ? +m[3] : 0, // the day the card shows (none for the 1st, shown as month only)
              tier: 0, // 1 = the search words are not all in the title or date (see update())
              ts: 0,
            };
          });
          const ys = ROWS.map((r) => r.y).filter(Boolean);
          this.yearMin = ys.length ? Math.min(...ys) : "";
          this.yearMax = ys.length ? Math.max(...ys) : "";
          const list = [];
          for (let y = this.yearMax; y && y >= this.yearMin; y--) list.push(y);
          this.yearList = list;
        },

        // Builds the search text in slices of about 10 ms, so the page stays responsive meanwhile.
        indexLater() {
          if (indexBusy) return;
          indexBusy = true;
          const step = () => {
            if (indexed >= ROWS.length) {
              indexBusy = false;
              // a search made meanwhile: run it again on the full search text
              if (partial) {
                partial = this.searching = false;
                this.update(false, true);
              }
              if (this.q && !fusePromise) this.ensureFuse();
              return;
            }
            // longer slices while a search waits for the rest
            const stop = performance.now() + (this.searching ? 40 : 12);
            while (indexed < ROWS.length && performance.now() < stop) indexUpTo(indexed + 10);
            soon(step);
          };
          soon(step);
        },

        ensureFuse() {
          if (fusePromise) return fusePromise;
          fusePromise = import(M.url("/assets/vendor/fuse.min.mjs"))
            .then((mod) => {
              Fuse = mod.default || mod.Fuse;
              fuseIndex = new Fuse(ROWS, {
                keys: [
                  { name: "titleF", weight: 3 },
                  { name: "fz", weight: 1 },
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
          const q = this.q.trim();
          if (q === lastQ && !force) return;
          lastQ = q;
          this.fuzzy = false;
          fuzzyRank = null;
          const qr = MS.query(q);
          if (qr.empty) {
            // nothing to search for yet (an empty box, or only signs such as ","): every document
            matched = null;
            lastQuery = null;
            partial = this.searching = false;
            return;
          }
          const dq = dateQuery(q);
          const set = new Set();
          // Rows whose search text is not built yet (a search typed in the first moment after the page loads, on a slow
          // phone) are tried on their plain words meanwhile; indexLater() searches again once every row has its text.
          // If that finds nothing, the rest of the text is built at once rather than showing "no documents".
          const run = () => {
            for (const r of ROWS) {
              const hay = r.hay || r.quick || (r.quick = quickHay(r));
              if (MS.test(hay, qr) || (dq && dq.test(r) && MS.test(hay, dq.rest))) set.add(r.idx);
            }
          };
          run();
          if (!set.size && indexed < ROWS.length) {
            indexUpTo(ROWS.length);
            run();
          }
          partial = this.searching = indexed < ROWS.length;
          if (!set.size) {
            // No document has every word. A word found nowhere is most likely misspelled: the library's own words
            // closest to it in spelling stand in for it ("guidlines" → guidelines, "asanblea" → asamblea) — shown as
            // close matches, those whose title matches best first.
            const fixed = respell(qr);
            if (fixed) {
              for (const r of ROWS) if (MS.test(r.hay, fixed)) set.add(r.idx);
              fuzzyRank = new Map([...set].map((i) => [i, -MS.score(ROWS[i].ti, fixed)]));
              this.fuzzy = set.size > 0;
            }
          }
          if (!set.size && fuseIndex) {
            // Otherwise close matches, best first (update() keeps this order):
            //  1) every word of 3+ letters roughly matches (Fuse.js), and the numbers and districts typed match
            //     exactly ("district 5 newsleter" → District 5 newsletters only; "minuts 2024" → 2024);
            //  2) failing that: documents that hold at least half the words (and at least 2) exactly.
            // Documents with more of the words exactly come first. No "any one word" pass: it listed hundreds of
            // unrelated documents.
            const one = oneTerm;
            const parts = qr.terms.map(one);
            const musts = qr.terms.filter((t) => /^d?\d+$/.test((Array.isArray(t) ? t : t.v || [])[0] || "")).map(one);
            const hasMusts = (r) => musts.every((m) => MS.test(r.hay, m));
            const exact = (r) => parts.reduce((n, p) => n + (MS.test(r.hay, p) ? 1 : 0), 0);
            const words = MS.fold(q)
              .split(/[^a-z0-9]+/)
              .filter((w) => w.length >= 3 && !/\d/.test(w) && !FUZZY_SKIP.has(w));
            let res = [];
            if (words.length) {
              res = fuseIndex
                .search(words.join(" "), musts.length ? undefined : { limit: 1000 })
                .filter((x) => hasMusts(ROWS[x.refIndex]))
                .map((x, k) => [x.refIndex, exact(ROWS[x.refIndex]), k]);
            }
            if (!res.length && parts.length > 1) {
              const need = Math.max(2, Math.ceil(parts.length / 2));
              for (const r of ROWS) {
                if (!hasMusts(r)) continue;
                const n = exact(r);
                if (n >= need) res.push([r.idx, n, 0]);
              }
            }
            res.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
            res = res.slice(0, 1000);
            res.forEach((x) => set.add(x[0]));
            // equal places keep the date order (the sort in update() is stable)
            fuzzyRank = new Map(res.map((x) => [x[0], (parts.length - x[1]) * 1e6 + x[2]]));
            this.fuzzy = set.size > 0;
          } else if (!set.size && !fuseIndex) {
            this.ensureFuse();
          }
          matched = set;
          lastQuery = { qr, dq };
        },

        // How well the search words match the document's title(s) and the date its card shows (MSearch.score: 3 for a
        // whole word, 1 for the start of a word); a full date typed ("June 12, 1988") counts as a whole word too.
        titleScore(r) {
          const { qr, dq } = lastQuery;
          const s = MS.score(r.ti, qr);
          return dq && dq.test(r) ? Math.max(s, MS.score(r.ti, dq.rest) + 3) : s;
        },

        // Which filters each row fails, one bit per filter (FILTER_BIT), worked out once per update() from plain copies
        // of the filters — the facet counts (each filter's options counted with the other filters applied) then cost
        // one look-up per row instead of eight checks through Alpine's proxies.
        failMasks() {
          const cats = new Set(this.cats);
          const langs = new Set(this.langs);
          const dists = new Set(this.dists);
          const comms = new Set(this.comms);
          const fmts = new Set(this.fmts);
          const col = this.col;
          const f = +this.from || 0;
          const t = +this.to || 0;
          const biOk = langs.has("en") || langs.has("es"); // a bilingual document is in English and in Spanish
          const out = new Uint8Array(ROWS.length);
          for (const r of ROWS) {
            let m = 0;
            if (matched && !matched.has(r.idx)) m |= FILTER_BIT.q;
            if (cats.size && !cats.has(r.c)) m |= FILTER_BIT.cats;
            if (col && (col === "archive") !== r.a) m |= FILTER_BIT.col;
            if ((f || t) && (!r.y || (f && r.y < f) || (t && r.y > t))) m |= FILTER_BIT.year;
            if (langs.size && !langs.has(r.l) && !(r.l === "bi" && biOk)) m |= FILTER_BIT.langs;
            if (dists.size && !dists.has(r.D)) m |= FILTER_BIT.dists;
            if (comms.size && !r.C.some((c) => comms.has(c))) m |= FILTER_BIT.comms;
            if (fmts.size && !fmts.has(r.f)) m |= FILTER_BIT.fmts;
            out[r.idx] = m;
          }
          return out;
        },
        // The row passes every filter (but `except`).
        pass(r, except) {
          return (MASKS[r.idx] & ~(FILTER_BIT[except] || 0)) === 0;
        },

        // ------------------------------------------------------------ the main loop
        update(resetPaging = true, forceSearch = false) {
          if (!this.ready) return;
          if (this.from && this.to && +this.from > +this.to) [this.from, this.to] = [this.to, this.from];
          this.search(forceSearch);
          MASKS = this.failMasks();
          const out = ROWS.filter((r) => MASKS[r.idx] === 0);
          // With a search, the documents whose title (or the date on the card) matches the words best come first, by year
          // as picked; the others — fewer of the words in the title, or found only through their shelf, committee,
          // district, language … — follow under "Other matches", best first. Nothing moves when all match alike.
          for (const r of out) r.tier = r.ts = 0;
          if (lastQuery && !this.fuzzy && !partial) {
            let best = 0;
            for (const r of out) best = Math.max(best, (r.ts = this.titleScore(r)));
            for (const r of out) r.tier = r.ts < best ? 1 : 0;
          }
          const cmpKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
          const cmp =
            this.sort === "title"
              ? (a, b) => (a.tk.charAt(0) === "#" ? 0 : 1) - (b.tk.charAt(0) === "#" ? 0 : 1) || collTitle.compare(a.tk, b.tk)
              : this.sort === "old"
                ? (a, b) => (a.y ? 0 : 1) - (b.y ? 0 : 1) || cmpKey(a, b) || collText.compare(a.title, b.title)
                : (a, b) => cmpKey(b, a) || collText.compare(a.title, b.title);
          out.sort((a, b) => a.tier - b.tier || (a.tier ? b.ts - a.ts : 0) || cmp(a, b));
          // Close matches (typos): best first, unless another order was picked.
          if (fuzzyRank && this.fuzzy && this.sort === "new") out.sort((a, b) => fuzzyRank.get(a.idx) - fuzzyRank.get(b.idx));
          FILTERED = out;
          ITEMS = pairUp(out);
          this.total = ITEMS.length; // documents, as listed (one card for the English and Spanish copies of one)
          if (resetPaging !== false) this.shown = PAGE;
          this.render();
          this.facets();
          this.buildActive();
          this.syncUrl();
          this.announce();
        },

        // The result count for screen readers (role=status), once typing or clicking has settled. Not on page load, and
        // not while the search is still being completed (the full count follows).
        announce() {
          clearTimeout(statusTimer);
          if (!statusOn || this.searching) {
            statusOn = true;
            return;
          }
          statusTimer = setTimeout(() => {
            const text =
              this.fmtNum(this.total) + " " + this.tr(this.total === 1 ? "result_one" : "result_many") + (this.fuzzy ? " " + this.tr("close_matches") : "");
            // cleared first, so the same count after a new search is read again
            this.status = "";
            this.$nextTick(() => (this.status = text));
          }, 600);
        },

        render() {
          const slice = ITEMS.slice(0, this.shown);
          const byTitle = this.sort === "title";
          // Groups: years (or first letters); close matches as one list, best first; documents found only through
          // their shelf, committee … (tier 1) under one heading after the others.
          const ranked = !!fuzzyRank && this.fuzzy && this.sort === "new";
          const keyOf = (r) => (ranked ? "~" : r.tier ? "+" : byTitle ? (/^[a-z]/.test(r.tk) ? r.tk.charAt(0).toUpperCase() : "#") : r.y ? String(r.y) : "");
          const counts = {};
          for (const g of ITEMS) {
            const k = keyOf(g[0]);
            counts[k] = (counts[k] || 0) + 1;
          }
          const groups = [];
          let cur = null;
          // English and Spanish copies of one document → one item with a button per language; the copy in the
          // page's language leads.
          const order = { en: cfg.lang === "es" ? 2 : 0, es: cfg.lang === "es" ? 0 : 2, bi: 1, "": 3 };
          const items = slice.map((g) => {
            if (g.length === 1) return { ...g[0], versions: [this.version(g[0])] };
            const versions = g.map((r) => this.version(r)).sort((a, b) => order[a.l || ""] - order[b.l || ""]);
            return { ...g[0], ...this.lead(g.find((r) => r.l === cfg.lang) || g[0], versions) };
          });
          for (const r of items) {
            const k = keyOf(r);
            if (!cur || cur.k !== k) {
              const n = counts[k] || 0;
              cur = {
                k,
                key: "g-" + (k || "undated") + "-" + groups.length,
                label: k === "~" ? this.tr("close_title") : k === "+" ? this.tr("more_matches") : k || this.tr("undated"),
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
          // Counts are documents, like the result count: the language copies of one document count once per option.
          const count = (except, keysOf) => {
            const m = {};
            const seen = new Set();
            for (const r of ROWS) {
              if (!this.pass(r, except)) continue;
              const ks = keysOf(r);
              for (const k of Array.isArray(ks) ? ks : [ks]) {
                if (!k) continue;
                if (r.p) {
                  const id = k + "|" + r.p;
                  if (seen.has(id)) continue;
                  seen.add(id);
                }
                m[k] = (m[k] || 0) + 1;
              }
            }
            return m;
          };
          const cc = count("col", (r) => [r.a ? "archive" : "current", "all"]); // a document with a copy in each collection counts once in "All"
          this.collOptions = [
            { key: "", label: this.tr("coll_all"), n: this.fmtNum(cc.all || 0) },
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
          // A bilingual document is also counted under English and Spanish: picking either one lists it.
          const cl = count("langs", (r) => (r.l === "bi" ? ["bi", "en", "es"] : r.l));
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
          if (lastQuery && this.q.trim()) a.push({ id: "q", type: "q", label: this.tr("query_chip", { q: this.q.trim() }) });
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
          // the typo index (Fuse.js) loads with the first search — once the search text is complete, so the two do
          // not compete on a slow phone (a search that finds nothing loads it at once)
          if (this.q && !fusePromise && indexed >= ROWS.length) this.ensureFuse();
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
          // A key in any letter case; for a district also its number ("5", "05", "d5", "District 5", "1&3", the old
          // "d03" of the merged District 1 & 3). Anything unknown is dropped and repeats are removed, so the chips and
          // the address bar only ever show real filters.
          const known = (m, k) => (m[k] ? k : m[k.toLowerCase()] ? k.toLowerCase() : "");
          const distOf = (k) => {
            if (known(maps.dist, k)) return known(maps.dist, k);
            const want = (k.match(/\d+/g) || []).map(Number);
            if (!want.length) return "";
            const hit = cfg.districts.find((d) => {
              const nums = (d.slug.match(/\d+/g) || []).map(Number);
              return want.every((n) => nums.includes(n));
            });
            return hit ? hit.slug : "";
          };
          const uniq = (a) => [...new Set(a.filter(Boolean))];
          this.q = p.get("q") || "";
          this.cats = uniq(listOf("cat").map((k) => known(maps.cat, k)));
          const col = (p.get("col") || "").toLowerCase();
          this.col = col === "archive" || col === "current" ? col : "";
          this.from = /^\d{4}$/.test(p.get("from") || "") ? p.get("from") : "";
          this.to = /^\d{4}$/.test(p.get("to") || "") ? p.get("to") : "";
          if (/^\d{4}$/.test(p.get("year") || "")) this.from = this.to = p.get("year");
          this.langs = uniq(listOf("lang").map((k) => known(maps.lang, k)));
          this.dists = uniq(listOf("d").map(distOf));
          this.comms = uniq(listOf("c").map((k) => known(maps.comm, k)));
          this.fmts = uniq(listOf("fmt").map((k) => known(maps.fmt, k)));
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

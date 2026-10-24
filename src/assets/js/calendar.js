/*
  MSCA09 — the Area calendar in the browser.

  Alpine component "areaCalendar" (used on /calendar/ and /es/calendar/):
    - loads /assets/data/events.json (built from the Google Calendar every few hours)
    - views: Agenda (our own list), Month / Week / List (FullCalendar 6, loaded on demand);
      on phones the Month view is a compact dot calendar with the chosen day's list below it
    - filters: categories (with live counts), format, language, district, committee/topic,
      day of week, time of day, has flyer, has Zoom, text search
    - text search (MSearch, search.js): title, type, committees, districts, format, language, place, address,
      role e-mail, weekday, month and repeat rule, in English and Spanish; a date typed in the box ("Oct 10",
      "10 de octubre") matches the days an entry covers. It looks at every date in the calendar, not only the
      ones on screen: the agenda lists every coming match, and month / week / list offer the matches on other dates
    - filter + view live in the address bar (shareable; Back works) and are remembered in this
      browser (Alpine persist) — but only once the visitor changes something: a shared link's
      filters are not saved as the visitor's own. The typed search is never remembered (it stays in the address
      only), so a later visit does not open on an old search. The view is remembered only once the visitor picks one; until
      then it follows the screen: the month grid from 1024px, the agenda on phones and tablets (where month titles
      would be cut off)
    - the page shows the Area events' flyers above the calendar; a link with filters or a view in the address opens
      it at the calendar instead of at the top (jumpToCalendar)
    - clicking an entry opens a details panel with a link to its page; closing it puts the keyboard
      focus back on the entry
    - keyboard: every entry in every view is a link (Enter opens the panel, Ctrl/Cmd+Enter the page);
      "+N more" opens a popover that takes the focus; Escape closes panels and popovers
  Every time is shown in Pacific time, whatever the visitor's own time zone.

  Alpine component "calFeatured": the "Coming up" flyers above the calendar ("Show more events" / "Show less" from 1024px).

  Also on every event page: [data-reveal-after="ISO"] elements are un-hidden once that moment passes.
*/
(function () {
  "use strict";

  const TZ = "America/Los_Angeles";
  const M = (window.MSCA = window.MSCA || {});
  const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
  const FORMAT_SLUG = { "In person": "in-person", Hybrid: "hybrid", Virtual: "online" };
  const LANG_SLUG = { English: "en", Spanish: "es", Bilingual: "bi" };
  const TODS = ["morning", "afternoon", "evening", "allday"];
  const AREA_TYPES = ["Area", "Area Committee", "Assembly", "Foro", "Servathon", "Conference"];
  const LEARNING_TYPES = ["Service School", "Workshop", "History"];
  const STORE_KEY = "msca-calendar-v1";
  // the calendar's own words in the address (readUrl / urlParams)
  const URL_KEYS = ["view", "date", "type", "format", "lang", "district", "committee", "topic", "day", "time", "flyer", "zoom", "q"];
  // a text search lists this many matches at a time ("Show more matches" adds as many): phones and tablets draw
  // agenda rows several times slower, so they get about what their 14-day agenda shows
  const SEARCH_STEP = { small: 40, large: 100 };

  /* ---------------------------------------------------------------- search words */
  // an entry's format and language as a visitor may type them, in both languages (MSearch adds its own
  // synonyms: online = virtual = Zoom = en línea, Spanish = español = hispano …)
  const FORMAT_WORDS = { "In person": "in person · en persona", Hybrid: "hybrid · híbrida", Virtual: "online · en línea · virtual · Zoom" };
  // hybrid entries can be joined online, so "online" / "en línea" find them; added as plain words (not through
  // MSearch.index), so "virtual" and "Zoom" do not
  const HYBRID_RAW = "online linea";
  const LANG_WORDS = { English: "English · inglés", Spanish: "Spanish · español · Hispanic", Bilingual: "bilingual · bilingüe · English · inglés · Spanish · español" };
  // weekday and month names (folded), so "Saturday", "sábado", "October", "octubre" find the entries on those days
  const DOW_WORDS = ["sunday domingo", "monday lunes", "tuesday martes", "wednesday miercoles", "thursday jueves", "friday viernes", "saturday sabado"];
  const MONTH_WORDS = ["january enero", "february febrero", "march marzo", "april abril", "may mayo", "june junio", "july julio", "august agosto", "september septiembre", "october octubre", "november noviembre", "december diciembre"];
  // month names in a typed date ("Oct 10", "Sept. 7", "10 de octubre"): English and Spanish, full or short. The date
  // patterns read the box as typed (any case), so MSearch still gets the rest of it as typed ("PI" stays an acronym)
  const MONTH_NUM = {};
  "jan january ene enero|feb february febrero|mar march marzo|apr april abr abril|may mayo|jun june junio|jul july julio|aug august ago agosto|sep sept september septiembre set setiembre|oct october octubre|nov november noviembre|dec december dic diciembre"
    .split("|").forEach((names, i) => names.split(" ").forEach((n) => { MONTH_NUM[n] = i + 1; }));
  const MON = Object.keys(MONTH_NUM).sort((a, b) => b.length - a.length).join("|");
  const DATE_MD = new RegExp(`\\b(${MON})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4})\\b)?`, "gi");         // Oct 10, 2026
  const DATE_DM = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|o)?\\s*(?:de\\s+)?(${MON})\\b\\.?(?:,?\\s*(?:de\\s+|del\\s+)?(\\d{4})\\b)?`, "gi"); // 10 de octubre de 2026
  const DATE_ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;                                                              // 2026-10-10
  const DATE_NUM = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g;                                                // 10/10, 10/10/2026
  const DATE_REL = /\b(today|hoy|tomorrow)\b/gi;
  // "District 1/3", "Distrito 5 mayo": a number right after a district word is a district, not a day
  const AFTER_DISTRICT = /\b(?:districts?|distritos?|dist|dto|d)\s*[.#-]?\s*0*$/i;

  /* ---------------------------------------------------------------- small helpers */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const accentVars = (c) => SHADES.map((s) => `--a-${s}:var(--color-${c || "slate"}-${s})`).join(";");
  const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function todayYmd() { return ymdFmt.format(new Date()); }
  function nowWall() {
    const p = Object.fromEntries(partsFmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
  }
  const utcDate = (ymd) => new Date(ymd + "T12:00:00Z");
  const addDays = (ymd, n) => { const d = utcDate(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dowOf = (ymd) => utcDate(ymd).getUTCDay();
  const monthStart = (ymd) => ymd.slice(0, 7) + "-01";
  // the list hides the days that are over with :has() (calendar.css); a browser without it shows the whole month
  const HAS_SEL = !!(window.CSS && CSS.supports && CSS.supports("selector(:has(a))"));
  const addMonths = (ymd, n) => { const d = utcDate(monthStart(ymd)); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  // the next animation frame, or a short timeout when frames are paused (background tab)
  const nextFrame = () => new Promise((resolve) => {
    const t = setTimeout(resolve, 60);
    requestAnimationFrame(() => { clearTimeout(t); resolve(); });
  });
  function storageOk() {
    try { localStorage.setItem("__msca", "1"); localStorage.removeItem("__msca"); return true; } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- event pages: "this event has ended" */
  function revealAfter() {
    const now = Date.now();
    document.querySelectorAll("[data-reveal-after]").forEach((el) => {
      const t = Date.parse(el.dataset.revealAfter);
      if (!isNaN(t) && now > t) el.hidden = false;
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", revealAfter);
  else revealAfter();

  /* ---------------------------------------------------------------- the component */
  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    Alpine.data("areaCalendar", () => {
      // big, read-only data lives outside Alpine's reactive state (fast filtering)
      let OCC = [];
      let SERIES = {};
      let TYPES = [];
      let TYPEMAP = {};
      let fc = null;
      let fcLoading = null;
      let cfg = {};
      let silent = false;
      let rendering = 0;
      let opener = null;       // element that opened the details panel / filter drawer (focus goes back there)
      let drawerOpener = null;
      let fromUrl = false;     // the page was opened with filters in the address (a shared link)
      let viewPicked = false;  // the visitor chose a view (only then is it remembered)
      let settleTimers = [];
      let WEND = "9999-12-31"; // last day in events.json: a text search looks this far ahead
      let QP = { q: null };    // the search box, parsed once per value (query())
      let DISTS = [];          // events.json districts: { slug, nums } (the District dropdown lists the same ones)

      const blank = () => ({ types: TYPES.map((t) => t.key), formats: [], langs: [], district: "", cmt: "", dows: [], tods: [], flyer: false, zoom: false, q: "" });

      return {
        saved: storageOk() ? Alpine.$persist({}).as(STORE_KEY) : {},
        ready: false,
        failed: false,
        view: "month",
        title: "",
        drawer: false,
        sel: null,
        ss: null,
        f: { types: [], formats: [], langs: [], district: "", cmt: "", dows: [], tods: [], flyer: false, zoom: false, q: "" },
        counts: { types: {}, formats: {}, langs: {}, dows: {}, tods: {}, total: 0 },
        agenda: [],
        agendaDays: 30,
        agendaFrom: todayYmd(),
        agendaTotal: 0,
        agendaCap: SEARCH_STEP.large,
        elsewhere: { later: 0, next: "", earlier: 0, last: "" }, // a text search: matches on dates not on screen
        mini: { month: monthStart(todayYmd()), weeks: [], day: todayYmd(), items: [], label: "" },
        range: { start: "", end: "" },
        // this month opens on what is still to come (earlyAt): the days before wait behind the "Earlier days" line
        early: { at: "", n: 0, label: "", events: "" },
        earlyOpen: false,      // the list: those days are shown
        nowMode: true,         // the month view: this week and the next four (dayGridNow), not a calendar month
        anchor: todayYmd(),
        phone: false,
        lg: false,
        xl: false,
        tbOut: false,
        copied: "",

        /* ------------------------------------------------ setup */
        async init() {
          try { cfg = JSON.parse(document.getElementById("cal-config").textContent); } catch (e) { cfg = {}; }
          const mqPhone = window.matchMedia("(max-width: 639px)");
          const mqLg = window.matchMedia("(min-width: 1024px)");
          const mqXl = window.matchMedia("(min-width: 1280px)");
          this.phone = mqPhone.matches;
          this.lg = mqLg.matches;
          this.xl = mqXl.matches;
          const onPhone = () => { const was = this.phone; this.phone = mqPhone.matches; if (was !== this.phone && this.ready) this.render(false, false); };
          const onLg = () => { this.lg = mqLg.matches; };
          const onXl = () => { this.xl = mqXl.matches; if (this.xl) this.drawer = false; };
          const listen = (mq, fn) => (mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn));
          listen(mqPhone, onPhone);
          listen(mqLg, onLg);
          listen(mqXl, onXl);
          // phones / tablets: show the slim sticky bar once the toolbar has scrolled under the site header
          if ("IntersectionObserver" in window && this.$refs.toolbar) {
            new IntersectionObserver((entries) => {
              const e = entries[0];
              this.tbOut = !e.isIntersecting && e.boundingClientRect.top < 0;
            }, { rootMargin: "-100px 0px 0px 0px" }).observe(this.$refs.toolbar);
          }
          // before the data arrives, so the page does not move once the visitor has started reading
          this.jumpToCalendar();

          let data;
          try {
            const res = await fetch(M.url(cfg.json || "/assets/data/events.json"), { cache: "no-cache" });
            if (!res.ok) throw new Error("HTTP " + res.status);
            data = await res.json();
          } catch (e) {
            this.failed = true;
            return;
          }
          this.prepare(data);

          // state: the address bar wins, then what this browser remembered, then defaults
          fromUrl = this.readUrl();
          if (!fromUrl) {
            const s = this.saved || {};
            if (s.f) this.f = this.cleanFilters(s.f); // never the typed search (see save())
            else this.f = blank();
            if (s.view) viewPicked = true;
            this.view = s.view || this.defaultView();
          }
          if (this.phone && this.view === "week") this.view = "agenda";
          this.agendaDays = this.step();
          this.agendaCap = this.searchStep();
          // counted before the first render, so "Nothing matches" does not flash up while a long list is being drawn
          this.recount();
          this.ready = true;

          // filter changes are Back-able steps; typing in the search box only updates the address
          let lastQ = this.f.q;
          this.$watch("f", () => {
            const typing = this.f.q !== lastQ;
            lastQ = this.f.q;
            if (typing) this.agendaCap = this.searchStep();
            if (!silent) this.apply(!typing);
          });
          window.addEventListener("popstate", () => {
            if (!this.readUrl()) {
              silent = true;
              this.f = blank();
              this.view = this.defaultView();
              this.anchor = todayYmd();
              this.nowMode = true;
              this.$nextTick(() => { silent = false; });
            }
            this.render(false, false);
          });
          this.$nextTick(() => this.render(false, false));
          setInterval(() => { if (this.view === "agenda") { this.buildAgenda(); this.recount(); } }, 5 * 60 * 1000);
        },

        prepare(data) {
          const es = cfg.lang === "es";
          const MS = window.MSearch;
          TYPES = (data.types || []).slice().sort((a, b) => a.sort - b.sort);
          TYPEMAP = Object.fromEntries(TYPES.map((t) => [t.key, t]));
          SERIES = data.series || {};
          WEND = String(data.windowEnd || WEND).slice(0, 10);
          DISTS = data.districts || [];
          const icons = cfg.icons || {};
          // search words of a committee and of a host district, in both languages (District 8 is also "District 11")
          const CW = Object.fromEntries((data.committees || []).map((c) => [c.slug, [c.en, c.es]]));
          const DW = Object.fromEntries((data.districts || []).map((d) => [d.slug, [d.en, d.es, ...(d.nums || []).map((n) => `District ${n}`)]]));
          // MSearch.index once per distinct entry text (a weekly meeting repeats it); the date words are added per date
          const hays = new Map();
          const titleHays = new Map();
          OCC = (data.occurrences || []).map((r) => {
            const s = SERIES[r.s] || {};
            const ty = TYPEMAP[r.ty] || { en: r.ty, es: r.ty, color: "slate" };
            const allDay = !!r.ad;
            const wall = r.a.slice(0, 19);
            const wallEnd = r.b.slice(0, 19);
            const date = r.a.slice(0, 10);
            let endDate = r.b.slice(0, 10);
            if (allDay || wallEnd.slice(11) === "00:00:00") endDate = addDays(endDate, -1);
            if (endDate < date) endDate = date;
            const hour = +wall.slice(11, 13);
            const title = (es && r.te) || r.t;
            const place = r.f === "Virtual" ? `${cfg.i18n.online} · Zoom` : [r.v, r.ci].filter(Boolean).join(", ") || (r.f === "Hybrid" ? "Zoom" : "");
            const key = [r.s, r.t, r.te, r.ty, r.v, r.ci, r.f, r.l, r.z ? 1 : 0, (r.cm || []).join(), (r.d || []).join()].join("|");
            let hay = hays.get(key);
            if (hay === undefined) {
              const loc = s.location || {};
              const mail = (MS.fold(s.email).match(/[a-z0-9._%+-]+@[a-z0-9.-]+/) || [""])[0];
              hay = MS.index(r.t, r.te, ty.en, ty.es, (r.cm || []).map((x) => CW[x]), (r.d || []).map((x) => DW[x]),
                FORMAT_WORDS[r.f], LANG_WORDS[r.l], r.z ? "Zoom" : "", place, r.v, r.ci, loc.address, s.rule_en, s.rule_es) +
                // the role e-mail whole and its name part ("d05dcmc", "archiveschair") as plain words: through MSearch.index
                // its pieces ("msca09aa", "dcmc" → "district committee member chair") would match every entry with an e-mail
                (mail ? `${mail} ${mail.split("@")[0]} ` : "") + (r.f === "Hybrid" ? HYBRID_RAW + " " : "");
              hays.set(key, hay);
            }
            // a date typed in the box is also looked for in the title ("Sept. 7th Budget Setting Meeting")
            const tkey = r.t + "|" + (r.te || "");
            let thay = titleHays.get(tkey);
            if (thay === undefined) titleHays.set(tkey, (thay = MS.index(r.t, r.te)));
            // the days it covers (for a typed date) and their weekday, month and year as words
            const days = [];
            const words = new Set();
            for (let d = date, i = 0; d <= endDate && i < 62; d = addDays(d, 1), i++) {
              days.push(d);
              words.add(DOW_WORDS[dowOf(d)]).add(MONTH_WORDS[+d.slice(5, 7) - 1]).add(d.slice(0, 4));
            }
            return {
              k: r.k, s: r.s, title, ty: r.ty, typeLabel: es ? ty.es : ty.en, color: r.c || ty.color, vars: accentVars(r.c || ty.color),
              icon: icons[r.ty] || "", f: r.f || "", l: r.l || "", d: r.d || [], cm: r.cm || [], tp: s.topics || [],
              ci: r.ci || "", v: r.v || "", fl: (es && r.fle) || r.fl || "", z: !!r.z, r: !!r.r, st: r.st || "", allDay,
              a: r.a, b: r.b, wall, wallEnd, date, endDate, multi: endDate !== date,
              ms: Date.parse(r.a), msEnd: Date.parse(r.b), dow: dowOf(date),
              tod: allDay ? "allday" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening",
              time: allDay ? cfg.i18n.all_day : (r.tl && r.tl[es ? 1 : 0]) || "",
              short: allDay ? "" : this.shortTime(wall),
              place,
              url: this.lurl(s.url || "/calendar/"),
              // MSearch search string (" word word … "), title only, and the days covered (" 2026-10-16 2026-10-17 ")
              hay: hay + [...words].join(" ") + " ",
              thay,
              days: " " + days.join(" ") + " ",
            };
          });
        },

        // filters remembered in this browser; the typed search is not restored (an old search would silently empty the calendar)
        cleanFilters(x) {
          const keys = TYPES.map((t) => t.key);
          const out = blank();
          if (x && typeof x === "object") {
            if (Array.isArray(x.types)) out.types = x.types.filter((k) => keys.includes(k));
            for (const k of ["formats", "langs", "dows", "tods"]) if (Array.isArray(x[k])) out[k] = x[k].slice();
            out.district = this.knownDistrict(x.district);
            out.cmt = this.knownCmt(x.cmt);
            out.flyer = !!x.flyer;
            out.zoom = !!x.zoom;
          }
          return out;
        },

        // a district / committee / topic from the address or from this browser: only one the dropdowns offer ("5", "d5",
        // "D05" → the district with number 5); anything else is dropped, so an old link does not empty the calendar
        knownDistrict(v) {
          v = typeof v === "string" ? v.trim().toLowerCase() : "";
          if (!v || DISTS.some((d) => d.slug === v)) return v;
          const n = (v.match(/^(?:d|dist|district|distrito)?[\s.-]*0*(\d{1,2})$/) || [])[1];
          const d = n && DISTS.find((x) => (x.nums || []).includes(+n));
          return d ? d.slug : "";
        },
        knownCmt(v) { return typeof v === "string" && (cfg.cmts || []).some((c) => c.value === v) ? v : ""; },

        /* ------------------------------------------------ URL <-> state */
        readUrl() {
          const p = new URLSearchParams(location.search);
          if (![...p.keys()].some((k) => URL_KEYS.includes(k))) return false;
          silent = true;
          const f = blank();
          if (p.get("type")) {
            const want = p.get("type").split(",");
            f.types = TYPES.filter((t) => want.includes(t.slug)).map((t) => t.key);
          }
          if (p.get("format")) { const w = p.get("format").split(","); f.formats = Object.keys(FORMAT_SLUG).filter((k) => w.includes(FORMAT_SLUG[k])); }
          if (p.get("lang")) { const w = p.get("lang").split(","); f.langs = Object.keys(LANG_SLUG).filter((k) => w.includes(LANG_SLUG[k])); }
          f.district = this.knownDistrict(p.get("district"));
          f.cmt = this.knownCmt(p.get("committee") ? "c:" + p.get("committee") : p.get("topic") ? "t:" + p.get("topic") : "");
          if (p.get("day")) f.dows = p.get("day").split(",").map(Number).filter((n) => n >= 0 && n <= 6);
          if (p.get("time")) f.tods = p.get("time").split(",").filter((x) => TODS.includes(x));
          f.flyer = p.get("flyer") === "1";
          f.zoom = p.get("zoom") === "1";
          f.q = p.get("q") || "";
          this.f = f;
          const v = p.get("view");
          if (["agenda", "month", "week", "list"].includes(v)) this.view = v;
          const d = p.get("date");
          this.anchor = todayYmd();
          this.nowMode = true;
          this.mini.month = monthStart(this.anchor);
          if (d && /^\d{4}-\d{2}(-\d{2})?$/.test(d)) {
            this.anchor = d.length === 7 ? d + "-01" : d;
            this.nowMode = false;
            if (this.view === "agenda") this.agendaFrom = this.anchor < todayYmd() ? todayYmd() : this.anchor;
            this.mini.month = monthStart(this.anchor);
          }
          this.$nextTick(() => { silent = false; });
          return true;
        },
        urlParams() {
          const p = new URLSearchParams();
          const f = this.f;
          p.set("view", this.view);
          if (this.view !== "agenda" && !(this.view === "month" && this.nowMode) && this.anchor && this.anchor.slice(0, 7) !== todayYmd().slice(0, 7)) p.set("date", this.view === "week" ? this.anchor : this.anchor.slice(0, 7));
          if (f.types.length !== TYPES.length) p.set("type", TYPES.filter((t) => f.types.includes(t.key)).map((t) => t.slug).join(",") || "none");
          if (f.formats.length) p.set("format", f.formats.map((k) => FORMAT_SLUG[k]).join(","));
          if (f.langs.length) p.set("lang", f.langs.map((k) => LANG_SLUG[k]).join(","));
          if (f.district) p.set("district", f.district);
          if (f.cmt.startsWith("c:")) p.set("committee", f.cmt.slice(2));
          if (f.cmt.startsWith("t:")) p.set("topic", f.cmt.slice(2));
          if (f.dows.length) p.set("day", f.dows.slice().sort().join(","));
          if (f.tods.length) p.set("time", f.tods.join(","));
          if (f.flyer) p.set("flyer", "1");
          if (f.zoom) p.set("zoom", "1");
          if (f.q.trim()) p.set("q", f.q.trim());
          return p;
        },
        syncUrl(push) {
          const qs = this.urlParams().toString();
          const url = location.pathname + (qs ? "?" + qs : "") + location.hash;
          if (url === location.pathname + location.search + location.hash) return;
          try {
            if (push) history.pushState(null, "", url);
            else history.replaceState(null, "", url);
          } catch (e) {}
        },
        save() {
          // a shared link's filters are not the visitor's own: remember only after they change something
          if (fromUrl) return;
          // the typed search is not remembered: it lives in the address only (?q=), so reload and shared links keep it
          try { this.saved = Object.assign(viewPicked ? { view: this.view } : {}, { f: Object.assign(JSON.parse(JSON.stringify(this.f)), { q: "" }) }); } catch (e) {}
        },
        shareUrl() { return location.origin + location.pathname + "?" + this.urlParams().toString(); },
        // the Area events' flyers come before the calendar. A link with the calendar's words in the address (a committee
        // or district page's "Area calendar" link, "Share this view") is about the calendar: open the page there. Not when
        // the address names a part of the page (#…), on a reload or Back / Forward (the browser puts the page back where
        // it was), or once the page has been scrolled
        jumpToCalendar() {
          const p = new URLSearchParams(location.search);
          if (location.hash || window.scrollY > 0 || ![...p.keys()].some((k) => URL_KEYS.includes(k))) return;
          const nav = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
          if (nav && nav.type !== "navigate") return;
          const main = document.getElementById("cal-main");
          if (main) main.scrollIntoView({ block: "start", behavior: "instant" });
        },

        /* ------------------------------------------------ filtering */
        match(o, skip) {
          // the plain filter object, not Alpine's reactive proxy: a search runs this for every entry, six times in recount()
          const f = Alpine.raw(this.f);
          if (skip !== "types" && !f.types.includes(o.ty)) return false;
          if (skip !== "formats" && f.formats.length && !f.formats.includes(o.f)) return false;
          if (skip !== "langs" && f.langs.length && !f.langs.includes(o.l)) return false;
          if (f.district && !o.d.includes(f.district)) return false;
          if (f.cmt) {
            const v = f.cmt.slice(2);
            if (f.cmt[0] === "c" && !o.cm.includes(v)) return false;
            if (f.cmt[0] === "t" && !o.tp.some((t) => this.slug(t) === v)) return false;
          }
          if (skip !== "dows" && f.dows.length && !f.dows.includes(o.dow)) return false;
          if (skip !== "tods" && f.tods.length && !f.tods.includes(o.tod)) return false;
          if (f.flyer && !o.fl) return false;
          if (f.zoom && !o.z) return false;
          if (f.q) {
            const p = this.query(f.q);
            if (!p.empty && !this.textHit(o, p)) return false;
          }
          return true;
        },
        // the search box, parsed once per value: the dates typed in it ("Oct 10", "10 de octubre", "2026-10-10",
        // "10/10" — month first on the English page, day first on the Spanish one —, "today") and the rest, for MSearch
        query(q = this.f.q) {
          q = q || "";
          if (QP.q === q) return QP;
          const MS = window.MSearch;
          const pad = (n) => String(n).padStart(2, "0");
          const dates = [];
          // phrase: a date written with a month name is also looked for as words of the title
          const take = (y, m, d, phrase) => {
            m = +m;
            d = +d;
            if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
            y = !y ? "" : String(y).length === 2 ? "20" + y : String(y);
            dates.push({ day: `${y}-${pad(m)}-${pad(d)} `, words: phrase ? MS.query(phrase) : null });
            return true;
          };
          let s = q;
          const cut = (re, fn) => {
            s = s.replace(re, (...a) => {
              const at = a[a.length - 2], whole = a[a.length - 1];
              return !AFTER_DISTRICT.test(whole.slice(0, at)) && fn(...a) ? " " : a[0];
            });
          };
          cut(DATE_MD, (m, mon, d, y) => take(y, MONTH_NUM[mon.toLowerCase()], d, m));
          cut(DATE_DM, (m, d, mon, y) => take(y, MONTH_NUM[mon.toLowerCase()], d, m));
          cut(DATE_ISO, (m, y, mo, d) => take(y, mo, d));
          cut(DATE_NUM, (m, a, b, y) => (cfg.lang === "es" ? take(y, b, a) || take(y, a, b) : take(y, a, b) || take(y, b, a)));
          cut(DATE_REL, (m, w) => { const t = w.toLowerCase() === "tomorrow" ? addDays(todayYmd(), 1) : todayYmd(); return take(t.slice(0, 4), t.slice(5, 7), t.slice(8)); });
          const mq = MS.query(s);
          QP = { q, mq, dates, empty: mq.empty && !dates.length };
          return QP;
        },
        // the text search on one entry, remembered per parsed query (match() runs six times per entry in recount())
        textHit(o, p) {
          if (o.qp !== p) {
            o.qp = p;
            o.qhit = MSearch.test(o.hay, p.mq) && p.dates.every((d) => o.days.includes(d.day) || (!!d.words && MSearch.test(o.thay, d.words)));
          }
          return o.qhit;
        },
        searching() { return !this.query().empty; },
        inRange(o, from, to) { return o.wallEnd > from && o.wall < to || (o.wall === o.wallEnd && o.wall >= from && o.wall < to); },
        // the agenda's days: never before today (a day number clicked in the month grid can be in the past, and a page
        // left open passes midnight); a text search covers every date from today to the end of the calendar
        agendaRange() {
          const today = todayYmd();
          if (this.searching()) return [today, addDays(WEND, 1)];
          const from = this.agendaFrom < today ? today : this.agendaFrom;
          return [from, addDays(from, this.agendaDays)];
        },
        countRange() {
          if (this.view === "agenda") { const [from, to] = this.agendaRange(); return [from + "T00:00:00", to + "T00:00:00"]; }
          if (this.view === "month" && this.phone) return [this.mini.month + "T00:00:00", addMonths(this.mini.month, 1) + "T00:00:00"];
          return [this.view === "list" && this.folded() ? this.early.at + "T00:00:00" : this.range.start || "0000", this.range.end || "9999"];
        },
        // this month opens on what is still to come: the month view on this week and the next four (dayGridNow), the list
        // on today. The days before (from the month grid's first Sunday, or the 1st) wait behind the "Earlier days" line
        // above. The first day after them, or "" (nothing to fold: another month, the first week, the 1st)
        earlyAt() {
          if (!this.usesFc() || !this.range.start) return "";
          const today = todayYmd(), m0 = monthStart(today);
          if (this.view === "month") {
            // the rolling grid, or this whole month after "Show"
            if (!this.nowMode && this.anchor.slice(0, 7) !== today.slice(0, 7)) return "";
            const at = addDays(today, -dowOf(today));
            return at > addDays(m0, -dowOf(m0)) ? at : "";
          }
          if (this.view !== "list" || !HAS_SEL || this.anchor.slice(0, 7) !== today.slice(0, 7)) return "";
          return today > m0 ? today : "";
        },
        // where the earlier days start: the month grid's first Sunday, the list's 1st
        earlyFrom() { const m0 = monthStart(todayYmd()); return this.view === "month" ? addDays(m0, -dowOf(m0)) : m0; },
        earlyShown() { return this.view === "month" ? !this.nowMode : this.earlyOpen; },
        folded() { return !!this.early.at && !this.earlyShown(); },
        toggleEarly() {
          if (this.view === "month") {
            // the whole of this month, or back to this week and the next four
            this.nowMode = !this.nowMode;
            this.anchor = this.nowMode ? todayYmd() : monthStart(todayYmd());
            this.render(true, false);
            return;
          }
          this.earlyOpen = !this.earlyOpen;
          this.recount();
          this.settle();
        },
        // "Earlier days · Sep 27 – Oct 10" and how many entries (with the filters and search) are in them
        countEarly() {
          const at = this.earlyAt();
          if (!at) return { at: "", n: 0, label: "", events: "" };
          const start = this.earlyFrom(), to = at + "T00:00:00";
          let n = 0;
          for (const o of OCC) if (this.inRange(o, start + "T00:00:00", to) && this.match(o)) n++;
          const loc = cfg.locale || "en-US", i = cfg.i18n;
          const f = (d) => new Intl.DateTimeFormat(loc, { month: "short", day: "numeric", timeZone: "UTC" }).format(utcDate(d));
          const ev = n === 1 ? i.one_event : n ? i.n_events.replace("{n}", n.toLocaleString(loc)) : i.no_events;
          return { at, n, label: i.early.replace("{from}", f(start)).replace("{to}", f(addDays(at, -1))), events: ev };
        },
        recount() {
          this.early = this.countEarly();
          const [from, to] = this.countRange();
          const c = { types: {}, formats: {}, langs: {}, dows: {}, tods: {}, total: 0 };
          const nowMs = Date.now();
          const agenda = this.view === "agenda";
          // an entry the typed search rules out counts nowhere (no facet count leaves the search out): skip it at once
          const p = this.query(Alpine.raw(this.f).q);
          const text = (o) => p.empty || this.textHit(o, p);
          for (const o of OCC) {
            if (!this.inRange(o, from, to)) continue;
            if (agenda && o.msEnd < nowMs) continue;
            if (!text(o)) continue;
            if (this.match(o, "types")) c.types[o.ty] = (c.types[o.ty] || 0) + 1;
            if (this.match(o, "formats")) c.formats[o.f] = (c.formats[o.f] || 0) + 1;
            if (this.match(o, "langs")) c.langs[o.l] = (c.langs[o.l] || 0) + 1;
            if (this.match(o, "dows")) c.dows[o.dow] = (c.dows[o.dow] || 0) + 1;
            if (this.match(o, "tods")) c.tods[o.tod] = (c.tods[o.tod] || 0) + 1;
            if (this.match(o)) c.total++;
          }
          this.counts = c;
          // a text search: the matches on dates that are not on screen. The agenda already lists every coming match, so
          // there only the earlier (ended) ones are left; month / week / list also count the coming ones
          const e = { later: 0, next: "", earlier: 0, last: "" };
          if (!p.empty) {
            const today = todayYmd();
            for (const o of OCC) {
              const ended = o.msEnd < nowMs;
              if ((agenda ? !ended : this.inRange(o, from, to)) || !text(o) || !this.match(o)) continue;
              if (ended) {
                e.earlier++;
                if (o.date > e.last) e.last = o.date;
              } else {
                e.later++;
                const d = o.date < today ? today : o.date;
                if (!e.next || d < e.next) e.next = d;
              }
            }
          }
          this.elsewhere = e;
        },
        // the line above the calendar while searching: the matches on other dates, or (when nothing coming matches) the earlier ones
        elsewhereText() {
          const e = this.elsewhere, i = cfg.i18n, loc = cfg.locale || "en-US";
          const day = (d) => new Intl.DateTimeFormat(loc, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(utcDate(d));
          if (e.later) return (e.later === 1 ? i.later_one : i.later_n).replace("{n}", e.later.toLocaleString(loc)).replace("{date}", day(e.next));
          if (e.earlier && !this.counts.total) return (e.earlier === 1 ? i.earlier_one : i.earlier_n).replace("{n}", e.earlier.toLocaleString(loc)).replace("{date}", day(e.last));
          return "";
        },
        goTarget() { const e = this.elsewhere; return e.later ? e.next : e.earlier && !this.counts.total ? e.last : ""; },
        goLabel() {
          const d = this.goTarget();
          return d ? cfg.i18n.go_to.replace("{date}", new Intl.DateTimeFormat(cfg.locale || "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(utcDate(d))) : "";
        },
        // "Show every match": the agenda, which lists every coming match of a text search
        showAllMatches() {
          this.agendaCap = this.searchStep();
          this.setView("agenda");
          this.focusTitle();
        },
        // "Go to …": the month / week / list moves to that date; from the agenda (only earlier matches), the list of that month
        goToMatch() {
          const d = this.goTarget();
          if (!d) return;
          if (this.view === "agenda") {
            this.anchor = d;
            this.mini.month = monthStart(d);
            this.setView("list");
          } else if (this.view === "month" && this.usesFc()) {
            // the whole month of that date
            this.nowMode = false;
            this.anchor = monthStart(d);
            this.render(true, false);
          } else if (this.usesFc()) {
            if (this.folded() && d < this.early.at && d >= this.earlyFrom()) this.toggleEarly();
            else if (fc) fc.gotoDate(d);
          } else {
            this.mini.month = monthStart(d);
            this.mini.day = d;
            this.anchor = this.mini.month;
            this.buildMini();
            this.recount();
            this.syncUrl(true);
          }
          this.focusTitle();
        },
        // the button that was pressed goes away with its line: take the keyboard to the calendar's title
        focusTitle() {
          this.$nextTick(() => {
            const t = document.getElementById("cal-title");
            if (t) t.focus({ preventScroll: true });
          });
        },
        count(group, key) { return (this.counts[group] && this.counts[group][key]) || 0; },
        groupCount(keys) { return keys.reduce((n, k) => n + this.count("types", k), 0); },

        /* ------------------------------------------------ filter actions */
        activeCount() {
          const f = this.f;
          return (f.types.length !== TYPES.length ? 1 : 0) + f.formats.length + f.langs.length + (f.district ? 1 : 0) + (f.cmt ? 1 : 0) +
            f.dows.length + f.tods.length + (f.flyer ? 1 : 0) + (f.zoom ? 1 : 0) + (f.q.trim() ? 1 : 0);
        },
        clearAll() { this.f = blank(); },
        toggle(list, v) { const a = this.f[list]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); },
        has(list, v) { return this.f[list].includes(v); },
        only(key) { this.f.types = [key]; },
        groupState(keys) { const n = keys.filter((k) => this.f.types.includes(k)).length; return n === 0 ? "none" : n === keys.length ? "all" : "some"; },
        toggleGroup(keys) {
          const st = this.groupState(keys);
          if (st === "all") this.f.types = this.f.types.filter((k) => !keys.includes(k));
          else this.f.types = [...new Set([...this.f.types, ...keys])];
        },
        chips() {
          const f = this.f, i = cfg.i18n, es = cfg.lang === "es", out = [];
          if (f.types.length !== TYPES.length) {
            const sel = TYPES.filter((t) => f.types.includes(t.key));
            out.push({ key: "types", label: sel.length <= 2 ? sel.map((t) => (es ? t.es : t.en)).join(", ") || i.no_categories : i.n_categories.replace("{n}", sel.length) });
          }
          f.formats.forEach((x) => out.push({ key: "formats", v: x, label: i["format_" + FORMAT_SLUG[x]] }));
          f.langs.forEach((x) => out.push({ key: "langs", v: x, label: i["lang_" + LANG_SLUG[x]] }));
          if (f.district) { const d = (cfg.districts || []).find((x) => x.slug === f.district); out.push({ key: "district", label: d ? d.label : f.district }); }
          if (f.cmt) { const c = (cfg.cmts || []).find((x) => x.value === f.cmt); out.push({ key: "cmt", label: c ? c.label : f.cmt.slice(2) }); }
          f.dows.forEach((x) => out.push({ key: "dows", v: x, label: cfg.dows[x] }));
          f.tods.forEach((x) => out.push({ key: "tods", v: x, label: i["tod_" + x] }));
          if (f.flyer) out.push({ key: "flyer", label: i.has_flyer });
          if (f.zoom) out.push({ key: "zoom", label: i.has_zoom });
          if (f.q.trim()) out.push({ key: "q", label: "“" + f.q.trim() + "”" });
          return out;
        },
        removeChip(c) {
          if (c.key === "types") this.f.types = TYPES.map((t) => t.key);
          else if (["formats", "langs", "dows", "tods"].includes(c.key)) this.toggle(c.key, c.v);
          else if (c.key === "flyer" || c.key === "zoom") this.f[c.key] = false;
          else this.f[c.key] = "";
        },

        /* ------------------------------------------------ quick views */
        quick(name) {
          const f = blank();
          if (name === "area") f.types = AREA_TYPES.filter((k) => TYPEMAP[k]);
          if (name === "spanish") f.langs = ["Spanish", "Bilingual"];
          if (name === "online") f.formats = ["Virtual"];
          if (name === "workshops") f.types = LEARNING_TYPES.filter((k) => TYPEMAP[k]);
          if (name === "districts") f.types = ["District"];
          silent = true;
          this.f = f;
          if (name === "week") {
            this.anchor = todayYmd();
            this.agendaFrom = todayYmd();
            if (this.phone) { this.view = "agenda"; this.agendaDays = 7; }
            else this.view = "week";
            viewPicked = true;
          } else if ((name === "area" || name === "workshops") && (this.view === "week" || this.view === "agenda")) {
            // few entries: a week would often be empty, so show the next three months as a list
            this.view = "agenda";
            this.agendaFrom = todayYmd();
            this.agendaDays = Math.max(this.agendaDays, 90);
          } else if (this.view === "agenda" && this.agendaDays === 7) {
            this.agendaDays = this.step();
          }
          this.$nextTick(() => { silent = false; this.render(true); });
        },
        isQuick(name) {
          const f = this.f;
          const clean = !f.formats.length && !f.langs.length && !f.district && !f.cmt && !f.dows.length && !f.tods.length && !f.flyer && !f.zoom && !f.q.trim();
          const typesAre = (keys) => f.types.length === keys.length && keys.every((k) => f.types.includes(k));
          const allTypes = f.types.length === TYPES.length;
          if (name === "all") return clean && allTypes && this.view !== "week";
          if (name === "week") return clean && allTypes && (this.view === "week" || (this.view === "agenda" && this.agendaDays === 7));
          if (name === "area") return clean && typesAre(AREA_TYPES.filter((k) => TYPEMAP[k]));
          if (name === "workshops") return clean && typesAre(LEARNING_TYPES.filter((k) => TYPEMAP[k]));
          if (name === "districts") return clean && typesAre(["District"]);
          const only = (k, vals) => allTypes && !f.district && !f.cmt && !f.dows.length && !f.tods.length && !f.flyer && !f.zoom && !f.q.trim() &&
            (k === "langs" ? !f.formats.length : !f.langs.length) && f[k].length === vals.length && vals.every((v) => f[k].includes(v));
          if (name === "spanish") return only("langs", ["Spanish", "Bilingual"]);
          if (name === "online") return only("formats", ["Virtual"]);
          return false;
        },

        /* ------------------------------------------------ views */
        // the month grid needs a laptop-wide screen; below 1024px its titles are cut off, so phones and tablets open
        // in the agenda (a shared link or the visitor's own choice still wins)
        defaultView() { return this.lg ? "month" : "agenda"; },
        usesFc() { return this.view === "week" || this.view === "list" || (this.view === "month" && !this.phone); },
        fcViewName() {
          if (this.view === "week") return this.phone ? "listWeek" : "dayGridWeek";
          if (this.view === "list") return "listMonth";
          return this.nowMode ? "dayGridNow" : "dayGridMonth";
        },
        setView(v) {
          if (v === this.view) return;
          viewPicked = true;
          this.view = v;
          // the month of the day on screen; this month opens on this week
          if (v === "month") this.nowMode = !this.anchor || this.anchor.slice(0, 7) === todayYmd().slice(0, 7);
          if (v === "agenda") { this.agendaFrom = todayYmd(); this.agendaDays = this.step(); }
          this.render(true);
        },
        apply(push) {
          if (!this.ready) return;
          this.render(push);
        },
        async render(push, user = true) {
          if (!this.ready) return;
          if (user) fromUrl = false;
          rendering++;
          try {
            if (this.usesFc()) {
              await this.ensureFc();
              if (!fc) return;
              const name = this.fcViewName();
              if (fc.view.type !== name) {
                const at = name === "dayGridNow" ? todayYmd() : this.anchor;
                fc.changeView(name, at);
                // FullCalendar can keep its old date when the view changes (seen going from next month back to this week)
                const ymd = (d) => d.toISOString().slice(0, 10);
                if (at && !(ymd(fc.view.currentStart) <= at && at < ymd(fc.view.currentEnd))) fc.gotoDate(at);
              } else if (name === "dayGridNow") {
                // a page left open into the next week starts again from this week
                const cur = fc.view.currentStart.toISOString().slice(0, 10), today = todayYmd();
                if (today < cur || today >= addDays(cur, 7)) fc.gotoDate(today);
              } else if (this.anchor) {
                // e.g. Back/Forward to another month: move the calendar to the date in the address bar
                const cur = fc.view.currentStart.toISOString().slice(0, 10);
                const same = this.view === "week" ? this.anchor >= cur && this.anchor < addDays(cur, 7) : this.anchor.slice(0, 7) === cur.slice(0, 7);
                if (!same) fc.gotoDate(this.anchor);
              }
              this.$nextTick(() => { fc.updateSize(); fc.refetchEvents(); this.recount(); this.settle(); });
            } else if (this.view === "agenda") {
              this.title = cfg.i18n.upcoming;
              this.buildAgenda();
            } else {
              this.buildMini();
            }
            this.recount();
            this.save();
            this.syncUrl(push);
          } finally {
            rendering--;
          }
        },
        nav(dir) {
          if (this.usesFc() && fc && this.view === "month") {
            // a calendar month at a time; this month is this week and the next four
            const m0 = monthStart(todayYmd());
            const target = dir === 0 ? m0 : addMonths(this.nowMode ? m0 : monthStart(this.anchor), dir);
            this.nowMode = target === m0;
            this.anchor = this.nowMode ? todayYmd() : target;
            this.render(true, false);
            return;
          }
          if (this.usesFc() && fc) {
            if (dir === 0) {
              // already on this month: no datesSet, so fold the earlier days back here
              if (this.earlyOpen) { this.earlyOpen = false; this.recount(); this.settle(); }
              fc.today();
            } else if (dir < 0) fc.prev(); else fc.next();
            return;
          }
          if (this.view === "month") {
            this.mini.month = dir === 0 ? monthStart(todayYmd()) : addMonths(this.mini.month, dir);
            if (dir === 0) this.mini.day = todayYmd();
            this.anchor = this.mini.month;
            this.buildMini();
            this.recount();
            this.syncUrl(true);
            return;
          }
          if (this.view === "agenda") { this.agendaFrom = todayYmd(); this.agendaDays = this.step(); this.buildAgenda(); this.recount(); }
        },

        /* ------------------------------------------------ FullCalendar */
        ensureFc() {
          if (fc) return Promise.resolve();
          if (fcLoading) return fcLoading;
          fcLoading = (async () => {
            try {
              await M.load("/assets/vendor/fullcalendar.min.js");
              if (cfg.lang === "es") await M.load("/assets/vendor/fullcalendar-es.min.js").catch(() => {});
            } catch (e) {
              this.failed = true;
              return;
            }
            const FC = window.FullCalendar;
            if (!FC) { this.failed = true; return; }
            const el = this.$refs.fc;
            const es = cfg.lang === "es";
            // Alpine un-hides x-show blocks on the next animation frame: FullCalendar measures its columns when it first
            // renders, so wait until its box is on screen (a few frames at most)
            await this.$nextTick();
            for (let i = 0; i < 12 && !el.getClientRects().length; i++) await nextFrame();
            fc = new FC.Calendar(el, {
              timeZone: "UTC",
              now: () => nowWall(),
              locale: es ? "es" : "en",
              firstDay: 0,
              initialView: this.fcViewName(),
              initialDate: this.anchor,
              headerToolbar: false,
              height: "auto",
              fixedWeekCount: false,
              showNonCurrentDates: true,
              eventDisplay: "block",
              displayEventEnd: false,
              eventInteractive: true,
              navLinks: true,
              navLinkDayClick: (date) => {
                this.agendaFrom = date.toISOString().slice(0, 10);
                this.anchor = this.agendaFrom;
                this.agendaDays = 7;
                this.view = "agenda";
                this.render(true);
                // the day number that had the focus is gone with the grid: take the keyboard to that day in the agenda
                this.focusAgendaDay(this.agendaFrom);
              },
              views: {
                dayGridMonth: { dayMaxEvents: 4, dayHeaderFormat: { weekday: "short" } },
                // this month: this week and the next four (nowMode)
                dayGridNow: { type: "dayGrid", duration: { weeks: 5 }, dayMaxEvents: 4, dayHeaderFormat: { weekday: "short" } },
                dayGridWeek: { dayMaxEvents: false, dayHeaderFormat: { weekday: "short", day: "numeric" } },
                listMonth: { listDayFormat: { weekday: "long", day: "numeric", month: "long" }, listDaySideFormat: false },
                listWeek: { listDayFormat: { weekday: "long", day: "numeric", month: "long" }, listDaySideFormat: false },
              },
              // one time format everywhere (the list's time column is replaced with our own label in eventDidMount)
              eventTimeFormat: { hour: "numeric", minute: "2-digit", meridiem: "short", hour12: true },
              navLinkHint: cfg.i18n.nav_hint || "Go to $0",
              closeHint: cfg.i18n.close || "Close",
              // the page shows its own "Nothing matches" box; no second one inside the list
              noEventsContent: () => ({ html: "" }),
              events: (info, ok) => ok(this.fcEvents(info)),
              eventContent: (arg) => this.fcContent(arg),
              eventDidMount: (arg) => {
                const o = arg.event.extendedProps.o;
                const el = arg.el;
                el.setAttribute("style", (el.getAttribute("style") || "") + ";" + o.vars);
                el.dataset.k = o.k;
                if (arg.view.type.startsWith("list")) {
                  // the row itself is not focusable; its title link is (fcContent). Same time label as the agenda.
                  const td = el.querySelector(".fc-list-event-time");
                  if (td) td.textContent = o.allDay ? cfg.i18n.all_day : o.multi ? this.rangeLabel(o) : o.time;
                } else {
                  // the link is named by its own text (time, title, then an sr-only "· type"; see fcContent),
                  // so what is read out starts with what is shown (WCAG 2.5.3); the tooltip shows a clamped title in full
                  el.removeAttribute("aria-label");
                  el.setAttribute("title", `${o.title} · ${o.allDay ? cfg.i18n.all_day : o.time}`);
                }
              },
              // this week and the next four: the first day and each 1st say their month ("Oct 11", "Nov 1"), and
              // next month's days are shaded like another month's days in the month grid
              dayCellClassNames: (arg) => {
                if (arg.view.type !== "dayGridNow") return [];
                const ymd = this.fcYmd(arg.date);
                return [ymd.slice(8) === "01" || ymd === this.fcYmd(arg.view.activeStart) ? "is-mon-start" : "", ymd.slice(0, 7) !== todayYmd().slice(0, 7) ? "is-next-month" : ""].filter(Boolean);
              },
              dayCellContent: (arg) => {
                if (arg.view.type !== "dayGridNow") return arg.dayNumberText;
                const ymd = this.fcYmd(arg.date);
                if (ymd.slice(8) !== "01" && ymd !== this.fcYmd(arg.view.activeStart)) return arg.dayNumberText;
                return new Intl.DateTimeFormat(cfg.locale || "en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utcDate(ymd)).replace(".", "");
              },
              // day numbers: a name that says what they do (they open the agenda at that day)
              dayCellDidMount: (arg) => {
                // FullCalendar names the whole cell after its day number (aria-labelledby). The cell also holds
                // the events, so that name hides them and does not match what is shown: let the cell be read
                // from its content (Preact compares against its own virtual DOM, so the attribute stays off)
                arg.el.removeAttribute("aria-labelledby");
                const a = arg.el.querySelector("a.fc-daygrid-day-number");
                if (!a) return;
                const ymd = this.fcYmd(arg.date);
                const day = new Intl.DateTimeFormat(cfg.locale || "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(utcDate(ymd));
                a.setAttribute("aria-label", (cfg.i18n.go_agenda || "{date}").replace("{date}", day));
              },
              // "+2 more": a real button that moves the focus into its popover (and back on Escape)
              moreLinkDidMount: (arg) => {
                const a = arg.el;
                a.setAttribute("role", "button");
                const focusPopover = () => setTimeout(() => {
                  const pop = document.querySelector(".cal-fc .fc-popover");
                  if (!pop) return;
                  const close = pop.querySelector(".fc-popover-close");
                  if (close && !close.hasAttribute("tabindex")) {
                    close.setAttribute("tabindex", "0");
                    close.setAttribute("role", "button");
                    close.setAttribute("aria-label", cfg.i18n.close || "Close");
                    close.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); close.click(); if (a.isConnected) a.focus(); } });
                  }
                  if (!pop.dataset.msca) {
                    pop.dataset.msca = "1";
                    pop.setAttribute("role", "dialog");
                    pop.addEventListener("keydown", (ev) => { if (ev.key === "Escape") setTimeout(() => { if (a.isConnected) a.focus(); }, 0); });
                  }
                  const first = pop.querySelector("a.fc-event, a[href]");
                  (first || close || pop).focus();
                }, 30);
                a.addEventListener("click", focusPopover);
                a.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") focusPopover(); });
              },
              eventClick: (arg) => {
                const e = arg.jsEvent;
                if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
                if (e) e.preventDefault();
                this.open(arg.event.extendedProps.o);
              },
              datesSet: (arg) => {
                this.title = arg.view.title;
                this.range = { start: arg.view.activeStart.toISOString().slice(0, 19), end: arg.view.activeEnd.toISOString().slice(0, 19) };
                this.anchor = arg.view.type === "dayGridNow" ? todayYmd() : arg.view.currentStart.toISOString().slice(0, 10);
                this.earlyOpen = false;
                // a change of month/week by the arrows is a step the Back button can undo;
                // changes made while rendering a new view are recorded by render() itself
                if (this.ready) { this.recount(); if (!rendering) this.syncUrl(true); }
              },
            });
            fc.render();
            // FullCalendar measures its columns when it renders. A measurement taken while the grid was hidden or still
            // settling (seen on first load with reduced motion: a 3-day bar drawn one day wide) is never redone by itself,
            // so measure again once layout has settled, when the web fonts arrive, and whenever the width changes,
            // including from hidden (0) back to visible.
            this.settle();
            if ("ResizeObserver" in window) {
              let lastW = Math.round(el.getBoundingClientRect().width);
              new ResizeObserver((entries) => {
                const w = Math.round(entries[0].contentRect.width);
                if (w === lastW) return;
                lastW = w;
                if (w) { fc.updateSize(); this.settle(); }
              }).observe(el);
            }
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.settle());
            if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => this.settle());
            if (document.readyState !== "complete") window.addEventListener("load", () => this.settle(), { once: true });
          })();
          return fcLoading;
        },
        // re-measure FullCalendar on the next two frames and again a little later (cheap: it only re-reads sizes)
        settle() {
          if (!fc) return;
          settleTimers.forEach(clearTimeout);
          const run = () => { if (fc && this.usesFc() && this.$refs.fc && this.$refs.fc.getClientRects().length) fc.updateSize(); };
          nextFrame().then(() => { run(); return nextFrame(); }).then(run);
          settleTimers = [setTimeout(run, 250), setTimeout(run, 900)];
        },
        fcEvents(info) {
          const from = info.start.toISOString().slice(0, 19), to = info.end.toISOString().slice(0, 19);
          const out = [];
          for (const o of OCC) {
            if (!this.inRange(o, from, to) || !this.match(o)) continue;
            out.push({
              id: o.k, title: o.title, url: o.url,
              start: o.allDay ? o.date : o.wall,
              end: o.allDay ? addDays(o.endDate, 1) : o.wallEnd,
              allDay: o.allDay,
              classNames: ["msca-ev", o.st ? "is-" + o.st : ""].filter(Boolean),
              extendedProps: { o },
            });
          }
          return out;
        },
        fcContent(arg) {
          const o = arg.event.extendedProps.o;
          const t = arg.view.type;
          const cancelled = o.st === "cancelled" ? ` <span class="fce-flag">${esc(cfg.i18n.cancelled)}</span>` : "";
          if (t.startsWith("list")) {
            // the title is a real link: Tab reaches it, Enter opens the details panel (eventClick), Ctrl/Cmd+Enter the page
            return { html: `<span class="fcl"><span class="fcl-type">${o.icon}${esc(o.typeLabel)}</span><a class="fcl-title" href="${esc(o.url)}">${esc(o.title)}</a>${cancelled}<span class="fcl-meta">${esc(o.place)}</span></span>` };
          }
          // real spaces between the parts, so the link's text reads "7 PM District 5", not "7 PMDistrict 5"
          const time = o.allDay || !arg.isStart ? "" : `<span class="fce-time">${esc(o.short)}</span> `;
          const meta = t === "dayGridWeek" ? ` <span class="fce-meta">${esc(o.place)}</span>` : "";
          const extra = `<span class="sr-only"> · ${o.allDay ? esc(cfg.i18n.all_day) + " · " : ""}${esc(o.typeLabel)}</span>`;
          return { html: `<span class="fce">${time}<span class="fce-title">${esc(o.title)}</span>${cancelled}${meta}${extra}</span>` };
        },
        // compact start time for month / week chips, in the site's 12-hour style: "7 PM", "7:30 PM" / "7 p. m."
        shortTime(wall) {
          const h = +wall.slice(11, 13), m = wall.slice(14, 16);
          const h12 = h % 12 || 12;
          const NB = "\u00a0";
          const mer = cfg.lang === "es" ? (h < 12 ? `a.${NB}m.` : `p.${NB}m.`) : h < 12 ? "AM" : "PM";
          return `${h12}${m === "00" ? "" : ":" + m}${NB}${mer}`;
        },
        fcYmd(d) { return d.toISOString().slice(0, 10); },

        /* ------------------------------------------------ agenda */
        buildAgenda() {
          const [from, to] = this.agendaRange();
          const fromW = from + "T00:00:00", toW = to + "T00:00:00";
          const nowMs = Date.now();
          const days = new Map();
          // a text search covers the whole calendar and can match a thousand entries: draw the first agendaCap (OCC is in
          // date order); "Show more matches" adds more
          const cap = this.searching() ? this.agendaCap : Infinity;
          let total = 0;
          for (const o of OCC) {
            if (o.msEnd < nowMs || !this.inRange(o, fromW, toW) || !this.match(o)) continue;
            if (total++ >= cap) continue;
            const key = o.date < from ? from : o.date;
            if (!days.has(key)) days.set(key, []);
            days.get(key).push(o);
          }
          this.agendaTotal = total;
          this.agenda = [...days.keys()].sort().map((d) => this.dayBlock(d, days.get(d)));
          this.$nextTick(() => M.applyTime && M.applyTime(this.$refs.agenda));
        },
        // after a day number in the month grid: focus the heading of that day (or the first day after it that has
        // entries) once the agenda is on screen; with no entries at all, the calendar's title (WCAG 2.4.3)
        async focusAgendaDay(d) {
          await this.$nextTick();
          const root = this.$refs.agenda, grid = this.$refs.fc;
          // wait until the agenda is shown and the grid gone, so the page has its new height before we scroll
          for (let i = 0; i < 12 && !(root && root.getClientRects().length && !(grid && grid.getClientRects().length)); i++) await nextFrame();
          await nextFrame();
          const days = root ? [...root.querySelectorAll(".ag-day[data-date]")] : [];
          const day = days.find((x) => x.dataset.date >= d) || days[0];
          const target = (day && day.querySelector(".ag-day__head")) || document.getElementById("cal-title");
          if (!target) return;
          target.focus({ preventScroll: true });
          const show = day || this.$refs.toolbar || target;
          const box = show.getBoundingClientRect();
          if (box.top < 110 || box.top > window.innerHeight - 120) show.scrollIntoView({ block: "start", behavior: "instant" });
        },
        // agenda days shown at a time (and added by "Show more"): two weeks on phones and tablets, a month on laptops
        step() { return this.lg ? 30 : 14; },
        searchStep() { return this.lg ? SEARCH_STEP.large : SEARCH_STEP.small; },
        moreAgenda() {
          if (this.searching()) this.agendaCap += this.searchStep();
          else this.agendaDays += this.step();
          this.buildAgenda();
          this.recount();
        },
        // agenda footer while searching: "Showing 100 of 1,215 matches"
        shownLabel() {
          const loc = cfg.locale || "en-US";
          return cfg.i18n.showing_matches.replace("{shown}", Math.min(this.agendaCap, this.agendaTotal).toLocaleString(loc)).replace("{n}", this.agendaTotal.toLocaleString(loc));
        },
        dayBlock(d, items) {
          const loc = cfg.locale || "en-US";
          const dt = utcDate(d);
          const diff = Math.round((utcDate(d) - utcDate(todayYmd())) / 864e5);
          const rel = diff === 0 ? cfg.i18n.today : diff === 1 ? cfg.i18n.tomorrow : "";
          return {
            date: d,
            num: dt.getUTCDate(),
            weekday: new Intl.DateTimeFormat(loc, { weekday: "long", timeZone: "UTC" }).format(dt),
            label: new Intl.DateTimeFormat(loc, { month: "long", day: "numeric", year: dt.getUTCFullYear() !== new Date().getFullYear() ? "numeric" : undefined, timeZone: "UTC" }).format(dt),
            mon: new Intl.DateTimeFormat(loc, { month: "short", timeZone: "UTC" }).format(dt).replace(".", ""),
            rel,
            today: diff === 0,
            items: items.map((o) => this.row(o)),
          };
        },
        row(o) {
          return {
            k: o.k, title: o.title, typeLabel: o.typeLabel, vars: o.vars, icon: o.icon, time: o.multi ? this.rangeLabel(o) : o.time,
            place: o.place, fl: o.fl, st: o.st, url: o.url, a: o.a, b: o.b, f: o.f, l: o.l, r: o.r,
            fmt: o.f === "Virtual" ? cfg.i18n.format_online : o.f === "Hybrid" ? cfg.i18n.format_hybrid : cfg.i18n.format_in_person,
            fmtIcon: o.f === "Virtual" ? "video" : o.f === "Hybrid" ? "hybrid" : "pin",
            lang: o.l === "Spanish" ? cfg.i18n.lang_es : o.l === "Bilingual" ? cfg.i18n.lang_bi : "",
          };
        },
        rangeLabel(o) {
          const loc = cfg.locale || "en-US";
          const f = (d) => new Intl.DateTimeFormat(loc, { month: "short", day: "numeric", timeZone: "UTC" }).format(utcDate(d));
          return `${f(o.date)} – ${f(o.endDate)}`;
        },

        /* ------------------------------------------------ phone month (dot calendar) */
        buildMini() {
          const m0 = this.mini.month;
          const m1 = addMonths(m0, 1);
          const loc = cfg.locale || "en-US";
          this.title = new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: "UTC" }).format(utcDate(m0));
          const first = addDays(m0, -dowOf(m0));
          const byDay = {};
          for (const o of OCC) {
            if (o.date >= addDays(first, 42) || o.endDate < first || !this.match(o)) continue;
            let d = o.date < first ? first : o.date;
            const last = o.endDate;
            for (let i = 0; i < 7 && d <= last; i++) { (byDay[d] ||= []).push(o); d = addDays(d, 1); }
          }
          const weeks = [];
          const today = todayYmd();
          for (let w = 0; w < 6; w++) {
            const row = [];
            for (let i = 0; i < 7; i++) {
              const d = addDays(first, w * 7 + i);
              const list = byDay[d] || [];
              row.push({ d, n: +d.slice(8), out: d < m0 || d >= m1, today: d === today, count: list.length, dots: list.slice(0, 4).map((o) => o.vars) });
            }
            if (w >= 4 && row.every((c) => c.out)) break;
            weeks.push(row);
          }
          this.mini.weeks = weeks;
          if (this.mini.day < m0 || this.mini.day >= m1) this.mini.day = today >= m0 && today < m1 ? today : m0;
          this.pickDay(this.mini.day, byDay);
        },
        pickDay(d, byDay) {
          this.mini.day = d;
          let list = byDay ? byDay[d] || [] : OCC.filter((o) => o.date <= d && o.endDate >= d && this.match(o));
          const loc = cfg.locale || "en-US";
          this.mini.label = new Intl.DateTimeFormat(loc, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(utcDate(d));
          this.mini.items = list.map((o) => this.row(o));
        },
        miniLabel(c) {
          const loc = cfg.locale || "en-US";
          const day = new Intl.DateTimeFormat(loc, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(utcDate(c.d));
          const i = cfg.i18n;
          const n = c.count === 0 ? i.no_events || "0" : c.count === 1 ? i.one_event || "1" : (i.n_events || "{n}").replace("{n}", c.count);
          return `${day}: ${n}`;
        },

        /* ------------------------------------------------ details panel */
        open(o) {
          const full = OCC.find((x) => x.k === o.k) || o;
          const s = SERIES[full.s] || {};
          // remember where the keyboard was, so closing the panel goes back there (x-trap focuses the Close button)
          opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
          this.sel = full;
          this.ss = s;
          this.copied = "";
          this.$nextTick(() => { M.applyTime && M.applyTime(this.$refs.detail); });
        },
        close() {
          const key = this.sel && this.sel.k;
          this.sel = null;
          this.ss = null;
          this.restoreFocus(opener, key);
          opener = null;
        },
        // after Alpine has released the focus trap and the inert page: back to the element (or the same entry, re-rendered)
        restoreFocus(el, key) {
          const go = () => {
            let t = el && el.isConnected && el.getClientRects().length ? el : null;
            if (!t && key) {
              const k = CSS.escape(key);
              t = document.querySelector(`.cal-surface a[data-k="${k}"], .cal-surface [data-k="${k}"] a[href], .cal-surface [data-k="${k}"]`);
            }
            if (t && typeof t.focus === "function") t.focus();
          };
          this.$nextTick(() => setTimeout(go, 30));
        },
        closeAll() { if (this.sel) this.close(); else if (this.drawer) this.closeDrawer(); },
        openDrawer(ev) {
          drawerOpener = (ev && ev.currentTarget) || document.activeElement;
          this.drawer = true;
        },
        closeDrawer() {
          if (!this.drawer) return;
          this.drawer = false;
          this.restoreFocus(drawerOpener);
          drawerOpener = null;
        },
        // sticky bar: back up to the full toolbar, ready to search
        toTop() {
          const tb = this.$refs.toolbar;
          if (!tb) return;
          tb.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "start" });
          setTimeout(() => this.$refs.search && this.$refs.search.focus({ preventScroll: true }), M.reducedMotion ? 0 : 450);
        },
        selDate() {
          const o = this.sel;
          if (!o) return "";
          const loc = cfg.locale || "en-US";
          const f = (d, opts) => new Intl.DateTimeFormat(loc, Object.assign({ timeZone: "UTC" }, opts)).format(utcDate(d));
          if (o.multi) return `${f(o.date, { weekday: "short", month: "short", day: "numeric" })} – ${f(o.endDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`;
          return f(o.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        },
        selRule() { const s = this.ss || {}; return (cfg.lang === "es" ? s.rule_es : s.rule_en) || ""; },
        selReg() { const s = this.ss || {}; return (s.reg && s.reg[cfg.lang === "es" ? 1 : 0]) || ""; },
        // Note lines in the page language: Spanish pages use the Nota: lines, else the English ones (marked)
        selNotes() {
          const s = this.ss || {};
          if (cfg.lang === "es" && s.notes_es && s.notes_es.length) return s.notes_es.map((text) => ({ text, lang: "es" }));
          return (s.notes || []).map((text) => ({ text, lang: "en" }));
        },
        selRel() { return this.sel && M.relative ? M.relative(this.sel.a, this.sel.b) : { text: "", tone: "" }; },
        flyerUrl(id, w) { return id ? `https://lh3.googleusercontent.com/d/${id}=w${w || 800}` : ""; },
        flyerFallback(ev, id) { const img = ev.target; img.onerror = null; img.removeAttribute("srcset"); img.src = `https://drive.google.com/thumbnail?id=${id}&sz=w800`; },
        googleUrl() {
          const o = this.sel, s = this.ss || {};
          if (!o) return "#";
          const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
          const p = new URLSearchParams({ action: "TEMPLATE", text: o.title });
          if (o.allDay) p.set("dates", `${o.date.replace(/-/g, "")}/${addDays(o.endDate, 1).replace(/-/g, "")}`);
          else p.set("dates", `${stamp(o.a)}/${stamp(o.b)}`);
          p.set("ctz", TZ);
          const lines = [];
          if (s.online && s.online.url) lines.push("Zoom: " + s.online.url);
          if (s.online && s.online.id) lines.push(`${cfg.i18n.meeting_id}: ${s.online.id}`);
          if (s.online && s.online.pc) lines.push(`${cfg.i18n.passcode}: ${s.online.pc}`);
          this.selNotes().forEach((n) => lines.push(n.text));
          lines.push(location.origin + o.url);
          p.set("details", lines.join("\n"));
          const where = s.location && s.location.address ? [s.location.name, s.location.address].filter(Boolean).join(", ") : (s.online && s.online.url) || "";
          if (where) p.set("location", where);
          return "https://calendar.google.com/calendar/render?" + p.toString();
        },
        icsUrl() { const s = this.ss || {}; return M.url(s.ics || "/calendar.ics"); },
        async copy(value, key) {
          try { await navigator.clipboard.writeText(value); } catch (e) {
            const ta = document.createElement("textarea"); ta.value = value; document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); } catch (e2) {}
            ta.remove();
          }
          this.copied = key;
          setTimeout(() => { if (this.copied === key) this.copied = ""; }, 1800);
        },
        lurl(p) { return M.url((cfg.lang === "es" && p.startsWith("/") && !p.startsWith("/es/") ? "/es" : "") + p); },
        slug(s) { return fold(s).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); },
      };
    });

    /* ---------------------------------------------------------------- "Coming up" flyers */
    // the flyers above the calendar: from 1024px only their first row shows until "Show more events" (calendar.css
    // .cal-feat). "Show less" folds the rows above its button: keep the button where it was on screen, so the
    // visitor is not left somewhere down in the calendar
    Alpine.data("calFeatured", () => ({
      all: false,
      toggle(btn) {
        const y = btn.getBoundingClientRect().top;
        this.all = !this.all;
        if (this.all) return;
        this.$nextTick(() => {
          const dy = btn.getBoundingClientRect().top - y;
          if (dy) window.scrollBy({ top: dy, behavior: "instant" });
        });
      },
    }));
  });
})();

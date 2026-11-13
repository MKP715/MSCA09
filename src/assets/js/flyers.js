/*
  MSCA09 — the event flyers page (/calendar/flyers/ and /es/calendar/flyers/, src/pages/calendar-flyers.njk), and the
  central office events page (/calendar/central-offices/, src/pages/calendar-offices.njk), which works the same way.

  Alpine component "flyerWall". The build writes every card (calendar.flyerWall in src/_data/calendar.js); this script
  only hides, dates and moves them.
    filters  f.q         words, matched with MSearch (search.js) against each card's data-search (title in both
                         languages, place, city, type, districts, pattern)
             f.when      "" (every upcoming flyer) | "30" | "90" (the card's next date is within that many days) |
                         "yyyy-mm" (one of the dates the card carries starts in that month and is not over: the card
                         then shows that date, see clock)
             f.show      "" | "events" | "meetings" (data-fw-kind "event" / "meeting")
             f.type      a type slug (data-fw-type)              f.district  a district slug (data-fw-districts)
             f.office    a central office's key (data-fw-offices: the office and the others that list the event; a
                         link with data-fw-office-link="<key>" on the page chooses it without reloading)
             f.langs     any of "en" "es" "bi" (data-fw-lang)    f.formats   any of "in-person" "hybrid" "online"
           Nothing chosen = every card. The filters live in the address — ?when=90&type=workshop&lang=es,bi&format=hybrid
           &district=d14&show=events&q=… (history.replaceState, other parameters kept) — so a filtered view can be shared
           or bookmarked, and a link with them opens the page filtered. Values the page does not offer are ignored.
    clock    data-dates on a card: its coming dates, each [start, end, badge month, badge day, badge weekday, time line]
             in the page's words. The first one not over yet is shown (the build shows the first) — while a month is
             chosen, the first one not over in that month, and the card goes back to its next date when the month is
             cleared. A regular meeting moves on to that date, and a repeating event into the group of its month
             (data-fw-month; the build sends every month an event card may reach, hidden while empty). app.js removes a
             card once its last date is over (data-hide-after) and keeps its "In 3 days" badge current; this runs again
             every minute and after every change of the filters.
    counts   `shown` / `total` (countText: "12 of 26 flyers"); facet(name, value): how many cards a choice would show,
             the other filters staying as they are (the pills' and the lists' numbers); a month or section with nothing
             visible is hidden, with its count; the empty state shows when nothing is left; `announce` is read out
             (polite) after the visitor changes something. The count's words: the text keys <data-fw-count>.count_one /
             count_n / count_of on the component's element ("calendar.flyers" when it has none).
  Without JavaScript the filter bar is not shown (calendar.css: html:not(.js), until init() marks the page .fw-ready)
  and every card is, with the build's dates.
  Strings come from the page's text keys (MSCA.t, front matter jsText).
*/
(function () {
  "use strict";

  const M = (window.MSCA = window.MSCA || {});
  const TZ = "America/Los_Angeles";
  const DAY = 864e5;
  const IS_MONTH = /^\d{4}-\d{2}$/;
  const LANGS = ["en", "es", "bi"];
  const FORMATS = ["in-person", "hybrid", "online"];
  // the Pacific month of a moment: "2026-11"
  const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" });
  const monthOf = (ms) => {
    const p = Object.fromEntries(monthFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}`;
  };
  const tr = (k, vars) => (M.tr ? M.tr(k, vars) : k);
  const blank = () => ({ q: "", when: "", show: "", type: "", langs: [], formats: [], district: "", office: "" });

  document.addEventListener("alpine:init", () => {
    window.Alpine.data("flyerWall", () => {
      // the cards and what this script knows of each, outside Alpine's reactive state
      let cards = [];
      // card -> { order, dates, months (the Pacific month each date starts in), at (index of the date shown),
      //           next (ms: its first date not over, for the 30 / 90 days choices), shown (ms: the date shown) }
      const meta = new WeakMap();
      let timer = null;

      return {
        f: blank(),
        open: false, // the filters, on phones and tablets
        shown: -1,
        total: 0,
        facets: {},
        announce: "",

        init() {
          // the filter bar shows from here on, even where the 4 s fallback of partials/i18n-js.njk took html.js away
          this.$root.classList.add("fw-ready");
          cards = [...this.$root.querySelectorAll("[data-fw-card]")];
          cards.forEach((c, i) => {
            let dates = [];
            try { dates = JSON.parse(c.dataset.dates || "[]"); } catch (e) {}
            const first = dates.length ? Date.parse(dates[0][0]) : Infinity;
            meta.set(c, { order: i, dates, months: dates.map((d) => monthOf(Date.parse(d[0]))), at: 0, next: first, shown: first });
          });
          this.readUrl();
          this.apply(true);
          // an office card's "N upcoming events" (calendar-offices.njk): that office's events, without reloading the page
          this.$root.ownerDocument.addEventListener("click", (e) => {
            const a = e.target.closest && e.target.closest("[data-fw-office-link]");
            if (!a || e.metaKey || e.ctrlKey || e.shiftKey || !this.options("[data-fw-offices-list]").includes(a.dataset.fwOfficeLink)) return;
            e.preventDefault();
            this.f = Object.assign(blank(), { office: a.dataset.fwOfficeLink });
            this.$nextTick(() => {
              const ev = document.getElementById("events");
              if (ev) ev.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "start" });
              if (this.$refs.results) this.$refs.results.focus({ preventScroll: true });
            });
          });
          // after the visitor's own change: the cards, the address and the spoken count. Typing in the search box (only
          // the words changed) redraws without the fade: it is for a filter the visitor picked, never for typing
          const rest = () => JSON.stringify({ ...this.f, q: "" });
          let lastRest = rest();
          this.$watch("f", () => {
            const r = rest();
            const typing = r === lastRest;
            lastRest = r;
            this.apply(false, typing);
          });
          // the clock: dates move on, ended cards go (app.js also checks every minute)
          timer = setInterval(() => this.apply(true), 60 * 1000);
        },
        destroy() {
          clearInterval(timer);
        },

        /* ------------------------------------------------ address <-> filters */
        options(sel) {
          const el = this.$root.querySelector(sel);
          return el ? [...el.options].map((o) => o.value).filter(Boolean) : [];
        },
        readUrl() {
          let p;
          try { p = new URLSearchParams(location.search); } catch (e) { return; }
          const f = blank();
          const list = (k, ok) => (p.get(k) || "").split(",").map((x) => x.trim()).filter((x, i, a) => ok.includes(x) && a.indexOf(x) === i);
          f.q = (p.get("q") || "").slice(0, 200);
          const w = p.get("when") || "";
          if (w === "30" || w === "90" || (IS_MONTH.test(w) && this.options("[data-fw-months]").includes(w))) f.when = w;
          if (p.get("show") === "events" || p.get("show") === "meetings") f.show = p.get("show");
          if (this.options("[data-fw-types]").includes(p.get("type"))) f.type = p.get("type");
          if (this.options("[data-fw-districts]").includes(p.get("district"))) f.district = p.get("district");
          if (this.options("[data-fw-offices-list]").includes(p.get("office"))) f.office = p.get("office");
          f.langs = list("lang", LANGS);
          f.formats = list("format", FORMATS);
          this.f = f;
        },
        syncUrl() {
          try {
            const p = new URLSearchParams(location.search);
            ["when", "office", "type", "lang", "format", "district", "show", "q"].forEach((k) => p.delete(k));
            const f = this.f;
            if (f.when) p.set("when", f.when);
            if (f.office) p.set("office", f.office);
            if (f.type) p.set("type", f.type);
            if (f.langs.length) p.set("lang", LANGS.filter((x) => f.langs.includes(x)).join(","));
            if (f.formats.length) p.set("format", FORMATS.filter((x) => f.formats.includes(x)).join(","));
            if (f.district) p.set("district", f.district);
            if (f.show) p.set("show", f.show);
            if (f.q.trim()) p.set("q", f.q.trim());
            const qs = p.toString().replace(/%2C/gi, ",");
            const url = location.pathname + (qs ? "?" + qs : "") + location.hash;
            if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, "", url);
          } catch (e) {}
        },

        /* ------------------------------------------------ the clock */
        // the date a card shows now: the first of its dates that is not over — while a month is chosen, the first one
        // not over in that month (when it has one: the others are hidden by the filter anyway)
        tick(now) {
          const pick = IS_MONTH.test(this.f.when) ? this.f.when : "";
          let moved = false;
          for (const c of cards) {
            if (!c.isConnected) continue;
            const m = meta.get(c);
            const gone = Date.parse(c.dataset.hideAfter);
            if (!isNaN(gone) && now > gone) {
              c.remove();
              continue;
            }
            const next = m.dates.findIndex((d) => Date.parse(d[1]) >= now);
            // every date it carries is over but the entry goes on (a page left open for weeks): keep it, without a date
            c.classList.toggle("is-stale", next < 0 && m.dates.length > 0);
            if (next < 0) {
              m.next = m.shown = now;
              continue;
            }
            const inMonth = pick ? m.dates.findIndex((d, i) => m.months[i] === pick && Date.parse(d[1]) >= now) : -1;
            const at = inMonth < 0 ? next : inMonth;
            m.next = Date.parse(m.dates[next][0]);
            m.shown = Date.parse(m.dates[at][0]);
            if (at !== m.at) {
              m.at = at;
              this.showDate(c, m.dates[at]);
              moved = true;
            }
            // a dated card belongs to the month of the date it shows
            const group = c.closest("[data-fw-month]");
            const month = m.months[at];
            if (group && group.dataset.fwMonth !== month) {
              const to = this.$root.querySelector(`[data-fw-month="${month}"] [data-fw-list]`);
              if (to) {
                to.appendChild(c);
                moved = true;
              }
            }
          }
          if (moved) this.sortLists();
        },
        showDate(c, d) {
          c.dataset.when = d[0];
          c.dataset.until = d[1];
          const put = (sel, text) => {
            const el = c.querySelector(sel);
            if (el) el.textContent = text;
          };
          put(".date-badge__mon", d[2]);
          put(".date-badge__day", d[3]);
          put(".date-badge__wkd", d[4]);
          put("[data-date-when]", d[5]);
          const slot = c.querySelector("[data-rel]");
          if (slot && M.relative) {
            const r = M.relative(d[0], d[1]);
            slot.textContent = r.text;
            slot.dataset.tone = r.tone;
            slot.hidden = false;
          }
        },
        // soonest date shown first in every list (the build's order for cards on the same date)
        sortLists() {
          this.$root.querySelectorAll("[data-fw-list]").forEach((ul) => {
            const kids = [...ul.children];
            const key = (c) => meta.get(c) || { shown: Infinity, order: 0 };
            const sorted = kids.slice().sort((a, b) => key(a).shown - key(b).shown || key(a).order - key(b).order);
            if (sorted.some((c, i) => c !== kids[i])) sorted.forEach((c) => ul.appendChild(c));
          });
        },

        /* ------------------------------------------------ filtering */
        apply(quiet, typing) {
          const now = Date.now();
          this.tick(now);
          const f = this.f;
          const S = window.MSearch;
          const query = S && f.q.trim() ? S.query(f.q) : null;
          const soon = (m, days) => m.next <= now + days * DAY;
          // the months in which one of the card's dates starts and is not over
          const months = (m) => new Set(m.months.filter((x, i) => Date.parse(m.dates[i][1]) >= now));
          const tests = {
            q: (c) => !query || query.empty || S.test(c.dataset.search || "", query),
            when: (c, m) => !f.when || (IS_MONTH.test(f.when) ? months(m).has(f.when) : soon(m, Number(f.when))),
            show: (c) => !f.show || c.dataset.fwKind === (f.show === "events" ? "event" : "meeting"),
            type: (c) => !f.type || c.dataset.fwType === f.type,
            langs: (c) => !f.langs.length || f.langs.includes(c.dataset.fwLang),
            formats: (c) => !f.formats.length || f.formats.includes(c.dataset.fwFormat),
            district: (c) => !f.district || (c.dataset.fwDistricts || "").split(" ").includes(f.district),
            office: (c) => !f.office || (c.dataset.fwOffices || "").split(" ").includes(f.office),
          };
          const names = Object.keys(tests);
          const facets = {};
          const bump = (k) => (facets[k] = (facets[k] || 0) + 1);
          let shown = 0;
          let total = 0;
          let changed = false;
          for (const c of cards) {
            if (!c.isConnected) continue;
            total++;
            const m = meta.get(c);
            const pass = {};
            names.forEach((k) => (pass[k] = tests[k](c, m)));
            const ok = names.every((k) => pass[k]);
            if (c.hidden !== !ok) { c.hidden = !ok; changed = true; }
            if (ok) shown++;
            // what each choice would show, the other filters staying as they are
            const others = (k) => names.every((x) => x === k || pass[x]);
            if (others("when")) {
              bump("when:");
              if (soon(m, 30)) bump("when:30");
              if (soon(m, 90)) bump("when:90");
              months(m).forEach((mo) => bump("month:" + mo));
            }
            if (others("show")) {
              bump("show:");
              bump(c.dataset.fwKind === "meeting" ? "show:meetings" : "show:events");
            }
            if (others("type")) bump("type:" + c.dataset.fwType);
            if (others("langs")) bump("langs:" + c.dataset.fwLang);
            if (others("formats")) bump("formats:" + c.dataset.fwFormat);
            if (others("district")) (c.dataset.fwDistricts || "").split(" ").filter(Boolean).forEach((d) => bump("district:" + d));
            if (others("office")) (c.dataset.fwOffices || "").split(" ").filter(Boolean).forEach((o) => bump("office:" + o));
          }
          // months and sections with nothing left to show
          this.$root.querySelectorAll("[data-fw-month]").forEach((g) => {
            const n = g.querySelectorAll("[data-fw-card]:not([hidden])").length;
            g.hidden = !n;
            const chip = g.querySelector("[data-fw-n]");
            if (chip) chip.textContent = n;
          });
          this.$root.querySelectorAll("[data-fw-section]").forEach((s) => (s.hidden = !s.querySelector("[data-fw-card]:not([hidden])")));
          this.facets = facets;
          this.total = total;
          this.shown = shown;
          if (!quiet) {
            this.announce = this.countText();
            this.syncUrl();
            // the cards a filter hides or brings back: the grid fades in briefly so the new set reads as new (not when
            // nothing moved, and not while typing in the search box; MSCA.fadeChange in app.js)
            if (changed && !typing && M.fadeChange) M.fadeChange(this.$refs.results);
          }
        },
        facet(name, value) {
          return this.facets[name + ":" + value] || 0;
        },
        // a list's choice with its number: "Workshop (4)"
        optLabel(label, name, value) {
          return `${label} (${this.facet(name, value)})`;
        },
        monthValue() {
          return IS_MONTH.test(this.f.when) ? this.f.when : "";
        },
        activeCount() {
          const f = this.f;
          return [f.q.trim(), f.when, f.show, f.type, f.langs.length, f.formats.length, f.district, f.office].filter(Boolean).length;
        },
        countText() {
          const n = Math.max(this.shown, 0);
          const k = this.$root.dataset.fwCount || "calendar.flyers";
          if (n < this.total) return tr(k + ".count_of", { n, total: this.total });
          return tr(n === 1 ? k + ".count_one" : k + ".count_n", { n });
        },
        // phones and tablets: fold the filters ("Show results", Escape) and bring the bar to the top, the first flyers
        // under it, the keyboard on the Filters button
        done() {
          this.open = false;
          this.$nextTick(() => {
            const bar = this.$root.querySelector(".fw-bar");
            if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "start" });
            const t = this.$root.querySelector(".fw-toggle");
            if (t) t.focus({ preventScroll: true });
          });
        },
        // Both Clear buttons go away once nothing is chosen, so the keyboard goes on from somewhere still there: from the
        // empty state's (fromEmpty) to the flyers; from the bar's to the Filters button (phones and tablets) or, where
        // that is hidden (from 1024px), to the When choice, "All upcoming" again (no on-screen keyboard pops up)
        clear(fromEmpty) {
          this.f = blank();
          this.$nextTick(() => {
            const to = fromEmpty
              ? this.$refs.results
              : [".fw-toggle", 'input[name="fw-when"]:checked'].map((s) => this.$root.querySelector(s)).find((el) => el && el.offsetParent !== null);
            if (to) to.focus({ preventScroll: true });
          });
        },
      };
    });
  });
})();

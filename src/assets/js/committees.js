/*
  Committees, Panel directory and Contact pages — small Alpine components.

  cmFilter({ group, lang })   live filtering of [data-cm-item] elements inside the component:
      data-search  the item's search text, built at build time with MSearch.index (src/assets/js/search.js) and
                   matched with MSearch.test; without it, the item's visible text is indexed once
      data-group   group key(s), space-separated (matches `group`, or "all")
      data-lang    "en" | "es" | "" (matches `lang`, or "all")
      data-open    "1" when the item is (or holds) an open position
      data-cm-past an item of the previous panel, in a folded list: counted in `shown` only while a query is typed
    Containers marked [data-cm-section] are hidden when none of their items is visible.
    details[data-cm-autoopen] open while a filter is on; details[data-cm-autofold] open while a query is typed
    and fold back when it is cleared (only when the filter opened them). A URL #anchor inside a folded <details>
    of the component opens it (on load and on a hash change).
    Counts that follow the filters:
      [data-cm-count="{n} in this group"]  the visible items of its section ([data-cm-unit="section"]: the visible
                   sections inside it); [data-cm-of="{n} of {total} …"] + [data-cm-total] is used while some are hidden
      [data-cm-facet="<group key>|open"]   how many items that pill would show, with the other filters as they are
    `shown` = number of visible items; `announce` = text for a polite live region.

  cmSpy()   highlights the in-page section link ([data-spy] anchors) of the section in view.

  cmRecordings()   the meeting recordings on a committee page (src/_includes/partials/committee-recordings.njk).
    series   the meeting shown ("all" or a key of data/recording-series.csv), set by pick(key): recordings [data-rec]
             of other meetings are hidden, a month [data-rec-month] with none left is hidden and its [data-rec-count]
             follows (data-one / data-many, "{n}"); when no month left in view is open, the first one opens
    open     the Drive id of the recording whose player is open, or "". The template puts Google Drive's player
             (an iframe) in only for that one (x-if), so opening another, closing it or filtering it away removes the
             frame and stops its sound. toggle(id) opens it and moves focus into the player; close(true) closes it
             and gives focus back to that recording's Play button.
    `announce` = text for a polite live region (data-results / data-opened on the section, translated by the page).
*/
(function () {
  "use strict";
  // an item's search text: its data-search, else its visible text indexed once
  const hays = new WeakMap();
  const hayOf = (el) => {
    if (el.dataset.search) return el.dataset.search;
    let h = hays.get(el);
    if (h === undefined) hays.set(el, (h = window.MSearch.index(el.textContent)));
    return h;
  };

  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    Alpine.data("cmFilter", (opts = {}) => ({
      q: "",
      group: opts.group || "all",
      lang: opts.lang || "all",
      openOnly: false,
      shown: -1,
      total: 0,
      announce: "",
      drawer: false,
      showSearch: false,
      init() {
        // deep links: ?q=…&group=…&open=1
        try {
          const p = new URLSearchParams(location.search);
          if (p.get("q")) (this.q = p.get("q")), (this.showSearch = true);
          if (p.get("group")) this.group = p.get("group");
          if (p.get("lang")) this.lang = p.get("lang");
          if (p.get("open") === "1") this.openOnly = true;
        } catch (e) {}
        this.$watch("q", () => this.apply());
        // a pill (group, language, "Help wanted") redraws the list below the toolbar: the results box ([data-cm-fade])
        // fades back once (MSCA.fadeChange, app.js). Not while typing in the search box
        const fade = () => this.$nextTick(() => window.MSCA && MSCA.fadeChange && MSCA.fadeChange(this.$root.querySelector("[data-cm-fade]")));
        this.$watch("group", () => { this.apply(); fade(); });
        this.$watch("lang", () => { this.apply(); fade(); });
        this.$watch("openOnly", () => { this.apply(); fade(); });
        this.$nextTick(() => {
          this.apply(true);
          this.reveal();
        });
        window.addEventListener("hashchange", () => this.reveal());
      },
      // a link to an anchor inside a folded list (a site-search hit such as /contact/#dir-committees on a phone)
      // opens that list and brings the anchor back into view
      reveal() {
        let el = null;
        try {
          if (location.hash.length > 1) el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        } catch (e) {}
        const d = el && this.$root.contains(el) ? el.closest("details") : null;
        if (!d || d.open) return;
        d.open = true;
        el.scrollIntoView();
      },
      apply(first) {
        const query = window.MSearch.query(this.q);
        const typed = !query.empty;
        const items = this.$root.querySelectorAll("[data-cm-item]");
        const facet = { open: 0 };
        let shown = 0;
        let total = 0;
        items.forEach((el) => {
          const okQ = window.MSearch.test(hayOf(el), query);
          const groups = (el.dataset.group || "").split(" ");
          const okG = this.group === "all" || groups.includes(this.group);
          const okL = this.lang === "all" || !el.dataset.lang || el.dataset.lang === this.lang;
          const isOpen = el.dataset.open === "1";
          const okO = !this.openOnly || isOpen;
          const ok = okQ && okG && okL && okO;
          el.hidden = !ok;
          const past = "cmPast" in el.dataset;
          if (!past) total++;
          // a previous-panel row sits in a folded list: it counts only while a query is typed
          if (past && !typed) return;
          if (ok) shown++;
          // what each pill would show if it were chosen, the other filters staying as they are
          if (okQ && okL && okO) groups.forEach((g) => (facet[g] = (facet[g] || 0) + 1));
          if (okQ && okL && okG && isOpen) facet.open++;
        });
        this.$root.querySelectorAll("[data-cm-section]").forEach((sec) => {
          const any = [...sec.querySelectorAll("[data-cm-item]")].some((el) => !el.hidden);
          sec.hidden = !any;
        });
        // counts that follow the filters: "4 of 5 in this group", and each pill's own number
        this.$root.querySelectorAll("[data-cm-count]").forEach((chip) => {
          const sec = chip.closest("[data-cm-section]");
          if (!sec) return;
          const units = chip.dataset.cmUnit === "section" ? sec.querySelectorAll("[data-cm-section]") : sec.querySelectorAll("[data-cm-item]");
          const n = [...units].filter((el) => !el.hidden).length;
          const all = Number(chip.dataset.cmTotal) || units.length;
          const tpl = n < all && chip.dataset.cmOf ? chip.dataset.cmOf : chip.dataset.cmCount;
          chip.textContent = tpl.replace("{n}", n).replace("{total}", all);
        });
        this.$root.querySelectorAll("[data-cm-facet]").forEach((el) => (el.textContent = facet[el.dataset.cmFacet] || 0));
        // folded sections open while searching so matches are visible; at load (a search in the address) they show at
        // once, like the rest of the first screen (app.js openFoldNow), and later ones may fade in
        const openFold = (d) => (first && window.MSCA && MSCA.openFoldNow ? MSCA.openFoldNow(d) : (d.open = true));
        if (typed || this.openOnly) this.$root.querySelectorAll("details[data-cm-autoopen]").forEach((d) => d.open || openFold(d));
        this.$root.querySelectorAll("details[data-cm-autofold]").forEach((d) => {
          if (typed && !d.open) openFold(d), (d.dataset.cmOpened = "1");
          else if (!typed && d.dataset.cmOpened) (d.open = false), delete d.dataset.cmOpened;
        });
        // show folded extras (e.g. long district lists) while a filter is on
        this.$root.classList.toggle("cm-filtering", typed || this.openOnly || this.lang !== "all");
        this.total = total;
        this.shown = shown;
        // wording comes from the page (data-results="… {n} …") so it is translated with the rest of the site
        if (!first) this.announce = (this.$root.dataset.results || "{n}").replace("{n}", shown);
        this.syncUrl();
      },
      syncUrl() {
        try {
          const p = new URLSearchParams(location.search);
          const set = (k, v, def) => (v && v !== def ? p.set(k, v) : p.delete(k));
          set("q", this.q.trim(), "");
          set("group", this.group, "all");
          set("lang", this.lang, "all");
          set("open", this.openOnly ? "1" : "", "");
          const qs = p.toString();
          history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
        } catch (e) {}
      },
      reset() {
        this.q = "";
        this.group = "all";
        this.lang = "all";
        this.openOnly = false;
      },
    }));

    /*
      The current section is the LAST one whose top has scrolled past the line where an anchored section
      lands (html scroll-padding-top + the section's scroll-margin-top, + a little slack). At the very bottom
      of the page the last section counts as reached once it is in view. A click on a link marks that
      section at once and keeps it until the reader scrolls on.
    */
    Alpine.data("cmSpy", () => ({
      current: "",
      init() {
        const links = [...this.$root.querySelectorAll("a[data-spy]")];
        const ids = [...new Set(links.map((a) => a.getAttribute("href").slice(1)))];
        const targets = ids.map((id) => document.getElementById(id)).filter(Boolean);
        if (!targets.length) return;
        const root = document.documentElement;
        const px = (v) => parseFloat(v) || 0;

        const mark = (id) => {
          if (!id || id === this.current) return;
          this.current = id;
          links.forEach((a) => {
            const on = a.getAttribute("href") === "#" + id;
            a.classList.toggle("is-current", on);
            if (on) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
          });
          // keep the active pill in view in the horizontal rail
          const pill = links.find((a) => a.closest(".cm-secnav") && a.getAttribute("href") === "#" + id);
          const rail = pill && pill.parentElement;
          if (rail && rail.scrollWidth > rail.clientWidth && rail.offsetParent) {
            rail.scrollTo({ left: pill.offsetLeft - rail.clientWidth / 2 + pill.clientWidth / 2, behavior: window.MSCA && MSCA.reducedMotion ? "auto" : "smooth" });
          }
        };

        const compute = () => {
          const pad = px(getComputedStyle(root).scrollPaddingTop);
          let id = targets[0].id;
          for (const t of targets) {
            const line = pad + px(getComputedStyle(t).scrollMarginTop) + 24;
            if (t.getBoundingClientRect().top <= line) id = t.id;
          }
          if (window.innerHeight + window.scrollY >= root.scrollHeight - 4) {
            const last = targets[targets.length - 1];
            if (last.getBoundingClientRect().top < window.innerHeight) id = last.id;
          }
          return id;
        };

        // a clicked link wins until the reader scrolls on from where the jump ended
        let pinned = "";
        let settledAt = null;
        let settleTimer = 0;
        links.forEach((a) =>
          a.addEventListener("click", () => {
            pinned = a.getAttribute("href").slice(1);
            settledAt = null;
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => (settledAt = window.scrollY), 300); // also when the click needs no scrolling
            mark(pinned);
          })
        );

        let ticking = false;
        const onScroll = () => {
          if (pinned) {
            clearTimeout(settleTimer);
            if (settledAt === null) settleTimer = setTimeout(() => (settledAt = window.scrollY), 180);
            else if (Math.abs(window.scrollY - settledAt) > 60) (pinned = ""), (settledAt = null);
            if (pinned) return;
          }
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            mark(compute());
          });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
        if (location.hash && ids.includes(location.hash.slice(1))) (pinned = location.hash.slice(1)), mark(pinned);
        else mark(compute());
      },
    }));

    Alpine.data("cmRecordings", () => ({
      series: "all",
      open: "",
      announce: "",
      pick(key) {
        this.series = key;
        let shown = 0;
        const months = [...this.$root.querySelectorAll("[data-rec-month]")];
        months.forEach((m) => {
          let n = 0;
          m.querySelectorAll("[data-rec]").forEach((li) => {
            const ok = key === "all" || li.dataset.series === key;
            li.hidden = !ok;
            if (ok) n++;
            else if (li.dataset.id === this.open) this.open = ""; // its player goes (and stops) with it
          });
          m.hidden = !n;
          shown += n;
          const count = m.querySelector("[data-rec-count]");
          if (count) count.textContent = (n === 1 ? count.dataset.one : count.dataset.many).replace("{n}", n);
        });
        const left = months.filter((m) => !m.hidden);
        if (left.length && !left.some((m) => m.open)) left[0].open = true;
        this.announce = (this.$root.dataset.results || "{n}").replace("{n}", shown);
      },
      toggle(id) {
        if (this.open === id) return this.close(false);
        this.open = id;
        const btn = this.$root.querySelector(`button[aria-controls="rp-${id}"]`);
        if (btn) this.announce = (this.$root.dataset.opened || "").replace("{name}", btn.dataset.name || "").replace("{date}", btn.dataset.date || "");
        // the frame is in the page after Alpine's next update: bring the player into view and focus it, so Tab
        // reaches Google's play button next (Shift+Tab: the close button)
        this.$nextTick(() => {
          const player = document.getElementById("rp-" + id);
          const frame = player && player.querySelector("iframe");
          if (!player) return;
          if (frame) frame.focus({ preventScroll: true });
          player.scrollIntoView({ block: "nearest", behavior: window.MSCA && MSCA.reducedMotion ? "auto" : "smooth" });
        });
      },
      close(back) {
        const id = this.open;
        this.open = "";
        if (back && id) this.$nextTick(() => {
          const btn = this.$root.querySelector(`button[aria-controls="rp-${id}"]`);
          if (btn) btn.focus();
        });
      },
    }));
  });
})();

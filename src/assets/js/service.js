/*
  Area-business pages: filters for the motions board, the Area-meeting list, the
  Delegate's Corner archive and the glossary; the interactive service triangle;
  and small clock-based touches (timeline "next" marker, Conference-year phase).
  Loaded before Alpine (see the page's front matter `scripts`). The three search boxes match with
  the site's shared matcher (window.MSearch, src/assets/js/search.js); their data-search / data-text
  strings are built with the same file (src/_data/motions.js, delegatePosts.js, glossary.js).
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});

  // put a list's items in this order (only when it changed, so an unchanged list is not re-laid out)
  const place = (items) => {
    const list = items[0] && items[0].parentElement;
    if (list && items.some((el, i) => list.children[i] !== el)) list.append(...items);
  };

  /* ------------------------------------------------------------ clock-based touches */
  function refreshTimeline() {
    const now = Date.now();
    document.querySelectorAll("[data-past-after]").forEach((el) => {
      const t = Date.parse(el.dataset.pastAfter);
      if (!isNaN(t) && now > t) el.classList.add("is-past");
    });
    // the first meeting that has not ended is "next" — once per timeline, and once per kind of
    // list across the page (the table and the phone cards each split by year)
    const groups = new Map();
    document.querySelectorAll(".svc-tl").forEach((list, i) => groups.set("tl" + i, [list]));
    document.querySelectorAll("[data-svc-rows]").forEach((list) => {
      const k = "rows-" + (list.dataset.svcRows || "");
      groups.set(k, [...(groups.get(k) || []), list]);
    });
    groups.forEach((lists) => {
      const items = lists.flatMap((l) => [...l.querySelectorAll("[data-past-after]")]);
      if (!items.length) return;
      items.forEach((i) => i.classList.remove("is-next"));
      const next = items.find((i) => !i.classList.contains("is-past"));
      if (next) next.classList.add("is-next");
      lists.forEach((l) =>
        l.querySelectorAll(".svc-tl__flag").forEach((f) => {
          if (!f.closest(".is-next")) f.remove();
        })
      );
    });
    // Conference-year stepper: highlight the phase for this month (data-months="9,10")
    const month = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: M.tz || "America/Los_Angeles", month: "numeric" }).format(new Date())
    );
    document.querySelectorAll("[data-months]").forEach((el) => {
      const months = el.dataset.months.split(",").map(Number);
      el.classList.toggle("is-now", months.includes(month));
    });
  }

  /* ------------------------------------------------------------ Alpine components */
  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;
    const S = window.MSearch;
    // an item's name (title, abbreviation…) ranks it: every query word in the name first, then how well it matches
    const rankOf = (name, query) => (S.test(name, query) ? 1000 : 0) + S.score(name, query);

    // Motions board: status chips, panel chips and a search box. It opens on the current panel; a search
    // looks in every panel until the visitor picks a panel chip. The search covers both languages, the
    // label chip, the id, "Panel N" and the status words (data-text, src/_data/motions.js).
    // Each column shows its first few cards (data-cap overrides; the "result not recorded"
    // archive starts collapsed) until "show more" is pressed or a search is typed.
    // The status tiles above the board send `svc-motions` events: { status, panel }.
    // Links: ?q=… fills the box; ?highlight=… (a site-search result) does too when some card has those
    // words; #motion-<id> shows that card whatever the panel, the cap or the search would hide.
    Alpine.data("svcMotions", (cap, panel) => {
      let labels = null; // card labels that end in a single letter ("motion a", "mocion a"), read once
      return {
        status: "all",
        panel: panel || "all",
        startPanel: panel || "all",
        picked: false, // the visitor chose a panel chip (or a status tile chose "all panels")
        q: "",
        cap: cap || 5,
        open: {},
        counts: {},
        extra: {},
        total: 0, // cards in the visible columns
        shown: 0, // cards that match the panel + search (any status)
        // the panel the board shows: every panel while searching, until a panel chip is picked
        get scope() {
          return !this.picked && !S.query(this.q).empty ? "all" : this.panel;
        },
        pick(p) {
          this.panel = p;
          this.picked = true;
        },
        // The query, parsed. "Motion A", "Moción B": a label whose last word is one letter is matched as
        // that label (data-label), because a single letter finds almost anything and "a"/"e" are ignored.
        parse(q) {
          if (!labels)
            labels = [...new Set([...this.$root.querySelectorAll(".svc-motion")].flatMap((c) => (c.dataset.label || "").split("|")))]
              .filter((l) => / [a-z]$/.test(l))
              .sort((a, b) => b.length - a.length);
          let f = " " + S.fold(q).replace(/[^a-z0-9]+/g, " ").trim() + " ";
          const label = labels.find((l) => f.includes(" " + l + " ")) || "";
          if (label) f = f.replace(" " + label + " ", " ");
          return { label, query: S.query(f), any: !!label || !S.query(f).empty };
        },
        match(c, t, scope) {
          const d = c.dataset;
          if (scope !== "all" && String(d.panel) !== String(scope)) return false;
          if (t.label && !(d.label || "").split("|").includes(t.label)) return false;
          return S.test(d.text, t.query);
        },
        apply() {
          const t = this.parse(this.q);
          const searching = t.any;
          const scope = this.scope;
          let total = 0;
          let shown = 0;
          this.$root.querySelectorAll("[data-col]").forEach((col) => {
            const key = col.dataset.col;
            const cap = col.dataset.cap != null ? Number(col.dataset.cap) : this.cap;
            let n = 0;
            col.querySelectorAll(".svc-motion").forEach((c) => {
              const ok = this.match(c, t, scope);
              if (ok) n++;
              c.hidden = !ok || (!searching && !this.open[key] && n > cap);
            });
            this.counts[key] = n;
            this.extra[key] = searching || this.open[key] ? 0 : Math.max(0, n - cap);
            col.hidden = n === 0 || (this.status !== "all" && this.status !== key);
            shown += n;
            if (!col.hidden) total += n;
          });
          this.total = total;
          this.shown = shown;
        },
        more(key) {
          this.open[key] = true;
          this.apply();
        },
        // #motion-<id>: open the card's column, drop a status, panel or search that hides it, scroll to it
        reveal() {
          let id = "";
          try {
            id = decodeURIComponent(location.hash.slice(1));
          } catch (e) {
            return;
          }
          const el = /^motion-/.test(id) ? document.getElementById(id) : null;
          const card = el && el.closest(".svc-motion");
          if (!card || !this.$root.contains(card)) return;
          const col = card.closest("[data-col]");
          if (col) this.open[col.dataset.col] = true;
          if (col && this.status !== "all" && this.status !== col.dataset.col) this.status = "all";
          if (!this.match(card, this.parse(this.q), "all")) this.q = "";
          if (String(card.dataset.panel) !== String(this.scope)) this.panel = "all";
          this.apply();
          this.$nextTick(() => card.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "center" }));
        },
        // from a status tile: show that status (across panels) and bring the board into view
        filter(detail) {
          const d = detail || {};
          if (d.panel) this.pick(d.panel);
          if (d.status) this.status = d.status;
          if (d.status && d.status !== "all") this.open[d.status] = true;
          this.$nextTick(() => {
            this.apply();
            // phones: bring the chosen chips into view inside their sideways-scrolling rows
            this.$root.querySelectorAll("[role=group]").forEach((g) => {
              const on = g.querySelector('[aria-pressed="true"]');
              if (on && g.scrollWidth > g.clientWidth) g.scrollLeft += on.getBoundingClientRect().left - g.getBoundingClientRect().left - 16;
            });
            const head = this.$root.querySelector("#board-title");
            this.$root.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "start" });
            if (head) {
              head.setAttribute("tabindex", "-1");
              head.focus({ preventScroll: true });
            }
          });
        },
        init() {
          try {
            const p = new URLSearchParams(location.search);
            const q = (p.get("q") || "").trim();
            // Pagefind's highlightParam sends one ?highlight= per word; a general site search ("motions")
            // that no card answers keeps the full board
            const hl = p.getAll("highlight").join(" ").trim();
            const cards = [...this.$root.querySelectorAll(".svc-motion")];
            if (q) this.q = q;
            else if (hl && cards.some((c) => this.match(c, this.parse(hl), "all"))) this.q = hl;
          } catch (e) {}
          this.apply();
          this.reveal();
          window.addEventListener("hashchange", () => this.reveal());
          ["status", "picked"].forEach((k) => this.$watch(k, () => this.apply()));
          this.$watch("q", () => {
            this.apply();
            // the box was emptied, so the board is back on its panel, where the chosen status may have nothing
            if (!this.picked && S.query(this.q).empty && this.status !== "all" && !this.counts[this.status]) this.status = "all";
          });
          this.$watch("panel", () => {
            this.apply();
            // a status with nothing in the newly chosen panel falls back to "all"
            if (this.status !== "all" && !this.counts[this.status]) this.status = "all";
          });
        },
        reset() {
          this.status = "all";
          this.panel = this.startPanel;
          this.picked = false;
          this.q = "";
        },
      };
    });

    // Year tabs on /service/ ("The Area's year"). A URL hash picks a tab only when it names one
    // (#y2027); every other hash (#new-gsr, #learn-title, #main …) keeps the first tab, so the
    // timeline never goes blank. Arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern).
    Alpine.data("svcYearTabs", (first, names) => ({
      tab: first,
      names: names || [],
      init() {
        let h = "";
        try { h = decodeURIComponent(location.hash.slice(1)); } catch {}
        if (h && this.names.includes(h)) this.tab = h;
      },
      go(name, focus) {
        if (!this.names.includes(name)) return;
        this.tab = name;
        if (focus) this.$nextTick(() => this.$root.querySelector(`[data-tab="${name}"]`)?.focus());
      },
      key(e) {
        const n = this.names.length;
        if (!n) return;
        const i = Math.max(0, this.names.indexOf(this.tab));
        let j = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % n;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + n) % n;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = n - 1;
        if (j === null) return;
        e.preventDefault();
        this.go(this.names[j], true);
      },
    }));

    // Area meetings list: kind group + upcoming/past. A year's heading shows while any of its
    // meetings does (rows carry data-year / data-grp / data-end); with none at all, a message and Clear.
    Alpine.data("svcMeetings", (initialWhen) => ({
      group: "all",
      when: initialWhen || "all",
      show(group, endIso) {
        if (this.group !== "all" && group !== this.group) return false;
        if (this.when === "all") return true;
        const past = Date.now() > Date.parse(endIso);
        return this.when === "past" ? past : !past;
      },
      yearShown(y) {
        const rows = [...this.$root.querySelectorAll(`tr[data-year="${y}"]`)];
        // a year of 2nd-Sunday placeholders only: its strip shows for "all" kinds, upcoming or any time
        if (!rows.length) return this.group === "all" && this.when !== "past";
        return rows.some((r) => this.show(r.dataset.grp, r.dataset.end));
      },
      none() {
        const years = [...this.$root.querySelectorAll("[data-year-head]")].map((h) => h.dataset.yearHead);
        return years.length > 0 && !years.some((y) => this.yearShown(y));
      },
    }));

    // Delegate's Corner archive: text search (the whole post and its card, data-search) + panel + kind.
    // While searching, posts whose title (data-title), then whose card (title, summary, byline: data-card)
    // has the words come first; otherwise the list keeps its order (newest first) and the first `limit`
    // show until the reader asks for all of them (or starts filtering). ?q= fills the box.
    Alpine.data("svcPosts", (total, limit) => {
      let order = null; // the posts in page order, read once
      return {
        q: "",
        panel: "all",
        kind: "all",
        all: false,
        limit: limit || 12,
        count: total || 0, // posts that match
        hiddenCount: 0, // matches still behind "show more"
        apply() {
          if (!order) order = [...this.$root.querySelectorAll("li.svc-post")];
          const query = S.query(this.q);
          const capped = !this.all && query.empty && this.panel === "all" && this.kind === "all";
          const rank = new Map();
          order.forEach((li) => {
            const d = li.dataset;
            const ok =
              (this.panel === "all" || String(d.panel) === String(this.panel)) &&
              (this.kind === "all" || d.kind === this.kind) &&
              S.test(d.search, query);
            if (!ok || query.empty) return rank.set(li, ok ? 0 : -1);
            // the title first (whole words count more, a shorter title wins a tie), then the card; a match stays >= 0
            const title = d.title || "";
            rank.set(li, (S.test(title, query) ? 2000 : 0) + 10 * S.score(title, query) + rankOf(d.card, query) + 1 - title.length / 1e5);
          });
          const list = query.empty ? order : [...order].sort((a, b) => rank.get(b) - rank.get(a));
          place(list);
          let n = 0;
          list.forEach((li) => {
            const ok = rank.get(li) >= 0;
            if (ok) n++;
            li.hidden = !ok || (capped && n > this.limit);
          });
          this.count = n;
          this.hiddenCount = capped ? Math.max(0, n - this.limit) : 0;
        },
        init() {
          try {
            const q = new URLSearchParams(location.search).get("q");
            if (q) this.q = q;
          } catch (e) {}
          this.apply();
          ["q", "panel", "kind", "all"].forEach((k) => this.$watch(k, () => this.apply()));
        },
        clear() {
          this.q = "";
          this.panel = "all";
          this.kind = "all";
        },
      };
    });

    // Glossary: search (both languages, abbreviations, the other names in the notes, the definitions:
    // data-search) + category. While searching, terms whose name or abbreviation (data-name) has the
    // words come first; otherwise the first `limit` terms show until "show all" (or a filter).
    // ?q= fills the box; #term-<slug> (a site-search result or a shared link) shows that term.
    Alpine.data("svcGlossary", (total, limit) => {
      let order = null; // the terms in page order (alphabetical in the page's language), read once
      return {
        q: "",
        cat: "all",
        all: false,
        limit: limit || 16,
        count: total || 0,
        hiddenCount: 0,
        apply() {
          if (!order) order = [...this.$root.querySelectorAll("[data-term]")];
          const query = S.query(this.q);
          const capped = !this.all && query.empty && this.cat === "all";
          const rank = new Map();
          order.forEach((el) => {
            const ok = (this.cat === "all" || el.dataset.cat === this.cat) && S.test(el.dataset.search, query);
            const name = el.dataset.name || "";
            // on a tie the shorter name first ("delegada" → Delegate, then Alternate Delegate); a match stays >= 0
            rank.set(el, !ok ? -1 : query.empty ? 0 : rankOf(name, query) + 1 - name.length / 1e5);
          });
          const list = query.empty ? order : [...order].sort((a, b) => rank.get(b) - rank.get(a));
          place(list);
          let n = 0;
          list.forEach((el) => {
            const ok = rank.get(el) >= 0;
            if (ok) n++;
            el.hidden = !ok || (capped && n > this.limit);
          });
          this.count = n;
          this.hiddenCount = capped ? Math.max(0, n - this.limit) : 0;
        },
        // #term-<slug>: lift the cap, drop a search or category that hides the term, scroll to it
        reveal() {
          let id = "";
          try {
            id = decodeURIComponent(location.hash.slice(1));
          } catch (e) {
            return;
          }
          const h = /^term-/.test(id) ? document.getElementById(id) : null;
          const li = h && h.closest("[data-term]");
          if (!li || !this.$root.contains(li)) return;
          this.all = true;
          this.apply();
          if (li.hidden) {
            this.q = "";
            this.cat = "all";
            this.apply();
          }
          this.$nextTick(() => h.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "center" }));
        },
        init() {
          try {
            const q = new URLSearchParams(location.search).get("q");
            if (q) this.q = q;
          } catch (e) {}
          this.apply();
          this.reveal();
          window.addEventListener("hashchange", () => this.reveal());
          ["q", "cat", "all"].forEach((k) => this.$watch(k, () => this.apply()));
        },
      };
    });

    // The inverted triangle on /about/structure/ (macros/triangle.njk, as tabs): one band selected at a time,
    // arrow keys move between bands. The bands drop in through the wrapper's .reveal, as on every page.
    Alpine.data("svcTriangle", (count, start) => ({
      sel: start || 0,
      count: count || 7,
      init() {
        // #level-N links to a band
        const m = location.hash.match(/^#level-(\d)$/);
        if (m) this.sel = Math.min(this.count - 1, Math.max(0, Number(m[1]) - 1));
      },
      pick(i, focus) {
        this.sel = (i + this.count) % this.count;
        if (focus) this.$nextTick(() => this.$root.querySelector(`[data-band="${this.sel}"]`)?.focus());
        if (window.matchMedia("(max-width: 1023px)").matches && !focus) {
          const panel = this.$root.querySelector("[data-level-panel]");
          panel && panel.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth", block: "nearest" });
        }
      },
      key(e) {
        if (["ArrowDown", "ArrowRight"].includes(e.key)) { e.preventDefault(); this.pick(this.sel + 1, true); }
        else if (["ArrowUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); this.pick(this.sel - 1, true); }
        else if (e.key === "Home") { e.preventDefault(); this.pick(0, true); }
        else if (e.key === "End") { e.preventDefault(); this.pick(this.count - 1, true); }
      },
    }));
  });

  function boot() {
    refreshTimeline();
    setInterval(refreshTimeline, 60 * 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

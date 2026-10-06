/*
  Area-business pages: filters for the motions board, the Area-meeting list, the
  Delegate's Corner archive and the glossary; the interactive service triangle;
  and small clock-based touches (timeline "next" marker, Conference-year phase).
  Loaded before Alpine (see the page's front matter `scripts`).
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});
  const fold = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

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

    // Motions board: status chips, panel chips and a search box. It opens on the current panel.
    // Each column shows its first few cards (data-cap overrides; the "result not recorded"
    // archive starts collapsed) until "show more" is pressed or a search is typed.
    // The status tiles above the board send `svc-motions` events: { status, panel }.
    Alpine.data("svcMotions", (cap, panel) => ({
      status: "all",
      panel: panel || "all",
      startPanel: panel || "all",
      q: "",
      cap: cap || 5,
      open: {},
      counts: {},
      extra: {},
      total: 0, // cards in the visible columns
      shown: 0, // cards that match the panel + search (any status)
      match(c) {
        const d = c.dataset;
        if (this.panel !== "all" && String(d.panel) !== String(this.panel)) return false;
        const q = fold(this.q);
        return !q || (d.text || "").includes(q);
      },
      apply() {
        const searching = !!fold(this.q);
        let total = 0;
        let shown = 0;
        this.$root.querySelectorAll("[data-col]").forEach((col) => {
          const key = col.dataset.col;
          const cap = col.dataset.cap != null ? Number(col.dataset.cap) : this.cap;
          let n = 0;
          col.querySelectorAll(".svc-motion").forEach((c) => {
            const ok = this.match(c);
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
      // from a status tile: show that status (across panels) and bring the board into view
      filter(detail) {
        const d = detail || {};
        if (d.panel) this.panel = d.panel;
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
        this.apply();
        ["status", "q"].forEach((k) => this.$watch(k, () => this.apply()));
        this.$watch("panel", () => {
          this.apply();
          // a status with nothing in the newly chosen panel falls back to "all"
          if (this.status !== "all" && !this.counts[this.status]) this.status = "all";
        });
      },
      reset() {
        this.status = "all";
        this.panel = this.startPanel;
        this.q = "";
      },
    }));

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

    // Area meetings list: kind group + upcoming/past.
    Alpine.data("svcMeetings", (initialWhen) => ({
      group: "all",
      when: initialWhen || "all",
      show(group, endIso) {
        if (this.group !== "all" && group !== this.group) return false;
        if (this.when === "all") return true;
        const past = Date.now() > Date.parse(endIso);
        return this.when === "past" ? past : !past;
      },
    }));

    // Delegate's Corner archive: text search + panel + kind; the first `limit` matches show until
    // the reader asks for all of them (or starts filtering).
    Alpine.data("svcPosts", (total, limit) => ({
      q: "",
      panel: "all",
      kind: "all",
      all: false,
      limit: limit || 12,
      count: total || 0,
      hiddenCount: 0,
      match(li) {
        const d = li.dataset;
        if (this.panel !== "all" && String(d.panel) !== String(this.panel)) return false;
        if (this.kind !== "all" && d.kind !== this.kind) return false;
        const q = fold(this.q);
        return !q || q.split(/\s+/).every((w) => (d.search || "").includes(w));
      },
      filtering() {
        return !!fold(this.q) || this.panel !== "all" || this.kind !== "all";
      },
      apply() {
        let n = 0;
        const capped = !this.all && !this.filtering();
        this.$root.querySelectorAll("li.svc-post").forEach((li) => {
          const ok = this.match(li);
          if (ok) n++;
          li.hidden = !ok || (capped && n > this.limit);
        });
        this.count = n;
        this.hiddenCount = capped ? Math.max(0, n - this.limit) : 0;
      },
      init() {
        this.apply();
        ["q", "panel", "kind", "all"].forEach((k) => this.$watch(k, () => this.apply()));
      },
      clear() {
        this.q = "";
        this.panel = "all";
        this.kind = "all";
      },
    }));

    // Glossary: search + category; the first `limit` terms show until "show all" (or a filter).
    Alpine.data("svcGlossary", (total, limit) => ({
      q: "",
      cat: "all",
      all: false,
      limit: limit || 16,
      count: total || 0,
      hiddenCount: 0,
      apply() {
        const q = fold(this.q);
        const capped = !this.all && !q && this.cat === "all";
        let n = 0;
        this.$root.querySelectorAll("[data-term]").forEach((el) => {
          const ok = (this.cat === "all" || el.dataset.cat === this.cat) && (!q || (el.dataset.search || "").includes(q));
          if (ok) n++;
          el.hidden = !ok || (capped && n > this.limit);
        });
        this.count = n;
        this.hiddenCount = capped ? Math.max(0, n - this.limit) : 0;
      },
      init() {
        this.apply();
        ["q", "cat", "all"].forEach((k) => this.$watch(k, () => this.apply()));
      },
    }));

    // The inverted triangle: one band selected at a time, arrow keys move between bands.
    Alpine.data("svcTriangle", (count, start) => ({
      sel: start || 0,
      count: count || 6,
      intro: true,
      init() {
        // read ?level= or #level-N so a band can be linked to
        const m = location.hash.match(/^#level-(\d)$/);
        if (m) this.sel = Math.min(this.count - 1, Math.max(0, Number(m[1]) - 1));
        setTimeout(() => (this.intro = false), 1200);
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

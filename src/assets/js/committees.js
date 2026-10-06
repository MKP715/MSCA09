/*
  Committees, Panel directory and Contact pages — small Alpine components.

  cmFilter({ group, lang })   live filtering of [data-cm-item] elements inside the component:
      data-search  lower-case, accent-free text to search in
      data-group   group key (matches `group`, or "all")
      data-lang    "en" | "es" | "" (matches `lang`, or "all")
      data-open    "1" when the item is (or holds) an open position
    Containers marked [data-cm-section] are hidden when none of their items is visible.
    `shown` = number of visible items; `announce` = text for a polite live region.

  cmSpy()   highlights the in-page section link ([data-spy] anchors) of the section in view.
*/
(function () {
  "use strict";
  const fold = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

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
        this.$watch("group", () => this.apply());
        this.$watch("lang", () => this.apply());
        this.$watch("openOnly", () => this.apply());
        this.$nextTick(() => this.apply(true));
      },
      apply(first) {
        const words = fold(this.q).split(/\s+/).filter(Boolean);
        const items = this.$root.querySelectorAll("[data-cm-item]");
        let shown = 0;
        items.forEach((el) => {
          const hay = el.dataset.search || fold(el.textContent);
          const okQ = words.every((w) => hay.includes(w));
          const g = el.dataset.group || "";
          const okG = this.group === "all" || g.split(" ").includes(this.group);
          const okL = this.lang === "all" || !el.dataset.lang || el.dataset.lang === this.lang;
          const okO = !this.openOnly || el.dataset.open === "1";
          const ok = okQ && okG && okL && okO;
          el.hidden = !ok;
          if (ok) shown++;
        });
        this.$root.querySelectorAll("[data-cm-section]").forEach((sec) => {
          const any = [...sec.querySelectorAll("[data-cm-item]")].some((el) => !el.hidden);
          sec.hidden = !any;
        });
        // folded sections open while searching so matches are visible
        if (words.length || this.openOnly) this.$root.querySelectorAll("details[data-cm-autoopen]").forEach((d) => (d.open = true));
        // show folded extras (e.g. long district lists) while a filter is on
        this.$root.classList.toggle("cm-filtering", words.length > 0 || this.openOnly || this.lang !== "all");
        this.total = items.length;
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
  });
})();

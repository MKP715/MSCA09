/*
  The Pacific Regional Forum 2028 pages (/service/prf-2028/…). Loaded before Alpine (the pages' front matter `scripts`).

    prfCountdown(startMs, endMs)  overview: days / hours / minutes / seconds to the opening session
    prfDays(keys, dates)          program: one tab per day (arrow keys move between tabs); during the Forum, today's
    prfPositions                  volunteer: the "Before the Forum / Forum weekend" filter; "I'm interested" ticks the
                                  position in the sign-up form (event prf-pick)
    prfMail(cfg)                  the sign-up forms (macros/prf.njk prfMailForm): nothing is sent from the page — it
                                  opens the visitor's own e-mail program with their answers (a mailto: link), addressed
                                  to the host committee, or copies the message to paste anywhere
    prfFaq                        FAQ: search (MSearch, the site's shared matcher) and topic chips
    prfFlyer(lang)                save the date: which flyer is shown and printed (printing prints only the flyer)
    prfChecklist(key, n)          save the date: "Help spread the word", kept in this browser only (localStorage,
                                  every access wrapped: with storage blocked the boxes simply are not remembered)

  Wording: data/text/prf.csv (window.MSCA.t — the keys are listed in each page's jsText).
*/
(function () {
  "use strict";
  const M = (window.MSCA = window.MSCA || {});
  const tr = (k, vars) => {
    if (M.tr) return M.tr(k, vars);
    let s = (M.t && M.t[k]) || k;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
    return s;
  };
  const lang = () => (document.documentElement.lang || "en").slice(0, 2);
  const TZ = "America/Los_Angeles";
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  // the tab row: bring the current page's tab into view on a narrow screen (scrolls the row only, never the page)
  function showTab() {
    const on = document.querySelector(".prf-tab.is-on");
    const row = on && on.closest(".prf-tabs__list");
    if (!row || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showTab);
  else showTab();

  document.addEventListener("alpine:init", () => {
    const Alpine = window.Alpine;

    /* ---------------------------------------------------------------- countdown */
    Alpine.data("prfCountdown", (startMs, endMs) => ({
      ready: false,
      over: false,
      calm: false,
      units: [],
      spoken: "",
      timer: null,
      init() {
        this.run();
        this.ready = true;
        this._onMotion = () => this.run();
        window.addEventListener("msca:motion", this._onMotion);
      },
      // With reduced motion or animations paused (WCAG 2.2.2) the seconds tile is hidden and the rest changes once a
      // minute, as the site's own countdown does (app.js countdown)
      run() {
        clearInterval(this.timer);
        this.calm = !!(M.reducedMotion || M.motionPaused);
        this.tick();
        if (this.over) return;
        if (this.calm) this.timer = setTimeout(() => { this.tick(); this.timer = setInterval(() => this.tick(), 6e4); }, 6e4 - (Date.now() % 6e4) + 50);
        else this.timer = setInterval(() => this.tick(), 1000);
      },
      destroy() { clearInterval(this.timer); window.removeEventListener("msca:motion", this._onMotion); },
      tick() {
        const now = Date.now();
        this.over = now >= endMs;
        const left = Math.max(0, startMs - now);
        const d = Math.floor(left / 864e5), h = Math.floor(left / 36e5) % 24, m = Math.floor(left / 6e4) % 60, s = Math.floor(left / 1e3) % 60;
        const loc = lang() === "es" ? "es-US" : "en-US";
        this.units = [
          { k: "d", v: d.toLocaleString(loc), label: tr("prf.js.days") },
          { k: "h", v: String(h).padStart(2, "0"), label: tr("prf.js.hours") },
          { k: "m", v: String(m).padStart(2, "0"), label: tr("prf.js.minutes") },
          { k: "s", v: String(s).padStart(2, "0"), label: tr("prf.js.seconds") },
        ];
        // read out once a minute at most (the visible seconds are hidden from screen readers)
        const said = `${d.toLocaleString(loc)} ${tr("prf.js.days")}, ${h} ${tr("prf.js.hours")}, ${m} ${tr("prf.js.minutes")}`;
        if (said !== this.spoken) this.spoken = said;
      },
    }));

    /* ---------------------------------------------------------------- program: day tabs */
    Alpine.data("prfDays", (keys, dates) => ({
      ready: false,
      day: keys[1] || keys[0],
      init() {
        const i = dates.indexOf(today());
        if (i >= 0) this.day = keys[i];
        const h = (location.hash || "").replace("#prf-day-", "");
        if (keys.includes(h)) this.day = h;
        this.ready = true;
      },
      // the chosen day's list fades back once (MSCA.fadeChange, app.js), from a click or an arrow key; never at load
      fade() {
        this.$nextTick(() => window.MSCA && MSCA.fadeChange && MSCA.fadeChange(document.getElementById("prf-day-" + this.day)));
      },
      pick(k) {
        if (k !== this.day) this.fade();
        this.day = k;
      },
      keys(e) {
        const i = keys.indexOf(this.day);
        let j = i;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % keys.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + keys.length) % keys.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = keys.length - 1;
        else return;
        e.preventDefault();
        if (j !== i) this.fade();
        this.day = keys[j];
        this.$nextTick(() => { const t = document.getElementById("prf-tab-" + this.day); if (t) t.focus(); });
      },
    }));

    /* ---------------------------------------------------------------- volunteer: positions */
    Alpine.data("prfPositions", () => ({
      ready: false,
      phase: "all",
      init() {
        this.ready = true;
        // a phase chip redraws the positions: the list (x-ref="list") fades back once (MSCA.fadeChange, app.js)
        this.$watch("phase", () => this.$nextTick(() => window.MSCA && MSCA.fadeChange && MSCA.fadeChange(this.$refs.list)));
      },
      show(el) { return this.phase === "all" || (el.dataset.phases || "").split(" ").includes(this.phase); },
      get shown() {
        // read phase so Alpine recounts when it changes
        const p = this.phase;
        return [...this.$root.querySelectorAll(".prf-pos")].filter((el) => p === "all" || (el.dataset.phases || "").split(" ").includes(p)).length;
      },
      interested(id) { window.dispatchEvent(new CustomEvent("prf-pick", { detail: id })); },
    }));

    /* ---------------------------------------------------------------- the sign-up forms */
    Alpine.data("prfMail", (cfg) => ({
      vals: {},
      missing: [],
      sent: false,
      copied: false,
      track(e) {
        const el = e.target;
        if (el && el.name && el.type === "radio") this.vals[el.name] = el.dataset.key || el.value;
        if (this.missing.length) this.check(false);
      },
      // "I'm interested" on a position card: tick it (the link itself scrolls to the form)
      pick(id) {
        const box = this.$root.querySelector(`input[type=checkbox][name=positions][data-key="${CSS.escape(String(id))}"]`);
        if (box) {
          box.checked = true;
          const first = this.$root.querySelector("input[name=name]");
          if (first) setTimeout(() => first.focus({ preventScroll: true }), 350);
        }
      },
      // required questions: the browser's own checks, plus "at least one" for required checkbox groups
      check(report) {
        const form = this.$root;
        const groups = [...form.querySelectorAll("[data-req-group]")].map((g) => g.dataset.reqGroup)
          .filter((k) => !form.querySelector(`input[name="${k}"]:checked`));
        this.missing = groups;
        const ok = form.checkValidity() && !groups.length;
        if (!ok && report) {
          if (!form.checkValidity()) form.reportValidity();
          else {
            const g = form.querySelector(`[data-req-group="${groups[0]}"] input`);
            if (g) g.focus();
          }
        }
        return ok;
      },
      // the answers in the form's order: "Question: answer" (several ticked boxes joined with ";")
      lines() {
        const form = this.$root;
        const out = [];
        const seen = new Set();
        form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
          const k = el.name;
          if (seen.has(k)) return;
          seen.add(k);
          const wrap = el.closest("fieldset, .prf-field, .prf-consent");
          // a question that is hidden (x-show: "Presentation details" unless that topic is chosen) is left out
          if (wrap && wrap.style.display === "none") return;
          let v;
          if (el.type === "checkbox" || el.type === "radio") v = [...form.querySelectorAll(`input[name="${k}"]:checked`)].map((x) => x.value).join("; ");
          else v = String(el.value || "").trim();
          if (!v) return;
          const label = wrap ? (wrap.querySelector("legend, .prf-field__label, span") || {}).textContent || k : k;
          out.push(`${label.replace(/\s*\*\s*$/, "").trim()}: ${v}`);
        });
        return out;
      },
      subject() {
        const name = String((this.$root.querySelector("[name=name]") || {}).value || "").trim();
        return cfg.subject.replace("{name}", name || "—");
      },
      body() {
        return [cfg.heading, "", ...this.lines(), "", cfg.from.replace("{url}", location.origin + location.pathname)].join("\r\n");
      },
      send() {
        if (!this.check(true)) return;
        const enc = encodeURIComponent;
        let body = this.body();
        // some e-mail programs open nothing for a very long link: shorten the longest answers if needed
        if (body.length > 1800) body = body.slice(0, 1780) + "\r\n…";
        window.location.href = `mailto:${cfg.to}?subject=${enc(this.subject())}&body=${enc(body)}`;
        this.sent = true;
      },
      async copy() {
        if (!this.check(true)) return;
        const text = `${tr("prf.js.to")}: ${cfg.to}\r\n${tr("prf.js.subject")}: ${this.subject()}\r\n\r\n${this.body()}`;
        try {
          await navigator.clipboard.writeText(text);
        } catch (e) {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        this.copied = true;
        if (M.announce) M.announce(tr("ui.copied"));
        setTimeout(() => (this.copied = false), 2200);
      },
    }));

    /* ---------------------------------------------------------------- FAQ */
    Alpine.data("prfFaq", () => ({
      ready: false,
      q: "",
      cat: "all",
      hays: new WeakMap(),
      init() {
        this.ready = true;
        const params = new URLSearchParams(location.search);
        if (params.get("q")) this.q = params.get("q");
      },
      hay(el) {
        let h = this.hays.get(el);
        if (h == null) {
          const MS = window.MSearch;
          h = MS ? MS.index(el.dataset.search || el.textContent) : " " + (el.dataset.search || el.textContent).toLowerCase() + " ";
          this.hays.set(el, h);
        }
        return h;
      },
      show(el) {
        if (this.cat !== "all" && el.dataset.cat !== this.cat) return false;
        const q = this.q.trim();
        if (!q) return true;
        const MS = window.MSearch;
        return MS ? MS.match(this.hay(el), q) : this.hay(el).includes(q.toLowerCase());
      },
      // show() reads q and cat, so Alpine counts again when either changes
      get shown() { return [...this.$root.querySelectorAll(".faq-item")].filter((el) => this.show(el)).length; },
    }));

    /* ---------------------------------------------------------------- save the date */
    Alpine.data("prfFlyer", (start) => ({
      flyer: start === "es" ? "es" : "en",
      print() { window.print(); },
    }));

    Alpine.data("prfChecklist", (key, n) => ({
      done: Array(n).fill(false),
      init() {
        try {
          const v = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(v)) this.done = this.done.map((x, i) => !!v[i]);
        } catch (e) {}
      },
      set(i, on) {
        this.done[i] = on;
        try { localStorage.setItem(key, JSON.stringify(this.done)); } catch (e) {}
      },
    }));
  });
})();

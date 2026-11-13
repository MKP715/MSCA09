/*
  The online Area finance forms: the Expense Reimbursement Request (/service/forms/expense/) and the
  Annual Budget Request (/service/forms/budget/). Loaded before Alpine (see the pages' front matter `scripts`).

  Nothing typed here leaves the visitor's browser: the page sends nothing anywhere. The visitor prints the
  form (or saves it as a PDF) and opens their own e-mail program with a plain-text summary (a mailto: link).
  While "Keep a draft on this device" is ticked, the answers are kept in this browser's localStorage
  (msca-form-expense, msca-form-budget) so a half-filled form survives a reload; "Start over", unticking the box
  and "Erase from this device" (offered after sending or printing) erase them.
  Every storage access is wrapped: with storage blocked the page works the same, without the draft.
  The printed copy (.ffp) is measured off-screen so it gets only the empty lines that still fit on one page (fit()).

  The choices, columns and lines come from data/finance-forms.csv through the JSON block #ff-data
  (src/_data/financeForms.js); the wording from data/text/forms.csv (window.MSCA.t — the keys are listed in
  each page's jsText). Money is counted in whole cents, so totals never drift by a cent.
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

  const STORE = "msca-form-";
  const FIRST_ROWS = 3; // expense lines shown at first (the paper form has 10)
  const MAX_ROWS = 40;
  const PRINT_ROWS = 10; // the paper expense form's empty lines: the printed copy pads up to them while they fit
  // The printed copy is one Letter page (11in less the 0.4in margins of @page in forms.css), in CSS px.
  // It is laid out off-screen at the paper's width, so fit() can measure it and add only the empty lines that
  // still fit on that page; FIT_SPARE keeps a little room for rounding between screen and print.
  const PAGE_H = (11 - 2 * 0.4) * 96;
  const FIT_SPARE = 10;
  const MAIL_MAX = 1900; // the longest mailto: link we open; a longer summary is shortened (see mailto())
  const LATE_DAYS = 30; // reimbursement requests are asked for within 30 days of the expense

  const readCfg = () => {
    try {
      return JSON.parse(document.getElementById("ff-data").textContent) || {};
    } catch (e) {
      return {};
    }
  };
  let n = 0;
  const uid = () => Date.now().toString(36) + (n++).toString(36);

  /* ------------------------------------------------------------ numbers, money, dates */
  // "$1,234.50", "1234.5", "12,50" (decimal comma) → cents; "" is a valid empty amount.
  function parseMoney(v) {
    let s = String(v == null ? "" : v).trim().replace(/^us\s*/i, "").replace(/[\s$]/g, "");
    if (!s) return { ok: true, cents: 0, empty: true };
    if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    else if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) s = s.replace(/,/g, "");
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return { ok: false, cents: 0 };
    return { ok: true, cents: Math.round(parseFloat(s) * 100) };
  }
  function parseMiles(v) {
    let s = String(v == null ? "" : v).trim().replace(/\s/g, "");
    if (!s) return { ok: true, miles: 0, empty: true };
    if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, miles: 0 };
    return { ok: true, miles: parseFloat(s) };
  }
  const loc = () => M.locale || (M.lang === "es" ? "es-US" : "en-US");
  const money = (cents) => new Intl.NumberFormat(loc(), { style: "currency", currency: "USD" }).format((cents || 0) / 100);
  const num = (x) => new Intl.NumberFormat(loc(), { maximumFractionDigits: 2 }).format(x || 0);
  const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  function day(iso, style) {
    if (!isIso(iso)) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat(loc(), { dateStyle: style || "medium", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
  }
  // today in the Area's time zone, as YYYY-MM-DD
  const today = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: M.tz || "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const daysAgo = (iso) => Math.round((Date.parse(today() + "T00:00:00Z") - Date.parse(iso + "T00:00:00Z")) / 86400000);
  const stamp = (ms) => new Intl.DateTimeFormat(loc(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

  /* ------------------------------------------------------------ the draft on this device */
  const store = {
    get(k) {
      try {
        const s = localStorage.getItem(STORE + k);
        return s ? JSON.parse(s) : null;
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(STORE + k, JSON.stringify(v));
      } catch (e) {}
    },
    del(k) {
      try {
        localStorage.removeItem(STORE + k);
      } catch (e) {}
    },
  };

  // A saved draft is read only into fields the form still has, with the same type (a changed CSV never breaks the page).
  function merge(blank, saved) {
    if (!saved || typeof saved !== "object") return blank;
    for (const k of Object.keys(blank)) {
      const b = blank[k];
      const s = saved[k];
      if (s == null) continue;
      if (Array.isArray(b)) {
        if (!Array.isArray(s) || !s.length) continue;
        const proto = b[0] || {};
        blank[k] = s.slice(0, MAX_ROWS).map((row) => merge({ ...JSON.parse(JSON.stringify(proto)), id: uid() }, row));
        blank[k].forEach((r) => (r.id = uid()));
      } else if (b && typeof b === "object") blank[k] = merge(b, s);
      else if (typeof s === typeof b) blank[k] = s;
    }
    return blank;
  }

  const crlf = (lines) => lines.filter((l) => l != null).join("\r\n");
  const enc = encodeURIComponent;
  // a typed text cut to n characters for a short e-mail summary (0 = whole); cut between characters, never inside
  // one (an emoji is two UTF-16 units, and half of one cannot go in a link)
  const cut = (s, n) => Array.from(s).slice(0, n).join("");
  const clip = (s, n) => {
    s = String(s == null ? "" : s).trim();
    return n && Array.from(s).length > n ? cut(s, n - 1).trimEnd() + "…" : s;
  };
  // the summary's levels (see mailto()): how long a typed text may be at each
  const CLIP = [0, 0, 0, 80, 30];

  /* ------------------------------------------------------------ what both forms share */
  function base(kind) {
    return {
      cfg: readCfg(),
      f: null,
      keep: true,
      restored: "", // when a draft came back: when it was saved, for the notice
      errors: {},
      summary: [], // [{ id, text }] — the error summary at the top of the form
      tried: false, // after the first check, the errors follow what the visitor types
      pending: "", // "print" when the error summary offers "Print anyway"
      sent: false, // the e-mail program was opened
      printed: false, // the form was printed or saved as a PDF
      copied: false,
      oldTitle: "",
      saveTimer: 0,
      fitTimer: 0,
      blankH: 0, // the height of one empty printed line (measured)
      room: PRINT_ROWS, // how many empty printed lines still fit on the page (fit())

      init() {
        this.f = this.blank();
        const d = store.get(kind);
        if (d && d.v === 1) {
          if (d.keep === false) this.keep = false;
          else if (d.f) {
            this.f = merge(this.blank(), d.f);
            if (this.used()) this.restored = d.saved ? stamp(d.saved) : "";
          }
        }
        if (this.prepare) this.prepare();
        this.$watch("f", () => {
          this.save();
          if (this.tried) this.check();
          this.queueFit();
        });
        // unticking erases the draft: only the choice not to keep one stays
        this.$watch("keep", (on) => (on ? this.save(true) : store.set(kind, { v: 1, keep: false })));
        window.addEventListener("beforeprint", () => this.beforePrint());
        window.addEventListener("afterprint", () => this.afterPrint());
        this.$nextTick(() => this.fit());
      },

      t: (k, vars) => tr(k, vars),
      money,
      num,
      day,
      today,
      save(now) {
        clearTimeout(this.saveTimer);
        const run = () => {
          if (this.keep) store.set(kind, { v: 1, keep: true, saved: Date.now(), f: this.f });
        };
        if (now) run();
        else this.saveTimer = setTimeout(run, 400);
      },
      err(k) {
        return this.errors[k] || "";
      },
      errId(k) {
        return "ff-e-" + String(k).replace(/[^\w-]/g, "");
      },
      // an amount gets its two decimals when the visitor leaves the box ("12.5" → "12.50")
      tidyMoney(e) {
        const p = parseMoney(e.target.value);
        if (!p.ok || p.empty) return;
        const v = (p.cents / 100).toFixed(2);
        if (e.target.value !== v) {
          e.target.value = v;
          e.target.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      cents(v) {
        const p = parseMoney(v);
        return p.ok ? p.cents : 0;
      },
      miles(v) {
        const p = parseMiles(v);
        return p.ok ? p.miles : 0;
      },
      // in whole cents, a half cent rounded up: thousandths of a mile × the rate in tenths of a cent, all whole numbers
      mileage(v) {
        const milli = Math.round(this.miles(v) * 1000);
        const rate = Math.round((this.cfg.rate || 0) * 1000);
        return Math.round((milli * rate) / 10000);
      },
      // a typed address on one line ("123 Main St, Santa Ana, CA 92701")
      oneLine(s) {
        return String(s == null ? "" : s).trim().replace(/\s*\n\s*/g, ", ");
      },
      label(list, key) {
        const o = (this.cfg[list] || []).find((x) => (x.key || x.slug) === key);
        if (!o) return "";
        return (M.lang === "es" ? o.label_es || o.name_es : "") || o.label_en || o.name_en || key;
      },
      kindOf(list, key) {
        const o = (this.cfg[list] || []).find((x) => x.key === key);
        return o ? o.kind : "";
      },

      // ---- checking
      check() {
        const list = this.validate();
        const errors = {};
        for (const e of list) if (!errors[e.key]) errors[e.key] = e.text;
        this.errors = errors;
        this.summary = list.map((e) => ({ id: e.id, text: e.text }));
        if (!list.length) this.pending = "";
        return !list.length;
      },
      attempt(action) {
        this.tried = true;
        if (this.check()) {
          this.pending = "";
          return true;
        }
        this.pending = action;
        this.$nextTick(() => this.$refs.summary && this.$refs.summary.focus());
        return false;
      },
      jump(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: M.reducedMotion ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
      },

      // ---- sending, printing, copying
      // The full summary when it fits in a mailto: link (some e-mail programs open nothing longer than about
      // 2,000 characters), else a shorter one: levels 1 and 2 leave out details that are in the PDF (see body()),
      // 3 and 4 also cut each typed text (CLIP). If even that is too long, the summary itself is cut.
      mailto() {
        const to = this.cfg.to || "";
        const cc = this.cfg.cc || "";
        const build = (body, level) =>
          `mailto:${to}?` + [cc ? "cc=" + enc(cc) : "", "subject=" + enc(this.subject(CLIP[level])), "body=" + enc(body)].filter(Boolean).join("&");
        const last = CLIP.length - 1;
        for (let level = 0; level <= last; level++) {
          const url = build(this.body(level), level);
          if (url.length <= MAIL_MAX) return url;
        }
        const body = this.body(last);
        let lo = 0;
        let hi = Array.from(body).length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (build(cut(body, mid) + "…", last).length <= MAIL_MAX) lo = mid;
          else hi = mid - 1;
        }
        return build(cut(body, lo) + "…", last);
      },
      send() {
        if (!this.attempt("mail")) return;
        this.sent = true;
        window.location.href = this.mailto();
      },
      print() {
        if (!this.attempt("print")) return;
        window.print();
        this.printed = true;
      },
      printAnyway() {
        this.pending = "";
        window.print();
        this.printed = true;
      },
      // the browser's "Save as PDF" names the file after the page title
      beforePrint() {
        this.fit();
        this.oldTitle = document.title;
        document.title = this.fileName().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
      },
      afterPrint() {
        if (this.oldTitle) document.title = this.oldTitle;
        if (this.used()) this.printed = true;
      },
      // after sending or printing: erase the draft from this browser (the answers stay on the screen)
      forget() {
        this.keep = false;
        store.set(kind, { v: 1, keep: false });
        this.restored = "";
        M.announce && M.announce(tr("forms.js.forgotten"));
      },

      // ---- the printed copy: how many empty lines still fit on one page
      // The copy (x-ref="paper") is laid out off-screen at the paper's width, so its height here is its height
      // on paper. Empty lines carry data-ffp-blank; room = how many of them fit below the rest.
      fit() {
        const paper = this.$refs.paper;
        // measured on screen only: while printing, the copy is cut into pages and its height means nothing here
        if (!paper || (window.matchMedia && window.matchMedia("print").matches)) return;
        const h = paper.getBoundingClientRect().height;
        if (!h) return;
        const blanks = paper.querySelectorAll("[data-ffp-blank]");
        let blankH = 0;
        blanks.forEach((el) => (blankH += el.getBoundingClientRect().height));
        if (blanks.length) this.blankH = blankH / blanks.length;
        if (!this.blankH) return;
        this.room = Math.max(0, Math.floor((PAGE_H - FIT_SPARE - (h - blankH)) / this.blankH));
      },
      queueFit() {
        clearTimeout(this.fitTimer);
        this.fitTimer = setTimeout(() => this.$nextTick(() => this.fit()), 120);
      },
      async copy() {
        const text = this.subject() + "\r\n\r\n" + this.body(0);
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
        M.announce && M.announce(tr("forms.js.copied"));
        setTimeout(() => (this.copied = false), 2200);
      },
      startOver() {
        if (!window.confirm(tr("forms.js.confirm_reset"))) return;
        this.f = this.blank();
        if (this.prepare) this.prepare();
        this.errors = {};
        this.summary = [];
        this.tried = false;
        this.pending = "";
        this.sent = false;
        this.printed = false;
        this.restored = "";
        if (this.keep) store.del(kind);
        M.announce && M.announce(tr("forms.js.reset_done"));
        this.$nextTick(() => {
          const top = document.getElementById("ff-top");
          if (top) {
            top.scrollIntoView({ behavior: M.reducedMotion ? "auto" : "smooth" });
            top.focus({ preventScroll: true });
          }
        });
      },
      // lines the summary and the printed copy show: name, then value (empty values are left out)
      pair(label, value) {
        return value ? `${label}: ${value}` : null;
      },
    };
  }

  /* ------------------------------------------------------------ Expense Reimbursement Request */
  function expense() {
    const c = {
      ...base("expense"),

      blank() {
        return {
          line: "", other: "", date: "", location: "",
          by: "", district: "", hostPosition: "", officer: "", committee: "",
          name: "", address: "", phone: "", email: "",
          pay: "", payee: "", zelle: "",
          rows: Array.from({ length: FIRST_ROWS }, () => this.row()),
        };
      },
      row() {
        const r = { id: uid(), date: "", desc: "", miles: "" };
        for (const c of this.amountCols()) r[c.key] = "";
        return r;
      },
      amountCols() {
        return (this.cfg.columns || []).filter((c) => c.kind === "amount");
      },
      col(kind) {
        return (this.cfg.columns || []).find((c) => c.kind === kind) || { key: kind, code: "", label_en: kind, label_es: kind };
      },
      colLabel(c) {
        return (M.lang === "es" ? c.label_es : "") || c.label_en || c.key;
      },
      lineKind() {
        return this.kindOf("lines", this.f.line);
      },
      byKind() {
        return this.kindOf("by", this.f.by);
      },
      rowMileage(r) {
        return this.mileage(r.miles);
      },
      rowTotal(r) {
        return this.rowMileage(r) + this.amountCols().reduce((s, c) => s + this.cents(r[c.key]), 0);
      },
      colTotal(c) {
        if (c.kind === "miles") return this.f.rows.reduce((s, r) => s + this.miles(r.miles), 0);
        if (c.kind === "mileage") return this.f.rows.reduce((s, r) => s + this.rowMileage(r), 0);
        return this.f.rows.reduce((s, r) => s + this.cents(r[c.key]), 0);
      },
      colShown(c) {
        return c.kind === "miles" ? num(this.colTotal(c)) : money(this.colTotal(c));
      },
      grand() {
        return this.f.rows.reduce((s, r) => s + this.rowTotal(r), 0);
      },
      rowUsed(r) {
        return !!(r.date || String(r.desc).trim() || String(r.miles).trim() || this.amountCols().some((c) => String(r[c.key]).trim()));
      },
      usedRows() {
        return this.f.rows.filter((r) => this.rowUsed(r));
      },
      used() {
        const f = this.f;
        return !!(f.line || f.name || f.email || f.phone || this.usedRows().length);
      },
      isLate(r) {
        return isIso(r.date) && daysAgo(r.date) > LATE_DAYS;
      },
      anyLate() {
        return this.f.rows.some((r) => this.isLate(r));
      },
      // the printed table: the lines in use, then empty lines up to the paper form's 10, as many as fit on the page
      printRows() {
        const rows = this.usedRows().map((r) => ({ ...r, blank: false }));
        const pad = Math.min(PRINT_ROWS - rows.length, this.room);
        for (let i = 0; i < pad; i++) rows.push({ id: "pad" + i, blank: true });
        return rows;
      },
      addRow() {
        if (this.f.rows.length >= MAX_ROWS) return;
        const r = this.row();
        this.f.rows.push(r);
        M.announce && M.announce(tr("forms.js.line_added", { n: this.f.rows.length }));
        this.$nextTick(() => {
          const el = document.getElementById("ff-r" + r.id + "-date");
          if (el) el.focus();
        });
      },
      removeRow(i) {
        if (this.f.rows.length <= 1) {
          this.f.rows.splice(0, 1, this.row());
        } else {
          this.f.rows.splice(i, 1);
        }
        M.announce && M.announce(tr("forms.js.line_removed"));
        this.$nextTick(() => {
          const r = this.f.rows[Math.max(0, i - 1)];
          const el = (r && document.getElementById("ff-r" + r.id + "-date")) || document.getElementById("ff-add-row");
          if (el) el.focus();
        });
      },
      lineText(n) {
        const k = this.lineKind();
        const name = this.label("lines", this.f.line);
        if (k === "other") return this.f.other.trim() ? `${name}: ${clip(this.f.other, n)}` : name;
        return name;
      },
      byText() {
        const k = this.byKind();
        const name = this.label("by", this.f.by);
        if (k === "district" && this.f.district) return `${name}: ${this.label("districts", this.f.district)}${this.f.hostPosition.trim() ? " — " + this.f.hostPosition.trim() : ""}`;
        if (k === "officer" && this.f.officer) return `${name}: ${this.label("officers", this.f.officer)}`;
        if (k === "committee" && this.f.committee) return `${name}: ${this.label("committees", this.f.committee)}`;
        return name;
      },

      validate() {
        const f = this.f;
        const out = [];
        const add = (key, id, text) => out.push({ key, id, text });
        // the first radio button of a group (ids ff-line-<key>, ff-by-<key>)
        const first = (prefix, list) => "ff-" + prefix + "-" + ((this.cfg[list] || [])[0] || {}).key;
        if (!f.line) add("line", first("line", "lines"), tr("forms.js.e_line"));
        else if (this.lineKind() === "other" && !f.other.trim()) add("other", "ff-other", tr("forms.js.e_other"));
        if (!f.by) add("by", first("by", "by"), tr("forms.js.e_by"));
        else if (this.byKind() === "district" && !f.district) add("district", "ff-district", tr("forms.js.e_district"));
        else if (this.byKind() === "officer" && !f.officer) add("officer", "ff-officer", tr("forms.js.e_officer"));
        else if (this.byKind() === "committee" && !f.committee) add("committee", "ff-committee", tr("forms.js.e_committee"));
        if (!f.name.trim()) add("name", "ff-name", tr("forms.js.e_name"));
        // a check is mailed: it needs an address
        if (f.pay === "check" && !f.address.trim()) add("address", "ff-address", tr("forms.js.e_address"));
        if (!f.phone.trim() && !f.email.trim()) add("phone", "ff-phone", tr("forms.js.e_contact"));
        if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) add("email", "ff-email", tr("forms.js.e_email"));
        if (!f.pay) add("pay", "ff-pay-check", tr("forms.js.e_pay"));
        else if (f.pay === "check" && !f.payee.trim()) add("payee", "ff-payee", tr("forms.js.e_payee"));
        else if (f.pay === "zelle" && !f.zelle.trim()) add("zelle", "ff-zelle", tr("forms.js.e_zelle"));
        const used = this.usedRows();
        if (!used.length) add("rows", "ff-r" + f.rows[0].id + "-date", tr("forms.js.e_rows"));
        f.rows.forEach((r, i) => {
          if (!this.rowUsed(r)) return;
          const n = i + 1;
          const id = (k) => "ff-r" + r.id + "-" + k;
          if (!isIso(r.date)) add("r" + r.id + "-date", id("date"), tr("forms.js.e_row_date", { n }));
          else if (daysAgo(r.date) < 0) add("r" + r.id + "-date", id("date"), tr("forms.js.e_row_future", { n }));
          if (!String(r.desc).trim()) add("r" + r.id + "-desc", id("desc"), tr("forms.js.e_row_desc", { n }));
          if (!parseMiles(r.miles).ok) add("r" + r.id + "-miles", id("miles"), tr("forms.js.e_miles", { n, field: this.colLabel(this.col("miles")) }));
          for (const c of this.amountCols()) {
            if (!parseMoney(r[c.key]).ok) add("r" + r.id + "-" + c.key, id(c.key), tr("forms.js.e_money", { n, field: this.colLabel(c) }));
          }
          if (!this.rowTotal(r) && parseMiles(r.miles).ok && this.amountCols().every((c) => parseMoney(r[c.key]).ok))
            add("r" + r.id + "-miles", id("miles"), tr("forms.js.e_row_amount", { n }));
        });
        return out;
      },

      subject(n) {
        return tr("forms.js.exp_subject", { name: clip(this.f.name, n), total: money(this.grand()) });
      },
      fileName() {
        return tr("forms.js.exp_file", { name: this.f.name.trim(), date: today() });
      },
      // level 0 = everything; 1 = without the column sub-totals; 2 = without the lines and the address (they are in
      // the PDF); 3 = level 2 with each typed text cut to 80 characters; 4 = cut to 30, without the sub-totals
      body(level) {
        const f = this.f;
        const L = (k) => tr(k);
        const n = CLIP[level] || 0;
        const v = (s) => clip(s, n);
        const pay =
          f.pay === "check" ? `${L("forms.expense.check")} – ${L("forms.expense.payable_to")} ${v(f.payee)}`
          : f.pay === "zelle" ? `${L("forms.expense.zelle")} – ${L("forms.expense.zelle_info")} ${v(f.zelle)}`
          : "";
        const lines = [
          L("forms.js.exp_heading"),
          "",
          this.pair(L("forms.expense.budget_line"), this.lineText(n)),
          this.pair(L("forms.expense.date"), day(f.date, "long")),
          this.pair(L("forms.expense.location"), v(f.location)),
          this.pair(L("forms.expense.requested_by"), this.byText()),
          "",
          this.pair(L("forms.contact.name"), v(f.name)),
          level >= 2 ? null : this.pair(L("forms.contact.address"), this.oneLine(f.address)),
          this.pair(L("forms.contact.phone"), v(f.phone)),
          this.pair(L("forms.contact.email"), v(f.email)),
          this.pair(L("forms.expense.pay_title"), pay),
          "",
          L("forms.expense.expenses_title") + ":",
        ];
        const used = this.usedRows();
        if (level >= 2) {
          lines.push(tr("forms.js.mail_lines", { n: used.length }));
        } else {
          used.forEach((r, i) => {
            const parts = [];
            if (this.miles(r.miles)) parts.push(`${this.col("mileage").code} ${tr("forms.js.miles_at", { miles: num(this.miles(r.miles)), total: money(this.rowMileage(r)) })}`);
            for (const c of this.amountCols()) if (this.cents(r[c.key])) parts.push(`${c.code} ${this.colLabel(c)} ${money(this.cents(r[c.key]))}`);
            lines.push(`${i + 1}. ${day(r.date)} – ${String(r.desc).trim()} – ${parts.join("; ")}`);
          });
        }
        lines.push("");
        if (level !== 1 && level < 4) {
          lines.push(L("forms.expense.subtotals") + ":");
          for (const c of this.cfg.columns || []) {
            if (c.kind === "miles" || !this.colTotal(c)) continue;
            lines.push(`  ${c.code} ${this.colLabel(c)}: ${money(this.colTotal(c))}`);
          }
        }
        lines.push(`${L("forms.expense.grand_total")}: ${money(this.grand())}`);
        if (this.anyLate()) lines.push("", tr("forms.js.mail_late"));
        lines.push("", L("forms.js.exp_attach"));
        if (level >= 2) lines.push(L("forms.js.mail_short"));
        lines.push("", tr("forms.js.mail_footer", { url: location.origin + location.pathname }));
        return crlf(lines).replace(/(\r\n){3,}/g, "\r\n\r\n");
      },
    };
    c.f = c.blank(); // the fields exist before Alpine renders; init() then brings back a saved draft
    return c;
  }

  /* ------------------------------------------------------------ Annual Budget Request */
  function budget() {
    const c = {
      ...base("budget"),
      watchingPick: false,
      langAuto: false, // the English / Spanish chair was set by the committee's language, not by the visitor

      blank() {
        const items = {};
        for (const it of this.cfg.items || []) {
          if (it.kind === "lines") items[it.key] = { rows: Array.from({ length: Math.max(1, it.rows || 1) }, () => this.line()) };
          else if (it.kind === "mileage") items[it.key] = { miles: "" };
          else items[it.key] = { amt: "" };
        }
        return { date: today(), year: String(this.cfg.year || ""), name: "", phone: "", email: "", lang: "", pick: "", items };
      },
      line() {
        return { id: uid(), desc: "", amt: "" };
      },
      prepare() {
        // a committee designated in one language only has its chair in that language
        if (!this.watchingPick) {
          this.watchingPick = true;
          this.$watch("f.pick", () => this.fixLang());
        }
        this.fixLang();
      },
      group() {
        const g = (this.cfg.groups || []).find((x) => x.items.some((i) => i.key === this.f.pick));
        if (g) return g.key;
        return (this.cfg.officers || []).some((o) => o.key === this.f.pick) ? "officer" : "";
      },
      // set for a committee designated in one language; cleared again when the visitor then picks a committee
      // designated in both (so it is asked, not assumed) or an officer
      fixLang() {
        const g = this.group();
        if (g === "english" || g === "spanish") {
          this.f.lang = g === "english" ? "en" : "es";
          this.langAuto = true;
        } else if (g === "officer" || (g === "both" && this.langAuto)) {
          this.f.lang = "";
          this.langAuto = false;
        }
      },
      pickText() {
        const g = this.group();
        if (!g) return "";
        const list = g === "officer" ? this.cfg.officers : ((this.cfg.groups || []).find((x) => x.key === g) || {}).items;
        const o = (list || []).find((x) => x.key === this.f.pick) || {};
        const name = (M.lang === "es" ? o.label_es : "") || o.label_en || this.f.pick;
        if (g === "officer") return `${tr("forms.budget.officer")} ${name}`;
        const chair = this.f.lang ? ` (${tr(this.f.lang === "es" ? "forms.budget.chair_es" : "forms.budget.chair_en")})` : "";
        return `${name}${chair}`;
      },
      item(key) {
        return (this.cfg.items || []).find((i) => i.key === key) || {};
      },
      itemLabel(it) {
        return (M.lang === "es" ? it.label_es : "") || it.label_en || it.key;
      },
      itemTotal(it) {
        const v = this.f.items[it.key];
        if (!v) return 0;
        if (it.kind === "lines") return v.rows.reduce((s, r) => s + this.cents(r.amt), 0);
        if (it.kind === "mileage") return this.mileage(v.miles);
        return this.cents(v.amt);
      },
      total() {
        return (this.cfg.items || []).reduce((s, it) => s + this.itemTotal(it), 0);
      },
      used() {
        const f = this.f;
        return !!(f.name || f.email || f.phone || f.pick || this.total());
      },
      deadlinePassed() {
        return !!this.cfg.deadline && today() > this.cfg.deadline;
      },
      addLine(key) {
        const v = this.f.items[key];
        if (!v || v.rows.length >= MAX_ROWS) return;
        const r = this.line();
        v.rows.push(r);
        M.announce && M.announce(tr("forms.js.line_added", { n: v.rows.length }));
        this.$nextTick(() => {
          const el = document.getElementById("ff-" + key + "-" + r.id + "-desc");
          if (el) el.focus();
        });
      },
      removeLine(key, i) {
        const v = this.f.items[key];
        if (!v) return;
        if (v.rows.length <= 1) v.rows.splice(0, 1, this.line());
        else v.rows.splice(i, 1);
        M.announce && M.announce(tr("forms.js.line_removed"));
        this.$nextTick(() => {
          const r = v.rows[Math.max(0, i - 1)];
          const el = (r && document.getElementById("ff-" + key + "-" + r.id + "-desc")) || document.getElementById("ff-" + key + "-add");
          if (el) el.focus();
        });
      },
      // the printed copy: the lines in use (at least one, empty, per item), then empty lines up to the paper
      // form's count (paper_rows in data/finance-forms.csv) while they fit on the page
      usedLines(key) {
        const v = this.f.items[key];
        return v ? v.rows.filter((r) => String(r.desc).trim() || String(r.amt).trim()) : [];
      },
      printLines(key) {
        const rows = this.usedLines(key).map((r) => ({ ...r, blank: false }));
        if (!rows.length) rows.push({ id: "empty", desc: "", amt: "", blank: false });
        // the room for empty lines is shared out in the paper form's order
        let room = this.room;
        let pad = 0;
        for (const it of this.cfg.items || []) {
          if (it.kind !== "lines") continue;
          const give = Math.min(Math.max(0, (it.paper_rows || 0) - Math.max(1, this.usedLines(it.key).length)), room);
          if (it.key === key) pad = give;
          room -= give;
        }
        for (let i = 0; i < pad; i++) rows.push({ id: "pad" + i, desc: "", amt: "", blank: true });
        return rows;
      },

      validate() {
        const f = this.f;
        const out = [];
        const add = (key, id, text) => out.push({ key, id, text });
        if (!isIso(f.date)) add("date", "ff-date", tr("forms.js.e_date"));
        if (!/^20\d{2}$/.test(String(f.year).trim())) add("year", "ff-year", tr("forms.js.e_year"));
        if (!f.name.trim()) add("name", "ff-name", tr("forms.js.e_name"));
        if (!f.phone.trim() && !f.email.trim()) add("phone", "ff-phone", tr("forms.js.e_contact"));
        if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) add("email", "ff-email", tr("forms.js.e_email"));
        const firstPick = (((this.cfg.groups || [])[0] || {}).items || [])[0];
        if (!f.pick) add("pick", "ff-pick-" + (firstPick ? firstPick.key : ""), tr("forms.js.e_pick"));
        else if (this.group() === "both" && !f.lang) add("lang", "ff-lang-en", tr("forms.js.e_lang"));
        for (const it of this.cfg.items || []) {
          const v = f.items[it.key];
          const name = this.itemLabel(it);
          if (it.kind === "lines") {
            v.rows.forEach((r, i) => {
              const id = (k) => "ff-" + it.key + "-" + r.id + "-" + k;
              const key = (k) => it.key + "-" + r.id + "-" + k;
              const p = parseMoney(r.amt);
              if (!p.ok) add(key("amt"), id("amt"), tr("forms.js.e_item_money", { item: name, n: i + 1 }));
              else if (String(r.desc).trim() && p.empty) add(key("amt"), id("amt"), tr("forms.js.e_item_amt", { item: name, n: i + 1 }));
              else if (!String(r.desc).trim() && p.cents) add(key("desc"), id("desc"), tr("forms.js.e_item_desc", { item: name, n: i + 1 }));
            });
          } else if (it.kind === "mileage") {
            if (!parseMiles(v.miles).ok) add(it.key, "ff-" + it.key, tr("forms.js.e_item_miles", { item: name }));
          } else if (!parseMoney(v.amt).ok) add(it.key, "ff-" + it.key, tr("forms.js.e_item_money1", { item: name }));
        }
        if (!out.length && !this.total()) {
          const it = (this.cfg.items || [])[0] || {};
          const v = f.items[it.key];
          add("total", it.kind === "lines" && v ? "ff-" + it.key + "-" + v.rows[0].id + "-desc" : "ff-" + it.key, tr("forms.js.e_total"));
        }
        return out;
      },

      subject() {
        return tr("forms.js.bud_subject", { year: String(this.f.year).trim(), line: this.pickText().replace(/^[^:]*:\s*/, ""), total: money(this.total()) });
      },
      fileName() {
        return tr("forms.js.bud_file", { year: String(this.f.year).trim(), name: this.f.name.trim(), date: today() });
      },
      // level 0 = everything; 1 and 2 = without the description lines (they are in the PDF); 3 and 4 = also each
      // typed text cut to 80 / 30 characters
      body(level) {
        const f = this.f;
        const L = (k) => tr(k);
        const v = (s) => clip(s, CLIP[level] || 0);
        const lines = [
          tr("forms.js.bud_heading", { year: v(f.year) }),
          "",
          this.pair(L("forms.budget.date"), day(f.date, "long")),
          this.pair(L("forms.budget.year"), v(f.year)),
          this.pair(L("forms.budget.requested"), money(this.total())),
          "",
          this.pair(L("forms.contact.name"), v(f.name)),
          this.pair(L("forms.budget.phone"), v(f.phone)),
          this.pair(L("forms.contact.email"), v(f.email)),
          this.pair(L("forms.budget.line_title"), this.pickText()),
          "",
          L("forms.budget.items_title") + ":",
        ];
        for (const it of this.cfg.items || []) {
          const v = f.items[it.key];
          const tot = this.itemTotal(it);
          let line = `(${it.code}) ${this.itemLabel(it)}: ${money(tot)}`;
          if (it.kind === "mileage" && this.miles(v.miles)) line += ` – ${tr("forms.js.miles_at", { miles: num(this.miles(v.miles)), total: money(tot) })}`;
          lines.push(line);
          if (it.kind === "lines" && !level) {
            v.rows.forEach((r) => {
              if (String(r.desc).trim() || this.cents(r.amt)) lines.push(`    – ${String(r.desc).trim()}: ${money(this.cents(r.amt))}`);
            });
          }
        }
        lines.push(`${L("forms.budget.total_all")}: ${money(this.total())}`);
        if (this.deadlinePassed()) lines.push("", tr("forms.js.mail_after_deadline", { date: day(this.cfg.deadline, "long") }));
        lines.push("", L("forms.js.bud_attach"));
        if (level) lines.push(L("forms.js.mail_short"));
        lines.push("", tr("forms.js.mail_footer", { url: location.origin + location.pathname }));
        return crlf(lines).replace(/(\r\n){3,}/g, "\r\n\r\n");
      },
    };
    c.f = c.blank();
    return c;
  }

  document.addEventListener("alpine:init", () => {
    window.Alpine.data("ffExpense", expense);
    window.Alpine.data("ffBudget", budget);
  });
})();

/*
  MSearch — the one way every search box on the site matches text (loaded on every page before the page scripts;
  the build imports the same file, so text prepared at build time and the visitor's query are folded alike).

    MSearch.fold(s)              lower case, no accents, straight apostrophes, "A.A." → "aa", "2,000" → "2000",
                                 "H&I" → "hi", "&" → "and", "Coordinador(a)" → "coordinador"
    MSearch.index(...parts)      a search string (" word word … ") for one item: every word, the words of hyphenated or
                                 run-together names both ways ("pre-conference" → "pre conference preconference"),
                                 district numbers as "dN" ("District 05", "Distrito 5", "D5", "d01-03" → d1 d3),
                                 masculine forms of Spanish titles ("Tesorera" → tesorero), the other language's word
                                 for common service terms (actas ↔ minutes, presupuesto ↔ budget …), and e-mail addresses
    MSearch.query(q)             a parsed query: { terms: [[variant, …], …], emails: [...], empty }
    MSearch.test(hay, query)     true when every term is found at the start of a word of `hay` (an e-mail at the start
                                 of an address); 1–2 digit numbers and "dN" must match whole ("5" never finds 15 or 25)
    MSearch.score(hay, query)    how well it matches (whole words count more) — for sorting results
    MSearch.match(hay, q)        test() with a query string

  A query word may be the start of a word ("treas" finds Treasurer), a plural ("budgets" finds Budget), a feminine
  Spanish title ("Tesorera" finds Tesorero(a)), or written with or without accents, hyphens, dots or apostrophes.
  Words like "and", "y", "de", "the" are ignored when the query has other words.
*/
(function (root) {
  "use strict";

  const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;
  const STOP = new Set("and y e the of de del la el los las en in a an al for para por to con with or o".split(" "));

  // Spanish titles: feminine → masculine (both the text and the query use the masculine form)
  const FEM = {
    tesorera: "tesorero", tesoreras: "tesoreros", secretaria: "secretario", secretarias: "secretarios",
    coordinadora: "coordinador", coordinadoras: "coordinadores", delegada: "delegado", delegadas: "delegados",
    registradora: "registrador", registradoras: "registradores", editora: "editor", editoras: "editores",
    servidora: "servidor", servidoras: "servidores", alterna: "alterno", alternas: "alternos", electa: "electo",
    presidenta: "presidente", archivista: "archivista", miembra: "miembro", custodia: "custodio", fundadora: "fundador",
    nueva: "nuevo", nuevas: "nuevos", pasada: "pasado", pasadas: "pasados", encargada: "encargado", oradora: "orador",
    representanta: "representante", suplenta: "suplente", traductora: "traductor", interprete: "interprete",
  };

  // English ↔ Spanish (and short ↔ long) names for the same thing. Each group is a list of phrases; when the text has
  // one of them, the words of all the others are added to its search string.
  const GROUPS = [
    ["hi", "hei", "hospitals and institutions", "hospitales e instituciones", "hospitales y instituciones"],
    ["gso", "general service office", "osg", "oficina de servicios generales"],
    ["gsr", "general service representative", "rsg", "representante de servicios generales"],
    ["dcm", "district committee member", "mcd", "miembro de comite de distrito"],
    ["dcmc", "district committee member chair", "cmcd", "coordinador de miembros de comite de distrito"],
    ["cpc", "cooperation with the professional community", "ccp", "cooperacion con la comunidad profesional"],
    ["cec", "cooperation with the elder community", "cooperation with the elderly community", "tercera edad", "adultos mayores"],
    ["pi", "public information", "ip", "informacion publica"],
    ["ypaa", "young people", "jovenes"],
    ["guidelines and policies", "guias y politicas"], // not "gap" alone: "Bridging the Gap"
    ["asc", "area service committee", "csa", "comite de servicio de area"],
    ["asa", "assembly", "asamblea"],
    ["gsc", "general service conference", "csg", "conferencia de servicios generales"],
    ["gsb", "general service board", "junta de servicios generales"],
    ["aa", "alcoholics anonymous", "alcoholicos anonimos"],
    ["aaws", "aa world services", "aa world services inc"],
    ["alanon", "al anon"],
    ["praasa", "pacific region alcoholics anonymous service assembly"],
    ["socal", "so cal", "southern california", "sur de california"],
    ["ap", "accounts payable", "cuentas por pagar"],
    ["ar", "accounts receivable", "cuentas por cobrar"],
    ["7th", "seventh", "septima", "7a"],
    ["12th", "twelfth", "duodecimo"],
    ["online", "virtual", "zoom", "en linea"],
    ["in person", "en persona"],
    ["hybrid", "hibrido", "hibrida"],
    ["spanish", "espanol", "hispano", "hispana", "hispanic", "hispanohablante", "habla hispana"],
    ["english", "ingles"],
    ["bilingual", "bilingue"],
    ["minutes", "actas", "minutas"],
    ["agenda", "agendas", "orden del dia"],
    ["budget", "presupuesto"],
    ["treasurer", "tesorero"],
    ["secretary", "secretario"],
    ["chair", "chairperson", "coordinador"],
    ["alternate", "alterno", "suplente"],
    ["delegate", "delegado"],
    ["registrar", "registrador"],
    ["webmaster", "web servant", "servidor web"],
    ["archivist", "archivista"],
    ["committee", "comite"],
    ["subcommittee", "subcomite"],
    ["standing committees", "comites permanentes"],
    ["workshop", "taller"],
    ["meeting", "reunion", "junta"],
    ["district", "distrito"],
    ["report", "informe", "reporte"],
    ["guidelines", "guias"],
    ["bylaws", "estatutos"],
    ["motion", "mocion"],
    ["newsletter", "boletin", "noticiero"],
    ["flyer", "volante"],
    ["calendar", "calendario"],
    ["literature", "literatura"],
    ["archives", "archivos", "archivos historicos"],
    ["corrections", "correccionales", "instituciones correccionales"],
    ["treatment", "tratamiento", "centros de tratamiento"],
    ["accessibilities", "accessibility", "accesibilidad", "accesibilidades"],
    ["intergroup", "intergrupo", "oficina intergrupal"],
    ["central office", "oficina central"],
    ["finance", "finances", "finanzas"],
    ["technology", "tecnologia"],
    ["translation", "traduccion"],
    ["interpreter", "interprete"],
    ["history", "historia"],
    ["group", "grupo"],
    ["birthday", "aniversario"],
    ["contribution", "contributions", "contribucion", "contribuciones"],
    ["open position", "vacante", "puesto vacante", "help wanted", "se necesita ayuda", "open seat"],
    ["forum", "foro"],
    ["servathon", "servaton"],
    ["preconference", "pre conference", "preconferencia"],
    ["convention", "convencion"],
    ["service", "servicio", "servicios"],
    ["steps", "pasos"],
    ["traditions", "tradiciones"],
    ["concepts", "conceptos"],
  ].map((g) => g.map((p) => p.split(" ")));
  // the same names, ready to look up (" public information " in the text, "publicinformation" run together)
  const PHRASES = GROUPS.map((g) => g.map((p) => ({ p, sp: " " + p.join(" ") + " ", j: p.join("") })));

  const fold = (s) =>
    String(s == null ? "" : s)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[‘’‚‛ʼ`´′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐-―−­]/g, "-")
      .replace(/(\d),(?=\d{3}\b)/g, "$1") // 2,000 → 2000
      .replace(/\b(?:[a-z]\.)+[a-z]\b\.?/g, (m) => m.replace(/\./g, "")) // a.a. / a.a / g.s.o. → aa / gso
      .replace(/\(\s*(?:a|as|o|os)\s*\)/g, "") // coordinador(a)
      .replace(/\b([a-z])\s*&\s*([a-z])\b/g, "$1$2") // h&i → hi
      .replace(/\b([a-z])\/([a-z])\b/g, "$1$2") // a/p → ap
      .replace(/&/g, " and ")
      .replace(/\b([a-z]|\d+)'s\b/g, "$1") // "F's", "9's" → f, 9
      .replace(/'/g, "")
      .replace(/\s+/g, " ")
      .replace(/\b([a-z]) (?:and|y|e) ([a-z])\b/g, "$1$2") // "H and I", "H y I" → hi
      .trim();

  // "District 5", "Distrito 05", "Dist. 5", "Dto 5", "D5", "D-5", "d01-03", "District 1 & 3",
  // "Districts 1, 4, and 12" → d5 / d1 d3 / d1 d4 d12
  // A list continues with a tight "-" or "/", a comma, or "and"/"y" — not a spaced dash ("Distrito 8 – 20 de diciembre"
  // is District 8). "Districts 1-12" (plural) is a range; "District 1-3" is the one district 1 & 3.
  const DIST = /\b(?:districts?|distritos?|dist|dto|d)\s*[.#-]?\s*0*(\d{1,2})\b((?:(?:-|\/|\s*,\s*(?:(?:and|y)\s+)?|\s+(?:and|y)\s+)0*\d{1,2}\b)*)/g;
  const distNums = (m, a, tail) => {
    const plural = /^(?:districts|distritos)\b/.test(m);
    const out = [Number(a)];
    (tail || "").replace(/(-|\/|,|and|y)\s*0*(\d{1,2})/g, (x, sep, n) => {
      const prev = out[out.length - 1];
      n = Number(n);
      if (sep === "-" && plural && n > prev && n - prev <= 30) for (let i = prev + 1; i <= n; i++) out.push(i);
      else out.push(n);
      return x;
    });
    return out;
  };
  const districts = (f) => {
    const out = [];
    f.replace(DIST, (m, a, tail) => (distNums(m, a, tail).forEach((n) => out.push("d" + n)), m));
    return out;
  };

  // words of a folded text; a word that mixes letters and digits also gives its parts ("d05dcmc" → d 05 dcmc)
  const words = (f) => {
    const out = [];
    for (const w of f.split(/[^a-z0-9]+/)) {
      if (!w) continue;
      out.push(w);
      if (/[a-z]/.test(w) && /\d/.test(w)) for (const p of w.match(/[a-z]+|\d+/g)) out.push(p);
    }
    return out;
  };
  const noZero = (w) => (/^\d+$/.test(w) ? String(Number(w)) : w);

  // web addresses ("msca09aa.org", "https://www.aa.org/…") are kept as their name only, so "09" or "aa" in the Area's
  // own domain do not end up in every row that shows an Area e-mail address
  // own domain do not end up in every row that shows an Area e-mail address; the name with its ending ("aaorg") is what a
  // typed address matches, so "aa.org" finds the aa.org links and not every card that says A.A.
  const WEB = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.(org|com|net|edu|gov|info|us|io)\b(?:\/[^\s]*)?/g;

  function index() {
    const raw = Array.prototype.slice.call(arguments).flat(Infinity).filter((x) => x != null && x !== "").join(" • ");
    // a possessive also gives its word ("Secretary's" → secretarys secretary)
    const f = fold(raw.replace(/([A-Za-zÀ-ÿ]{2,})['’]s\b/g, "$1's $1"));
    const set = new Set();
    const add = (w) => w && set.add(w);
    // e-mail addresses: whole (for "chair@…" queries), their own part as words and run together
    // ("d05dcmc" → d05dcmc d 05 dcmc d5; "pichair-es" → pichair es pichaires), and the domain's name ("msca09aa")
    for (const e of f.match(EMAIL) || []) {
      add(e);
      const [local, domain] = e.split("@");
      words(local).forEach((w) => (add(w), add(noZero(w))));
      add(local.replace(/[^a-z0-9]/g, ""));
      const dn = domain.split(".");
      add(dn[0].replace(/-/g, ""));
      add(dn.join("").replace(/-/g, ""));
      const dm = local.match(/^d0*(\d{1,2})(?=[a-z])/);
      if (dm) add("d" + Number(dm[1]));
    }
    const body = f.replace(EMAIL, " ").replace(WEB, (m, name, tld) => {
      add(name.replace(/-/g, ""));
      add(name.replace(/-/g, "") + tld);
      name.split("-").forEach(add);
      return " ";
    });
    words(body).forEach((w) => {
      add(w);
      add(noZero(w));
      if (FEM[w]) add(FEM[w]);
    });
    // hyphenated / slashed / dotted names and the first 80 word pairs, run together
    // ("pre-conference" → preconference, "76-7" → 767, "1975.04.13" → 19750413, "La Quinta" → laquinta)
    body.replace(/[a-z0-9]+(?:[-/.][a-z0-9]+)+/g, (m) => add(m.replace(/[-/.]/g, "")));
    const flat = body.split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i < Math.min(flat.length - 1, 80); i++) if (flat[i].length + flat[i + 1].length <= 24) add(flat[i] + flat[i + 1]);
    districts(body).forEach(add);
    // the other names of the same thing: one-word names as words, longer names run together ("publicinformation"),
    // so "PI" adds "public information" without making every DCMC row match "committee" or "member"
    const text = " " + flat.join(" ") + " ";
    // (a plural in the text counts too: "Budgets" also gives "presupuesto")
    const sing = new Set();
    for (const w of flat) for (const s of singulars(w)) sing.add(s);
    const present = (x) => (x.p.length === 1 ? set.has(x.j) || sing.has(x.j) : text.includes(x.sp) || set.has(x.j));
    for (const g of PHRASES) if (g.some(present)) g.forEach((x) => add(x.j));
    return " " + Array.from(set).join(" ") + " ";
  }

  // singular forms of a plural query word ("budgets" → budget, "talleres" → taller; never "notes" → not)
  function singulars(w) {
    const v = [];
    if (w.length >= 4 && /[^s]s$/.test(w)) {
      v.push(w.slice(0, -1));
      if (/ies$/.test(w) && w.length >= 5) v.push(w.slice(0, -3) + "y"); // assemblies → assembly
      const stem = w.slice(0, -2);
      if (/es$/.test(w) && stem.length >= 4 && /(?:[lrndszxj]|ch|sh)$/.test(stem)) v.push(stem);
    }
    return v.map((x) => FEM[x] || x);
  }

  function query(q) {
    const raw = String(q == null ? "" : q);
    const typing = !/[\s.,;:!?)]$/.test(raw); // the last word may still be being typed ("Ryan W." is finished)
    // what the visitor typed as an acronym: "H&I", "A/P", "H and I", or two capital letters ("PI", "AR")
    const acro = new Set();
    raw.replace(/\b([a-z])\s*(?:&|\/|\band\b|\by\b|\be\b)\s*([a-z])\b/gi, (m, a, b) => (acro.add((a + b).toLowerCase()), m));
    (raw.match(/\b[A-Z]{2}\b/g) || []).forEach((w) => acro.add(w.toLowerCase()));
    const f = fold(raw.replace(/\bmailto:/gi, " "));
    // a whole address is matched from the start of an address ("chair@…" is not "archiveschair@…");
    // a part of one ("webmaster@", "dcmc@") anywhere in an address
    const emails = f.match(EMAIL) || [];
    let rest = f.replace(EMAIL, " ");
    const partial = rest.match(/[a-z0-9._%+-]+@[a-z0-9.-]*/g) || [];
    rest = rest.replace(/[a-z0-9._%+-]+@[a-z0-9.-]*/g, " ");
    const terms = [];
    // a web address or "@domain", as the text keeps it: its name ("asbco.org" → asbco, "@msca09aa.org" → msca09aa)
    rest = rest.replace(WEB, (m, name, tld) => (terms.push({ v: [name.replace(/-/g, "") + tld], whole: true }), " "));
    // "District 5" → d5; "district 5, 6" or "1 & 3" → either; "districts 20-25" → any of 20 … 25
    rest = rest.replace(DIST, (m, a, tail) => (terms.push({ v: distNums(m, a, tail).map((x) => "d" + x), whole: true }), " "));
    // the typed word is a word start; its singular forms only count as whole words ("treas" is not "trea…tment")
    const term = (w, last) => {
      if (/^\d+$/.test(w)) return { v: [noZero(w)], whole: w.length <= 2 };
      const t = { v: [FEM[w] || w], vw: singulars(w), whole: w.length <= 2 && (acro.has(w) || !(last && typing)) };
      // "10am", "7th", "d05dcmc": also accepted as their parts ("10:00 AM")
      if (/[a-z]/.test(w) && /\d/.test(w)) t.parts = w.match(/[a-z]+|\d+/g).map((p) => term(p, false));
      return t;
    };
    // hyphenated / slashed / dotted words. Letters only ("al-anon", "pre-conference"): the whole word run together —
    // the text's "Al-Anon", "Al Anon" and "Alanon" all index as "alanon", and "al anonimato" must not count.
    // With digits ("76-7", "2026-10-11"): run together, or all the parts.
    rest = rest.replace(/[a-z0-9]+(?:[-/.][a-z0-9]+)+/g, (m) => {
      const joined = m.replace(/[-/.]/g, "");
      if (!/\d/.test(m)) terms.push({ v: ["", "s", "es", "ing", "ed"].map((e) => joined + e), whole: true });
      else terms.push({ v: [joined], whole: false, parts: m.split(/[-/.]/).filter(Boolean).map((p) => term(p, false)) });
      return " ";
    });
    // a longer name from the list of other names ("public information", "orden del dia"): any of its names
    rest = " " + rest.split(/[^a-z0-9]+/).filter(Boolean).join(" ") + " ";
    for (const g of PHRASES) {
      for (const x of g) {
        if (x.p.length < 2 || !rest.includes(x.sp)) continue;
        rest = rest.replace(x.sp, " ");
        // …or its own words, when it has two or more real words ("comites permanentes"; not "al anon" → anon…)
        const own = x.p.filter((w) => !STOP.has(w));
        terms.push({ v: g.map((y) => y.j), whole: true, parts: own.length >= 2 ? own.map((w) => term(w, false)) : undefined });
        break;
      }
    }
    let ws = rest.split(" ").filter(Boolean);
    const content = ws.filter((w) => !STOP.has(w));
    if (content.length || terms.length) {
      // a label letter after a word ("Motion A", "Plan B") stays, run together with that word
      const n = ws.length;
      if (n >= 2 && /^[a-z]$/.test(ws[n - 1]) && STOP.has(ws[n - 1]) && !STOP.has(ws[n - 2])) {
        const [w, l] = ws.splice(n - 2, 2);
        terms.push({ v: [w + l], whole: false, parts: [term(w, false), { v: [l], whole: true }] });
      }
      ws = ws.filter((w) => !STOP.has(w));
    }
    ws.forEach((w, i) => terms.push(term(w, i === ws.length - 1)));
    return { terms, emails, partial, empty: !terms.length && !emails.length && !partial.length };
  }

  const one = (hay, v, whole) => (whole ? hay.includes(" " + v + " ") : hay.includes(" " + v));
  function hit(hay, t) {
    return (
      t.v.some((v) => one(hay, v, t.whole)) ||
      (!!t.vw && t.vw.some((v) => one(hay, v, true))) ||
      (!!t.parts && t.parts.every((p) => hit(hay, p)))
    );
  }

  function test(hay, qr) {
    if (!qr || qr.empty) return true;
    hay = hay || " ";
    return (
      qr.terms.every((t) => hit(hay, t)) &&
      qr.emails.every((e) => hay.includes(" " + e)) &&
      (qr.partial || []).every((p) => hay.includes(p)) // only addresses contain an @
    );
  }

  // whole words count 3, word starts 1 — e.g. score the title's index first, then the rest
  function score(hay, qr) {
    if (!qr || qr.empty || !hay) return 0;
    let s = 0;
    for (const t of qr.terms) {
      if (t.v.concat(t.vw || []).some((v) => one(hay, v, true))) s += 3;
      else if (hit(hay, t)) s += 1;
    }
    for (const e of qr.emails) if (hay.includes(" " + e)) s += 3;
    return s;
  }

  const api = { fold, index, query, test, score, match: (hay, q) => test(hay, query(q)) };
  root.MSearch = api;
})(typeof window !== "undefined" ? window : globalThis);

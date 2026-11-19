// Tests the site search (Pagefind) on the built site — npm run test:site-search, after `npm run build`.
//
//   node scripts/test-site-search.mjs [site folder, default _site]
//
// Searches the built index in Node the way the search box does (src/assets/js/app.js: the same RANKING, read from
// that file; on Spanish pages the small index of the Delegate's Corner posts is searched too), then checks:
//   - the cases below: the page a visitor should find first (or within the first few) for the words they type
//   - every hub page (district, committee, documents …: the pages with meta "name", base.njk) comes within the first
//     3 results for its own name
// Run it before and after changing RANKING, the search.kw.* rows of data/text/common.csv or the search attributes of
// <main> in base.njk. A failing case prints the first results, so you can see what came before the page.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SITE = path.resolve(process.argv[2] || "_site");
if (!fs.existsSync(path.join(SITE, "pagefind", "pagefind.js"))) {
  console.error(`No search index in ${SITE}/pagefind: run npm run build first.`);
  process.exit(1);
}

// [language, what a visitor types, the page it should find, within the first n results (default 1)]
const CASES = [
  ["en", "MSCA 09", "/"],
  ["es", "MSCA 09", "/es/"],
  ["en", "delegate", "/service/delegate/"],
  ["en", "district 9", "/districts/d09/"],
  ["en", "district 22", "/districts/d22/"],
  ["en", "D05", "/districts/d05/"],
  ["en", "zelle", "/contribute/"],
  ["en", "contribute", "/contribute/"],
  ["en", "seventh tradition", "/contribute/"],
  ["en", "minutes", "/documents/minutes/"],
  ["en", "expense form", "/service/forms/expense/", 2],
  ["en", "budget form", "/service/forms/budget/", 2],
  ["en", "report form", "/service/reports/"],
  ["en", "newcomers", "/newcomers/"],
  ["en", "find a meeting", "/newcomers/"],
  ["en", "contact", "/contact/"],
  ["en", "trusted servants", "/about/panel/"],
  ["en", "committees", "/committees/"],
  ["en", "resources", "/resources/"],
  ["es", "delegado", "/es/service/delegate/"],
  ["es", "distrito 9", "/es/districts/d09/"],
  ["es", "distrito 22", "/es/districts/d22/"],
  ["es", "zelle", "/es/contribute/"],
  ["es", "contribuir", "/es/contribute/"],
  ["es", "actas", "/es/documents/minutes/", 2],
  ["es", "formulario de gastos", "/es/service/forms/expense/", 2],
  ["es", "recién llegados", "/es/newcomers/"],
];

// The search box's ranking, as written in app.js (a plain object literal)
const appJs = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "js", "app.js"), "utf8");
const lit = /const RANKING = (\{[^;]*\});/.exec(appJs);
if (!lit) throw new Error("RANKING not found in src/assets/js/app.js");
const RANKING = Function(`return (${lit[1]});`)();

// pagefind.js is written for browsers: let it read the index files from disk, and tell it the language
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const u = String(input && input.url ? input.url : input);
  if (!u.startsWith("file:")) return realFetch(input);
  try {
    return new Response(fs.readFileSync(fileURLToPath(u.split("?")[0])), { status: 200 });
  } catch {
    return new Response("", { status: 404 });
  }
};
let lang = "en";
globalThis.document = { currentScript: null, querySelector: () => ({ getAttribute: () => lang }) };

// every hub page's own name: data-search-name is "name · other ways to write it"; the visitor types the name
const hubs = [];
const walk = (dir, rel = "") => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!rel && /^pagefind/.test(e.name)) continue;
      walk(path.join(dir, e.name), r);
    } else if (e.name === "index.html") {
      const main = /<main\b[^>]*>/.exec(fs.readFileSync(path.join(dir, e.name), "utf8"));
      const name = main && /\sdata-search-name="([^"]*)"/.exec(main[0]);
      const title = main && /\sdata-search-title="([^"]*)"/.exec(main[0]);
      if (name && title) {
        const q = title[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        const url = "/" + r.replace(/index\.html$/, "");
        hubs.push([url.startsWith("/es/") ? "es" : "en", q, url, 3]);
      }
    }
  }
};
walk(SITE);

let fail = 0;
let n = 0;
for (const code of ["en", "es"]) {
  lang = code;
  // a new copy of the module for each language (it keeps one index open)
  const pf = await import(`${pathToFileURL(path.join(SITE, "pagefind", "pagefind.js")).href}?lang=${code}`);
  await pf.options({ ranking: RANKING, baseUrl: "/" });
  if (code === "es" && fs.existsSync(path.join(SITE, "pagefind-posts", "pagefind-entry.json")))
    await pf.mergeIndex(`${pathToFileURL(path.join(SITE, "pagefind-posts")).href}/`, { language: "en", ranking: RANKING, baseUrl: "/" });
  for (const [l, q, url, within = 1] of [...CASES, ...hubs]) {
    if (l !== code) continue;
    n++;
    const res = await pf.search(q);
    const top = [];
    for (const r of res.results.slice(0, Math.max(within, 5))) top.push((await r.data()).url);
    const at = top.indexOf(url) + 1;
    if (!at || at > within) {
      fail++;
      console.log(`FAIL  ${l} ${JSON.stringify(q)}: ${url} ${at ? `is result ${at}` : "is not in the first 5"} (want ${within === 1 ? "first" : `within ${within}`})\n      first: ${top.join("  ")}`);
    }
  }
  await pf.destroy();
}
console.log(`${n - fail}/${n} passed (${CASES.length} cases, ${hubs.length} hub pages found by their own name)`);
process.exit(fail ? 1 : 0);

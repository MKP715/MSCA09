// Builds the site search (Pagefind) for the built site — what `npm run build:search` runs.
//
//   node scripts/build-search.mjs [site folder, default _site]
//
// Two indexes, as before:
//   <site>/pagefind/        every page (pages mark their searchable part with data-pagefind-body)
//   <site>/pagefind-posts/  the Spanish copies of the Delegate's Corner posts, indexed as English text (their own
//                           language), searched alongside the Spanish index (see src/assets/js/app.js)
//
// Pagefind reads the text of elements that touch each other as one word ("Actas" + "11" → "actas11",
// "2012" + "35 documents" → "201235"), so each page is indexed with a space between neighbouring tags. The pages on
// disk are not changed; the space only exists in what Pagefind reads. <wbr> (a break chance inside an e-mail address
// or a long word) is left alone.
import fs from "node:fs";
import path from "node:path";
import * as pagefind from "pagefind";

const SITE = process.argv[2] || "_site";
const POSTS = /^es\/service\/delegate\/posts\/.+\.html$/;

const spaced = (html) =>
  html
    .replace(/>(?=<)/g, "> ") // two tags side by side
    .replace(/([^\s>])(?=<(?!wbr\b)[a-z])/gi, "$1 ") // text, then an opening tag
    .replace(/(<\/[a-z][a-z0-9-]*>|<br\s*\/?>)(?=[^\s<])/gi, "$1 "); // a closing tag or <br>, then text

function* pages(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (!rel && /^pagefind/.test(e.name)) continue; // earlier indexes
      yield* pages(path.join(dir, e.name), r);
    } else if (e.name.endsWith(".html")) yield r;
  }
}

async function build(files, outputPath, config) {
  const { errors, index } = await pagefind.createIndex(config);
  if (!index) throw new Error(errors.join("\n"));
  let n = 0;
  for (const rel of files) {
    const res = await index.addHTMLFile({ sourcePath: rel, content: spaced(fs.readFileSync(path.join(SITE, rel), "utf8")) });
    if (res.errors.length) console.warn(`[search] ${rel}: ${res.errors.join("; ")}`);
    else n++;
  }
  fs.rmSync(outputPath, { recursive: true, force: true });
  const out = await index.writeFiles({ outputPath });
  if (out.errors.length) throw new Error(out.errors.join("\n"));
  return n;
}

const all = [...pages(SITE)];
const main = await build(all, path.join(SITE, "pagefind"), {});
const posts = await build(all.filter((r) => POSTS.test(r)), path.join(SITE, "pagefind-posts"), { rootSelector: "main", forceLanguage: "en" });
await pagefind.close();
console.log(`[search] ${all.length} pages read; ${main} indexed in ${SITE}/pagefind, ${posts} posts in ${SITE}/pagefind-posts`);

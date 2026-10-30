// Gives the site's stylesheet and scripts an address that changes only when the file does — the last step
// of `npm run build`.
//
//   node scripts/asset-hash.mjs [site folder, default _site]
//
// base.njk links /assets/css/site.css, /assets/js/*.js and the libraries in /assets/vendor/ (Alpine, and the styles
// and scripts pages ask for in their front matter) with "?v=<build time>", so a browser never keeps an
// old copy after a deploy. The site is rebuilt every 3 hours even when nothing changed, and the build time would
// give every file a new address each time. This step swaps the build time in the built pages for the first 8
// characters of the file's SHA-1 ("?v=3f9a0c1d"), so an unchanged file keeps its address. That is all it keeps:
// GitHub Pages stamps every file with the deploy time (Last-Modified, ETag), so after each deploy a returning
// browser downloads even an unchanged file again once its 10-minute cache has run out (so deploy.yml does not
// publish a scheduled build that is identical to the last one). A local `npm start` keeps the build time; nothing
// to do there. The installed app's service worker keeps such files for good (scripts/sw-template.js), after checking
// each one against the hash in its address.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SITE = process.argv[2] || "_site";

// asset path (as linked, after "/assets/") -> short hash of its content
const hashes = {};
const add = (rel) => {
  const file = path.join(SITE, "assets", rel);
  if (fs.existsSync(file)) hashes[rel] = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
};
add("css/site.css");
const jsDir = path.join(SITE, "assets", "js");
if (fs.existsSync(jsDir)) for (const f of fs.readdirSync(jsDir)) if (f.endsWith(".js")) add(`js/${f}`);
// the libraries, at any depth (vendor/leaflet/leaflet.css …)
const vendorFiles = (dir, rel) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? vendorFiles(path.join(dir, e.name), `${rel}${e.name}/`) : /\.(m?js|css)$/.test(e.name) ? [`${rel}${e.name}`] : [],
      )
    : [];
for (const f of vendorFiles(path.join(SITE, "assets", "vendor"), "vendor/")) add(f);

function* htmlFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}

// "/assets/js/app.js?v=1793126045775" (or "…?x=1&v=…"), with or without the site's path prefix in front. Only the
// build time (digits to the end of the value): run again on built pages, a hash that starts with digits stays as it is
const LINK = /\/assets\/(css\/site\.css|js\/[\w.-]+\.js|vendor\/[\w./-]+\.(?:m?js|css))([?&])v=\d+(?![0-9a-f])/g;
let pages = 0;
let links = 0;
for (const file of htmlFiles(SITE)) {
  const html = fs.readFileSync(file, "utf8");
  let n = 0;
  const out = html.replace(LINK, (m, rel, sep) => (hashes[rel] ? (n++, `/assets/${rel}${sep}v=${hashes[rel]}`) : m));
  if (n) {
    fs.writeFileSync(file, out);
    pages++;
    links += n;
  }
}
console.log(`[asset-hash] ${Object.keys(hashes).length} files hashed; ${links} links in ${pages} pages now use the file's hash`);

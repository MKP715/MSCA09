// /assets/data/redirects.json — what the "page not found" page (src/pages/404.njk, via
// /assets/js/redirects.js) looks up to forward an old msca09aa.org address.
// Built from data/redirects.csv and the old_url of the archived Delegate's Corner posts
// (see legacyRedirects() in eleventy.config.js).
//   exact:  { "/msca-officers/": "/about/panel/", … }   (lower case, ending in /)
//   prefix: [ ["/event/", "/calendar/"], … ]            (longest first)
//   files:  where an old /wp-content/uploads/… file sends the visitor (its name is searched there)
export default class {
  data() {
    return { permalink: "/assets/data/redirects.json", eleventyExcludeFromCollections: true };
  }
  render({ legacyRedirects }) {
    const r = legacyRedirects || { exact: {}, prefix: [] };
    const files = (r.prefix.find(([p]) => p === "/wp-content/uploads/") || [])[1] || "/documents/";
    return JSON.stringify({ exact: r.exact, prefix: r.prefix.filter(([p]) => p !== "/wp-content/uploads/"), files });
  }
}

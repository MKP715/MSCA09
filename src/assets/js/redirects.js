/*
  Old-address forwarding for the "page not found" page (src/pages/404.njk loads this file).

  GitHub Pages shows 404.html for any address that has no page. If that address belongs
  to the old msca09aa.org WordPress site, this script sends the visitor to the page that
  replaced it, using /assets/data/redirects.json (built from data/redirects.csv and the
  old Delegate's Corner posts):
    1. exact match, ignoring upper/lower case and a missing final "/"
    2. an old file (/wp-content/uploads/…/name.pdf): the document library, searching for its name
    3. the longest matching "starts with" rule (rows ending in * in data/redirects.csv)
  Works in a sub-folder (https://<user>.github.io/<repo>/) as well as on msca09aa.org.
*/
(function () {
  "use strict";

  var root = document.documentElement;
  var base = (window.MSCA && window.MSCA.base) || root.getAttribute("data-base") || "/";
  if (base.charAt(base.length - 1) !== "/") base += "/";
  var join = function (p) {
    return base.replace(/\/$/, "") + p;
  };

  var path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch (e) {}
  if (path.toLowerCase().indexOf(base.toLowerCase()) === 0) path = "/" + path.slice(base.length);
  path = path.toLowerCase().replace(/\/{2,}/g, "/");
  if (path === "/" || path === "/404.html") return;

  var candidates = [path];
  var noIndex = path.replace(/\/index\.(html?|php)$/, "/").replace(/\.html?$/, "/");
  if (noIndex !== path) candidates.push(noIndex);
  if (!/\/$/.test(path) && !/\.[a-z0-9]{2,5}$/.test(path)) candidates.push(path + "/");

  var go = function (target) {
    if (!target) return false;
    var url = join(target);
    if (url.split("#")[0].toLowerCase() === location.pathname.toLowerCase()) return false; // never loop
    try {
      document.dispatchEvent(new CustomEvent("msca:redirect", { detail: { from: path, to: url } }));
    } catch (e) {}
    location.replace(url);
    return true;
  };

  var lookup = function (map) {
    var exact = map.exact || {};
    for (var i = 0; i < candidates.length; i++) if (exact[candidates[i]]) return go(exact[candidates[i]]);

    var file = /^\/wp-content\/uploads\/.*?([^/]+?)(?:-\d+x\d+)?\.[a-z0-9]{2,5}$/.exec(path);
    if (file) {
      var name = file[1].replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
      var lib = (map.files || "/documents/").split("#")[0].split("?")[0];
      return go(lib + "?q=" + encodeURIComponent(name) + "#library");
    }

    var prefix = map.prefix || [];
    for (var j = 0; j < prefix.length; j++) {
      for (var k = 0; k < candidates.length; k++) {
        if (candidates[k].indexOf(prefix[j][0]) === 0) return go(prefix[j][1]);
      }
    }
    return false;
  };

  if (!window.fetch) return;
  fetch(join("/assets/data/redirects.json"), { credentials: "same-origin" })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (map) {
      if (map) lookup(map);
    })
    .catch(function () {});
})();

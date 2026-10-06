// Values every page gets automatically.
//  - lang: the page's language object. Pages that paginate over `langs`
//    alias it as `lang`; detail pages paginate over `{ lang, item }` entries
//    aliased as `entry`. Everything else is English.
//  - title / description: pages may give a text key (title_key, description_key)
//    from data/text/*.csv instead of a literal title.
//  - searchSkip: true keeps the page out of the site search (front matter
//    `searchExclude: true`; one-off events that are over are left out automatically).
//  - searchType: what kind of page this is, stored with the search index.
//  - altNoindex: true when the same page in the other language is kept out of search engines,
//    so base.njk and the sitemap link no language alternate (front matter `altNoindex: true`;
//    the English Delegate's Corner posts get it automatically, their Spanish copies are noindex).
//  - editSource: the file a volunteer edits to change what this page shows (footer link).
//    A page may set `source:` in its front matter ("data/faq.csv", or a folder ending in "/").
import { LANGS, t } from "../_lib/i18n.js";

const pickLang = (data) => data.lang || data.entry?.lang || LANGS[0];

// The English path of the page ("/es/districts/d05/" → "/districts/d05/").
const enPath = (data) => String(data.page?.url || "/").replace(/^\/es(\/|$)/, "/");

// A single event that has already ended: still published, but not worth finding in search.
const pastOneOff = (data) => {
  const it = data.entry?.item;
  return !!(it && /^\/events\//.test(String(it.url || "")) && !it.recurring && it.ended);
};

const TYPES = [
  [/^\/$/, "home"],
  [/^\/(calendar|events)\//, "event"],
  [/^\/districts\//, "district"],
  [/^\/committees\//, "committee"],
  [/^\/documents\//, "document"],
  [/^\/service\/delegate\/posts\//, "post"],
  [/^\/service\//, "service"],
];

// Which file holds the information on a page. "#…" anchors point into README.md.
const SOURCES = [
  [/^\/(calendar|events)\//, "README.md#adding-something-to-the-calendar"],
  [/^\/districts\//, "data/districts.csv"],
  [/^\/committees\//, "data/committees.csv"],
  [/^\/about\/panel\//, "data/trusted-servants.csv"],
  [/^\/contact\//, "data/trusted-servants.csv"],
  [/^\/about\/structure\//, "data/text/service.csv"],
  [/^\/about\//, "data/text/content.csv"],
  [/^\/documents\//, "data/documents/"],
  [/^\/service\/motions\//, "data/motions.csv"],
  [/^\/service\/delegate\/$/, "data/gsc.csv"],
  [/^\/service\//, "data/text/service.csv"],
  [/^\/resources\//, "data/resources.csv"],
  [/^\/newcomers\//, "data/central-offices.csv"],
  [/^\/contribute\//, "data/text/content.csv"],
];

export default {
  lang: (data) => pickLang(data),
  title: (data) => (data.title_key ? t(data.title_key, pickLang(data)) : data.title),
  description: (data) => (data.description_key ? t(data.description_key, pickLang(data)) : data.description),
  searchSkip: (data) => !!data.searchExclude || pastOneOff(data),
  altNoindex: (data) => {
    if (data.altNoindex) return true;
    // src/content/delegate/*.md: the Spanish copy repeats the English text and is noindex (delegate.11tydata.js)
    const input = String(data.page?.inputPath || "").replace(/\\/g, "/");
    return /(^|\/)src\/content\/delegate\/[^/]+\.md$/i.test(input) && pickLang(data).code === "en";
  },
  searchType: (data) => {
    const p = enPath(data);
    return data.searchType || (TYPES.find(([re]) => re.test(p)) || [])[1] || "page";
  },
  editSource: (data) => {
    if (data.source) return data.source;
    const input = String(data.page?.inputPath || "").replace(/^\.\//, "");
    // Pages written in Markdown (delegate posts) are edited in their own file.
    if (/\.md$/i.test(input)) return input;
    const p = enPath(data);
    return (SOURCES.find(([re]) => re.test(p)) || [])[1] || "data/";
  },
};

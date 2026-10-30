// Archived Delegate's Corner posts (2020–2023), one Markdown file each.
// Every post is published in both languages: the text stays in its original language (English)
// and the page around it follows the reader's language. URL: /service/delegate/posts/<file name>/
//
// To add a post: copy any .md file here, change the front matter (title, date, panel, author_en,
// author_es, kind, summary) and write the text below it. Members: first name + last initial only.
import path from "node:path";
import { formatDate } from "../../_lib/filters.js";

// A front matter day (`date:`, `updated:`) as written, YYYY-MM-DD (YAML reads it as midnight UTC: the UTC day is the one written).
const dayOf = (d) => {
  if (d instanceof Date) return Number.isNaN(+d) ? "" : d.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(String(d || "")) ? String(d).slice(0, 10) : "";
};
// The post's day. No date in the front matter → no day (the file's own date would be the day the site was built).
const postDay = (data) => dayOf(data.date);

export default {
  pagination: { data: "langs", size: 1, alias: "lang" },
  layout: "../partials/service-post.njk",
  tags: [],
  eyebrow_key: "service.posts.eyebrow",
  heroIcon: "newspaper",
  accent: "coral",
  bare: true,
  // the post title stays in English on /es/ pages: mark the heading lang="en" (layouts/page.njk)
  titleLang: "en",
  crumbs: [
    { label_key: "service.title", url: "/service/" },
    { label_key: "service.delegate.title", url: "/service/delegate/" },
  ],
  scripts: [],
  // one page per language: /service/delegate/posts/<file name>/ and /es/service/delegate/posts/<file name>/
  permalink: "{{ lang.prefix }}/service/delegate/posts/{{ page.inputPath | svcBasename }}/",
  eleventyComputed: {
    postSlug: (data) => path.basename(data.page.inputPath, ".md"),
    // the Spanish copy repeats English text: keep it out of search engines and out of the Spanish search index
    // (English words there skew the Spanish results). The Spanish copies get a small index of their own instead,
    // pagefind-posts (package.json build:search), which the site search adds on Spanish pages (assets/js/app.js).
    noindex: (data) => !!(data.lang && data.lang.code === "es"),
    description: (data) => data.summary || "",
    // search results and link previews: the title with the post's date, since several posts share a title
    // ("Delegate's Sharing Session"); the heading and the older/newer links keep the title alone
    metaTitle: (data) => {
      const day = postDay(data);
      return day ? `${data.title} – ${formatDate(day, "full", data.lang)}` : data.title;
    },
    // the post's day as YYYY-MM-DD, for search engines (the <time> by the heading and the BlogPosting data, service-post.njk)
    published: (data) => postDay(data),
    // the sitemap's <lastmod> (and the BlogPosting's dateModified): the day the post was published (the archived text is
    // not edited), or its `updated:` day
    lastmod: (data) => dayOf(data.updated) || postDay(data),
  },
};

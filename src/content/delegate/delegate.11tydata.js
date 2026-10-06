// Archived Delegate's Corner posts (2020–2023), one Markdown file each.
// Every post is published in both languages: the text stays in its original language (English)
// and the page around it follows the reader's language. URL: /service/delegate/posts/<file name>/
//
// To add a post: copy any .md file here, change the front matter (title, date, panel, author_en,
// author_es, kind, summary) and write the text below it. Members: first name + last initial only.
import path from "node:path";

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
    // the Spanish copy repeats English text: keep it out of search engines
    noindex: (data) => !!(data.lang && data.lang.code === "es"),
    description: (data) => data.summary || "",
  },
};

// A.A.'s upside-down service triangle, top to bottom — the one list of levels every triangle on the site draws
// (Home, About, Districts, How service works) through src/_includes/macros/triangle.njk, so their order and
// colours can never drift apart. The tip is the General Service Board's two operating corporations.
//   key   → the wording in data/text/triangle.csv (triangle.<key>.band, triangle.<key>.name)
//           and each page's own text for that level (home.service.<key>.*, about.tri.<key>, service.structure.<key>_*)
//   color → the level's accent (the `accent` filter): its lit band, its number and its panel on /about/structure/
export default [
  { key: "groups", color: "coral" },
  { key: "gsrs", color: "copper" },
  { key: "districts", color: "sun" },
  { key: "areas", color: "sage" },
  { key: "gsc", color: "ocean" },
  { key: "gsb", color: "iris" },
  { key: "corps", color: "lilac" },
];

# MSCA09 — Mid-Southern California Area of A.A.

A modern, accessible, multilingual website for AA Area 09, built as a static
**Single-Page Application (SPA)** that runs entirely on **GitHub Pages** — no
backend, no build step, no hosting cost.

All site content (events, meetings, officers, committees, districts,
announcements, resources) is driven by **CSV files** in [`data/`](data/) that
anyone can edit on GitHub directly, in a spreadsheet, or — later — in a
published Google Sheet.

---

## Highlights

- **Pure static, GitHub-Pages friendly** — works behind the `msca09aa.org` domain or any
  `*.github.io/...` URL. Hash-based SPA routing means no rewrites required.
- **Mobile-first responsive** — uses Bootstrap 5 (MIT) with a custom AA blue/gold
  theme that adapts to all screen sizes and supports a dark mode.
- **Accessible** — semantic HTML, ARIA landmarks, skip-link, keyboard focus rings,
  reduced-motion support, and visible focus on interactive elements.
- **Native translation** — Google Translate widget embedded in the header
  offers 30+ languages including Spanish, French, Chinese (Simplified/Traditional),
  Vietnamese, Tagalog, Arabic, and more.
- **Interactive events** — FullCalendar with month / list views, category color
  coding, per-event detail page, **Add-to-calendar** (`.ics`) download, map link.
- **Find-a-meeting** — searchable by day, city, and free-text.
- **Data via CSV** — all content lives in `data/*.csv`; trivially editable.
  When the area is ready, swap individual feeds for a published Google Sheets
  URL in one line of config (see [Migrating to Google Sheets](#migrating-to-google-sheets)).
- **No build, no install** — open `index.html`, that's it.

## Stack (all open-source, all via CDN)

| Library | License | Purpose |
|---|---|---|
| [Bootstrap 5](https://getbootstrap.com/) | MIT | Responsive UI primitives |
| [Bootstrap Icons](https://icons.getbootstrap.com/) | MIT | Icons |
| [FullCalendar](https://fullcalendar.io/) | MIT | Events calendar |
| [PapaParse](https://www.papaparse.com/) | MIT | CSV parsing |
| [AOS](https://michalsnik.github.io/aos/) | MIT | Animate-on-scroll |
| Google Translate Widget | Google | In-page translation (no API key needed) |

No bundlers, no transpilers — modern browsers run the ES modules directly.

## Project layout

```
MSCA09/
├── index.html              # SPA shell — hosts the router, navbar, footer
├── 404.html                # GitHub Pages SPA fallback redirect
├── .nojekyll               # Tells GitHub Pages: serve as plain static files
├── CNAME                   # (optional) custom domain mapping for Pages
├── README.md
├── LICENSE
│
├── css/
│   ├── theme.css           # AA color palette, dark mode tokens, typography
│   └── styles.css          # Component & layout styles
│
├── js/
│   ├── app.js              # Boot: routes, theme, announcements, back-to-top
│   ├── config.js           # SITE config + DATA_SOURCES (swap to Google Sheets here)
│   ├── data.js             # CSV loader + domain helpers (events, officers, etc.)
│   ├── router.js           # Tiny hash-based SPA router
│   ├── ui.js               # DOM helpers, html`` tagged template, formatters
│   └── pages/              # One module per route
│       ├── home.js
│       ├── about.js
│       ├── events.js
│       ├── event-detail.js
│       ├── meetings.js
│       ├── districts.js
│       ├── service.js
│       ├── officers.js
│       ├── resources.js
│       ├── newcomers.js
│       ├── contact.js
│       └── not-found.js
│
├── data/                   # All site content — edit these
│   ├── README.md           # How to edit each CSV
│   ├── events.csv
│   ├── meetings.csv
│   ├── officers.csv
│   ├── committees.csv
│   ├── districts.csv
│   ├── resources.csv
│   └── announcements.csv
│
└── assets/
    └── img/
        └── favicon.svg
```

## Running locally

Because the site uses ES modules and `fetch()` for CSV, it needs to be served
over HTTP (not opened via `file://`). Any static server works:

```bash
# Python 3
python -m http.server 8000

# Node
npx serve .

# VS Code
Install the "Live Server" extension, right-click index.html → "Open with Live Server"
```

Then open `http://localhost:8000/`.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In the repo on GitHub, go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch** → `main` / `/ (root)`.
4. Save. Your site will be live at `https://<user>.github.io/<repo>/` within a minute.

### Custom domain (`msca09aa.org`) — ONLY when ready to cut over

> ⚠️ **Don't add the CNAME file or set a custom domain until your DNS is actually
> pointed at GitHub Pages.** If you add `msca09aa.org` as a custom domain while
> the domain still serves the *old* website, GitHub Pages will 301-redirect every
> visitor from `<user>.github.io/<repo>/` to `msca09aa.org` — i.e. straight back
> to the old site.

When you are ready to migrate the domain:

1. At your DNS provider, repoint `msca09aa.org`:
   - **Apex (`@`)** — four A records pointing at `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`
   - **Subdomain (e.g. `www`)** — a CNAME pointing at `<user>.github.io`
2. Wait for DNS to propagate (5 min – a few hours).
3. In repo **Settings → Pages → Custom domain**, enter `msca09aa.org` and save.
   GitHub will create the `CNAME` file in the repo for you.
4. Once the certificate is provisioned, tick **Enforce HTTPS**.

To reverse / disable the custom domain (e.g. if you accidentally got stuck in a
redirect loop to the old site): delete the `CNAME` file from the repo AND clear
the custom-domain field in **Settings → Pages**. Both are required — GitHub
caches the custom domain in repo settings even if the file is gone.

## Maintaining the site

### Updating content (events, officers, etc.)

Edit the relevant file in [`data/`](data/) — see [data/README.md](data/README.md)
for full field reference. You can edit directly on GitHub via the pencil icon,
or pull the repo, open the CSV in a spreadsheet, and push.

The site reads CSV files with PapaParse on each visit and caches them in the
browser's `sessionStorage` for 5 minutes.

### Configuring site basics

Open [`js/config.js`](js/config.js) and update:
- `SITE.contactEmail`, `SITE.hotline`, `SITE.hotlineDisplay`
- Any data source URL (see below)

### Adding a new page

1. Create `js/pages/your-page.js` exporting `renderYourPage({ params, query })`.
2. Register it in [`js/app.js`](js/app.js): `route('/your-page', renderYourPage);`
3. Add a link somewhere in the nav (in `index.html`) or in another page module.

## Migrating to Google Sheets

The site is built to pull each CSV from either a local file (the default) or a
published Google Sheets URL. To migrate one feed:

1. Paste the CSV contents into a new Google Sheet (or one tab of a master sheet).
2. **File → Share → Publish to web → CSV** for that sheet/tab. Copy the URL.
3. In [`js/config.js`](js/config.js), replace the relevant `DATA_SOURCES` entry:
   ```js
   export const DATA_SOURCES = {
     events: 'https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=0',
     // …unchanged feeds keep their relative paths
   };
   ```
4. Commit. Done.

No other code changes required. Feeds can be migrated one at a time.

## Accessibility & translation

- **Skip-to-content** link at the top of every page (visible on focus).
- **Keyboard navigation** — all interactive elements are reachable via Tab.
- **Screen reader landmarks** — `<main>`, `<nav>`, `<footer>`, `aria-live` for view changes.
- **Dark / light theme** — toggle in the header; respects `prefers-color-scheme`.
- **Reduced motion** — all animations honor `prefers-reduced-motion`.
- **Translation** — Google Translate widget in the top bar offers 30+ languages.

## A.A. anonymity & traditions

This site adheres to A.A.'s Twelve Traditions, particularly the principle of
**anonymity at the public level**. The CSV templates include first-name-only
patterns and prompts. When adding officer/committee names, please follow the
area's conscience on how names are listed publicly.

---

## License

The site code is offered under the MIT License (see [LICENSE](LICENSE)).

Content describing Alcoholics Anonymous, the Twelve Steps, and the Twelve
Traditions is reproduced for educational purposes. The names "Alcoholics
Anonymous" and "A.A." are registered trademarks of Alcoholics Anonymous World
Services, Inc.

# MSCA09 — Mid-Southern California Area 09 of Alcoholics Anonymous

The public website of Area 09, in English (`/`) and Spanish (`/es/`).

**You can keep this site up to date without writing code.**

> **Trusted servants:** what the Area still needs to check, confirm, supply or correct is in
> [AREA-ACTION-LIST.md](AREA-ACTION-LIST.md).

- **Meetings and events** come from the Area's **Google Calendar**.
- **Documents** come from the Area's shared **Google Drive** folder.
- **Everything else** (wording, trusted servants, districts, committees, announcements, the menu) lives in
  **CSV spreadsheets** in the [`data/`](data/) folder, which you can edit on github.com.

The site rebuilds itself after every change and every three hours. "Upcoming" lists, countdowns
and announcements also update in visitors' browsers between builds.

---

## Contents

1. [How it works](#how-it-works)
2. [Everyday updates](#everyday-updates) (most volunteers only need this)
3. [Adding something to the calendar](#adding-something-to-the-calendar)
4. [Adding a document](#adding-a-document)
5. [Flyers and PDFs on hold](#flyers-and-pdfs-on-hold)
6. [Old msca09aa.org addresses](#old-msca09aaorg-addresses)
7. [When the panel rotates](#when-the-panel-rotates)
8. [Anonymity rules — read before editing](#anonymity-rules--read-before-editing)
9. [When the build turns red](#when-the-build-turns-red)
10. [Staying switched on](#staying-switched-on)
11. [One-time setup (webmaster)](#one-time-setup-webmaster)
12. [For developers](#for-developers)
13. [Credits and licences](#credits-and-licences)

---

## How it works

```
 Google Calendar ──┐
 (every meeting    │
  and event)       │      GitHub Actions (every push + every 3 hours)
                   ├──►   1. download the calendar        ──►  GitHub Pages
 data/*.csv  ──────┤      2. draw the link-preview picture       msca09aa.org
 (words, people,   │      3. build ~1,000 pages (EN + ES)
  districts …)     │      4. check anonymity, links, text
                   │      5. publish
 Google Drive  ────┘
 (minutes, flyers, documents — linked, never copied)

 Every Monday: "Check flyers and PDFs for personal details" reads new flyers and PDFs
 and puts any that show personal details on hold (see "Flyers and PDFs on hold").
```

| What you see on the site | Where it comes from | Who changes it |
|---|---|---|
| Every meeting, event, Area meeting, flyer, agenda, Zoom link | Google Calendar **MSCA09** | whoever keeps the Area calendar |
| Minutes, motions, reports, guidelines, newsletters, the archive | Drive folder `MSCA09AA/docs/` + the CSV files in [`data/documents/`](data/documents/) (new documents go in `current.csv`) | Secretary / webmaster |
| Districts: cities, about, contacts, map pins | `data/districts.csv` | webmaster, at the DCMC's request |
| Trusted servants (officers, chairs, DCMCs, district officers) | `data/trusted-servants.csv` | webmaster |
| Committees: purpose, how to get involved, guidelines, aa.org links | `data/committees.csv`, `data/committee-resources.csv` | committee chairs, via the webmaster |
| Home page banner photos, announcements, quick links | `data/hero.csv`, `data/announcements.csv`, `data/home-links.csv` | webmaster |
| Motions and their status | `data/motions.csv` | Secretary |
| Conference / PRAASA / Forum dates (Delegate's corner) | `data/gsc.csv` | Delegate |
| Central offices & hotlines, A.A. resources, FAQs | `data/central-offices.csv`, `data/resources.csv`, `data/faq.csv` | webmaster |
| Glossary of service words (EN/ES) | `data/glossary.csv` | anyone |
| The menu and the footer links | `data/nav.csv` | webmaster |
| Every heading, sentence and button label, in both languages | `data/text/*.csv` | anyone |
| Panel number, mailing address, Zelle, role e-mails, calendar id … | `data/settings.csv` | webmaster |
| Flyers and PDFs kept off the site | `data/flyer-holds.csv` (filled by the weekly check) | webmaster |
| Old WordPress addresses that forward to the new pages | `data/redirects.csv` | webmaster |

[`data/README.md`](data/README.md) lists every CSV file and its columns. Every page also has an
**Edit this page on GitHub** link at the bottom: it opens the file that holds that page's information.

---

## Everyday updates

### Edit a CSV on github.com (no software needed)

1. Open the file in [`data/`](data/) on github.com (or use the **Edit this page on GitHub** link at the bottom of the page you want to change).
2. Press the **pencil** icon (*Edit this file*).
3. Change the text. Keep the commas: each line is one row, and each comma separates two columns.
   If a value contains a comma, wrap the value in "double quotes"; a `"` inside such a value is written twice (`""`).
4. Press **Commit changes…** and then **Commit changes**.
5. Wait about two minutes. The **Actions** tab shows the build, and the site updates when it turns green.

If the build turns **red**, see [When the build turns red](#when-the-build-turns-red). The live site
stays as it was until the problem is fixed.

> **Prefer a spreadsheet?** Download the CSV, edit it in Excel or Google Sheets, and save it
> as **CSV UTF-8**. Then upload it on github.com with *Add file → Upload files*, using the same
> name and the same folder.

**Rows that start with `#` are notes for editors**, and the site ignores them. Almost every file begins with
a few of these notes explaining its columns (for example `announcements.csv`, `hero.csv` and
`home-links.csv`), so read them before you add a row.

**Words in curly brackets** such as `{panel}`, `{years}`, `{date}` or `{name}` are filled in by the site.
Keep them as they are, in both languages. `{panel}`, `{years}` and `{previous_panel}` work in every text
and CSV file and come from `data/settings.csv`, so nothing needs editing when the panel changes.

### Common jobs

| I want to… | Do this |
|---|---|
| Announce something on the home page | Add a row to `data/announcements.csv` with a `start` and `end` date (YYYY-MM-DD). It appears on `start` and disappears by itself after `end`. Set `pin` to `yes` to keep it first. |
| Change a sentence or a button | Find the words in `data/text/*.csv` (GitHub's search, or press `t` on github.com and type the file name), then change the `en` and `es` columns. |
| Record a new trusted servant | Edit their row in `data/trusted-servants.csv`: `name` must be first name + last initial (`Maria G.`), and set `status` to `Filled`. Other values of `status`: `Open` (vacant: leave `name` empty; the site shows a "help wanted" badge), `Unnamed` (the role mailbox is known but no name is published), `Unconfirmed` (someone serves but the name still has to be confirmed: the site marks it "to be confirmed"), `Completed` (an ad-hoc committee that has finished its work). |
| Update a district's cities, website or about text | Edit its row in `data/districts.csv`. The meeting time and place come from the calendar, not from this file. Spanish names of sub-districts go in `subdistricts_es`. |
| Fix a district meeting that is wrong in the calendar, for now | Put the right format, place and times in the `meeting_*`, `venue`, `address`, `city` and `zip` columns of `data/districts.csv`, set `meeting_override` to `yes` and say why in `notes`. The district page then shows the CSV. Correct the Google Calendar entry as soon as you can and clear `meeting_override`: the build log says when the calendar and the CSV agree. |
| Change a committee's description | Edit its row in `data/committees.csv`. Markdown works: `**bold**`, `[link](https://…)`, and lines starting with `- ` for lists. |
| Add a guideline or aa.org link to a committee page | Add a row to `data/committee-resources.csv`. |
| Record a motion's result | In `data/motions.csv`, set `status` (`passed`, `failed`, `tabled`…) and `decided_date`. |
| Swap the home page photo | Put the photo in `src/assets/img/hero/` (at least 2560 px wide; 3840 px is ideal) and add a row to `data/hero.csv` with its alt text and photo credit. Phones show a tall crop around `position_mobile`; for a better phone picture, add an upright (portrait) photo and put its file name in `file_mobile`. Check the licence (see [Credits](#credits-and-licences)), and make sure no person in the photo can be identified. |
| Hide a central office or a link | Set `show` to `no` on its row. |
| Show the Zelle QR code on /contribute/ | Only after the Treasurer A/R has test-scanned it: set `show` to `yes` on the `zelle-qr` row of `data/resources.csv` and write who confirmed it, and when, in `notes`. |
| Help the site search find a page | Add a row `search.kw./page-address/` to `data/text/common.csv` with extra words in `en` and `es` (they are not shown), e.g. `search.kw./newcomers/`. |
| Forward an old msca09aa.org address | Add a row to `data/redirects.csv` — see [Old msca09aa.org addresses](#old-msca09aaorg-addresses). |
| Change the Secretary's, webmaster's or contributions e-mail | Edit `email_secretary`, `email_webmaster` or `email_contributions` in `data/settings.csv`. |

### Good to know

- **"Pause animations"**: the button at the bottom of every page stops the moving waves and other
  decorations on that device (it remembers the choice), and the home page banner has its own pause button.
  Visitors whose phone or computer asks for less motion get no animation at all.
- **Spanish**: Spanish text follows A.A. usage (RSG, MCD, CMCD, CSA, Asamblea …) and speaks to the
  reader as *tú*. If a Spanish cell is empty, the English text is shown.

---

## Adding something to the calendar

Meetings and events are **only** added in Google Calendar (calendar **MSCA09**). Never edit
`data/calendar.ics`, because the next refresh overwrites it.

**The calendar copy in the repository is checked for anonymity first.** Every three hours the build saves a
copy of the calendar in `data/calendar.ics` (so the site still builds if Google is unreachable), and that copy
becomes permanent public history. It is saved only when `node scripts/check-calendar.mjs --all` finds no
personal e-mail address and no phone number anywhere in any entry, past or upcoming (public office lines listed
in `data/contact-allowlist.csv`, `central-offices.csv` or `resources.csv` are fine). If it finds one, the
build shows a yellow warning naming the entry (never the detail), the repository keeps its last clean copy,
and the site is still built and published from the fresh calendar. Fix the entry in Google Calendar (role
e-mails and office numbers only) and the next run saves the copy again.

> **The Area calendar is public.** People subscribe to it directly (the *Subscribe* buttons on the
> calendar page), so they see everything typed in an entry, **including the text under the `--` line**.
> Never type a member's last name, personal phone number or personal e-mail anywhere in an entry.

Every entry keeps its details in the **description**, in this shape. You can type it from the Google Calendar
app on a phone:

```
MSCA09|Committee|Virtual
Language: English
Título: Comité de Cooperación con la Comunidad de la Tercera Edad
ZoomID: 851 7562 5116
Passcode: CEC76
Email: cecchair@msca09aa.org
IMG: https://drive.google.com/file/d/<flyer id>/view?usp=sharing
Note: Shown on the website under the meeting details.
Nota: Se muestra en las páginas en español en lugar de la nota en inglés.
--
Anything under the line is free text: shown on the page of a one-time event,
never shown for a repeating meeting.
```

**First line:** `MSCA09|<Type>|<Format>`

- **Type** must be one of the `key` values in [`data/event-types.csv`](data/event-types.csv), spelled exactly:
  `Area`, `Area Committee`, `Assembly`, `Conference`, `Foro`, `Servathon`, `District`, `Committee`,
  `H&I`, `Intergroup`, `Service School`, `Workshop`, `History`, `Convention`, `Forum`, `YPAA`,
  `Social`, `Event`. To create a new type, add a row to that file.
- **Format** is `In person`, `Hybrid` or `Virtual`.

**Fields:** one per line, above the `--`. Leave out any field that doesn't apply.

| Field | Meaning |
|---|---|
| `Language:` | `English`, `Spanish` or `Bilingual`. Area meetings, assemblies and the other Area-wide types are interpreted, so the `default_language` column of `data/event-types.csv` shows them as Bilingual even without this line. |
| `Título:` (or `Title-ES:`) | Spanish title, shown on the Spanish site (with accents, e.g. *Comité de Servicio de Área*) |
| `Host:` | Host district(s): `D5`, or `D6 & D12`. The event then appears on those district pages. |
| `Email:` | A **role** address (`…@msca09aa.org`), never a personal one |
| `ZoomID:` · `Passcode:` | The Zoom meeting. **Never a Zoom personal meeting ID (PMI)** — that number is often the host's own phone number. Schedule a meeting with its own ID. |
| `ZoomLink:` | The join link. Needed for **hybrid** meetings; for a virtual meeting the link goes in *Location*. |
| `Web:` | A website |
| `IMG:` | A flyer image's Drive share link. Use one line per flyer; the first is the cover. |
| `Link:` | A document, written as label then URL: `Link: Agenda (English) https://drive.google.com/…` |
| `Note:` | A short note shown with the meeting details (one line per note) |
| `Nota:` | The same note in Spanish: shown on the Spanish pages instead of the English `Note:` lines |
| `Registration:` (or `Inscripción:`) | When doors or registration open, as a time: `Registration: 8:00 AM`. The site shows "Registration from 8:00 AM" / "Inscripción desde las 8:00 a. m." Keep the entry's start time at the time the meeting itself starts. |
| `Topic:` | What a workshop or school is about, e.g. `Topic: Concepts` or `Topic: Steps, Sponsorship` |
| `Cost:` | e.g. `$15 suggested contribution` |
| `Covers:` | The cities a district meeting serves |

**Location:** for anything people can attend in person, put the **venue name first**, then the street
address with its ZIP code (`Imperial Alano Club, 8021 Rosecrans Ave, Paramount, CA 90723`). Never a
private home. For an online-only meeting, put the Zoom join link here.

**Flyers** (`IMG:` and `Link:` files) may show only **role e-mail addresses** (`…@msca09aa.org`, a
district's service mailbox) and **public office or hotline numbers** — never a member's own phone number,
personal e-mail or last name. Ask the host for a corrected flyer before you add it. A flyer that shows
personal details is put on hold and disappears from the site (see [Flyers and PDFs on hold](#flyers-and-pdfs-on-hold)).

**Repeating meetings:** use Google Calendar's *Custom* repeat (e.g. "Monthly on the third
Thursday"), and **always set an end date**, normally the end of the panel. To skip a date, delete that one occurrence;
to move one, edit just that occurrence. The site follows both.

**Area meetings:** the series "MSCA09 Area Meeting" repeats on the 2nd Sunday so the monthly
pattern stays right. When an actual ASC or Assembly gets its own entry (with host district, place, flyer and
agenda), the site automatically hides the series entry on that day.

**District and committee pages** find their meetings by the role e-mail (`d05dcmc@…`,
`archiveschair@…`) or by the `Host:` line. A committee can also be tied to entries with keywords in the
`calendar_match` column of `data/committees.csv`.

**Spanish titles and notes until the calendar has them.** When an entry has no `Título:` or `Nota:` line yet,
a row in [`data/text/calendar.csv`](data/text/calendar.csv) can stand in:

- `calendar.title_es.<slug>` — the Spanish title. The slug is the last part of the event's address,
  e.g. `calendar.title_es.74th-scaa-convention-2026-10-16`.
- `calendar.note_es.<slug>` — the Spanish version of the entry's `Note:` lines (several lines separated by ` | `).
  It is used only while its `en` column still matches the calendar word for word, so an outdated
  translation is never shown; `scripts/check-calendar.mjs` lists the ones that need updating.

Once Google Calendar has its own `Título:` / `Nota:` lines, these rows can be deleted.

**Calendar files people download.** `/calendar.ics` (English) and `/calendar-es.ics` (Spanish) are built
from the cleaned entries — what the pages show — not copied from the Google feed: no editor notes,
no "Source:" lines, no flyers on hold. Each event also has its own `.ics` on its page.

**Problems are reported, not hidden.** Each build runs `scripts/check-calendar.mjs` and prints
any entry that breaks these rules in the Actions log (for example a Spanish event without a Spanish title,
a location without a venue name, or a flyer on hold). To publish a calendar change straight away
instead of waiting up to three hours, go to **Actions** → *Build and publish the website* → **Run workflow**.

---

## Adding a document

The full guide is [`scripts/README-documents.md`](scripts/README-documents.md). In short:

1. **Check the file for anonymity** first: no last names, personal e-mails, phone numbers, home addresses or
   sobriety dates. On a computer with Python, run the scanner on the file **before you upload it**:
   ```
   pip install --user pypdf pymupdf python-docx       (once)
   python scripts/scan-documents.py --file my-minutes.pdf
   ```
   It reports what kind of detail it found and how many (never the details themselves) — open the file and
   look. It is a safety net, not a guarantee, so also go through the checklist in `scripts/README-documents.md`.
   The scanner needs your own copy of the files, so it cannot run on GitHub: it is a check you do yourself.
2. Put the file in the right folder in the Drive folder `MSCA09AA/docs/`, for example `minutes/2026/`.
3. Add one row to [`data/documents/current.csv`](data/documents/current.csv) (older material goes in the
   `archive-….csv` files of the same folder). Set `publish` to `yes`. For Area minutes and agendas, give the
   exact meeting `date` (`2026-10-11`) and `meeting_type` (`ASC` or `ASA`): that is how
   /service/area-meetings/ finds them.
4. Fill the link: paste the Drive link into `url` (in Drive: *Share → Copy link*), or run
   `python scripts/drive_ids.py` on a computer with Google Drive for Desktop.

**Never delete rows in `data/documents/held.csv`, and never empty that file.** Its rows keep unredacted
originals, confidential background and duplicates off the site; deleting one can put a file with members'
full names or phone numbers back on the site. To release a held document, publish a cleaned copy as a new
row (see `scripts/README-documents.md`) and leave the held row where it is.

**Held documents carry no links in the repository.** The repository is public, so a row that is not published
(`publish` = `review` or `no`, including every row of `held.csv`) keeps `url` empty and never names a Drive
link or a copy on the old site: it is recognized by its `drive_path` (and `drive_id`, where the file is known)
alone. Never paste a link into such a row.

The build **stops** if a published row points at an unredacted original or a held file, and it never
publishes General Service Board meeting minutes, whatever the CSV says. A published document that the weekly
flyer and PDF check puts on hold (see [Flyers and PDFs on hold](#flyers-and-pdfs-on-hold)) is simply left out
of the library: the build log names its row, and the build carries on. A shelf marked `expect_yearly` in
`data/document-categories.csv` (the minutes) shows a "not posted yet — write to …" line for a missing year,
using the address in its `gap_email` column.

### Documents appear automatically (optional)

If the repository has `GOOGLE_API_KEY` and `DRIVE_FOLDER_ID` secrets (see
[One-time setup](#one-time-setup-webmaster)), every build lists the Drive folder itself. A file dropped into `docs/` then appears on the site within three hours,
with a title taken from its file name, without any CSV edit. A row in `data/documents/` still wins, for a
better title or to hide a file (`publish` = `no`).

---

## Flyers and PDFs on hold

Flyers and PDFs often come from hosts, and some print a member's phone number or personal e-mail.
The site keeps such files off every page, the calendar files, `events.json` and the document library.

**How a file gets held.** Every Monday the workflow **Check flyers and PDFs for personal details**
(Actions tab; you can also start it with *Run workflow*) reads the words printed in every new flyer and PDF:
each Drive file in an `IMG:` or `Link:` line of the calendar, and each published document. Each file is read
once, and the result is written to `data/media-review.csv`. A file that shows a personal phone number,
a personal e-mail address or a sobriety date gets a row in `data/flyer-holds.csv`, and the workflow starts
a new build so the file disappears at once. You can also hold a file by hand: add its row to `flyer-holds.csv`.

| File | Columns |
|---|---|
| `data/flyer-holds.csv` | `drive_id` (the long id in the Drive link), `reason` (what kind of detail — never the detail itself), `held_on` (YYYY-MM-DD), `notes` (where the file is used) |
| `data/media-review.csv` | `drive_id`, `checked_on`, `result` (`clean`, `hold: …`, `cleared` or `error: …`), `notes` — written by the workflow |

**How to release a file.** Ask the host for a version that shows only role e-mails and public office
numbers. In Google Drive, open the old file and choose **Manage versions → Upload new version** with the
corrected file, so the link and the id stay the same. Then:

1. delete the file's row in `data/flyer-holds.csv`, and
2. if `data/media-review.csv` has a row for it whose result starts with `hold`, change that result to
   `cleared` (you looked at the new version) or delete the row (the next Monday check reads it again).

`node scripts/check-calendar.mjs` lists every held file the calendar still uses, upcoming events first.

**False alarms.** The check reads pictures with OCR, so it sometimes mistakes a Zoom ID or a public office
line for a personal number. Open the file; if nothing personal is printed, delete its row in
`data/flyer-holds.csv` and set its result in `data/media-review.csv` to `cleared`. A public office line that
keeps coming back belongs in `data/contact-allowlist.csv` (see [Anonymity rules](#anonymity-rules--read-before-editing)).

**Links on committee, resource, motion and district pages.** The weekly check reads only calendar files and
published documents. When you add a Drive link to `data/committee-resources.csv`, `resources.csv`,
`motions.csv` or `districts.csv`, check it once on a computer with the repository:
`node scripts/check-media.mjs --extra-links`. If it holds the file, either clear it as above (false alarm) or
remove the link from that CSV until a clean version is in Drive — those pages do not hide held files by themselves.

The check never blocks the website: if it fails, the site keeps building and publishing as usual.

---

## Old msca09aa.org addresses

Links to the old WordPress site live on in flyers, QR codes, district websites and aa.org.
[`data/redirects.csv`](data/redirects.csv) sends each old address to its new page: one row per address, with
`old_path` (the old address, e.g. `/msca-officers/`), `new_path` (the page on this site, e.g. `/about/panel/`)
and an optional `note`.

- An `old_path` ending in `*` (e.g. `/event/*`) forwards every old address that starts with it.
- Never use the address of a page that exists on this site (e.g. `/calendar/`): the check stops with an error.
- Old Delegate's Corner posts are forwarded automatically from the `old_url` line in `src/content/delegate/*.md`.

---

## When the panel rotates

1. In `data/settings.csv`, set `panel`, `panel_years` and `previous_panel`. The menu, headings, text and the
   link-preview picture follow automatically (`{panel}`, `{years}` and `{previous_panel}` are filled in everywhere).
2. In `data/trusted-servants.csv`, copy the current rows, set `panel` to the new number, and fill in the
   new names (first name + last initial). Keep the old rows: they appear in the "previous panel" fold.
3. Add the new panel's Area meetings to Google Calendar, and give repeating meetings an end date.
4. Replace the logo files `src/assets/img/logo/logo-en*.{png,webp}` and `logo-es*` with the new panel's logo,
   keeping the same names and sizes. The link-preview picture uses `logo-en-512.png`, so it shows the new
   logo from the next build.
5. Update `data/gsc.csv` with the new Conference cycle.

The link-preview picture (`src/assets/img/social-card.jpg`, what chat apps show when someone shares a link)
is redrawn on every deploy from `data/settings.csv` (panel, years) and `data/hero.csv` (photo and credit).
To redraw it on your own computer: `npm run social-card` (needs Python 3 with `pip install pillow`, and
`npm install` for the site's fonts). If the redraw ever fails on GitHub, the picture in the repository is used.

---

## Anonymity rules — read before editing

Tradition Eleven: *"we need always maintain personal anonymity at the level of press, radio, and films."*
The internet is all three. Everything here is public and permanent, and search engines index it.

**Never put on this site, in any file, flyer, calendar entry or document:**

- a member's last name. Write `Jane D.`, never `Jane Doe`.
- a personal e-mail address. Use role addresses such as `registrar@msca09aa.org`.
- a personal phone number, or a Zoom personal meeting ID. Central-office and hotline numbers are fine.
- a home address, sobriety date or home group
- a photo in which a member's face can be recognized

**The build refuses to publish** when it finds:

- a personal-looking e-mail address or phone number on a page, in a calendar (`.ics`) or data (`.json`)
  file the site serves, or in a `data/` file;
- a trusted servant written with a surname, or what looks like a full name (first name + surname) on the
  panel, committee, district or event pages (elsewhere it is a warning);
- a link to a flyer or PDF on hold (see [Flyers and PDFs on hold](#flyers-and-pdfs-on-hold)).

It also warns when a Zoom ID looks like a Southern California phone number: ask the host whether it is
their personal meeting room.

**Allow lists.** Two files tell the check what is *not* a problem:

- [`data/contact-allowlist.csv`](data/contact-allowlist.csv) (`value`, `kind` = `email` or `phone`, `reason`):
  role mailboxes that happen to be on Gmail or Outlook — their name must say which role they serve — and
  public phone lines. Never a person's own address or number.
- [`data/name-allowlist.csv`](data/name-allowlist.csv) (`phrase`, `reason`): words that look like a full name
  but are not a member's: venues, place names, book titles and authors, Class A (non-alcoholic) trustees,
  GSO staff. Never a member's real name.

Whatever is added to these lists is published without further checks, so a second person should look at
every change. [`.github/CODEOWNERS`](.github/CODEOWNERS) names that reviewer. It takes effect once the
repository has a ruleset (see [One-time setup](#one-time-setup-webmaster), step 5).

Git keeps history. If something private was committed, removing it in a new commit does not erase it.
Ask the webmaster to rewrite the history.

---

## When the build turns red

Open the red run in the **Actions** tab. The *Check the built site* step lists each problem with the file
or page it is on, for example:

- a personal e-mail address or phone number (see [Anonymity rules](#anonymity-rules--read-before-editing));
- a broken row in a CSV file (a missing comma, or a `"` that is never closed) — the line number is given;
- a link to a page that does not exist;
- a text key a page uses that has no row in `data/text/*.csv`;
- a page title or description that shows `&amp;amp;` instead of `&`.

Fix the file, commit, and the next build tries again. Lines marked `!` are warnings: they never block
the site, but they are worth a look.

---

## Staying switched on

GitHub pauses the scheduled runs of a workflow after 60 days without a commit to the repository. The site
prevents that by itself: the three-hourly build switches both workflows back on once a day, and the Monday
flyer check does the same. Nobody needs to do anything.

If the site ever stops updating on its own (the "Updated" date at the bottom of every page stays old), open
**Actions**, choose *Build and publish the website* (and *Check flyers and PDFs for personal details*), and
press **Enable workflow** if GitHub shows it. Then press **Run workflow** once.

---

## One-time setup (webmaster)

1. **Publish with GitHub Pages:** go to *Settings → Pages → Build and deployment → Source* and choose
   **GitHub Actions**. Then run *Actions → Build and publish the website → Run workflow* once.
   - Until a custom domain is set, the site is at `https://<user>.github.io/<repository>/`. Every
     link adapts to that sub-folder automatically.
2. **Use the domain msca09aa.org** when the Area is ready to retire the WordPress site:
   - Go to *Settings → Pages → Custom domain*, enter `msca09aa.org`, and save. Tick **Enforce HTTPS** once it is offered.
   - At the domain registrar, point the apex record to GitHub Pages (four `A` records: 185.199.108.153,
     185.199.109.153, 185.199.110.153, 185.199.111.153) and add a `CNAME` record for `www` → `<user>.github.io`.
   - Set the repository variable `SITE_URL` to `https://msca09aa.org` (*Settings → Secrets and variables →
     Actions → Variables*) so share links and the sitemap use the domain. (`site_url` in `data/settings.csv`
     is used only for builds on your own computer.)
   - Old WordPress addresses keep working through `data/redirects.csv` (see [Old msca09aa.org addresses](#old-msca09aaorg-addresses)).
3. **Optional — automatic document listing:** create a Google API key
   (console.cloud.google.com → APIs & Services → enable **Google Drive API** → Credentials → API key,
   restricted to the Drive API) and save it as the repository **secret** `GOOGLE_API_KEY`
   (*Settings → Secrets and variables → Actions → Secrets*). Then save the id of the Area's `MSCA09AA`
   Drive folder (the long code at the end of the folder's address in Drive) as the repository **secret**
   `DRIVE_FOLDER_ID` (*Settings → Secrets and variables → Actions → Secrets*). Use a secret, not a variable:
   the repository and its build logs are public, a variable's value is printed in the logs while a secret is
   masked, and the folder is shared as "Anyone with the link", so its id would open the whole folder. Leave `drive_folder_id` in `data/settings.csv` empty.
   The `MSCA09AA` folder must stay shared as "Anyone with the link".
4. Give other trusted servants **write** access to the repository (*Settings → Collaborators*) so
   the site never depends on one person.
5. **Optional — a reviewer for the allow lists:** *Settings → Rules → Rulesets → New branch ruleset* for
   `main`, with **Require a pull request before merging** and **Require review from Code Owners**. Add
   **GitHub Actions** to the ruleset's **bypass list**: without it, the automatic calendar-mirror and
   flyer-check commits cannot be saved. Note that every edit on github.com then becomes a pull request that
   someone approves.

---

## For developers

The site is an [Eleventy](https://www.11ty.dev/) 3 static site, styled with [Tailwind CSS](https://tailwindcss.com/) v4
and made interactive with [Alpine.js](https://alpinejs.dev/). Volunteers never need any of this:
GitHub Actions builds the site.

```sh
npm install
npm run fetch        # download the calendar (and the Drive listing if GOOGLE_API_KEY and DRIVE_FOLDER_ID are set)
npm start            # http://localhost:8080 — rebuilds as you edit
npm run build        # full build into _site/ (pages + CSS + search index)
npm run check        # anonymity, links, CSV and missing-text checks on _site/
node scripts/check-site.mjs _site_preview   # the same checks on another output folder
npm run check:calendar                      # calendar entries that need fixing in Google Calendar
npm run check:media -- --dry-run            # read new flyers/PDFs (needs tesseract + poppler); changes nothing
npm run social-card                         # redraw src/assets/img/social-card.jpg (Python + pillow)
```

| Path | What it is |
|---|---|
| `data/` | All content as CSV files (see `data/README.md`) plus the calendar mirror `calendar.ics` |
| `data/documents/` | The document index, split into small files (`current.csv`, `archive-*.csv`, `held.csv`) |
| `src/pages/` | One template per page type. Each is built once per language, and detail pages once per district, committee, event and so on. |
| `src/_data/` | Loaders that turn the CSVs and the calendar into page data |
| `src/_lib/` | Shared code: CSV reading, i18n (`t`, `loc`, `lurl` filters), the calendar parser, and plugins per section |
| `src/_includes/` | Layouts, partials and macros (`macros/ui.njk`, `macros/events.njk`, …) |
| `src/assets/` | CSS (Tailwind input + per-section files), browser scripts, images |
| `src/content/delegate/` | Archived Delegate's Corner posts (Markdown) |
| `scripts/` | Calendar fetch and check, Drive listing and id filler, site check, flyer/PDF check, document scanner, social-card builder |
| `.github/workflows/deploy.yml` | Build and deploy on push, every 3 hours, and on demand |
| `.github/workflows/media-check.yml` | The Monday flyer and PDF check |

Conventions:
- Text comes from `{{ "key" | t(lang) }}`, and CSV columns are picked with `{{ row | loc("title", lang) }}`
  (reading `title_es` on Spanish pages). Both fill in `{panel}`, `{years}` and `{previous_panel}` from settings.
- Internal links are written as `/path/` and passed through `| lurl(lang)`.
- Colours come from palette names (`ocean iris coral sun sage copper blush lilac sea`) set with `style="{{ color | accent }}"`.
- Data files in `src/_data/` must have a single default export.
- Search engines: a page with `noindex: true` gets no canonical or hreflang links and stays out of the
  sitemap; `altNoindex: true` drops the hreflang alternates when the other-language copy is noindex (the
  English Delegate's Corner posts get it automatically). `searchExclude: true` keeps a page out of the site search only.

---

## Credits and licences

- Site code: MIT licence (see `package.json`).
- Banner photos: credited on the page and in `data/hero.csv`. They include CC BY-SA images from
  Wikimedia Commons (credit and licence link required) and Unsplash photos (Unsplash License).
- Open-source software: Eleventy, Tailwind CSS, Alpine.js, FullCalendar, Leaflet and
  Leaflet.markercluster with © OpenStreetMap contributors, PhotoSwipe, Swiper, Fuse.js, Pagefind, ical.js,
  Luxon, markdown-it, Lucide icons, and the Inter and Outfit fonts (SIL Open Font License).
- A.A.®, Alcoholics Anonymous®, the Big Book®, Grapevine® and La Viña® are registered trademarks of
  A.A. World Services, Inc. and A.A. Grapevine, Inc. This site speaks for Area 09 only.

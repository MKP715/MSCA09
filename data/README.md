# data/ — the website's content

Every word, person, district, committee and document on the site comes from the files in this
folder. Meetings and events come from the Area's Google Calendar instead, mirrored into
`calendar.ics`.

**How to edit:** open a file on github.com, press the pencil icon, change it, and press *Commit changes*.
The site rebuilds in about two minutes. Details are in the main [README](../README.md#everyday-updates).

General rules for every file:

- The first row is the header. Don't rename or remove columns.
- Rows that start with `#` are notes for editors, and the site ignores them. Most files start with a few
  of these notes explaining their columns: read them before adding a row.
- Every row has as many values as the header (keep the trailing commas of a short row). A value that
  contains a comma, a line break or a `"` is wrapped in "double quotes", and a `"` inside it is written twice (`""`).
  A broken row is reported during the build and stops the site check until it is fixed, so no data is lost silently.
- Save as **UTF-8** (Excel: *CSV UTF-8*).
- Columns ending in `_en` / `_es` hold English and Spanish. If the Spanish cell is empty, the English text is shown.
- `{panel}`, `{years}` and `{previous_panel}` in any text are filled in from `settings.csv`; other words in
  `{braces}` are filled in by the page that uses them. Keep them as they are, in both languages.
- `color` columns take a palette name: `ocean iris coral sun sage copper blush lilac sea`
  (or a Tailwind colour such as `teal`, `rose`, `amber`).
- `icon` columns take a [Lucide icon](https://lucide.dev/icons) name, e.g. `calendar-days`, `map`, `users`.
- Dates are `YYYY-MM-DD`. `start` / `end` columns make a row appear and disappear on those days.
- Lists inside one cell are separated with `;`.
- Long text cells accept Markdown: `**bold**`, `[link text](https://…)`, and `- ` for list items.
- **Anonymity:** first name + last initial only, and role e-mail addresses only (see the main README).

## The files

| File | What it controls | Change it when |
|---|---|---|
| `settings.csv` | Panel number and years (`panel`, `panel_years`, `previous_panel`), mailing address, Zelle details, role e-mails (`email_webmaster`, `email_contributions`, `email_secretary`), the calendar id, the GitHub repository, the site address for local builds. `drive_folder_id` stays **empty**: the Drive folder id is the repository variable `DRIVE_FOLDER_ID` (*Settings → Secrets and variables → Actions → Variables*, next to the `GOOGLE_API_KEY` secret), so it is never published | the panel rotates; an address changes |
| `nav.csv` | The menu (top items and their dropdown entries) and the footer links | a page is added |
| `text/*.csv` | **Every heading, sentence and button** in English and Spanish (`key`, `en`, `es`, `notes`). There is one file per section of the site: `common`, `home`, `calendar`, `districts`, `committees`, `people`, `documents`, `service`, `content`. `common.csv` also holds `search.kw./page-address/` rows (extra words for the site search); `calendar.csv` holds `calendar.title_es.<slug>` and `calendar.note_es.<slug>` rows (Spanish titles and notes until Google Calendar has `Título:` / `Nota:` lines). | wording changes |
| `announcements.csv` | Home-page announcements with `start`/`end` dates; `pin` = `yes` keeps one first | there's news |
| `hero.csv` | Home-page banner photos, with their alt text and photo credits. `file_mobile` = an optional upright photo for phones; `position_desktop` / `position_mobile` = the point of the photo that stays in view | new photos |
| `home-links.csv` | The quick-action tiles on the home page | rarely |
| `event-types.csv` | Calendar categories (`MSCA09\|<Type>\|…`): label, colour, icon, group, whether a type counts as a meeting or an event, and `default_language` (e.g. `Bilingual` for interpreted Area meetings) | a new kind of calendar entry |
| `districts.csv` | One row per district: cities, counties, about text, contacts, website, map pin, `subdistricts_es` (Spanish names of the sub-districts). The `meeting_*` columns (and `venue`, `address`, `room`, `city`, `zip`, `zoom_*`) are used when the calendar has no entry for that district, and to fill in a venue name or ZIP the calendar leaves out. `meeting_override` = `yes` makes them win over the calendar while the calendar entry is known to be wrong — clear it once the calendar is fixed (the build log says when they agree). | a district asks |
| `trusted-servants.csv` | Every trusted servant: officers, committee chairs, DCMCs and district officers, for this panel and the last. `status` = `Filled` / `Open` (vacant, `name` empty) / `Unnamed` (role mailbox only) / `Unconfirmed` (the name is shown "to be confirmed") / `Completed` (an ad-hoc committee that has finished). | elections, resignations |
| `committees.csv` | Every committee, school, subcommittee and officer role: purpose, activities, how to get involved, e-mails, aa.org page, `calendar_match` keywords | a chair asks |
| `committee-resources.csv` | Guidelines, aa.org workbooks, pamphlets and links on each committee page | new guidelines |
| `documents/` | The document library, one row per document, split into small files: **`current.csv`** (new documents go here), `archive-….csv` (by year) and **`held.csv`** (documents kept off the site — never delete its rows and never empty it). `publish` = `yes` / `review` / `no`. Rows that are not published carry **no links** (`url` empty, no Drive or old-site address): the public repository must not open the held files. Full guide: [`scripts/README-documents.md`](../scripts/README-documents.md). | a document is added |
| `document-categories.csv` | The shelves of the document library (`/documents/<key>/`). `expect_yearly` = `yes` shows a "not posted yet — write to `gap_email`" line for a missing year (the minutes). | rarely |
| `drive-folders.csv` | For the optional automatic Drive listing: which `docs/` folders are listed, and as what | a Drive folder is added |
| `motions.csv` | Motions and their status (new business → passed / failed …) | after every ASC / Assembly |
| `gsc.csv` | General Service Conference, PRAASA and Forum dates and themes (Delegate's corner) | each Conference cycle |
| `glossary.csv` | Service words in English and Spanish (GSR = RSG, DCMC = CMCD …) | anyone can add |
| `central-offices.csv` | Central offices, intergroups and hotlines: public phone numbers, websites, hours | a number changes |
| `resources.csv` | Links on the Resources, Newcomers, Contribute and Policy pages (`show` = `no` hides a row; the Zelle QR code stays hidden until the Treasurer has test-scanned it) | links change |
| `faq.csv` | Questions and answers on the Newcomers and Contribute pages | rarely |
| `redirects.csv` | Old msca09aa.org (WordPress) addresses and the page each one forwards to: `old_path`, `new_path`, `note`. An `old_path` ending in `*` covers every address that starts with it. Never the address of a page of this site. | an old link turns up |
| `flyer-holds.csv` | Google Drive flyers and PDFs the site must **not** show, because they print personal details: `drive_id`, `reason` (what kind of detail — never the detail itself), `held_on`, `notes`. Filled by the weekly flyer check or by hand. Applies to calendar flyers and to published documents (they leave the library quietly; the build never stops for a hold). To release a file: in Drive, *Manage versions → Upload new version* with the details removed, then delete its row (see the main README, "Flyers and PDFs on hold"). | a flyer is fixed |
| `media-review.csv` | Written by the weekly **Check flyers and PDFs for personal details** workflow: each Drive file it has read (`drive_id`, `checked_on`, `result`, `notes`). `result` = `clean`, `hold: …` (also in `flyer-holds.csv`), `cleared` (a person looked: false alarm) or `error: …` (tried again after 30 days). Delete a row to have that file read again. | a false alarm (set `cleared`) |
| `contact-allowlist.csv` | Role mailboxes on Gmail/Outlook and public phone lines that the anonymity check allows (`value`, `kind` = `email` / `phone`, `reason`). A free-mail address is accepted only when its name says which role it serves. **Needs a reviewer** (`.github/CODEOWNERS`). | a new role mailbox |
| `name-allowlist.csv` | Words that look like a full name but are not a member's (venues, places, book titles, authors, Class A trustees, GSO staff): `phrase`, `reason`. Never a member's real name. **Needs a reviewer** (`.github/CODEOWNERS`). | the check mistakes a place for a name |
| `calendar.ics` | A copy of the Google Calendar. **Don't edit it.** The build refreshes it automatically, and saves the new copy only when `scripts/check-calendar.mjs --all` finds no personal e-mail address or phone number in any entry (the copy is public history); otherwise it keeps the last clean copy and warns. | never |
| `generated/` | Created during the build (Drive listing); not committed | never |

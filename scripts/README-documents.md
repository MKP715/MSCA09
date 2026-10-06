# Documents: how to add, check and publish them

Every document on the website (minutes, agendas, motions, reports, finance reports, guidelines,
newsletters, workbooks, Conference material, the archive…) is a file in the Area's shared Google
Drive folder **MSCA09AA/docs/**, plus one row in the document index, the CSV files in
**`data/documents/`**. The site never stores the files itself; it links to Drive.

## The index: `data/documents/`

| File | What is in it |
|---|---|
| `current.csv` | Documents of this panel and the previous one (from the previous panel's first year on), current guidelines and forms. **New documents go here.** |
| `archive-2020.csv` … `archive-2023.csv`, `archive-2010s.csv`, `archive-2000s.csv`, `archive-undated.csv` | The archive, by year. |
| `held.csv` | **Do not delete these rows.** Documents kept off the site (`publish` = `review` or `no`): unredacted originals of "-redacted" copies, files with members' full names / personal contact details / sobriety dates, GSC background, General Service Board minutes, duplicates. A row here also stops the automatic Drive listing from adding the file. |

All files have the same columns; the first lines starting with `#` explain them (they are
ignored by the site). The site reads every `.csv` in the folder, so a row can live in any of them —
the split only keeps each file small enough to edit on github.com. (An old single
`data/documents.csv` is still read too, if someone adds one.)

## The short version

1. **Check the file for anonymity** — run the scanner (below) and go through the checklist.
2. **Drop it into the right folder** in `MSCA09AA/docs/` (table below), with a readable name:
   `<what>-<when>-<en|es|en-es>.pdf`, e.g. `asc-minutes-october-2026-en.pdf`.
3. **Add a row** to `data/documents/current.csv` (on github.com: open the file → pencil icon → add a
   line → *Commit changes*). Leave `url` empty. For Area minutes and agendas give the exact meeting
   date (`2026-10-11`) and `meeting_type` (`ASC` or `ASA`): that is how /service/area-meetings/ finds them.
4. **Fill the link**: on a computer with Google Drive for Desktop, run
   `python scripts/drive_ids.py` from the repository folder and commit `data/documents/`.
   No computer? Open the file in Drive → *Share* → *Copy link* and paste it into `url`.

Rows with an empty `url` are not shown on the site, so a half-finished row never breaks anything.

## Anonymity scanner: `scripts/scan-documents.py`

```
pip install --user pypdf pymupdf python-docx           # once
python scripts/scan-documents.py --file my-minutes.pdf  # check one file before you upload it
python scripts/scan-documents.py --redact IN.pdf OUT.pdf # make a cleaned copy: full names → "First L.",
                                                        #   personal e-mail/phone/home address/sobriety date → removed
python scripts/scan-documents.py                        # check every published document (from your Drive copy)
python scripts/scan-documents.py --ocr                  # also read scanned pages (Windows 10/11 OCR)
python scripts/scan-documents.py --hold                 # move every flagged published row to held.csv
```

It reads every page with two PDF readers (pypdf and PyMuPDF — each finds text the other misses),
plus Word files, and looks for personal e-mail addresses, phone numbers that are not public office
lines (`data/central-offices.csv`, `data/contact-allowlist.csv`), street addresses that do not look
like meeting places, sobriety dates, and full names next to a service role or in an attendance list.
The report gives **counts only** — open the file and look. It is a safety net, not a guarantee: it
errs on the side of holding a document back, and a person should still read the checklist below.
The exit code is 1 when a published document has a finding.

**Where your Drive copy is:** the runs that go through the index (every mode except `--file` and
`--redact`) open each file from your Google Drive for Desktop copy of the Area folder — the folder
that contains `docs/`. There is no built-in default: set the environment variable `MSCA09_DRIVE`
to that folder once (or pass `--drive <folder>` each time), e.g.

```
setx MSCA09_DRIVE "G:/My Drive/MSCA09AA"           # Windows (open a new terminal afterwards)
export MSCA09_DRIVE="$HOME/Google Drive/My Drive/MSCA09AA"   # macOS / Linux
```

Without it the script stops with a message instead of guessing.

### Two checks, two rule sets

| | `scripts/scan-documents.py` (your computer) | `scripts/check-media.mjs` (weekly on GitHub) |
|---|---|---|
| Reads | your Drive copy; every page with two PDF readers; Word/Excel/PowerPoint | the published file downloaded from Drive; every page (`pdftotext`), Word/Excel/PowerPoint XML, OCR (`tesseract`) for pictures and scanned PDFs |
| Looks for | e-mail, phone, street address, sobriety date **next to a date or a name**, full names | e-mail, phone, any sobriety phrase ("years of sobriety", "sobriety birthday") |
| E-mail | a role address (district…, dcmc, chair…, …@msca09aa.org) is fine | anything not in `data/contact-allowlist.csv` or on an A.A. domain is "personal" |
| Result | counts; `--hold`, `--redact` | a row in `data/media-review.csv`; a hold in `data/flyer-holds.csv` |

So the weekly check raises more alarms. Most are false: a district or central-office role mailbox
that is not in `data/contact-allowlist.csv` yet (add it, with its role), a General Service Office
212-870 number, or a sobriety phrase used in a general sense ("two years of sobriety required").
Mark those `cleared: <reason>` in `data/media-review.csv` and delete the hold row.

What the October 2026 pre-launch scan of all 2,183 published documents taught (both tools were fixed):

- **Phone numbers broken over two lines** (`(714)` ⏎ `555-0123`, `714-` ⏎ `555-0123`), printed with a
  Unicode hyphen (`909‐555‐0147`), glued to an initial (`Pat R.(714)…`), followed by a hyphen
  (`…0123-No Report`) or in a sentence that mentions Zoom ("on Zoom. Call Pat at …") were missed —
  by `scan-documents.py` in every case and by `check-media.mjs` when there was a line break. Both
  rules now accept these forms (scan cache version 16).
- **Pictures inside text pages and garbled text layers** (a flyer pasted into a newsletter, a PDF made
  with a font that has no text mapping): `scan-documents.py --ocr` only reads pages that have *no* text
  at all, so personal phone numbers and e-mails printed in pasted flyers went unseen. When a newsletter
  or report contains flyers or screenshots, open it and look at them, or OCR the whole file.
- **Sobriety-birthday lists** (first name, last initial and years, by month) and dates next to a
  member's name ("Pat 1/2/03") are sobriety dates; the years or dates are removed in the published copy.

## Which folder

| Folder in `MSCA09AA/docs/` | `category` | Put here |
|---|---|---|
| `minutes/<year>/` | Minutes | Approved ASA / ASC / Board minutes (EN and ES) |
| `agendas/<year>/` | Agendas | ASC / Assembly agendas and packets |
| `motions/<year>/` | Motions | Motions, motion backgrounds, yearly motion lists |
| `reports/<year>/` | Reports | Committee, district (DCMC) and officer reports |
| `reports/Delegate/<year>/` | Delegate | Delegate's reports, share-backs, highlights |
| `reports/Treasurer AP/<year>/`, `reports/Treasurer AR/<year>/` | Finances | Treasurer reports, statements of activity, budget vs. actual, group contributions |
| `finances/<year>/` | Finances | Budgets, audits |
| `guidelines/` | Guidelines | Current Area Guidelines and Bylaws |
| `Committee Guidelines/` | Guidelines | Each committee's current guidelines (superseded copies go in `Committee Guidelines/OLD/`) |
| `conference/<year>/` | Conference | GSC agenda lists, advisory actions, quick-reference guides (never the confidential background) |
| `gso/<year>/` | GSO | Letters, memos and reports from GSO / AAWS / Grapevine (never General Service Board meeting minutes) |
| `workbooks/<year>/` | Workbooks | Area workbook, tool kits, Mock Conference workbooks |
| `service/<year>/` | Service | Orientations, sharing sessions |
| `forms/` | Forms | Budget request, expense reimbursement… |
| `calendars/` | Calendar | Approved Area calendar |
| `archive/...` | (various) | Historical material only — do not add new business here |
| `events/`, `meetings/` | — | Event / meeting flyers: these belong to the **calendar**, not to the document index |

The same mapping is in `data/drive-folders.csv`, which the optional automatic Drive listing
(`scripts/drive-index.mjs`) uses. Folders with `include = no` are never listed automatically.

## Columns

| Column | What to write |
|---|---|
| `id` | A short unique name, lower case with dashes (e.g. `minutes-2026-oct-asc-en`). Never change it later. |
| `collection` | `Current` or `Archive`. Documents from the previous panel's first year on are always shown as Current. |
| `category` | One of: Minutes, Agendas, Motions, Reports, Delegate, Finances, Guidelines, Conference, GSO, Workbooks, Service, Forms, Calendar, Contributions, Newsletters, District, Flyers, PRAASA, Archives, Misc. |
| `title_en`, `title_es` | The title in English and in Spanish (e.g. `ASC Minutes – October 2026` / `Actas del CSA – octubre de 2026`). If `title_es` is empty the English title is shown. Give the English and Spanish copies of one document the **same** `title_en` and date: the site then shows them as one entry with an EN and an ES button. |
| `date` | `2026-10-11` (best), or `2026-10`. |
| `year` | The year (4 digits). |
| `language` | `English`, `Spanish` or `Bilingual` (one row per language version). |
| `format` | `PDF`, `Word`, `Excel`, `PowerPoint`. |
| `size_kb` | Optional. |
| `meeting_type` | For Area minutes/agendas: `ASC`, `ASA`, `Board`. |
| `district` | District slug if it belongs to a district page: `d01-03`, `d05`, `d25`… |
| `committee` | Committee/officer slug if it belongs to a committee page: `literature`, `treatment`, `delegate`, `treasurer-ap`… (same slugs as `data/committees.csv`). |
| `source` | Where it came from (free text). |
| `publish` | `yes` = show it. `review` = held for an anonymity/confidentiality check (never shown). `no` = never show. |
| `anonymity_flag` | Empty, or why it is held: `personal-contact`, `full-name`, `sobriety-date`, `confidential`, `unverified`. |
| `drive_path` | Path of the file in Drive starting with `docs/`. |
| `url` | `https://drive.google.com/file/d/<id>/view` — filled by `scripts/drive_ids.py`. |
| `notes` | Anything the next person should know. |

## Safety rules the build enforces

- General Service Board quarterly **meeting minutes** and board weekend reports are never published,
  whatever `publish` says (they list trustees and attendees by full name); the build prints a warning.
- The build **stops** if a published row points at the unredacted original of a "-redacted" copy, or
  at a file that a held row keeps off the site.
- Two published rows with the same title, date and language print a warning (keep one: `publish = no`
  with the note "duplicate of <id>").
- A shelf marked `expect_yearly` in `data/document-categories.csv` (the minutes) shows a "not posted
  yet — write to …" line for a missing year, so a gap is visible instead of silent.

## Anonymity checklist (Tradition Eleven) — before a file goes into `docs/`

Everything in `docs/` can be opened by anyone with the link, so check **before** uploading:

- [ ] Members appear only as **first name + last initial** (Josh O.) — in the text, in
      signatures, in attendance lists ("Present:"), in photos' captions **and in the file name**.
- [ ] No **personal** e-mail addresses (gmail/yahoo/icloud… belonging to a person). Role
      addresses (…@msca09aa.org, a district's service address) are fine.
- [ ] No **personal phone numbers**. Central-office / intergroup / GSO public lines are fine.
- [ ] No home addresses, no sobriety dates ("my sobriety date is…", "date of sobriety"), no photos of members' faces.
- [ ] Not **GSC background material**, General Service Board minutes, or anything marked "confidential",
      "may contain full names", "do not share outside the Fellowship" (Final Conference Report: only the
      anonymity-protected edition).
- [ ] No rosters or contact lists. No lists of individual contributors.
- [ ] Spreadsheets/PDF properties: the *Author* field doesn't show a full name (File → Properties).

When in doubt, set `publish` to `review`, leave `url` empty and ask the Area Secretary or
Technology Committee. Files held during the 2026 rebuild are listed (counts only) in the private
folder `MSCA09AA-private/documents-held-for-anonymity-review.csv`.

## `scripts/drive_ids.py` in detail

```
python scripts/drive_ids.py              # fill missing links in every data/documents/*.csv
python scripts/drive_ids.py --dry-run    # just report
python scripts/drive_ids.py --unlisted   # also list docs/ files that have no row yet
python scripts/drive_ids.py --refresh    # re-check existing links (e.g. after moving files)
```

It reads Google Drive for Desktop's local database (Windows or macOS, read-only, from a temporary
copy), so the file must be visible in your Drive for Desktop. Freshly copied files can take
minutes to hours to upload; until then they have no Drive id — just run it again later. Only
rows with `publish = yes` get a link. Comment rows (`# …`) are kept as they are.

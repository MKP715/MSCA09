# MSCA09 — Data files

All site content that changes frequently lives in this folder as **CSV files**.
Editing one of these files (locally or via Google Sheets) is enough to update
the live website.

## Files

| File | Drives | Edit when |
|---|---|---|
| `events.csv` | Events list & calendar | A new assembly, workshop, committee meeting, or convention is scheduled |
| `meetings.csv` | Find-a-meeting page | A group changes location/time or a new group registers |
| `officers.csv` | Officers & DCMs page | After elections, or when a position is filled mid-rotation |
| `committees.csv` | Service committees page | When a committee chair changes or a committee's schedule changes |
| `districts.csv` | Districts page | When a DCM changes or district contact info is updated |
| `resources.csv` | Resources & forms page | When a new document, form, or external link is added |
| `announcements.csv` | The yellow announcement bar at the top of every page | When you want to announce something time-sensitive |

## How to edit a CSV file

### Option A — edit on GitHub (easiest)

1. Open the file on GitHub (e.g. `data/events.csv`).
2. Click the pencil icon to edit.
3. Make your changes. CSVs render as a table in GitHub's preview.
4. Scroll down and commit. The site updates within ~1 minute.

### Option B — edit locally in Excel / Numbers / LibreOffice / Google Sheets

1. Open the CSV in your spreadsheet app.
2. Make your changes. **Keep the header row untouched.**
3. Save **as CSV (UTF-8)**. (Not `.xlsx` — must stay CSV.)
4. Commit and push to GitHub.

## Field reference

### `events.csv`
```
id,title,category,start_date,start_time,end_date,end_time,location,address,district,url,flyer_url,description,contact,featured
```
- **id** — a unique short id, e.g. `asm-2026-spring`. Used in the URL.
- **category** — one of `assembly`, `workshop`, `committee`, `convention`, `other`. Drives the color on the calendar.
- **start_date / end_date** — `YYYY-MM-DD`.
- **start_time / end_time** — `9:00 AM` style, or 24-hour `09:00`.
- **district** — a number if the event is hosted by a single district; leave empty for area-wide.
- **flyer_url** — optional link to a PDF flyer.
- **featured** — `yes` to highlight on the home page and the events list.

### `meetings.csv`
```
name,day,time,address,city,district,types,notes
```
- **day** — `Sunday` … `Saturday`.
- **types** — pipe- or comma-separated tags, e.g. `Open|Speaker` or `Closed, Step Study, Women`.

### `officers.csv`
```
name,position,type,district,email,bio,sort
```
- **type** — `officer` (area officer), `chair` (committee chair), or `dcm` (district committee member).
- **sort** — number; lower numbers display first. Useful to order officers logically.
- **name** — leave empty if the position is currently open (it will show as “Open position”).

### `committees.csv`
```
name,purpose,chair,email,meeting_schedule,icon
```
- **icon** — any [Bootstrap Icon](https://icons.getbootstrap.com/) class name, e.g. `bi-megaphone-fill`.

### `districts.csv`
```
number,name,area,dcm,email,website,meeting_info
```

### `resources.csv`
```
title,category,url,description,updated
```
- **url** — link to a PDF, Google Doc, or external page.
- **category** — free-form text; resources are grouped by category on the page.

### `announcements.csv`
```
id,title,body,url,starts,ends,priority
```
- **starts / ends** — `YYYY-MM-DD`. Optional. If set, the announcement only shows in that window.
- **priority** — number; lowest number is shown.

## Migrating to Google Drive / Google Sheets later

When you're ready to host the data in Google Sheets so non-technical members
can edit it without touching GitHub:

1. Create a new Google Sheet for each feed (or one Sheet with multiple tabs).
2. Paste in the CSV contents — keep the header row exactly the same.
3. **File → Share → Publish to web → CSV** for that sheet/tab. Copy the URL.
4. Open [`js/config.js`](../js/config.js) and replace the relevant entry in
   `DATA_SOURCES` with the published URL, e.g.:

   ```js
   export const DATA_SOURCES = {
     events: 'https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=0',
     // …
   };
   ```

5. Commit. Done. The site will now pull live from the Google Sheet.

No other code changes are required — the data layer treats local files and
published Google Sheets URLs identically.

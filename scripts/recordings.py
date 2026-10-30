#!/usr/bin/env python3
"""Keep data/recordings.csv in step with the Area's Zoom recordings on Google Drive.

The Technology Committee page plays the audio of the Area's Zoom meetings
(/committees/technology/#recordings) straight from the Drive folder MSCA09AA/Zoom Recordings/,
which holds one folder per month and per meeting:

    Zoom Recordings/<YYYY-MM Month>/<meeting folder>/<YYYY-MM-DD HHMM>[ (Session N)][ - Part N] - Audio[ (Interpretation …)].m4a

next to each recording's Video.mp4, Transcript.vtt and Chat.txt. Only the audio files (.m4a) are
ever listed: never the videos, transcripts or chats. "_Duplicates…" folders and the loose files
at the top of the folder are skipped.

This script reads that folder through Google Drive for Desktop and adds every .m4a file that
data/recordings.csv does not list yet: its Drive id (from Drive for Desktop's local database, as
scripts/drive_ids.py does), date, start time (Pacific, as in the file name), part, session,
interpretation track, length (ffprobe) and size.

It MERGES and never takes anything away:
  - a row that is already in the file keeps every filled cell (show, notes, titles, series …);
    only its empty cells are filled in. A file that was moved gets its new path.
    --refresh also measures duration and size_mb again.
  - no row is ever deleted: rows whose file is no longer in the folder are listed at the end
    (hide one with show = no, or delete it on github.com once you are sure).
  - a recording shorter than 3 minutes (an empty start/stop) is added with show = no and a note.
  - a meeting folder that data/recording-series.csv does not know yet gets a new series row named
    after the folder, and a warning: give it proper English and Spanish names there.

Needs: Python 3.8+ (standard library only), Google Drive for Desktop signed in to the account that
holds the MSCA09AA folder (Windows or macOS), and ffprobe (part of FFmpeg) for the lengths.
Nothing is sent anywhere; Drive's database is only read (from a temporary copy).

Usage (from the repository folder):
    python scripts/recordings.py                  # add new recordings (npm run drive:recordings)
    python scripts/recordings.py --dry-run        # show what would change, write nothing
    python scripts/recordings.py --folder "G:/My Drive/RowlettAATech/MSCA09AA/Zoom Recordings"
    python scripts/recordings.py --committee technology   # the page that lists new rows (default)
    python scripts/recordings.py --refresh        # also measure the rows already listed again
"""
import argparse
import csv
import glob
import io
import os
import re
import shutil
import subprocess
import sys

import drive_ids

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECORDINGS = os.path.join(REPO, "data", "recordings.csv")
SERIES = os.path.join(REPO, "data", "recording-series.csv")

COLUMNS = ["drive_id", "committee", "series", "date", "time", "part", "session", "track", "duration",
           "size_mb", "show", "title_en", "title_es", "path", "notes"]
COMMENTS = [
    "# Zoom meeting recordings (audio only) that a committee page lists and plays: today the Technology "
    "Committee page (/committees/technology/#recordings). One row per .m4a file in the Area's Google Drive "
    "folder MSCA09AA/Zoom Recordings/. Only the audio is ever listed: never the video, transcript or chat.",
    "# Kept up to date by scripts/recordings.py (npm run drive:recordings, on a computer with Google Drive for "
    "Desktop): it adds new files, fills empty cells and never changes a filled cell or deletes a row. A row can "
    "also be added by hand: the file's Drive id (the long code in its Share link), committee, series, date and show.",
    "# drive_id = the file's Drive id | committee = slug in committees.csv of the page that lists it | series = key "
    "in recording-series.csv (the meeting: its name, filter button and link) | date = YYYY-MM-DD | time = when the "
    "recording started, HH:MM (24-hour, Pacific) | part / session = Zoom's Part N / Session N, else empty | track = "
    "main (the meeting's own audio) / es (Spanish interpretation) / en (English interpretation)",
    "# duration = H:MM:SS | size_mb = the file's size in MB (near 100 MB or more, Google Drive first asks to press "
    "Play anyway: the page says so) | show = yes / no (no keeps the recording off the site without deleting the "
    "row) | title_en / title_es = an optional name instead of the meeting's | path = where the file is, below "
    "Zoom Recordings/ | notes = for editors (not shown)",
]
SERIES_COLUMNS = ["key", "folder", "name_en", "name_es", "link", "sort", "notes"]

# Filled in from the folder only while empty; show, notes, titles, committee and series are the editors'.
FACTS = ["drive_id", "date", "time", "part", "session", "track", "duration", "size_mb", "path"]
SHORT_SECONDS = 180  # shorter than 3 minutes: an empty start/stop recording, added with show = no

NAME = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2}) (?P<hh>\d{2})(?P<mm>\d{2})"
    r"(?: \(Session (?P<session>\d+)\))?"
    r"(?: - Part (?P<part>\d+))?"
    r" - Audio(?: \(Interpretation (?P<interp>[^)]+)\))?\.m4a$",
    re.IGNORECASE,
)
LOOSE = re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})(?:[ _T](?P<hh>\d{2})[:.]?(?P<mm>\d{2}))?")


def track_of(interp):
    """'Español' → es, 'English' → en, nothing → main (the meeting's own audio)."""
    s = (interp or "").strip().lower()
    if not s:
        return "main"
    if re.search(r"espa|spanish|castell", s):
        return "es"
    if re.search(r"engl|ingl", s):
        return "en"
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "main"


def find_folder():
    """The Zoom Recordings folder in a Google Drive for Desktop drive (Windows drive letters or macOS CloudStorage)."""
    patterns = []
    for letter in "GHIJKLMNOPQRSTUVWXYZDEF":
        root = f"{letter}:/"
        if os.path.isdir(root + "My Drive") or os.path.isdir(root + "Shared drives"):
            patterns += [root + "My Drive/MSCA09AA/Zoom Recordings", root + "My Drive/*/MSCA09AA/Zoom Recordings",
                         root + "My Drive/*/*/MSCA09AA/Zoom Recordings", root + "Shared drives/*/MSCA09AA/Zoom Recordings"]
    mac = os.path.expanduser("~/Library/CloudStorage/GoogleDrive-*")
    patterns += [mac + "/My Drive/MSCA09AA/Zoom Recordings", mac + "/My Drive/*/MSCA09AA/Zoom Recordings",
                 mac + "/My Drive/*/*/MSCA09AA/Zoom Recordings"]
    for p in patterns:
        hits = [h for h in glob.glob(p) if os.path.isdir(h)]
        if hits:
            return hits[0]
    return None


def scan(folder):
    """[{ rel, file, folder_name, date, time, part, session, track }] for every .m4a in <month>/<meeting>/, and the skipped names."""
    found, skipped = [], []
    for month in sorted(os.listdir(folder)):
        mdir = os.path.join(folder, month)
        if not os.path.isdir(mdir) or month.startswith(("_", ".")):
            continue  # loose files at the top, "_Duplicates (safe to delete)"
        for meeting in sorted(os.listdir(mdir)):
            gdir = os.path.join(mdir, meeting)
            if not os.path.isdir(gdir) or meeting.startswith(("_", ".")):
                continue
            for root, dirs, files in os.walk(gdir):
                dirs[:] = sorted(d for d in dirs if not d.startswith(("_", ".")))
                for name in sorted(files):
                    if not name.lower().endswith(".m4a"):
                        continue  # never the videos, transcripts or chats
                    rel = os.path.relpath(os.path.join(root, name), folder).replace("\\", "/")
                    m = NAME.match(name)
                    if m:
                        info = {"date": m["date"], "time": f"{m['hh']}:{m['mm']}", "part": m["part"] or "",
                                "session": m["session"] or "", "track": track_of(m["interp"])}
                    else:
                        loose = LOOSE.search(name) or LOOSE.search(month)
                        if not loose or not re.match(r"\d{4}-\d{2}-\d{2}$", loose["date"] or ""):
                            skipped.append(f"{rel} (no date in the name)")
                            continue
                        info = {"date": loose["date"], "time": f"{loose['hh']}:{loose['mm']}" if loose["hh"] else "",
                                "part": "", "session": "", "track": "main"}
                        skipped.append(f"{rel} (unusual name: date read as {info['date']}; check its row)")
                    found.append({"rel": rel, "file": os.path.join(root, name), "folder_name": meeting, **info})
    return found, skipped


def seconds(path):
    """Length of an audio file in seconds (ffprobe), or None."""
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                              "default=noprint_wrappers=1:nokey=1", path], capture_output=True, text=True, timeout=300)
        return float(out.stdout.strip().splitlines()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def hms(sec):
    s = int(round(sec))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def size_mb(path):
    return f"{os.path.getsize(path) / 1_000_000:.1f}"


def read_csv(path):
    """(header, rows, newline, bom): rows are raw cell lists; comment rows ("# …") are kept as they are."""
    with open(path, "rb") as f:
        raw = f.read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    nl = "\r\n" if "\r\n" in text else "\n"
    lines = list(csv.reader(io.StringIO(text, newline="")))
    lines = [l for l in lines if l]
    return (lines[0] if lines else []), lines[1:], nl, bom


def write_csv(path, header, rows, nl, bom):
    with open(path, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        csv.writer(f, lineterminator=nl).writerows([header] + rows)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folder", help="the Zoom Recordings folder (found automatically in Google Drive for Desktop)")
    ap.add_argument("--committee", default="technology", help="committee page that lists new recordings (slug in committees.csv)")
    ap.add_argument("--db", help="path to Drive for Desktop's metadata_sqlite_db (found automatically)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="also measure duration and size_mb of listed rows again")
    a = ap.parse_args()

    folder = a.folder or find_folder()
    if not folder or not os.path.isdir(folder):
        raise SystemExit("The Zoom Recordings folder was not found. Pass it with --folder \"<drive>/My Drive/…/MSCA09AA/Zoom Recordings\".")
    folder = os.path.normpath(folder)
    prefix = os.path.basename(folder)  # "Zoom Recordings"
    root_name = os.path.basename(os.path.dirname(folder))  # "MSCA09AA"
    if not shutil.which("ffprobe"):
        raise SystemExit("ffprobe (part of FFmpeg) is needed for the recordings' lengths: install FFmpeg and run again.")

    # ---- Drive ids (Drive for Desktop's local database), as scripts/drive_ids.py reads them
    dbs = drive_ids.find_dbs(a.db)
    if not dbs:
        raise SystemExit("Google Drive for Desktop database not found. Is Drive for Desktop installed and signed in?")
    ids = {}
    for db in dbs:  # more than one signed-in account: merge (newest first wins)
        con, tmp = drive_ids.open_copy(db)
        try:
            for k, v in drive_ids.drive_paths(con, root_name).items():
                if k.startswith(prefix + "/") and (k not in ids or (ids[k] is None and v)):
                    ids[k] = v
        finally:
            con.close()
            shutil.rmtree(tmp, ignore_errors=True)
    lower_ids = {k.lower(): v for k, v in ids.items()}

    # ---- the series (meeting folders)
    s_header, s_rows, s_nl, s_bom = read_csv(SERIES) if os.path.exists(SERIES) else (SERIES_COLUMNS, [], "\n", False)
    s_col = {h.strip().lower(): i for i, h in enumerate(s_header)}
    for c in ("key", "folder", "name_en", "sort"):
        if c not in s_col:
            raise SystemExit(f"data/recording-series.csv has no '{c}' column")
    live_series = [r + [""] * (len(s_header) - len(r)) for r in s_rows if r and not r[0].lstrip().startswith("#")]
    by_folder = {r[s_col["folder"]].strip().lower(): r[s_col["key"]].strip() for r in live_series if r[s_col["folder"]].strip()}
    keys = {r[s_col["key"]].strip() for r in live_series}
    sorts = [int(r[s_col["sort"]]) for r in live_series if r[s_col["sort"]].strip().isdigit()]
    new_series = []

    def series_for(folder_name):
        k = by_folder.get(folder_name.lower())
        if k:
            return k
        k = base = slug(folder_name) or "meeting"
        n = 2
        while k in keys:
            k, n = f"{base}-{n}", n + 1
        keys.add(k)
        by_folder[folder_name.lower()] = k
        row = [""] * len(s_header)
        row[s_col["key"]], row[s_col["folder"]], row[s_col["name_en"]] = k, folder_name, folder_name
        row[s_col["sort"]] = str(max(sorts + [0]) + 10 * (len(new_series) + 1))
        if "notes" in s_col:
            row[s_col["notes"]] = "Added by scripts/recordings.py: give this meeting proper English and Spanish names"
        new_series.append(row)
        return k

    # ---- the recordings already listed
    if os.path.exists(RECORDINGS):
        header, rows, nl, bom = read_csv(RECORDINGS)
    else:
        header, rows, nl, bom = list(COLUMNS), [[c] + [""] * (len(COLUMNS) - 1) for c in COMMENTS], "\n", False
    for c in COLUMNS:  # a column added since the file was made goes at the end
        if c not in [h.strip().lower() for h in header]:
            header.append(c)
    col = {h.strip().lower(): i for i, h in enumerate(header)}
    for r in rows:
        r += [""] * (len(header) - len(r))
    data = [r for r in rows if r and not r[0].lstrip().startswith("#")]
    by_id = {r[col["drive_id"]].strip(): r for r in data if r[col["drive_id"]].strip()}
    by_path = {r[col["path"]].strip().lower(): r for r in data if r[col["path"]].strip()}

    # ---- the folder
    files, skipped = scan(folder)
    seen = set()
    added, filled, moved, waiting, conflicts, short = [], 0, [], [], [], []
    for f in files:
        fid = lower_ids.get(f"{prefix}/{f['rel']}".lower())
        row = (by_id.get(fid) if fid else None) or by_path.get(f["rel"].lower())
        if row is not None:
            seen.add(id(row))
            rid = row[col["drive_id"]].strip()
            if fid and rid and rid != fid:
                conflicts.append(f"{f['rel']}: the row says {rid}, Drive says {fid} - check which is right")
                continue
            touched = False
            if row[col["path"]].strip() and row[col["path"]].strip().lower() != f["rel"].lower():
                moved.append(f"{row[col['path']]}  ->  {f['rel']}")
                row[col["path"]], touched = f["rel"], True
            facts = {"drive_id": fid or "", "date": f["date"], "time": f["time"], "part": f["part"],
                     "session": f["session"], "track": f["track"], "path": f["rel"]}
            for k, v in facts.items():
                if v and not row[col[k]].strip():
                    row[col[k]], touched = v, True
            if a.refresh or not row[col["duration"]].strip():
                sec = seconds(f["file"])
                if sec is not None and row[col["duration"]] != hms(sec):
                    row[col["duration"]], touched = hms(sec), True
            if a.refresh or not row[col["size_mb"]].strip():
                if row[col["size_mb"]] != size_mb(f["file"]):
                    row[col["size_mb"]], touched = size_mb(f["file"]), True
            filled += touched
            continue
        if not fid:
            waiting.append(f["rel"])
            continue
        sec = seconds(f["file"])
        row = [""] * len(header)
        values = {"drive_id": fid, "committee": a.committee, "series": series_for(f["folder_name"]), "date": f["date"],
                  "time": f["time"], "part": f["part"], "session": f["session"], "track": f["track"],
                  "duration": hms(sec) if sec is not None else "", "size_mb": size_mb(f["file"]), "show": "yes",
                  "path": f["rel"]}
        if sec is not None and sec < SHORT_SECONDS:
            values["show"] = "no"
            values["notes"] = f"Hidden automatically by scripts/recordings.py: only {hms(sec)} long (shorter than 3 minutes)"
            short.append(f"{f['rel']}  ({hms(sec)})")
        elif sec is None:
            values["notes"] = "Length unknown (ffprobe could not read the file): listen before showing it"
        for k, v in values.items():
            row[col[k]] = v
        added.append(row)
        by_id[fid] = row
        seen.add(id(row))

    def order(r):
        return (r[col["date"]], r[col["time"]], r[col["session"]].zfill(3), r[col["part"]].zfill(3), r[col["track"]] != "main", r[col["track"]])

    added.sort(key=order)
    gone = [r for r in data if id(r) not in seen and r[col["path"]].strip()]

    # ---- report
    print(f"Zoom Recordings folder: {folder}")
    print(f"audio files (.m4a) found: {len(files)}; already listed: {len(files) - len(added) - len(waiting) - len(conflicts)}"
          f"{f' ({filled} row(s) completed)' if filled else ''}")
    print(f"new rows: {len(added)} ({sum(1 for r in added if r[col['show']] == 'yes')} shown, {len(short)} hidden as shorter than 3 minutes)")
    for s in short:
        print("   hidden (short):", s)
    for r in new_series:
        print(f"   ! new meeting folder '{r[s_col['folder']]}': added to data/recording-series.csv as '{r[s_col['key']]}' - give it English and Spanish names")
    for s in moved:
        print("   moved:", s)
    for s in conflicts:
        print("   ! different Drive id:", s)
    if waiting:
        print(f"still uploading (no Drive id yet, run again later): {len(waiting)}")
        for s in waiting[:25]:
            print("   waiting:", s)
    for s in skipped:
        print("   ! name not understood:", s)
    if gone:
        print(f"rows whose file is no longer in the folder (kept; set show = no or delete them on github.com): {len(gone)}")
        for r in gone:
            print(f"   gone: {r[col['path']]}  ({r[col['drive_id']]}, show = {r[col['show']] or '?'})")
    hand = [r for r in data if not r[col["path"]].strip()]
    if hand:
        print(f"rows added by hand (no path, not looked for): {len(hand)}")

    if a.dry_run:
        print("(dry run - nothing written)")
        return
    if added or filled or moved:
        write_csv(RECORDINGS, header, rows + added, nl, bom)
        print(f"updated {os.path.relpath(RECORDINGS, REPO)}")
    if new_series:
        write_csv(SERIES, s_header, s_rows + new_series, s_nl, s_bom)
        print(f"updated {os.path.relpath(SERIES, REPO)}")


if __name__ == "__main__":
    sys.exit(main())

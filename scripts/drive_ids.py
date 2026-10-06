#!/usr/bin/env python3
"""Fill in the Google Drive links in the document index (data/documents/*.csv).

Every document on the site lives in the Area's shared Google Drive folder
(MSCA09AA/docs/...). The index (data/documents/*.csv) points at each file by its path
(column `drive_path`, e.g. docs/minutes/2026/may-2026-asa-minutes-en.pdf) and,
once the file has been uploaded, by its Drive link (column `url`).

This script looks the paths up in Google Drive for Desktop's local database and
writes https://drive.google.com/file/d/<id>/view into `url` for every row
that does not have one yet. It changes nothing else in the file.

Needs: Python 3.8+ (standard library only) and Google Drive for Desktop
signed in to the account that holds the MSCA09AA folder, on Windows or macOS.
Nothing is sent anywhere; the database is only read (from a temporary copy).

Usage (from the repository folder):
    python scripts/drive_ids.py              # fill missing links
    python scripts/drive_ids.py --dry-run    # show what would change, write nothing
    python scripts/drive_ids.py --unlisted   # also list Drive files that are not in the index yet
    python scripts/drive_ids.py --refresh    # re-check rows that already have a link
    python scripts/drive_ids.py --root "MSCA09AA" --csv data/documents/current.csv --db <path to metadata_sqlite_db>

Rows with publish = review / no are never given a link (they stay hidden).
Files that Drive has not finished uploading yet have no id; run the script
again later (uploads can take minutes to hours) - the count is printed.
"""
import argparse
import csv
import glob
import os
import shutil
import sqlite3
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_dbs(explicit=None):
    if explicit:
        return [explicit]
    bases = []
    if os.environ.get("LOCALAPPDATA"):  # Windows
        bases.append(os.path.join(os.environ["LOCALAPPDATA"], "Google", "DriveFS"))
    bases.append(os.path.expanduser("~/Library/Application Support/Google/DriveFS"))  # macOS
    found = []
    for b in bases:
        found += glob.glob(os.path.join(b, "*", "metadata_sqlite_db"))
    return sorted(found, key=os.path.getmtime, reverse=True)


def open_copy(db):
    """Copy the live database (and its -wal/-shm files) to a temp folder so Drive is never disturbed."""
    tmp = tempfile.mkdtemp(prefix="drivefs-")
    dst = os.path.join(tmp, "metadata.db")
    shutil.copy2(db, dst)
    for ext in ("-wal", "-shm"):
        if os.path.exists(db + ext):
            shutil.copy2(db + ext, dst + ext)
    return sqlite3.connect(dst), tmp


def drive_paths(con, root_name):
    """Return {path below <root_name>/ : cloud id} for every live (not trashed) file."""
    cur = con.cursor()
    cols = {r[1] for r in cur.execute("pragma table_info(items)")}
    need = {"stable_id", "id", "local_title", "is_folder"}
    if not need <= cols:
        raise SystemExit(f"Unexpected Drive for Desktop database layout (items has {sorted(cols)})")
    flags = [c for c in ("trashed", "is_tombstone") if c in cols]
    sel = "select stable_id, id, local_title, is_folder" + "".join(", " + f for f in flags) + " from items"
    info = {}
    for row in cur.execute(sel):
        sid, fid, title, is_folder = row[:4]
        dead = any(row[4:])
        info[sid] = (fid, title, is_folder, dead)
    parent = {}
    for child, par, *_ in cur.execute("select * from stable_parents"):
        parent.setdefault(child, par)
    cache = {}

    def path(sid, depth=0):
        if sid in cache:
            return cache[sid]
        it = info.get(sid)
        if not it or depth > 60:
            return None
        p = parent.get(sid)
        up = path(p, depth + 1) if p is not None else None
        cache[sid] = f"{up}/{it[1]}" if up else it[1]
        return cache[sid]

    out = {}
    marker = "/" + root_name + "/"
    for sid, (fid, title, is_folder, dead) in info.items():
        if is_folder or dead:
            continue
        p = path(sid)
        if not p:
            continue
        p = "/" + p
        if marker in p:
            rel = p.split(marker, 1)[1]
            # a file still being uploaded has a temporary local id
            if fid and not str(fid).startswith("local"):
                out[rel] = fid
            else:
                out.setdefault(rel, None)
    return out


def index_files(explicit=None):
    """data/documents/*.csv (the split index) — or one file given with --csv — or the older data/documents.csv."""
    if explicit:
        return [explicit]
    d = os.path.join(REPO, "data", "documents")
    files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith(".csv")) if os.path.isdir(d) else []
    old = os.path.join(REPO, "data", "documents.csv")
    return files + ([old] if os.path.exists(old) else [])


def read_index(path):
    """(header, lines) where lines are the raw cell lists — comment rows ("# …") are kept as they are."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        lines = list(csv.reader(f))
    return (lines[0] if lines else []), lines[1:]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", help="one index file (default: every data/documents/*.csv)")
    ap.add_argument("--root", default="MSCA09AA", help="name of the shared Drive folder that contains docs/")
    ap.add_argument("--db", help="path to Drive for Desktop's metadata_sqlite_db (found automatically)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="also re-check rows that already have a url")
    ap.add_argument("--unlisted", action="store_true", help="list files under docs/ that are not in the index")
    a = ap.parse_args()

    dbs = find_dbs(a.db)
    if not dbs:
        raise SystemExit("Google Drive for Desktop database not found. Is Drive for Desktop installed and signed in?")
    ids = {}
    for db in dbs:  # more than one signed-in account: merge (newest first wins)
        con, tmp = open_copy(db)
        try:
            for k, v in drive_paths(con, a.root).items():
                if k not in ids or (ids[k] is None and v):
                    ids[k] = v
        finally:
            con.close()
            shutil.rmtree(tmp, ignore_errors=True)
    if not ids:
        raise SystemExit(f"No files found under a folder named '{a.root}'. Check --root.")
    lower = {k.lower(): v for k, v in ids.items()}

    filled = waiting = missing = changed = 0
    missing_list, listed = [], set()
    for path in index_files(a.csv):
        header, lines = read_index(path)
        col = {h.strip().lower(): i for i, h in enumerate(header)}
        for c in ("drive_path", "url", "publish"):
            if c not in col:
                raise SystemExit(f"{path} has no '{c}' column")
        touched = 0
        for cells in lines:
            if not cells or cells[0].lstrip().startswith("#"):
                continue
            cells += [""] * (len(header) - len(cells))
            dp = cells[col["drive_path"]].strip().lstrip("/")
            pub = cells[col["publish"]].strip().lower()
            if dp:
                listed.add(dp.lower())
            if not dp or pub not in ("yes", "y", "true", "1"):
                continue
            if cells[col["url"]] and not a.refresh:
                continue
            key = dp.lower()
            if key not in lower:
                missing += 1
                missing_list.append(dp)
                continue
            fid = lower[key]
            if not fid:
                waiting += 1
                continue
            url = f"https://drive.google.com/file/d/{fid}/view"
            if cells[col["url"]] != url:
                if cells[col["url"]]:
                    changed += 1
                else:
                    filled += 1
                cells[col["url"]] = url
                touched += 1
        if touched and not a.dry_run:
            with open(path, "w", encoding="utf-8", newline="") as f:
                csv.writer(f, lineterminator="\n").writerows([header] + lines)
            print(f"updated {os.path.relpath(path, REPO)} ({touched} link(s))")

    print(f"Drive files seen under {a.root}/: {len(ids)}")
    print(f"links added: {filled}" + (f", links corrected: {changed}" if a.refresh else ""))
    print(f"still uploading (no Drive id yet, run again later): {waiting}")
    print(f"path not found in Drive (check spelling / file moved?): {missing}")
    for p in missing_list[:25]:
        print("   missing:", p)
    if a.unlisted:
        extra = sorted(p for p in ids if p.lower().startswith("docs/") and p.lower() not in listed
                       and not p.lower().startswith(("docs/events/", "docs/meetings/")) and not p.endswith(("desktop.ini", "README.md")))
        print(f"files in docs/ not listed in the index: {len(extra)}")
        for p in extra:
            print("   unlisted:", p)
    if a.dry_run:
        print("(dry run - nothing written)")


if __name__ == "__main__":
    sys.exit(main())

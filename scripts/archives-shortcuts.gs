/**
 * Drive shortcuts to the Area 09 Archives Committee's collections (msca09aa-archives.org).
 *
 * The Archives Committee keeps its scans in its own Google Drive folders. This script puts a
 * SHORTCUT to each of them (never a copy) in the Area's Drive folder MSCA09AA/MSCA09AA-archives,
 * in one sub-folder per section of the Archives website — so the Area's Drive always opens the
 * Archives' live folders, with whatever they add later.
 *
 * The list comes from data/archives/collections.csv in the website's repository (rows with
 * mode = files or link). Run it again whenever that file changes: shortcuts that already exist
 * are left alone, new ones are added.
 *
 * How to run (one time, about two minutes):
 *   1. Open https://script.google.com while signed in to the Google account that owns MSCA09AA.
 *   2. New project → delete the sample code → paste this whole file → Save.
 *   3. Choose the function syncArchivesShortcuts → Run → allow the access Google asks for
 *      (Google Drive, and "connect to an external service" to read the list from GitHub).
 *   4. View → Logs (or Execution log) shows how many shortcuts were made.
 *   Optional: Triggers → Add trigger → syncArchivesShortcuts, time-driven, weekly.
 */
const CSV_URL = 'https://raw.githubusercontent.com/MKP715/MSCA09/main/data/archives/collections.csv';
const FOLDER_NAME = 'MSCA09AA-archives'; // inside MSCA09AA

function syncArchivesShortcuts() {
  const dest = findDestination_();
  const rows = Utilities.parseCsv(UrlFetchApp.fetch(CSV_URL).getContentText('UTF-8'));
  const head = rows.shift();
  const col = {};
  head.forEach(function (h, i) { col[h.replace(/^﻿/, '')] = i; });

  const sections = {};
  let made = 0, kept = 0;
  const failed = [];
  rows.forEach(function (r) {
    const key = r[col.key] || '';
    const id = r[col.drive_id] || '';
    const mode = r[col.mode] || '';
    if (!key || key.charAt(0) === '#' || !id || (mode !== 'files' && mode !== 'link')) return;
    const section = r[col.section_en] || 'Other';
    const folder = sections[section] || (sections[section] = childFolder_(dest, section));
    const title = r[col.title_en] || key;
    if (hasShortcutTo_(folder, id)) { kept++; return; }
    try {
      folder.createShortcut(id).setName(title);
      made++;
    } catch (e) {
      failed.push(title + ' (' + id + '): ' + e.message);
    }
  });
  Logger.log(made + ' shortcut(s) made, ' + kept + ' already there, ' + failed.length + ' failed.');
  failed.forEach(function (f) { Logger.log('  failed: ' + f); });
}

/** MSCA09AA/MSCA09AA-archives (the only folder of that name inside a folder called MSCA09AA). */
function findDestination_() {
  const found = [];
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  while (it.hasNext()) {
    const f = it.next();
    const parents = f.getParents();
    while (parents.hasNext()) {
      if (parents.next().getName() === 'MSCA09AA') { found.push(f); break; }
    }
  }
  if (found.length !== 1) throw new Error('Expected one folder MSCA09AA/' + FOLDER_NAME + ', found ' + found.length + '.');
  return found[0];
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function hasShortcutTo_(folder, targetId) {
  const it = folder.getFilesByType(MimeType.SHORTCUT);
  while (it.hasNext()) {
    if (it.next().getTargetId() === targetId) return true;
  }
  return false;
}

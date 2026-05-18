/**
 * MSCA09 site configuration.
 *
 * Data sources can be either:
 *   - a relative path to a CSV file in /data/ (default — works on GitHub Pages)
 *   - a published Google Sheets / Drive CSV URL (e.g. https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID})
 *
 * To migrate any feed to Google Drive later:
 *   1. Open the sheet → File → Share → Publish to web → CSV
 *   2. Paste the resulting URL as the value below.
 *   3. No other code changes required.
 */
export const SITE = {
  name: 'MSCA09',
  fullName: 'Mid-Southern California Area 09 of A.A.',
  tagline: 'Carrying the message through the General Service structure.',
  legacyUrl: 'https://msca09aa.org',
  contactEmail: 'webmaster@msca09aa.org',
  hotline: '+18002221234',
  hotlineDisplay: '1-800-222-1234',
  meetingFinderUrl: 'https://meetingguide.org',
  aaWorldUrl: 'https://www.aa.org',
  grapevineUrl: 'https://www.aagrapevine.org',
};

export const DATA_SOURCES = {
  events:        'data/events.csv',
  meetings:      'data/meetings.csv',
  officers:      'data/officers.csv',
  committees:    'data/committees.csv',
  districts:     'data/districts.csv',
  resources:     'data/resources.csv',
  announcements: 'data/announcements.csv',
};

/** Categories for the events calendar — drives color coding. */
export const EVENT_CATEGORIES = {
  assembly:   { label: 'Assembly',   className: 'cat-assembly' },
  workshop:   { label: 'Workshop',   className: 'cat-workshop' },
  committee:  { label: 'Committee',  className: 'cat-committee' },
  convention: { label: 'Convention', className: 'cat-convention' },
  other:      { label: 'Other',      className: 'cat-other' },
};

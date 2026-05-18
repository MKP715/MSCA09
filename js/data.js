/**
 * Data layer — loads CSV files (local or Google Drive published URL),
 * normalizes rows, and caches results in-memory + sessionStorage.
 *
 * Usage:
 *   import { loadData } from './data.js';
 *   const events = await loadData('events');
 */

import { DATA_SOURCES } from './config.js';

const CACHE_KEY_PREFIX = 'msca09:data:';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const memCache = new Map();

/**
 * Parse a CSV string into an array of objects.
 * Returns rows with header-keyed properties, all values trimmed.
 */
function parseCsv(text) {
  if (!window.Papa) {
    throw new Error('PapaParse is not loaded.');
  }
  const result = window.Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    transform: (v) => (typeof v === 'string' ? v.trim() : v),
  });
  if (result.errors && result.errors.length) {
    console.warn('[data] CSV parse warnings:', result.errors);
  }
  return result.data.filter((row) => Object.values(row).some((v) => v && v.length > 0));
}

/**
 * Fetch + parse a single CSV feed by key. Cached for 5 minutes
 * per browser session.
 */
export async function loadData(key, { force = false } = {}) {
  const url = DATA_SOURCES[key];
  if (!url) throw new Error(`Unknown data source: ${key}`);

  if (!force && memCache.has(key)) {
    const { at, rows } = memCache.get(key);
    if (Date.now() - at < CACHE_TTL_MS) return rows;
  }

  // Try sessionStorage cache (survives client-side navigation)
  if (!force) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + key);
      if (raw) {
        const { at, rows } = JSON.parse(raw);
        if (Date.now() - at < CACHE_TTL_MS) {
          memCache.set(key, { at, rows });
          return rows;
        }
      }
    } catch (_) { /* ignore */ }
  }

  let text;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    console.error(`[data] Failed to load ${key} from ${url}:`, err);
    return [];
  }

  const rows = parseCsv(text);
  const payload = { at: Date.now(), rows };
  memCache.set(key, payload);
  try { sessionStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(payload)); } catch (_) {}
  return rows;
}

/** Invalidate cache for one or all feeds. */
export function clearDataCache(key) {
  if (key) {
    memCache.delete(key);
    try { sessionStorage.removeItem(CACHE_KEY_PREFIX + key); } catch (_) {}
  } else {
    memCache.clear();
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(CACHE_KEY_PREFIX))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch (_) {}
  }
}

/* ---------- Domain helpers ---------- */

/** Parse "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" into a Date (local). */
export function parseEventDate(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  let hh = 0, mm = 0;
  if (timeStr) {
    const t = timeStr.replace(/[^\d:apm ]/gi, '').trim();
    const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
      hh = parseInt(match[1], 10);
      mm = match[2] ? parseInt(match[2], 10) : 0;
      const period = (match[3] || '').toLowerCase();
      if (period === 'pm' && hh < 12) hh += 12;
      if (period === 'am' && hh === 12) hh = 0;
    }
  }
  return new Date(y, m - 1, d, hh, mm);
}

/** Sort & enrich the events feed. */
export async function getEvents({ upcomingOnly = false } = {}) {
  const rows = await loadData('events');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const enriched = rows.map((r) => {
    const start = parseEventDate(r.start_date, r.start_time);
    const end   = parseEventDate(r.end_date || r.start_date, r.end_time || r.start_time);
    return {
      id: r.id || `${r.start_date}-${(r.title || '').toLowerCase().replace(/\s+/g, '-')}`,
      title: r.title || '(Untitled event)',
      category: (r.category || 'other').toLowerCase(),
      start, end,
      startDate: r.start_date,
      startTime: r.start_time || '',
      endDate: r.end_date || r.start_date,
      endTime: r.end_time || '',
      location: r.location || '',
      address: r.address || '',
      district: r.district || '',
      url: r.url || '',
      flyer_url: r.flyer_url || '',
      description: r.description || '',
      contact: r.contact || '',
      featured: /^(y|yes|true|1)$/i.test(r.featured || ''),
    };
  }).filter((e) => e.start instanceof Date && !isNaN(e.start));

  enriched.sort((a, b) => a.start - b.start);
  return upcomingOnly ? enriched.filter((e) => e.start >= now) : enriched;
}

export async function getOfficers() {
  const rows = await loadData('officers');
  return rows.map((r) => ({
    name: r.name || '',
    position: r.position || '',
    type: (r.type || 'officer').toLowerCase(), // officer | chair | dcm
    district: r.district || '',
    email: r.email || '',
    bio: r.bio || '',
    sort: parseInt(r.sort || '99', 10),
  })).sort((a, b) => a.sort - b.sort);
}

export async function getCommittees() {
  const rows = await loadData('committees');
  return rows.map((r) => ({
    name: r.name || '',
    purpose: r.purpose || '',
    chair: r.chair || '',
    email: r.email || '',
    meeting_schedule: r.meeting_schedule || '',
    icon: r.icon || 'bi-people-fill',
  }));
}

export async function getDistricts() {
  const rows = await loadData('districts');
  return rows.map((r) => ({
    number: r.number || r.district || '',
    name: r.name || '',
    area: r.area || '',
    dcm: r.dcm || '',
    email: r.email || '',
    website: r.website || '',
    meeting_info: r.meeting_info || '',
  })).sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
}

export async function getResources() {
  const rows = await loadData('resources');
  return rows.map((r) => ({
    title: r.title || '',
    category: r.category || 'General',
    url: r.url || '#',
    description: r.description || '',
    updated: r.updated || '',
  }));
}

export async function getAnnouncements({ activeOnly = true } = {}) {
  const rows = await loadData('announcements');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const list = rows.map((r) => ({
    id: r.id || r.title,
    title: r.title || '',
    body: r.body || '',
    url: r.url || '',
    starts: r.starts ? parseEventDate(r.starts) : null,
    ends:   r.ends   ? parseEventDate(r.ends)   : null,
    priority: parseInt(r.priority || '5', 10),
  }));
  if (!activeOnly) return list;
  return list.filter((a) => {
    if (a.starts && a.starts > today) return false;
    if (a.ends && a.ends < today) return false;
    return true;
  }).sort((a, b) => a.priority - b.priority);
}

export async function getMeetings() {
  const rows = await loadData('meetings');
  return rows.map((r) => ({
    name: r.name || '',
    day: r.day || '',
    time: r.time || '',
    address: r.address || '',
    city: r.city || '',
    district: r.district || '',
    types: (r.types || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean),
    notes: r.notes || '',
  }));
}

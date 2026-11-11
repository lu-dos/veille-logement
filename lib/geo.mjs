// Geocoding + travel times, all free / key-less.
//  - geocode : api-adresse.data.gouv.fr (BAN, French state)
//  - transit : api.transitous.org (open GTFS router, covers IDF)
//  - car     : router.project-osrm.org

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.join(import.meta.dirname, '..', process.env.STATE_DIR || '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'travel.json');

let cache = {};
export async function loadCache() {
  await mkdir(CACHE_DIR, { recursive: true });
  if (existsSync(CACHE_FILE)) cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  return cache;
}
export async function saveCache() {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 0));
}

const UA = 'coloc-hunter/1.0 (personal flat search)';

export async function geocode(query, postcode) {
  const u = new URL('https://api-adresse.data.gouv.fr/search/');
  u.searchParams.set('q', query);
  if (postcode) u.searchParams.set('postcode', postcode);
  u.searchParams.set('limit', '1');
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('geocode http ' + r.status);
  const j = await r.json();
  const f = j.features?.[0];
  if (!f) return null;
  return {
    label: f.properties.label,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    score: f.properties.score,
  };
}

// next weekday 09:00 Europe/Paris, expressed as UTC ISO
function nextWorkday0900() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const d = new Date(paris);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  // convert back: paris local -> UTC
  const offsetMin = paris.getTimezoneOffset() * -1; // not reliable across DST; recompute
  const guess = new Date(d.toISOString());
  // robust: build ISO string with explicit +01:00/+02:00 via formatting
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const winter = [0, 1, 2, 10, 11].includes(d.getMonth());
  const tz = winter ? '+01:00' : '+02:00';
  return `${y}-${m}-${day}T09:00:00${tz}`;
}

export async function transitMinutes(from, to, { arriveBy = true } = {}) {
  const key = `t:${from.lat.toFixed(3)},${from.lon.toFixed(3)}>${to.lat.toFixed(3)},${to.lon.toFixed(3)}`;
  if (cache[key]) return cache[key];
  const u = new URL('https://api.transitous.org/api/v1/plan');
  u.searchParams.set('fromPlace', `${from.lat},${from.lon}`);
  u.searchParams.set('toPlace', `${to.lat},${to.lon}`);
  u.searchParams.set('arriveBy', String(arriveBy));
  u.searchParams.set('time', nextWorkday0900());
  u.searchParams.set('numItineraries', '4');
  let out = { minutes: null, error: null };
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    const its = j.itineraries || [];
    if (!its.length) out = { minutes: null, error: 'no itinerary' };
    else {
      const best = its.reduce((a, b) => (a.duration < b.duration ? a : b));
      out = {
        minutes: Math.round(best.duration / 60),
        transfers: best.transfers,
        modes: [...new Set(best.legs.map((l) => l.mode))].filter((m) => m !== 'WALK'),
      };
    }
  } catch (e) {
    out = { minutes: null, error: String(e.message || e) };
  }
  cache[key] = out;
  return out;
}

export async function carMinutes(from, to) {
  const key = `c:${from.lat.toFixed(3)},${from.lon.toFixed(3)}>${to.lat.toFixed(3)},${to.lon.toFixed(3)}`;
  if (cache[key]) return cache[key];
  let out = { minutes: null, error: null };
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes?.length) out = { minutes: null, error: j.code || 'no route' };
    else out = { minutes: Math.round(j.routes[0].duration / 60), km: Math.round(j.routes[0].distance / 100) / 10 };
  } catch (e) {
    out = { minutes: null, error: String(e.message || e) };
  }
  cache[key] = out;
  return out;
}


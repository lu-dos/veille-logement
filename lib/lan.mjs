import os from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname.replace(/[\\/]lib$/, '');
const URL_FILE = path.join(ROOT, '.cache', 'tunnel-url.txt');

// IP du PC sur le reseau local : secours quand le tunnel n'est pas encore pret.
export function lanIp() {
  const found = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) found.push(a.address);
    }
  }
  const score = (ip) =>
    /^192\.168\./.test(ip) ? 3 : /^10\./.test(ip) ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  found.sort((a, b) => score(b) - score(a));
  return found[0] || '127.0.0.1';
}

export function tunnelUrl() {
  if (!existsSync(URL_FILE)) return null;
  try {
    const u = readFileSync(URL_FILE, 'utf8').trim();
    return /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(u) ? u : null;
  } catch {
    return null;
  }
}

// Base des URL mises dans les notifications. Priorite : config explicite, puis tunnel
// public (marche en 4G), puis IP du LAN (secours, telephone sur le meme Wi-Fi).
export function serverBase(cfg) {
  const explicit = cfg.notify?.serverBase;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const t = tunnelUrl();
  if (t) return t;
  return `http://${lanIp()}:${cfg.notify?.serverPort || 8787}`;
}

export function serverBaseInfo(cfg) {
  const explicit = cfg.notify?.serverBase;
  if (explicit) return { base: String(explicit).replace(/\/+$/, ''), via: 'config' };
  const t = tunnelUrl();
  if (t) return { base: t, via: 'tunnel' };
  return { base: `http://${lanIp()}:${cfg.notify?.serverPort || 8787}`, via: 'lan' };
}

// Boutons affiches dans la notification ntfy (3 max).
// Tap sur la notification -> la fiche de l'annonce. C'est elle qui marque "vu" et qui
// affiche "deja ouverte" au 2e passage (une notification ntfy ne peut pas se modifier).
export function openUrl(base, ad) {
  return `${base}/ad/${encodeURIComponent(ad.id)}`;
}

export function adActions(base, ad) {
  if (!base) return [];
  const mark = (field, value) =>
    `${base}/api/mark?id=${encodeURIComponent(ad.id)}&field=${field}&value=${value}`;
  return [
    { type: 'http', label: "J'ai postule", url: mark('applied', 1) },
    { type: 'http', label: 'Pas postule', url: mark('applied', 0) },
    { type: 'view', label: 'Rapport', url: `${base}/` },
  ];
}

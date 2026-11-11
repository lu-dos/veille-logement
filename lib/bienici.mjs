// Source Bien'ici : API JSON publique, sans navigateur.
// C'est la seule source qui repond depuis une IP datacenter (donc la seule qui
// peut collecter PC eteint, sur un runner GitHub).
//
// Deux appels :
//   res.bienici.com/zones.json?name=<ville>&type=city&postalCodes[]=<cp>  -> zone id
//   www.bienici.com/realEstateAds.json?filters=<json>                    -> annonces
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ZONES_CACHE = path.join(
  import.meta.dirname,
  '..',
  process.env.STATE_DIR || '.cache',
  'bienici-zones.json',
);
const API = 'https://www.bienici.com/realEstateAds.json';
const ZONES = 'https://res.bienici.com/zones.json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const slug = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const getJson = async (url) => {
  const r = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url.slice(0, 80)}`);
  return r.json();
};

// ---------------------------------------------------------------------------
// Zones : un code postal -> un zone id. Le cache evite de refaire 40 requetes
// a chaque tour (et permet de tourner sans reseau supplementaire).
// ---------------------------------------------------------------------------
function loadZoneCache() {
  try {
    return JSON.parse(readFileSync(ZONES_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

async function resolveZone(nom, cp) {
  for (const type of ['city', 'arrondissement']) {
    const q = new URLSearchParams({ name: nom.replace(/-/g, ' '), type });
    q.append('postalCodes[]', cp);
    try {
      const j = await getJson(`${ZONES}?${q}`);
      const list = (Array.isArray(j) ? j : []).filter((z) => z && z.id);
      if (list.length) return { id: String(list[0].id), nom: list[0].name };
    } catch {}
  }
  return null;
}

export async function resolveZones(locations, log = () => {}) {
  const cache = loadZoneCache();
  const villes = locations.map((l) => {
    const [nom, cp] = String(l).split('_');
    return { nom, cp, brut: l };
  });
  let manquants = 0;
  for (const v of villes) {
    if (cache[v.brut]) continue;
    const z = await resolveZone(v.nom, v.cp);
    if (z) {
      cache[v.brut] = z;
      manquants++;
    } else {
      log(`  ! zone bien'ici introuvable : ${v.brut}`);
    }
  }
  if (manquants) {
    try { writeFileSync(ZONES_CACHE, JSON.stringify(cache, null, 1)); } catch {}
    log(`  ${manquants} zone(s) bien'ici resolue(s) et mise(s) en cache`);
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------
function toAd(a, zoneLabel = null) {
  const typeFr = a.propertyType === 'house' ? 'maison' : 'appartement';
  const pieces = Number(a.roomsQuantity) || 0;
  const photos = (a.photos || []).map((p) => p?.url).filter(Boolean);
  const pos = a.blurInfo?.position || a.blurInfo?.centroid || null;
  // certains hebergeurs ajoutent deja un ?timestamp : on enchaine alors avec &
  const sized = (u, w, h) => `${u}${u.includes('?') ? '&' : '?'}width=${w}&height=${h}&fit=cover`;
  return {
    id: `bc-${a.id}`,
    subject: a.title ? `${a.title}` : `${typeFr} ${pieces || '?'} pièces ${a.city || ''}`.trim(),
    url: `https://www.bienici.com/annonce/location/${slug(a.city || '')}/${typeFr}/${pieces || 1}piece${pieces > 1 ? 's' : ''}/${a.id}`,
    price: a.price != null ? Math.round(Number(a.price)) : null,
    city: a.city || null,
    zip: a.postalCode ? String(a.postalCode) : null,
    zone: zoneLabel || undefined,
    rooms: Number.isFinite(Number(a.roomsQuantity)) ? Number(a.roomsQuantity) : null,
    bedrooms: Number.isFinite(Number(a.bedroomsQuantity)) ? Number(a.bedroomsQuantity) : null,
    surface: Number(a.surfaceArea) || null,
    publishedAt: a.publicationDate || a.modificationDate || null,
    image: photos[0] ? sized(photos[0], 400, 300) : null,
    imageLarge: photos[0] || null,
    nbImages: photos.length,
    images: photos.map((u) => sized(u, 520, 390)).slice(0, 12),
    lat: pos?.lat ?? null,
    lon: pos?.lon ?? null,
    kind: 'logement-entier',
    description: String(a.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    agency: a.accountType === 'agency' ? 'agence' : 'particulier',
    charges: Number(a.charges) || null,
    source: 'bienici',
  };
}

export async function collectBienici(cfg, log = () => {}) {
  const zones = cfg.zones.flatMap((z) => z.locations);
  const cache = await resolveZones(zones, log);
  const ids = [...new Set(zones.map((l) => cache[l]?.id).filter(Boolean))];
  if (!ids.length) throw new Error('aucune zone bien\'ici resolue');

  const cpsOk = new Set(zones.map((l) => String(l).split('_')[1]).filter(Boolean));
  // code postal -> nom du groupe de zones, pour l'etiquette affichee sur la carte
  const groupeParCp = new Map();
  for (const g of cfg.zones || []) {
    for (const loc of g.locations || []) {
      const cp = String(loc).split('_')[1];
      if (cp) groupeParCp.set(cp, g.name);
    }
  }
  const maxPrice = Math.round(cfg.budget.max_total_eur * (1 + (cfg.tolerances?.price_over_pct ?? 10) / 100));
  const parPage = 60;
  const maxPages = cfg.sources?.bienici?.maxPages ?? 6;

  const out = [];
  const vus = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const filters = {
      size: parPage,
      from: (page - 1) * parPage,
      filterType: 'rent',
      propertyType: ['flat', 'house'],
      onTheMarket: [true],
      maxPrice,
      page,
      sortBy: 'publicationDate',
      sortOrder: 'desc',
      zoneIdsByTypes: { zoneIds: ids },
    };
    const url = `${API}?filters=${encodeURIComponent(JSON.stringify(filters))}&extensionType=extended`;
    const j = await getJson(url);
    const ads = j.realEstateAds || [];
    if (!ads.length) break;

    let ajout = 0;
    for (const a of ads) {
      if (!a?.id || vus.has(a.id)) continue;
      vus.add(a.id);
      const ad = toAd(a, groupeParCp.get(String(a.postalCode)));
      // l'API renvoie aussi les communes voisines : on ne garde que nos codes postaux
      if (ad.zip && !cpsOk.has(ad.zip)) continue;
      out.push(ad);
      ajout++;
    }
    log(`  bien'ici page ${page} : ${ads.length} annonces, ${ajout} retenues (total ${j.total})`);
    if (ads.length < parPage) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  log(`  bien'ici : ${out.length} annonces dans les zones visees`);
  return out;
}

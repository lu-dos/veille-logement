// Collecteur "reseau d'agences" : les sites qui publient encore leur catalogue
// d'annonces de location dans un format lisible sans compte ni connexion.
//
// Citya (verifie le 12/11/2026) :
//   - sitemap.location.xml liste toutes les annonces (6 000+), une URL = une annonce ;
//   - chaque fiche expose un JSON-LD RealEstateListing complet : loyer, pieces,
//     surface, coordonnees GPS, photos, description. Rien a deviner.
//   - le sitemap ne contient pas la date de publication, et il est mis a jour par
//     Citya (pas a chaque minute) : c'est une source de complement, pas de temps reel.
//
// D'ou la strategie : une seule requete pour connaitre les annonces du corridor,
// puis une fiche telechargee UNIQUEMENT pour les annonces jamais vues (cache local).
// Les autres tours ne coutent donc presque rien.
//
// Les autres reseaux d'agences sondes le meme jour ne sont pas ici, pour des raisons
// mesurees et non par choix : Century 21 n'a plus d'URL de recherche par commune,
// SeLoger / Logic-Immo / Foncia renvoient des pages vides ou 403 (DataDome), Orpi
// ne filtre plus par ville. Le detail du sondage est dans le README.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SITEMAP = 'https://www.citya.com/sitemap.location.xml';

const FICHE = `(() => {
  const lds = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
  const ld = lds.find((t) => /RealEstateListing/.test(t)) || '';
  const imgs = [...new Set([...document.querySelectorAll('img')]
    .map((i) => i.currentSrc || i.getAttribute('src') || '')
    .filter((s) => /media\\/images\\/agences\\/biens/.test(s)))];
  return JSON.stringify({ ld, imgs: imgs.slice(0, 10) });
})()`;

// curl plutot que fetch : Cloudflare refuse un fetch Node nu (403) alors que la
// meme requete passe tres bien avec un vrai en-tete de navigateur.
function sitemapUrls() {
  const xml = execFileSync('curl', ['-sSL', '-m', '40', '-A', UA, SITEMAP], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const urls = [...xml.matchAll(/<loc>(https:\/\/www\.citya\.com\/annonces\/location\/[^<]+)<\/loc>/g)].map((m) => m[1]);
  // une page de commune = .../appartement/<ville>-<cp> ; une annonce a un segment de plus
  return urls.filter((u) => /\/location\/(appartement|maison)\/[^/]+\/[^/]+$/.test(u));
}

const zipOf = (url) => {
  const m = /-(\d{5})\//.exec(url);
  return m ? m[1] : null;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Transforme une fiche Citya en annonce au meme format que les autres sources.
function normalise(url, brut) {
  let ld = {};
  try {
    ld = JSON.parse(brut.ld);
  } catch {}
  const offer = ld.mainEntity || {};
  const bien = offer.itemOffered || {};
  const adresse = bien.address || {};
  const prix = Math.round(Number(offer.price) || 0);
  const surface = num(bien.floorSize && bien.floorSize.value);
  const pieces = num(bien.numberOfRooms);
  const geo = bien.geo || {};
  const images = (brut.imgs || []).filter(Boolean);
  const ville = adresse.addressLocality || '';
  const zip = adresse.postalCode || zipOf(url);
  const description = String(bien.description || '').replace(/\s+/g, ' ').slice(0, 1500);
  // Citya ne donne pas le nombre de chambres dans son JSON-LD, mais la description
  // le dit presque toujours ("deux chambres", "3 chambres").
  const MOTS = { une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
  const lits = /(\d+|une?|deux|trois|quatre|cinq|six)\s*chambres?/i.exec(description);
  const chambres = lits ? MOTS[String(lits[1]).toLowerCase()] || num(lits[1]) : null;
  const coloc = /\bcolocation\b|\bchambre en colocation\b|\bcoloc\b/i.test(description + ' ' + String(ld.name || ''));

  return {
    id: 'citya-' + String(url).split('/').pop(),
    url,
    subject: String(ld.name || `Appartement ${pieces || ''} pieces - ${ville}`).slice(0, 90),
    price: prix,
    surface,
    rooms: pieces,
    bedrooms: chambres,
    city: ville,
    zip,
    lat: num(geo.latitude),
    lon: num(geo.longitude),
    realEstateType: 'appartement',
    owner: 'agence',
    publishedAt: null,
    body: description,
    image: images[0] || null,
    imageLarge: images[0] || null,
    images,
    nbImages: images.length,
    kind: coloc ? 'chambre-coloc' : 'appartement',
    totalRent: prix,
    source: 'citya',
    zone: '',
  };
}

// Lit une fiche sur le VPS (contexte neuf) ou sur le PC (onglet Brave deja ouvert).
async function litFiche(tab, url) {
  if (typeof tab.freshExtract === 'function') {
    return JSON.parse(await tab.freshExtract(url, FICHE, { waitMs: 2500, timeout: 35000 }));
  }
  await tab.goto(url, { waitMs: 2500 });
  return JSON.parse(await tab.page.evaluate(FICHE));
}

export async function collectCitya(tab, { zones, maxNew = 6, cacheFile }, log = () => {}) {
  const spots = zones.flatMap((z) =>
    z.locations.map((l) => {
      const [city, zip] = String(l).split('_');
      return { city, zip, zone: z.name };
    }),
  );
  const byZip = new Map(spots.map((s) => [s.zip, s]));

  let urls = [];
  try {
    urls = sitemapUrls();
  } catch (e) {
    log(`  Citya : sitemap illisible (${String(e.message || e).slice(0, 80)})`);
    return [];
  }
  const corridor = urls.filter((u) => byZip.has(zipOf(u)));
  log(`  Citya : ${corridor.length} annonce(s) dans le corridor (sitemap : ${urls.length})`);
  if (!corridor.length) return [];

  let cache = {};
  if (cacheFile && existsSync(cacheFile)) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
    } catch {}
  }
  // cache ecrit avant l'ajout de firstSeenAt : on le date maintenant, une seule fois
  for (const a of Object.values(cache)) if (a && !a.firstSeenAt) a.firstSeenAt = new Date().toISOString();

  // on oublie ce qui a disparu du sitemap, sinon le cache grossit sans fin
  const vivantes = new Set(corridor);
  for (const cle of Object.keys(cache)) if (!vivantes.has(cle)) delete cache[cle];

  const inconnues = corridor.filter((u) => !cache[u]);
  const aLire = inconnues.slice(0, maxNew);
  if (inconnues.length > aLire.length) {
    log(`  Citya : ${inconnues.length} fiche(s) a lire, ${aLire.length} ce tour (budget)`);
  }
  for (const url of aLire) {
    try {
      const a = normalise(url, await litFiche(tab, url));
      // Citya ne publie aucune date : on retient le premier tour ou l'annonce a ete
      // vue, c'est ce qui permet de la trier par "date" et de la marquer nouvelle.
      a.firstSeenAt = new Date().toISOString();
      cache[url] = a;
    } catch (e) {
      log(`  Citya : fiche illisible ${url.split('/').pop()} (${String(e.message || e).slice(0, 60)})`);
    }
  }

  let ecrites = 0;
  if (cacheFile) {
    try {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
      ecrites = Object.keys(cache).length;
    } catch {}
  }

  const out = [];
  for (const url of corridor) {
    const a = cache[url];
    if (!a || !a.price) continue;
    const spot = byZip.get(a.zip);
    out.push({ ...a, zone: spot ? spot.zone : 'hors zone', city: spot ? spot.city : a.city });
  }
  log(`  Citya : ${out.length} annonce(s) retenue(s), ${ecrites} en cache`);
  return out;
}

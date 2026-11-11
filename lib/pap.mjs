// Collecteur PAP (particulier a particulier).
//
// Ce qui a change (constate le 12/11/2026) :
//   - /json/code-postal-get, qui donnait la table code postal -> identifiant geo,
//     repond 403 (Cloudflare) des qu'on n'est pas sur le PC de l'utilisateur ;
//   - une URL "…-palaiseau-91120" sans identifiant geo retombe sur une liste
//     nationale, donc sur rien d'utile ;
//   - la seule forme qui filtre vraiment est celle que PAP fabrique lui-meme :
//       /annonce/locations-appartement-<ville>-<cp>-g<id>g<id>…-3-pieces-jusqu-a-1200-euros
//     Les identifiants geo sont releves une fois (pap-geo.json) et ne bougent pas.
//
// Depuis une IP de datacenter, Cloudflare n'accorde qu'UNE requete par contexte de
// navigation : on ouvre donc un contexte neuf pour la page de resultats (voir
// lib/pw.mjs, freshExtract). Sur le PC, le vrai Brave se contente d'un onglet.
import { readFileSync } from 'node:fs';

const HOME = 'https://www.pap.fr/';

// table "Ville_CP" -> identifiant geo PAP, relevee avec /json/ac-geo
const GEO = (() => {
  for (const rel of ['../pap-geo.json', './pap-geo.json']) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
    } catch {}
  }
  return {};
})();

const EXTRACT = `(() => {
  const cards = [...document.querySelectorAll('.search-list-item-alt')];
  const out = [];
  for (const c of cards) {
    const a = c.querySelector('a[href*="/annonces/"]');
    if (!a) continue;
    const txt = (c.innerText || '').replace(/\\s+/g, ' ').trim();
    const idm = /-r(\\d+)/.exec(a.getAttribute('href') || '');
    if (!idm) continue;
    const price = (txt.match(/([\\d][\\d\\s.]{2,9})\\s*€/) || [])[1] || null;
    const zip = (txt.match(/\\((\\d{5})\\)/) || [])[1] || null;
    const city = (txt.match(/([A-Za-zÀ-ÿ'’\\- ]{3,40}?)\\s*\\(\\d{5}\\)/) || [])[1] || null;
    const rooms = (txt.match(/(\\d+)\\s*pi[eè]ces?/) || [])[1] || null;
    const beds = (txt.match(/(\\d+)\\s*chambres?/) || [])[1] || null;
    const surf = (txt.match(/(\\d{1,3})\\s*m²/) || [])[1] || null;
    const imgs = [...c.querySelectorAll('img')]
      .map(i => i.currentSrc || i.getAttribute('src') || '')
      .filter(s => s.includes('cdn.pap.fr'));
    out.push({
      id: 'pap-' + idm[1],
      url: 'https://www.pap.fr' + a.getAttribute('href'),
      price, zip, city, rooms, beds, surf,
      images: [...new Set(imgs)].slice(0, 8),
      text: txt.slice(0, 700),
    });
  }
  return JSON.stringify(out);
})()`;

const num = (s) => {
  if (s == null) return null;
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// PAP affiche parfois une surface aberrante ("505 m2" pour 50 m2) : au-dela de 250 m2
// a moins de 1500 EUR, on prefere "surface inconnue" plutot qu'un faux prix au m2.
function saneSurface(surf, price) {
  const s = num(surf);
  if (!s) return null;
  if (s > 250 && price && price <= 1500) return null;
  return s;
}

const slug = (city) =>
  String(city)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// URL canonique de la recherche : c'est celle que PAP fabrique apres son formulaire.
// PAP ne rend qu'une page a la fois (Cloudflare) : on peut donc lui donner un
// sous-ensemble de communes (groupe) et faire tourner les groupes d'un tour a l'autre.
export function papUrl({ zones, maxPrice = 1200, minRooms = 3, group = null, groups = 1 }) {
  const wanted = zones.flatMap((z) =>
    z.locations.map((l) => {
      const [city, zip] = String(l).split('_');
      return { city, zip, zone: z.name, geo: GEO[l] };
    }),
  );
  const avecGeo = wanted.filter((w) => w.geo);
  if (!avecGeo.length) return null;
  const toutes = [...new Set(avecGeo.map((w) => String(w.geo)))];
  let choix = toutes;
  if (group != null && groups > 1) {
    const taille = Math.ceil(toutes.length / groups);
    // on découpe la liste en tranches contigues : deux groupes voisins restent
    // des communes voisines, ce que PAP comprend mieux qu'un semis aleatoire
    choix = toutes.slice(group * taille, group * taille + taille);
    if (!choix.length) choix = toutes;
  }
  const tete = avecGeo.find((w) => String(w.geo) === choix[0]) || avecGeo[0];
  const ids = choix.map((i) => 'g' + i).join('');
  return `https://www.pap.fr/annonce/locations-appartement-${slug(tete.city)}-${tete.zip}-${ids}-${minRooms}-pieces-jusqu-a-${maxPrice}-euros`;
}

export async function collectPap(tab, { zones, maxPrice, maxPages = 1, group = null, groups = 1 }, log = () => {}) {
  const wanted = zones.flatMap((z) =>
    z.locations.map((l) => {
      const [city, zip] = String(l).split('_');
      return { city, zip, zone: z.name };
    }),
  );
  const byZip = new Map(wanted.map((w) => [w.zip, w]));
  const url = papUrl({ zones, maxPrice, group, groups });
  if (!url) {
    log('  PAP : aucun identifiant de commune (pap-geo.json absent)');
    return [];
  }
  const nGeo = Object.keys(GEO).length;
  log(
    `  PAP : recherche ${maxPrice} EUR` +
      (groups > 1 ? ` · groupe ${group + 1}/${groups} (${Math.ceil(nGeo / groups)} communes sur ${nGeo})` : ` · ${nGeo} communes`),
  );
  if (maxPages > 1) log('  PAP : une seule page par tour (Cloudflare limite a une requete)');

  let cards = [];
  try {
    if (typeof tab.freshExtract === 'function') {
      // VPS : contexte neuf = une requete autorisee
      cards = JSON.parse(await tab.freshExtract(url, EXTRACT, { waitMs: 2500 }));
    } else {
      // PC : le vrai Brave ouvre un onglet et passe le mur
      await tab.goto(url, { waitMs: 4200 });
      cards = JSON.parse(await tab.page.evaluate(EXTRACT));
    }
  } catch (e) {
    log(`  PAP illisible : ${e.message}`);
    return [];
  }

  const seen = new Set();
  const out = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const price = num(c.price);
    if (!price || !c.zip) continue;
    // PAP recherche "aux alentours" : on ne garde que les communes de la config
    const spot = byZip.get(c.zip);
    if (!spot) continue;
    // PAP ne donne pas de titre : la description suit le bloc "X pieces Y m2".
    const desc = String(c.text || '')
      .replace(/^.*?\d+\s*m²\s*/, '')
      .trim();
    const pieces = num(c.rooms);
    const surf = saneSurface(c.surf, price);
    const subject =
      desc.length > 12
        ? desc.slice(0, 78).replace(/\s+\S*$/, '')
        : `${pieces ? pieces + ' pieces' : 'Appartement'}${surf ? ' ' + surf + ' m2' : ''} - ${spot.city}`;

    out.push({
      ...c,
      subject,
      price,
      surface: surf,
      rooms: num(c.rooms),
      bedrooms: num(c.beds),
      city: spot.city,
      lat: null,
      lon: null,
      realEstateType: 'appartement',
      owner: 'particulier',
      publishedAt: null,
      body: (c.text || '').slice(0, 1200),
      image: c.images[0] || null,
      imageLarge: c.images[0] || null,
      nbImages: c.images.length,
      kind: 'appartement',
      totalRent: price,
      source: 'pap',
      zone: spot.zone,
    });
  }
  log(`  PAP : ${cards.length} cartes, ${out.length} retenues`);
  return out;
}

// Collecteur PAP (particulier a particulier).
// PAP n'expose ni API ni RSS : la recherche est un POST /recherche qui renvoie une
// URL canonique. On la construit une fois, puis on lit les cartes dans le vrai Brave
// (le site est derriere un mur Cloudflare qui bloque un simple fetch).

const HOME = 'https://www.pap.fr/';

const EXTRACT = `(() => {
  const cards = [...document.querySelectorAll('.search-list-item-alt')];
  const out = [];
  for (const c of cards) {
    const a = c.querySelector('a[href*="/annonces/"]');
    if (!a) continue;
    const txt = (c.innerText || '').replace(/\\s+/g, ' ').trim();
    const idm = /-r(\\d+)$/.exec(a.getAttribute('href') || '');
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
// a moins de 1200 EUR, on prefere "surface inconnue" plutot qu'un faux prix au m2.
function saneSurface(surf, price) {
  const s = num(surf);
  if (!s) return null;
  if (s > 250 && price && price <= 1500) return null;
  return s;
}

function pageUrl(base, n) {
  const u = new URL(base);
  const tail = u.pathname.replace(/^\/annonce\//, '');
  return `${u.origin}/proximite/${tail}-${n}`;
}

export async function collectPap(tab, { zones, maxPrice, maxPages = 2 }, log = () => {}) {
  const wanted = zones.flatMap((z) =>
    z.locations.map((l) => {
      const [city, zip] = String(l).split('_');
      return { city, zip, zone: z.name };
    }),
  );
  const byZip = new Map(wanted.map((w) => [w.zip, w]));
  const zips = [...byZip.keys()];

  await tab.goto(HOME, { waitMs: 3500 });

  // 1. table code postal -> identifiant geo PAP (elle est servie en entier)
  const rawMap = await tab.page.evaluate(`(async () => {
    const r = await fetch('/json/code-postal-get', { headers: { accept: 'application/json' } });
    const j = await r.json();
    const out = {};
    for (const p of (j._embedded && j._embedded.place) || []) {
      const m = /\\((\\d{5})\\)$/.exec(p.title || '');
      if (m && !out[m[1]]) out[m[1]] = p.id;
    }
    return JSON.stringify(out);
  })()`);
  const geoMap = JSON.parse(rawMap);
  const ids = zips.map((z) => geoMap[z]).filter(Boolean);
  log(`  PAP : ${ids.length}/${zips.length} communes reconnues`);
  if (!ids.length) return [];

  // 2. recherche : PAP renvoie l'URL canonique de la recherche
  const finalUrl = await tab.page.evaluate(`(async () => {
    const fd = new URLSearchParams();
    fd.set('action', 'submit');
    fd.set('produit', 'location');
    fd.append('typesbien[]', 'appartement');
    fd.set('nb_pieces[list][]', '3');
    fd.set('prix[max]', ${JSON.stringify(String(maxPrice))});
    fd.set('geo_objets_ids', ${JSON.stringify(ids.join(','))});
    const r = await fetch('/recherche', { method: 'POST', body: fd, redirect: 'follow' });
    return r.url;
  })()`);
  if (!finalUrl || !finalUrl.includes('/annonce/')) {
    log('  PAP : recherche sans resultat exploitable');
    return [];
  }
  log(`  PAP : ${finalUrl.replace('https://www.pap.fr', '')}`);

  // 3. pages de resultats
  const seen = new Set();
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const url = p === 1 ? finalUrl : pageUrl(finalUrl, p);
    await tab.goto(url, { waitMs: 4200 });
    let cards = [];
    try {
      cards = JSON.parse(await tab.page.evaluate(EXTRACT));
    } catch (e) {
      log(`  PAP page ${p} illisible : ${e.message}`);
      continue;
    }
    for (const c of cards) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const price = num(c.price);
      if (!price || !c.zip) continue;
      // PAP cherche "aux alentours" : on ne garde que les communes de la config
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
    log(`  PAP page ${p} : ${cards.length} cartes, ${out.length} retenues`);
  }
  return out;
}

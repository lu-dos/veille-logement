// Leboncoin collector — reads the real search page in the user's own Brave via CDP,
// then pulls the structured __NEXT_DATA__ payload (same data the site renders).

const EXTRACT = `(() => {
  const el = document.getElementById('__NEXT_DATA__');
  if (!el) return { error: 'no __NEXT_DATA__ (page blocked or not a search page)' };
  let j;
  try { j = JSON.parse(el.textContent); } catch (e) { return { error: 'bad json: ' + e.message }; }
  const sd = j.props?.pageProps?.searchData;
  if (!sd) return { error: 'no searchData' };
  const attr = (a, k) => (a.find(x => x.key === k) || {}).value;
  // Une annonce est "chambre en coloc" (prix par personne) et non "logement entier"
  // si le texte le dit, ou si le prix est hors marché pour la surface/le nb de pieces.
  const isRoomAd = (subject, body, price, surface, rooms) => {
    const txt = ((subject || '') + ' ' + (body || '')).toLowerCase();
    if (/\\b(chambre|colocation|coloc|colocataire)\\b/.test(txt)) return true;
    if (surface && price / surface < 9) return true;
    if (rooms && price / rooms < 300) return true;
    return false;
  };
  const ads = (sd.ads || []).map(a => ({
    id: String(a.list_id),
    subject: a.subject,
    url: a.url || ('https://www.leboncoin.fr/ad/' + a.list_id),
    price: Array.isArray(a.price) ? a.price[0] : a.price,
    city: a.location?.city,
    zip: a.location?.zipcode,
    lat: a.location?.lat,
    lon: a.location?.lng,
    rooms: Number(attr(a.attributes || [], 'rooms')) || null,
    bedrooms: Number(attr(a.attributes || [], 'bedrooms')) || null,
    surface: Number(attr(a.attributes || [], 'square')) || null,
    realEstateType: attr(a.attributes || [], 'real_estate_type'),
    owner: a.owner?.name || a.owner?.store_id ? 'pro' : 'particulier',
    publishedAt: a.first_publication_date,
    body: (a.body || '').slice(0, 1200),
    image: a.images?.small_url || a.images?.thumb_url || null,
    imageLarge: (a.images?.urls && a.images.urls[0]) || a.images?.small_url || null,
    nbImages: a.images?.nb_images || 0,
    // toutes les photos, en taille vignette (leger) pour le carrousel du rapport
    images: (a.images?.urls || []).map((u) => u.replace('rule=ad-image', 'rule=ad-small')),
  })).map(a => {
    const kind = isRoomAd(a.subject, a.body, a.price, a.surface, a.rooms) ? 'chambre-coloc' : 'appartement';
    return {
      ...a,
      kind,
      // loyer total pour 2 personnes : le logement entier, ou 2 chambres en coloc
      totalRent: kind === 'chambre-coloc' ? Math.round(a.price * 2) : a.price,
    };
  });
  return { total: sd.total, maxPages: sd.max_pages, ads };
})()`;

const BASE = 'https://www.leboncoin.fr/recherche';

export function buildUrl({ locations, category = 10, rooms = '3-6', maxPrice = 1200, page = 1 }) {
  const u = new URL(BASE);
  u.searchParams.set('category', String(category));
  u.searchParams.set('locations', locations.join(','));
  if (category === 10) u.searchParams.set('real_estate_type', '2'); // appartement
  if (rooms) u.searchParams.set('rooms', rooms);
  u.searchParams.set('price', `min-${maxPrice}`);
  // tri par date : les nouvelles annonces passent en premier, donc les pages 1-2
  // suffisent a ne rien rater (sans tri, le site renvoie un ordre de pertinence).
  u.searchParams.set('sort', 'time');
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

export async function collect(tab, queries, log = () => {}) {
  const out = [];
  for (const q of queries) {
    const url = buildUrl(q);
    log(`  → ${q.name} (${q.locations.length} villes)`);
    await tab.goto(url, { waitMs: 4000 });
    let r = await tab.page.evaluate(EXTRACT);
    // one retry: the site sometimes hydrates late
    if (r?.error || !r?.ads?.length) {
      await new Promise((res) => setTimeout(res, 3000));
      r = await tab.page.evaluate(EXTRACT);
    }
    if (r?.error) {
      log(`    ! ${r.error}`);
      continue;
    }
    const pages = Math.min(r.maxPages || 1, q.maxPages || 2);
    let ads = r.ads;
    for (let p = 2; p <= pages; p++) {
      await tab.goto(buildUrl({ ...q, page: p }), { waitMs: 3500 });
      const rr = await tab.page.evaluate(EXTRACT);
      if (rr?.ads) ads = ads.concat(rr.ads);
    }
    log(`    ${r.total} annonces, ${ads.length} récupérées`);
    out.push(...ads.map((a) => ({ ...a, source: 'leboncoin', zone: q.name })));
  }
  return out;
}

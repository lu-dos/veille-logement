// Donnees embarquees dans la page publiee pour que le TELEPHONE aille chercher
// les nouvelles annonces lui-meme, sans PC et sans runner.
//
// Pourquoi ca marche : bienici.com renvoie `access-control-allow-origin: *`
// (verifie), donc un `fetch` depuis une page GitHub Pages passe. Leboncoin et
// PAP, eux, bloquent (DataDome / Cloudflare) : ils restent PC-only.
//
// Ce module ne collecte rien : il produit un petit JSON (zones + plafonds +
// temps de trajet medians par code postal) que `lib/report.mjs` injecte dans
// le HTML. Le reste se passe dans le navigateur du telephone.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

const median = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return Math.round(v[Math.floor(v.length / 2)]);
};

export function buildLive({ cfg, ads = [] }) {
  const stateDir = path.join(ROOT, process.env.STATE_DIR || '.cache');
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(path.join(stateDir, 'bienici-zones.json'), 'utf8'));
  } catch {}

  // code postal -> zone bien'ici. Les annonces de l'API debordent sur les
  // communes voisines : ce filtre est ce qui garde seulement nos 40 communes.
  const parCp = new Map();
  const ids = new Set();
  for (const groupe of cfg.zones || []) {
    for (const loc of groupe.locations || []) {
      const cp = String(loc).split('_')[1];
      if (!cp) continue;
      const z = cache[loc];
      if (z?.id) ids.add(String(z.id));
      parCp.set(cp, { zone: groupe.name });
    }
  }

  // temps de trajet : mediane par code postal, calculee sur les annonces deja
  // notees par le PC ou le runner (elles ont un trajet reel).
  const echantillons = new Map();
  for (const a of ads) {
    if (!a?.zip || !a.travel) continue;
    if (!echantillons.has(a.zip)) echantillons.set(a.zip, { p: [], o: [], c: [] });
    const e = echantillons.get(a.zip);
    if (Number.isFinite(a.travel.pasteur)) e.p.push(a.travel.pasteur);
    if (Number.isFinite(a.travel.orsay)) e.o.push(a.travel.orsay);
    if (Number.isFinite(a.travel.carEtrechy)) e.c.push(a.travel.carEtrechy);
  }

  const pGlobal = median(ads.map((a) => a?.travel?.pasteur));
  const oGlobal = median(ads.map((a) => a?.travel?.orsay));
  const cGlobal = median(ads.map((a) => a?.travel?.carEtrechy));

  const zips = {};
  for (const [cp, info] of parCp) {
    const e = echantillons.get(cp);
    zips[cp] = [
      e?.p.length ? median(e.p) : pGlobal,
      e?.o.length ? median(e.o) : oGlobal,
      e?.c.length ? median(e.c) : cGlobal,
      info.zone,
    ];
  }

  return {
    api: 'https://www.bienici.com/realEstateAds.json',
    pageSize: 60,
    pages: cfg.sources?.live?.pages ?? 2,
    target: cfg.budget.target_total_eur,
    maxPrice: cfg.budget.max_total_eur,
    priceCeil: Math.round(
      cfg.budget.max_total_eur * (1 + (cfg.tolerances?.price_over_pct ?? 10) / 100),
    ),
    minRooms: cfg.requirements.min_rooms,
    minBedrooms: cfg.requirements.min_bedrooms,
    minSurface: cfg.tolerances?.surface_min_hard ?? 35,
    minEurPerM2: cfg.scam?.min_eur_per_m2 ?? 12,
    anchors: {
      pasteur: { ideal: cfg.anchors.pasteur.ideal_min, max: cfg.anchors.pasteur.max_min },
      orsay: { ideal: cfg.anchors.orsay.ideal_min, max: cfg.anchors.orsay.max_min },
      car: { ideal: cfg.car_anchor?.ideal_min ?? 45, weight: cfg.car_anchor?.weight ?? 8 },
    },
    zones: [...ids],
    zips,
  };
}

import { transitMinutes, carMinutes } from './geo.mjs';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ramp = (x, ideal, max) => (x == null ? 1 : clamp01((x - ideal) / Math.max(1, max - ideal)));

// ---------------------------------------------------------------------------
// 1. Filtre dur : ce qui disqualifie pour de bon.
//    (colocation, logement trop petit, prix hors budget au-dela de la tolerance)
// ---------------------------------------------------------------------------
export function hardFilter(ad, cfg) {
  const reasons = [];
  const price = Number(ad.price) || 0;
  const { max_total_eur } = cfg.budget;
  const { min_bedrooms, min_rooms } = cfg.requirements;
  const floor = cfg.scam?.min_eur_per_m2 ?? 12;
  const tol = cfg.tolerances ?? {};
  const priceCeil = max_total_eur * (1 + (tol.price_over_pct ?? 10) / 100);
  const surfaceHard = tol.surface_min_hard ?? 35;

  if (!price) reasons.push('loyer inconnu');
  if (price > priceCeil) reasons.push(`${price} € > ${Math.round(priceCeil)} €`);
  if (ad.rooms != null && ad.rooms < min_rooms) reasons.push(`${ad.rooms} pièces < ${min_rooms}`);
  if (ad.bedrooms != null && ad.bedrooms < min_bedrooms) reasons.push(`${ad.bedrooms} ch. < ${min_bedrooms}`);
  if (ad.surface != null && ad.surface < surfaceHard) reasons.push(`${ad.surface} m² < ${surfaceHard}`);
  if (ad.lat == null || ad.lon == null) reasons.push('pas de coordonnées');

  // Colocation = prix par personne, pas un logement entier. On n'en veut pas.
  if (ad.kind === 'chambre-coloc') {
    reasons.push('colocation / chambre au détail');
  } else if (ad.surface) {
    const eurM2 = price / ad.surface;
    if (eurM2 < floor) {
      reasons.push(`prix suspect (${eurM2.toFixed(1)} €/m² < ${floor}) : coloc déguisée ou arnaque`);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// 2. Notes + doutes. Un doute n'exclut pas : il envoie l'annonce en "hésitation".
// ---------------------------------------------------------------------------
export async function scoreAd(ad, cfg) {
  const from = { lat: ad.lat, lon: ad.lon };
  const [pasteur, orsay, car] = await Promise.all([
    transitMinutes(from, cfg.anchors.pasteur),
    transitMinutes(from, cfg.anchors.orsay),
    cfg.car_anchor ? carMinutes(from, cfg.car_anchor) : Promise.resolve({ minutes: null }),
  ]);

  const { max_total_eur, target_total_eur } = cfg.budget;
  let s = 100;

  const over = clamp01((ad.price - target_total_eur) / Math.max(1, max_total_eur - target_total_eur));
  s -= over * 18;

  const rp = ramp(pasteur.minutes, cfg.anchors.pasteur.ideal_min, cfg.anchors.pasteur.max_min);
  const ro = ramp(orsay.minutes, cfg.anchors.orsay.ideal_min, cfg.anchors.orsay.max_min);
  s -= rp * 30;
  s -= ro * 32;
  if (pasteur.minutes == null) s -= 12;
  if (orsay.minutes == null) s -= 12;

  if (cfg.car_anchor && car.minutes != null) {
    s -= ramp(car.minutes, cfg.car_anchor.ideal_min, cfg.car_anchor.ideal_min + 40) * (cfg.car_anchor.weight || 8);
  }

  if (ad.surface >= 60) s += 4;
  if (ad.surface >= 70) s += 2;

  s = Math.round(Math.max(0, Math.min(100, s)));

  const travel = {
    pasteur: pasteur.minutes,
    pasteurModes: pasteur.modes || [],
    orsay: orsay.minutes,
    orsayModes: orsay.modes || [],
    carEtrechy: car.minutes,
    carKm: car.km ?? null,
  };

  const flags = doubts(ad, cfg, travel, s);
  const bucket = decideBucket(ad, cfg, s, flags, travel);

  return {
    score: s,
    verdict: s >= 75 ? 'excellent' : s >= 60 ? 'bon' : s >= 45 ? 'moyen' : 'faible',
    bucket,
    flags,
    travel,
  };
}

// Ce qui empêche de dire "oui" franchement.
export function doubts(ad, cfg, travel, score) {
  const flags = [];
  const floor = cfg.scam?.min_eur_per_m2 ?? 12;
  const tol = cfg.tolerances ?? {};
  const threshold = cfg.scoring.notify_threshold;

  if (ad.bedrooms == null) flags.push('nombre de chambres non précisé dans l\'annonce');
  if (ad.surface == null) flags.push('surface non précisée');
  if (ad.price > cfg.budget.max_total_eur) {
    flags.push(`${ad.price} € : ${Math.round(ad.price - cfg.budget.max_total_eur)} € au-dessus du plafond`);
  }
  if (ad.surface && ad.surface < cfg.requirements.min_surface_m2) {
    flags.push(`${ad.surface} m² : sous les ${cfg.requirements.min_surface_m2} m² visés`);
  }
  if (ad.surface) {
    const eurM2 = ad.price / ad.surface;
    if (eurM2 < floor + 1.5) flags.push(`${eurM2.toFixed(1)} €/m² : prix bas pour la surface, à vérifier`);
  }
  if (travel.pasteur != null && travel.pasteur > cfg.anchors.pasteur.max_min) {
    flags.push(`Pasteur ${travel.pasteur} min (limite ${cfg.anchors.pasteur.max_min})`);
  }
  if (travel.orsay != null && travel.orsay > cfg.anchors.orsay.max_min) {
    flags.push(`Orsay ${travel.orsay} min (limite ${cfg.anchors.orsay.max_min})`);
  }
  if (travel.pasteur == null) flags.push('trajet Pasteur non calculé');
  if (travel.orsay == null) flags.push('trajet Orsay non calculé');
  if (score < threshold) flags.push(`note ${score}/100 sous le seuil ${threshold}`);

  return flags;
}

export function decideBucket(ad, cfg, score, flags, travel = {}) {
  const threshold = cfg.scoring.notify_threshold;
  const gap = cfg.scoring.maybe_gap ?? 20;
  const over = cfg.tolerances?.transit_over_min ?? 20;

  // Un trajet franchement hors limite n'est pas une hesitation, c'est un non.
  const pMax = cfg.anchors.pasteur.max_min + over;
  const oMax = cfg.anchors.orsay.max_min + over;
  if (travel.pasteur != null && travel.pasteur > pMax) return 'low';
  if (travel.orsay != null && travel.orsay > oMax) return 'low';

  if (score >= threshold && flags.length === 0) return 'match';
  if (score >= threshold - gap) return 'maybe';
  return 'low';
}

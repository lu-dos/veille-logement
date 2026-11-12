// Tailles des chambres, lues dans le texte libre d'une annonce.
//
// Regle absolue : on n'affiche que ce qui est ecrit. Aucune estimation, aucune
// moyenne. Une annonce qui dit "2 chambres de 12 et 11 m2" donne [12, 11] ;
// une annonce qui dit seulement "3 pieces, 2 chambres, 52 m2" ne donne rien
// (le 52 est la surface du logement, pas d'une chambre).
//
// Les deux fonctions sont volontairement autonomes : le rapport embarque leur
// source telle quelle dans la page (toString), pour que le telephone lise aussi
// les tailles des annonces qu'il trouve lui-meme dans Bien'ici.

/**
 * @param {string} texte description / corps de l'annonce
 * @returns {number[]} surfaces de chambres en m2, dans l'ordre du texte
 */
export function taillesChambres(texte) {
  const t = String(texte || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/m\s*(?:2|\u00b2)/g, 'm2')
    .replace(/metres?\s+carres?/g, 'm2')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');

  const COUPES = /[.;!?\u2022\u00b7|\n]|\s[-/]\s/;
  const AUTRE_PIECE =
    /sejour|salon|cuisine|salle de bain|salle d eau|sdb|entree|terrasse|balcon|garage|cellier|placard|bureau|wc|toilettes|dressing|couloir/;
  // mot de liaison obligatoire entre "chambre(s)" et le premier chiffre :
  // sans lui ("2 chambres 52 m2"), le chiffre est la surface du logement.
  const LIEN = /^(?:[^0-9]{0,24})?(?:[0-9]{1,2}\s*)?(?:de|d'|:|n\u00b0|\u00b0|-|\u2013|environ|taille|font|fait|mesure|\()/;

  const out = [];
  for (const clause of t.split(COUPES)) {
    const m = /chambres?/.exec(clause);
    if (!m) continue;
    // on part de la premiere occurrence de "chambre" et on s'arrete a la piece suivante
    let suite = clause.slice(m.index + m[0].length);
    const stop = AUTRE_PIECE.exec(suite);
    if (stop) suite = suite.slice(0, stop.index);
    if (!/m2/.test(suite)) continue;
    if (!LIEN.test(suite)) continue;
    const nombres = suite.match(/[0-9]{1,2}(?:[.,][0-9])?/g) || [];
    for (const brut of nombres) {
      const v = Math.round(parseFloat(brut.replace(',', '.')));
      if (v >= 4 && v <= 45) out.push(v);
    }
  }
  // une meme phrase recopiee deux fois par le site ne doit pas doubler la ligne
  const garde = [];
  for (const v of out) if (garde[garde.length - 1] !== v) garde.push(v);
  return garde.slice(0, 6);
}

/**
 * Rendu court pour la carte : "12 m² · 11 m²", "13 m² (1 sur 3)", ou "" si inconnu.
 * @param {number[]} tailles
 * @param {number|null} nb nombre de chambres annonce
 */
export function resumeChambres(tailles, nb) {
  const t = (tailles || []).filter((v) => Number(v) > 0);
  if (!t.length) return '';
  const total = Number(nb) || 0;
  const liste = t.map((v) => v + ' m²').join(' · ');
  // plusieurs chambres annoncees mais une seule dimension donnee : on le dit,
  // plutot que de laisser croire que toutes les chambres font cette taille.
  if (total > t.length) return liste + ' (' + t.length + ' sur ' + total + ')';
  return liste;
}

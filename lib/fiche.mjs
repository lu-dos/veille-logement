// Fiche d'une annonce, servie au telephone quand on tape une notification.
// C'est la piece qui manquait : une notification ntfy ne peut pas se modifier
// elle-meme, donc on ouvre une page qui, elle, sait dire "tu l'as deja ouverte".

import { taillesChambres, resumeChambres } from './chambres.mjs';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const eur = (n) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0);

const min = (n) => (n == null ? '?' : `${n} min`);

const when = (ts) =>
  ts
    ? new Date(ts).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

function chip(label, value, tone = 'neutral') {
  return `<span class="chip ${tone}"><b>${esc(label)}</b> ${esc(value)}</span>`;
}

export function renderFiche({ ad, st, cfg }) {
  const s = st || {};
  const wasSeen = !!s.seen;
  const applied = !!s.applied;
  const opens = s.opens || 0;

  const t = ad.travel || {};
  const pasteurOk = t.pasteur != null && t.pasteur <= (cfg?.anchors?.pasteur?.max_min ?? 50);
  const orsayOk = t.orsay != null && t.orsay <= (cfg?.anchors?.orsay?.max_min ?? 75);

  const imgs = (ad.images?.length ? ad.images : ad.image ? [ad.image] : []).filter(Boolean);
  const hero = ad.imageLarge || imgs[0] || null;

  const strip =
    imgs.length > 1
      ? `<div class="strip">${imgs
          .map((src) => `<img src="${esc(src)}" alt="" loading="lazy" draggable="false">`)
          .join('')}</div>`
      : '';

  const flags = ad.flags?.length
    ? `<ul class="flags">${ad.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '';

  // tailles de chambres : uniquement celles ecrites dans l'annonce
  const chTxt = resumeChambres(taillesChambres(ad.description || ad.body), ad.bedrooms);

  // bandeau d'etat : c'est LA reponse a "je veux savoir si j'ai deja clique"
  const seenBanner = wasSeen
    ? `<div class="state seen">
         <span class="dot"></span>
         <div>
           <b>Déjà ouverte</b>
           <small>1ʳᵉ ouverture le ${esc(when(s.seen))}${opens > 1 ? ` · ${opens} ouvertures` : ''}</small>
         </div>
       </div>`
    : `<div class="state fresh">
         <span class="dot"></span>
         <div>
           <b>Première ouverture</b>
           <small>elle vient d'être marquée comme vue</small>
         </div>
       </div>`;

  const appliedBanner = applied
    ? `<div class="state applied">
         <span class="dot"></span>
         <div>
           <b>Postulé</b>
           <small>le ${esc(when(s.applied))}</small>
         </div>
       </div>`
    : '';

  const id = encodeURIComponent(ad.id);
  const isPap = String(ad.source || '').includes('pap');
  const site = isPap ? 'PAP' : 'Leboncoin';
  const appliedButton = applied
    ? `<a class="btn ghost" href="/api/mark?id=${id}&field=applied&value=0&next=/ad/${id}">Annuler « postulé »</a>`
    : `<a class="btn violet" href="/api/mark?id=${id}&field=applied&value=1&next=/ad/${id}">J'ai postulé</a>`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(ad.subject)} — ${eur(ad.price)}</title>
<style>
  :root{--bg:#0f1115;--card:#171a21;--line:#252a34;--txt:#e8eaef;--mut:#9aa3b2;--ok:#3ecf8e;--bad:#ff6b6b;--acc:#ffd166;--vio:#7c5cff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 0 34px}
  .top{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;position:sticky;top:0;background:rgba(15,17,21,.94);backdrop-filter:blur(8px);z-index:5;border-bottom:1px solid var(--line)}
  .top a{color:var(--mut);text-decoration:none;font-size:14px}
  .top .id{color:#4d5666;font-size:11.5px;margin-left:auto;font-variant-numeric:tabular-nums}
  .wrap{max-width:640px;margin:0 auto;padding:0 16px}
  .hero{position:relative;margin:14px 0 0;border-radius:14px;overflow:hidden;background:#11141a;aspect-ratio:4/3}
  .hero img{width:100%;height:100%;object-fit:cover;display:block}
  .hero.empty{display:grid;place-items:center;color:#5b6473;font-size:12px;border:1px dashed var(--line)}
  .state{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:12px;margin-top:12px;border:1px solid var(--line);background:#11141a}
  .state .dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
  .state b{display:block;font-size:14px;font-weight:650}
  .state small{color:var(--mut);font-size:12px}
  .state.seen{border-color:rgba(62,207,142,.4);background:rgba(62,207,142,.07)}
  .state.seen .dot{background:var(--ok)}
  .state.fresh{border-color:rgba(255,209,102,.4);background:rgba(255,209,102,.06)}
  .state.fresh .dot{background:var(--acc)}
  .state.applied{border-color:rgba(124,92,255,.55);background:rgba(124,92,255,.1)}
  .state.applied .dot{background:var(--vio)}
  h1{font-size:18px;line-height:1.3;margin:16px 0 8px;font-weight:650}
  .price{font-size:21px;font-weight:700;letter-spacing:-.01em}
  .price small{font-size:12.5px;color:var(--mut);font-weight:400;letter-spacing:0}
  .meta{color:var(--mut);font-size:13px;margin-top:6px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
  .chip{font-size:12px;padding:4px 9px;border-radius:999px;background:#11141a;border:1px solid var(--line);color:var(--mut)}
  .chip b{color:var(--txt);font-weight:600}
  .chip.ok{border-color:rgba(62,207,142,.45)}
  .chip.bad{border-color:rgba(255,107,107,.45)}
  .chbed{margin:14px 0 0;font-size:13px;color:var(--mut)}
  .chbed b{color:var(--acc);font-weight:600}
  .flags{margin:14px 0 0;padding:10px 12px 10px 28px;background:rgba(255,209,102,.06);border:1px solid rgba(255,209,102,.22);border-radius:10px;font-size:13px;color:#e6d5a8}
  .flags li{margin:2px 0}
  .strip{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;margin-top:14px;padding-bottom:4px}
  .strip img{flex:0 0 78%;scroll-snap-align:start;border-radius:10px;height:130px;object-fit:cover;background:#11141a}
  .actions{display:grid;gap:9px;margin-top:18px}
  .btn{display:block;text-align:center;text-decoration:none;font:inherit;font-size:15px;font-weight:600;padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:#11141a;color:var(--txt)}
  .btn.primary{background:var(--ok);border-color:var(--ok);color:#06231a}
  .btn.violet{border-color:var(--vio);color:#cfc2ff;background:rgba(124,92,255,.12)}
  .btn.ghost{color:var(--mut);font-weight:500;font-size:13.5px;padding:11px 14px}
  .foot{margin-top:18px;color:#4d5666;font-size:11.5px;text-align:center}
</style></head>
<body>
<div class="top">
  <a href="/">‹ Rapport</a>
  <span class="id">#${esc(ad.id)}</span>
</div>

<div class="wrap">
  ${hero ? `<div class="hero"><img src="${esc(hero)}" alt="" draggable="false"></div>` : `<div class="hero empty">pas de photo</div>`}

  ${seenBanner}
  ${appliedBanner}

  <h1>${esc(ad.subject)}</h1>
  <div class="price">${eur(ad.price)} <small>/ mois · ${esc(ad.surface ?? '?')} m² · ${
    ad.surface ? (ad.price / ad.surface).toFixed(1) : '?'
  } €/m²</small></div>
  <div class="meta">${esc(ad.rooms ?? '?')} pièces · ${esc(ad.bedrooms ?? '?')} chambres · ${esc(ad.city)} (${esc(ad.zip)}) · via ${esc(site)}</div>

  <div class="chips">
    ${chip('Pasteur', min(t.pasteur), pasteurOk ? 'ok' : 'bad')}
    ${chip('Orsay', min(t.orsay), orsayOk ? 'ok' : 'bad')}
    ${chip('Étréchy (voiture)', min(t.carEtrechy))}
    ${chip('zone', ad.zone)}
  </div>

  ${chTxt ? `<div class="chbed">Chambres : <b>${esc(chTxt)}</b></div>` : ''}
  ${flags}
  ${strip}

  <div class="actions">
    <a class="btn primary" href="/api/open?id=${id}">Ouvrir l'annonce ${site}</a>
    ${appliedButton}
    <a class="btn ghost" href="/">Retour au rapport</a>
  </div>

  <div class="foot">page servie par ton PC · état partagé avec le rapport</div>
</div>
</body></html>`;
}

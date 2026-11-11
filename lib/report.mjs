const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const min = (n) => (n == null ? '?' : `${n} min`);

// "il y a 3 h" : plus parlant qu'une date brute sur un telephone.
function rel(iso) {
  if (!iso) return null;
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return null;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 0) return 'a venir';
  if (m < 60) return m <= 1 ? "a l'instant" : `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString('fr-FR');
}

const SRC = { leboncoin: 'Leboncoin', pap: 'PAP', bienici: 'Bien’ici', 'les deux': 'Plusieurs sites' };

function chip(label, value, tone) {
  return `<span class="chip ${tone}"><b>${esc(label)}</b> ${esc(value)}</span>`;
}

// Carrousel : fleches au survol, swipe au doigt, compteur 1/N.
function gallery(a) {
  const imgs = (a.images && a.images.length ? a.images : a.image ? [a.image] : []).filter(Boolean);
  if (!imgs.length) return `<div class="gallery empty"><span>pas de photo</span></div>`;

  const slides = imgs
    .map((src, i) => `<img src="${esc(src)}" alt="" ${i === 0 ? '' : 'loading="lazy"'} draggable="false">`)
    .join('');

  const nav =
    imgs.length > 1
      ? `<button class="nav prev" aria-label="photo precedente">‹</button>
         <button class="nav next" aria-label="photo suivante">›</button>
         <span class="pos">1/${imgs.length}</span>`
      : '';

  return `<div class="gallery" data-gal data-id="${esc(a.id)}" data-url="${esc(a.url)}">${nav}<div class="track">${slides}</div></div>`;
}

function card(a, cfg, kind) {
  const t = a.travel || {};
  const pasteurOk = t.pasteur != null && t.pasteur <= cfg.anchors.pasteur.max_min;
  const orsayOk = t.orsay != null && t.orsay <= cfg.anchors.orsay.max_min;
  const flags = a.flags?.length
    ? `<ul class="flags">${a.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '';
  const age = rel(a.publishedAt);
  const fresh = a.publishedAt && Date.now() - new Date(String(a.publishedAt).replace(' ', 'T')).getTime() < 24 * 3600 * 1000;
  const pubAt = a.publishedAt ? new Date(String(a.publishedAt).replace(' ', 'T')).getTime() : 0;
  const src = SRC[a.source] || (a.source ? String(a.source) : 'Leboncoin');

  return `
  <article class="card ${kind}" data-id="${esc(a.id)}" data-pub="${pubAt}" data-score="${Number(a.score) || 0}">
    <div class="ribbon">Postulé</div>
    ${gallery(a)}
    <div class="body">
      <header>
        <div class="score">${a.score}<small>/100</small></div>
        <div class="head">
          <h3><a href="${esc(a.otherUrl || a.url)}" target="_blank" rel="noopener">${esc(a.subject)}</a></h3>
          <div class="meta">
            <b>${eur(a.price)}</b>/mois · ${esc(a.surface ?? '?')} m² · ${a.surface ? (a.price / a.surface).toFixed(1) : '?'} €/m² ·
            ${esc(a.rooms ?? '?')} pièces · ${esc(a.bedrooms ?? '?')} ch. · ${esc(a.city)} (${esc(a.zip)})
          </div>
          <div class="when">
            ${fresh ? '<span class="new">nouveau</span> ' : ''}${age ? `publiée ${esc(age)}` : 'date inconnue'}
            · <span class="src">${esc(src)}</span>
            ${a.otherUrl ? ` · <a href="${esc(a.url)}" target="_blank" rel="noopener">aussi sur ${esc(SRC[a.source === 'les deux' ? 'pap' : 'leboncoin'] || '')}</a>` : ''}
          </div>
        </div>
      </header>
      <div class="chips">
        ${chip('Pasteur', min(t.pasteur), pasteurOk ? 'ok' : 'bad')}
        ${chip('Orsay', min(t.orsay), orsayOk ? 'ok' : 'bad')}
        ${chip('Étréchy (voiture)', min(t.carEtrechy), 'neutral')}
        ${chip('zone', a.zone, 'neutral')}
      </div>
      ${flags}
      <div class="actions">
        <button class="act seen-btn" data-act="seen">Marquer vu</button>
        <button class="act applied-btn" data-act="applied">J'ai postulé</button>
      </div>
    </div>
  </article>`;
}

function section(title, subtitle, items, cfg, kind) {
  if (!items.length) {
    return `<section class="sec"><h2>${esc(title)} <span class="count">0</span></h2>
      <p class="sub">${esc(subtitle)} — rien pour le moment.</p></section>`;
  }
  return `<section class="sec">
    <h2>${esc(title)} <span class="count">${items.length}</span></h2>
    <p class="sub">${esc(subtitle)}</p>
    ${items.map((a) => card(a, cfg, kind)).join('\n')}
  </section>`;
}

const SCRIPT = `
(function () {
  var KEY = 'coloc-hunter-state';
  // Le serveur du PC injecte window.__COLOC_LIVE__ : la, l'etat vit cote serveur.
  // Sur la page publiee (GitHub Pages), l'etat vit dans le navigateur et se synchronise
  // avec le PC quand il est joignable (adresse du tunnel lue dans tunnel.txt).
  var USE_API = !!window.__COLOC_LIVE__;
  var remote = null;
  var state = {};

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    var url = USE_API ? '/api/state' : remote ? remote + '/api/state' : null;
    if (url) {
      try {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        }).catch(function () {});
      } catch (e) {}
    }
  }

  function boot() {

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card[data-id]'));

  function get(id) { return state[id] || (state[id] = {}); }

  function paint(c) {
    var id = c.dataset.id;
    var s = state[id] || {};
    c.classList.toggle('seen', !!s.seen);
    c.classList.toggle('applied', !!s.applied);
    var ab = c.querySelector('.applied-btn');
    if (ab) { ab.textContent = s.applied ? 'Postulé' : "J'ai postulé"; ab.classList.toggle('on', !!s.applied); }
    var sb = c.querySelector('.seen-btn');
    if (sb) { sb.textContent = s.seen ? 'Vu' : 'Marquer vu'; sb.classList.toggle('on', !!s.seen); }
  }

  function counters() {
    var seen = 0, applied = 0;
    cards.forEach(function (c) {
      var s = state[c.dataset.id] || {};
      if (s.seen) seen++;
      if (s.applied) applied++;
    });
    var a = document.getElementById('stat-seen');
    var b = document.getElementById('stat-applied');
    var t = document.getElementById('stat-total');
    if (a) a.textContent = seen;
    if (b) b.textContent = applied;
    if (t) t.textContent = cards.length;
  }

  function markSeen(id) {
    if (!id) return;
    var s = get(id);
    if (!s.seen) { s.seen = Date.now(); save(); }
    var c = document.querySelector('.card[data-id="' + id + '"]');
    if (c) { paint(c); counters(); }
  }

  // 1. tout clic vers l'annonce marque la carte comme vue
  cards.forEach(function (c) {
    c.addEventListener('click', function (e) {
      var link = e.target.closest('a[href]');
      if (link) markSeen(c.dataset.id);
    });
  });

  // 2. boutons vu / postulé
  cards.forEach(function (c) {
    var id = c.dataset.id;
    var sb = c.querySelector('.seen-btn');
    var ab = c.querySelector('.applied-btn');
    if (sb) sb.addEventListener('click', function (e) {
      e.stopPropagation();
      var s = get(id);
      s.seen = s.seen ? 0 : Date.now();
      save(); paint(c); counters();
    });
    if (ab) ab.addEventListener('click', function (e) {
      e.stopPropagation();
      var s = get(id);
      s.applied = !s.applied;
      if (s.applied && !s.seen) s.seen = Date.now();
      save(); paint(c); counters();
    });
  });

  // 3. carrousel
  Array.prototype.forEach.call(document.querySelectorAll('[data-gal]'), function (g) {
    var track = g.querySelector('.track');
    var n = track.children.length;
    if (n < 2) {
      g.addEventListener('click', function () { window.open(g.dataset.url, '_blank'); markSeen(g.dataset.id); });
      return;
    }
    var pos = g.querySelector('.pos');
    var i = 0, x0 = null, dx = 0, swiped = false;

    function go(k) {
      i = (k + n) % n;
      track.style.transform = 'translateX(' + (-i * 100) + '%)';
      if (pos) pos.textContent = (i + 1) + '/' + n;
      swiped = true;
      setTimeout(function () { swiped = false; }, 60);
    }

    g.querySelector('.prev').addEventListener('click', function (e) { e.stopPropagation(); go(i - 1); });
    g.querySelector('.next').addEventListener('click', function (e) { e.stopPropagation(); go(i + 1); });

    g.addEventListener('pointerdown', function (e) { x0 = e.clientX; dx = 0; });
    g.addEventListener('pointermove', function (e) { if (x0 !== null) dx = e.clientX - x0; });
    g.addEventListener('pointerup', function () {
      if (x0 !== null && Math.abs(dx) > 30) go(i + (dx < 0 ? 1 : -1));
      x0 = null;
    });
    g.addEventListener('pointercancel', function () { x0 = null; });
    g.addEventListener('click', function (e) {
      if (swiped || Math.abs(dx) > 10) { e.preventDefault(); return; }
      window.open(g.dataset.url, '_blank');
      markSeen(g.dataset.id);
    });
  });

  // 4. filtres
  var filters = document.querySelectorAll('.filters button');
  Array.prototype.forEach.call(filters, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(filters, function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var f = b.dataset.filter;
      cards.forEach(function (c) {
        var s = state[c.dataset.id] || {};
        var show = f === 'all' ? true : f === 'todo' ? !s.seen : f === 'applied' ? !!s.applied : true;
        c.classList.toggle('hide', !show);
      });
    });
  });

  // 5. tri : score (defaut) ou date de publication
  var SORT_KEY = KEY + '-sort';
  var sortMode = 'score';
  try { sortMode = localStorage.getItem(SORT_KEY) || 'score'; } catch (e) {}

  function sortCards(mode) {
    var sections = Array.prototype.slice.call(document.querySelectorAll('.sec'));
    sections.forEach(function (sec) {
      var kids = Array.prototype.slice.call(sec.querySelectorAll('.card[data-id]'));
      kids.sort(function (a, b) {
        if (mode === 'date') {
          var da = Number(a.dataset.pub || 0), db = Number(b.dataset.pub || 0);
          if (da && db && da !== db) return db - da;
          if (da && !db) return -1;
          if (!da && db) return 1;
        }
        return Number(b.dataset.score || 0) - Number(a.dataset.score || 0);
      });
      kids.forEach(function (c) { sec.appendChild(c); });
    });
  }

  var sortBtns = document.querySelectorAll('.sortbar button');
  Array.prototype.forEach.call(sortBtns, function (b) {
    b.classList.toggle('on', b.dataset.sort === sortMode);
    b.addEventListener('click', function () {
      sortMode = b.dataset.sort;
      try { localStorage.setItem(SORT_KEY, sortMode); } catch (e) {}
      Array.prototype.forEach.call(sortBtns, function (x) { x.classList.toggle('on', x === b); });
      sortCards(sortMode);
    });
  });
  if (sortMode === 'date') sortCards('date');

  cards.forEach(paint);
  counters();
  // la synchro avec le PC peut arriver apres l'affichage : on repeint alors
  window.__colocRepaint = function () { cards.forEach(paint); counters(); };
  }

  // etat local + tentative de synchronisation avec le PC (silencieuse, 3 s max)
  function merge(local, distant) {
    var out = {};
    var keys = Object.keys(local).concat(Object.keys(distant));
    keys.forEach(function (id) {
      var a = local[id] || {}, b = distant[id] || {};
      out[id] = {
        seen: a.seen || b.seen || 0,
        lastSeen: Math.max(a.lastSeen || 0, b.lastSeen || 0),
        opens: Math.max(a.opens || 0, b.opens || 0),
        applied: a.applied || b.applied || 0,
      };
    });
    return out;
  }

  function syncRemote() {
    fetch('tunnel.txt', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        var base = (t || '').trim();
        // pas de backslash ici : ce code vit dans un gabarit, ils seraient manges
        if (base.indexOf('http') !== 0) return;
        remote = base.replace(/[/]+$/, '');
        var ctl = new AbortController();
        var timer = setTimeout(function () { ctl.abort(); }, 3000);
        return fetch(remote + '/api/state', { signal: ctl.signal })
          .then(function (r) { return r.json(); })
          .then(function (distant) {
            clearTimeout(timer);
            var before = JSON.stringify(state);
            state = merge(state, distant || {});
            if (JSON.stringify(state) !== before && window.__colocRepaint) window.__colocRepaint();
          })
          .catch(function () {
            clearTimeout(timer);
            remote = null;
          });
      })
      .catch(function () { remote = null; });
  }

  if (USE_API) {
    fetch('/api/state')
      .then(function (r) { return r.json(); })
      .then(function (s) { state = s || {}; })
      .catch(function () { state = {}; })
      .then(boot);
  } else {
    try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
    boot();          // affichage immediat, meme PC eteint
    syncRemote();    // puis on complete si le PC repond
  }
})();
`;

export function renderReport({ cfg, matches, maybes, rejected, ranAt }) {
  const floor = cfg.scam?.min_eur_per_m2 ?? 12;
  const nColoc = rejected.filter((r) =>
    r.rejectedBecause.some((w) => w.includes('colocation') || w.includes('suspect')),
  ).length;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coloc hunter — ${matches.length} retenus, ${maybes.length} hésitations</title>
<style>
  :root{--bg:#0f1115;--card:#171a21;--line:#252a34;--txt:#e8eaef;--mut:#9aa3b2;--ok:#3ecf8e;--bad:#ff6b6b;--acc:#ffd166}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 20px 60px}
  .wrap{max-width:960px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:34px 0 2px;letter-spacing:.01em;display:flex;align-items:center;gap:9px}
  h2 .count{font-size:11px;font-weight:600;color:var(--mut);background:#11141a;border:1px solid var(--line);border-radius:999px;padding:2px 8px}
  .sub{color:var(--mut);font-size:13px;margin:0 0 14px}
  .bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 4px}
  .progress{color:var(--mut);font-size:12.5px}
  .progress b{color:var(--txt)}
  .filters{display:flex;gap:6px;margin-left:auto}
  .filters button{background:#11141a;border:1px solid var(--line);color:var(--mut);font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;cursor:pointer}
  .filters button.on{background:#232a36;border-color:#39424f;color:var(--txt)}
  .sortbar{display:flex;align-items:center;gap:6px;margin:10px 0 0;font-size:12px;color:var(--mut)}
  .sortbar .lbl{margin-right:2px}
  .sortbar button{background:#11141a;border:1px solid var(--line);color:var(--mut);font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;cursor:pointer}
  .sortbar button.on{background:#232a36;border-color:#39424f;color:var(--txt)}
  .when{color:#67707f;font-size:12px;margin-top:5px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .when .new{background:rgba(62,207,142,.16);color:#8ff0c2;border:1px solid rgba(62,207,142,.45);border-radius:999px;padding:1px 7px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .when .src{color:#8b93a3}
  .when a{color:#8ab4ff;text-decoration:none}
  .card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:12px;border-left:4px solid var(--line);display:flex;gap:16px;align-items:flex-start;transition:opacity .15s}
  .card.match{border-left-color:var(--ok)}
  .card.maybe{border-left-color:var(--acc)}
  .card.hide{display:none}
  .card.applied{border-left-color:#7c5cff;background:#1a1a2b}
  .card.seen .gallery{filter:grayscale(.55) brightness(.7)}
  .card.seen .gallery::after{content:"Vu";position:absolute;inset:0;display:grid;place-items:center;font-size:13px;font-weight:700;letter-spacing:.12em;color:#fff;background:rgba(0,0,0,.42);text-transform:uppercase}
  .ribbon{display:none;position:absolute;top:-1px;right:-1px;background:#7c5cff;color:#fff;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 10px;border-radius:0 13px 0 10px;z-index:3}
  .card.applied .ribbon{display:block}

  .gallery{position:relative;flex:0 0 190px;height:140px;border-radius:10px;overflow:hidden;background:#11141a;touch-action:pan-y;cursor:pointer;user-select:none}
  .gallery.empty{display:flex;align-items:center;justify-content:center;border:1px dashed var(--line);color:#5b6473;font-size:11px;cursor:default}
  .gallery .track{display:flex;height:100%;transition:transform .22s ease;will-change:transform}
  .gallery .track img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
  .gallery .nav{position:absolute;top:50%;transform:translateY(-50%);width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:16px;line-height:1;display:none;place-items:center;cursor:pointer;padding:0;z-index:4}
  .gallery:hover .nav{display:grid}
  .gallery .nav.prev{left:5px}
  .gallery .nav.next{right:5px}
  .gallery .pos{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;padding:2px 7px;border-radius:999px;z-index:4;font-variant-numeric:tabular-nums}

  .body{flex:1;min-width:0}
  header{display:flex;gap:16px;align-items:flex-start}
  .score{font-size:26px;font-weight:700;line-height:1;min-width:64px}
  .score small{font-size:11px;color:var(--mut);font-weight:400}
  h3{margin:0 0 6px;font-size:15px;font-weight:600}
  h3 a{color:var(--txt);text-decoration:none}
  h3 a:hover{text-decoration:underline}
  .meta{color:var(--mut);font-size:13px}
  .meta b{color:var(--txt)}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .chip{font-size:12px;padding:4px 9px;border-radius:999px;background:#11141a;border:1px solid var(--line);color:var(--mut)}
  .chip b{color:var(--txt);font-weight:600}
  .chip.ok{border-color:rgba(62,207,142,.45)}
  .chip.bad{border-color:rgba(255,107,107,.45)}
  .flags{margin:12px 0 0;padding:10px 12px 10px 28px;background:rgba(255,209,102,.06);border:1px solid rgba(255,209,102,.22);border-radius:10px;font-size:13px;color:#e6d5a8}
  .flags li{margin:2px 0}
  .actions{display:flex;gap:8px;margin-top:13px}
  .act{font:inherit;font-size:12.5px;padding:6px 13px;border-radius:999px;background:#11141a;border:1px solid var(--line);color:var(--mut);cursor:pointer}
  .act:hover{border-color:#39424f;color:var(--txt)}
  .act.on{background:#1e2b24;border-color:rgba(62,207,142,.5);color:#9ff0c8}
  .applied-btn.on{background:#241f45;border-color:#7c5cff;color:#cfc2ff}
  details{margin-top:34px;color:var(--mut);font-size:13px;border-top:1px solid var(--line);padding-top:18px}
  summary{cursor:pointer}
  li{margin:2px 0}
  @media (max-width:640px){
    body{padding:20px 14px 50px}
    .card{flex-direction:column;gap:12px}
    .gallery{flex:none;width:100%;height:190px}
    .filters{margin-left:0;width:100%}
  }
</style></head>
<body><div class="wrap">
<h1>Coloc hunter</h1>
<div class="sub">Logements entiers uniquement (2 chambres min, ${eur(cfg.budget.max_total_eur)} max) · maj ${esc(ranAt.toLocaleString('fr-FR'))}</div>

<div class="bar">
  <div class="progress"><b id="stat-seen">0</b> vus · <b id="stat-applied">0</b> postulés · <b id="stat-total">0</b> annonces</div>
  <div class="filters">
    <button data-filter="all" class="on">Tout</button>
    <button data-filter="todo">Pas encore vus</button>
    <button data-filter="applied">Postulés</button>
  </div>
</div>

<div class="sortbar">
  <span class="lbl">Trier par</span>
  <button data-sort="score" class="on">Score</button>
  <button data-sort="date">Date de publication</button>
</div>

${section(
  'Retenus',
  'Tous les critères passent, aucun doute. C\'est là qu\'il faut appeler.',
  matches,
  cfg,
  'match',
)}

${section(
  'Hésitation',
  'Ça pourrait coller, mais un point bloque ou manque. À ouvrir avant d\'écarter.',
  maybes,
  cfg,
  'maybe',
)}

<details><summary>${rejected.length} annonce(s) écartée(s) — dont ${nColoc} colocation(s) / prix suspects</summary>
<p class="sub">Colocations et prix sous ${floor} €/m² : ce ne sont pas des logements entiers, écartés volontairement.</p>
<ul>${rejected
    .slice(0, 100)
    .map((r) => `<li><b>${esc(r.city)}</b> · ${eur(r.price)} · ${esc(String(r.subject)).slice(0, 70)} — <i>${esc(r.rejectedBecause.join(', '))}</i></li>`)
    .join('')}</ul>
</details>
</div>
<script>${SCRIPT}</script>
</body></html>`;
}

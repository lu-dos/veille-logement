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
  // une erreur silencieuse sur un telephone est indiagnosticable : on la garde
  // sous la main (visible dans la console et via window.__ERR__).
  window.addEventListener('error', function (e) {
    window.__ERR__ = String((e && e.message) || 'erreur') + ' @' + ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0);
  });

  var KEY = 'coloc-hunter-state';
  // Le serveur du PC injecte window.__COLOC_LIVE__ : la, l'etat vit cote serveur.
  // Sur la page publiee (GitHub Pages), l'etat vit dans le navigateur et se synchronise
  // avec le PC quand il est joignable (adresse du tunnel lue dans tunnel.txt).
  var USE_API = !!window.__COLOC_LIVE__;
  // Donnees pour interroger Bien'ici depuis le telephone (construites par lib/live.mjs).
  // L'API repond avec access-control-allow-origin: *, donc un fetch depuis cette page marche.
  var LIVE = window.__LIVE__ || null;
  var remote = null;
  var state = {};
  var cards = [];
  var filterMode = 'all';
  var sortMode = 'score';

  // tri : score (defaut) ou date de publication. Au niveau du script (pas dans
  // boot) parce que les cartes ajoutees par le telephone passent aussi par la.
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
      // on garde chaque carte dans son conteneur (la liste du telephone a le sien)
      var parent = kids.length ? kids[0].parentNode : null;
      if (!parent) return;
      kids.forEach(function (c) { parent.appendChild(c); });
    });
  }

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

  function refreshCards() {
    cards = Array.prototype.slice.call(document.querySelectorAll('.card[data-id]'));
    return cards;
  }

  function get(id) { return state[id] || (state[id] = {}); }

  function paint(c) {
    var id = c.dataset.id;
    var s = state[id] || {};
    c.classList.toggle('seen', !!s.seen);
    c.classList.toggle('applied', !!s.applied);
    var ab = c.querySelector('.applied-btn');
    if (ab) {
      ab.textContent = s.applied ? 'Postulé' : "J'ai postulé";
      ab.classList.toggle('on', !!s.applied);
    }
    var sb = c.querySelector('.seen-btn');
    if (sb) {
      sb.textContent = s.seen ? 'Vu' : 'Marquer vu';
      sb.classList.toggle('on', !!s.seen);
    }
  }

  function counters() {
    var seen = 0, applied = 0;
    refreshCards().forEach(function (c) {
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

  // Carrousel : fleches, glisser au doigt, compteur. Reutilise pour les cartes
  // trouvees par le telephone, qui sont ajoutees apres le chargement.
  function wireGallery(g) {
    var track = g.querySelector('.track');
    if (!track) return;
    var n = track.children.length;
    if (n < 2) {
      g.addEventListener('click', function () {
        window.open(g.dataset.url, '_blank');
        markSeen(g.dataset.id);
      });
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
  }

  function wireCards() {
    refreshCards().forEach(function (c) {
      if (c.dataset.wired) return;
      c.dataset.wired = '1';
      var id = c.dataset.id;
      c.addEventListener('click', function (e) {
        var link = e.target.closest('a[href]');
        if (link) markSeen(id);
      });
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
      var g = c.querySelector('[data-gal]');
      if (g) wireGallery(g);
    });
  }

  function applyFilter() {
    refreshCards().forEach(function (c) {
      var s = state[c.dataset.id] || {};
      var show = filterMode === 'all' ? true
        : filterMode === 'todo' ? !s.seen
        : filterMode === 'applied' ? !!s.applied
        : true;
      c.classList.toggle('hide', !show);
    });
  }

  // ---------------------------------------------------------------------
  // Rafraichissement depuis le telephone.
  // Le telephone interroge lui-meme Bien'ici a l'ouverture de la page : les
  // annonces publiees depuis le dernier passage arrivent sans PC et sans
  // runner. Trajets estimes par code postal (voir lib/live.mjs).
  // ---------------------------------------------------------------------
  var LIVE_KEY = KEY + '-live';
  var liveAds = [];
  var liveAt = 0;
  var liveBusy = false;

  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function euros(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' €'; }

  function deaccent(s) {
    var n = String(s || '').normalize('NFD');
    var out = '';
    for (var i = 0; i < n.length; i++) {
      var c = n.charCodeAt(i);
      if (c < 768 || c > 879) out += n.charAt(i);
    }
    return out;
  }

  function slug(s) {
    return deaccent(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function sized(u, w, hh) {
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'width=' + w + '&height=' + hh + '&fit=cover';
  }

  function loadLive() {
    try {
      var o = JSON.parse(localStorage.getItem(LIVE_KEY) || '{}');
      liveAds = (o.ads || []).filter(function (a) {
        return a && a.id && a.pubAt && Date.now() - a.pubAt < 21 * 24 * 3600 * 1000;
      });
      liveAt = o.at || 0;
    } catch (e) { liveAds = []; liveAt = 0; }
  }

  function saveLive() {
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify({ at: liveAt, ads: liveAds.slice(0, 40) }));
    } catch (e) {}
  }

  function liveStatus(txt) {
    var el = document.getElementById('live-state');
    if (el) el.textContent = txt;
  }

  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return 'il y a ' + m + ' min';
    var hh = Math.round(m / 60);
    if (hh < 24) return 'il y a ' + hh + ' h';
    return 'il y a ' + Math.round(hh / 24) + ' j';
  }

  function liveCard(a) {
    var imgs = a.images && a.images.length ? a.images : (a.image ? [a.image] : []);
    var gal;
    if (!imgs.length) {
      gal = '<div class="gallery empty"><span>pas de photo</span></div>';
    } else {
      var slides = '';
      for (var i = 0; i < imgs.length; i++) {
        slides += '<img src="' + h(imgs[i]) + '" alt="" ' + (i ? 'loading="lazy" ' : '') + 'draggable="false">';
      }
      var nav = '';
      if (imgs.length > 1) {
        nav = '<button class="nav prev" aria-label="photo precedente">&#8249;</button>' +
          '<button class="nav next" aria-label="photo suivante">&#8250;</button>' +
          '<span class="pos">1/' + imgs.length + '</span>';
      }
      gal = '<div class="gallery" data-gal data-id="' + h(a.id) + '" data-url="' + h(a.url) + '">' +
        nav + '<div class="track">' + slides + '</div></div>';
    }

    var t = a.travel || {};

    function chip(label, value, tone) {
      return '<span class="chip ' + tone + '"><b>' + h(label) + '</b> ' + h(value) + '</span>';
    }

    var flags = '';
    if (a.flags && a.flags.length) {
      flags = '<ul class="flags">';
      for (var j = 0; j < a.flags.length; j++) flags += '<li>' + h(a.flags[j]) + '</li>';
      flags += '</ul>';
    }

    var pubAt = a.pubAt || 0;
    var mins = Math.round((Date.now() - pubAt) / 60000);
    var age = !pubAt ? 'date inconnue'
      : mins < 60 ? 'il y a ' + Math.max(1, mins) + ' min'
      : mins < 1440 ? 'il y a ' + Math.round(mins / 60) + ' h'
      : 'il y a ' + Math.round(mins / 1440) + ' j';
    var eurM2 = a.surface ? (a.price / a.surface).toFixed(1) : '?';

    return '<article class="card ' + (a.bucket === 'match' ? 'match' : 'maybe') + '" data-id="' + h(a.id) +
      '" data-pub="' + pubAt + '" data-score="' + (a.score || 0) + '">' +
      '<div class="ribbon">Postulé</div>' +
      gal +
      '<div class="body"><header>' +
      '<div class="score">' + (a.score || 0) + '<small>/100</small></div>' +
      '<div class="head">' +
      '<h3><a href="' + h(a.url) + '" target="_blank" rel="noopener">' + h(a.subject) + '</a></h3>' +
      '<div class="meta"><b>' + euros(a.price) + '</b>/mois · ' + h(a.surface == null ? '?' : a.surface) + ' m² · ' +
      eurM2 + ' €/m² · ' + h(a.rooms == null ? '?' : a.rooms) + ' pièces · ' +
      h(a.bedrooms == null ? '?' : a.bedrooms) + ' ch. · ' + h(a.city) + ' (' + h(a.zip) + ')</div>' +
      '<div class="when"><span class="new">nouvelle</span> publiée ' + age +
      ' · <span class="src">Bien’ici</span></div>' +
      '</div></header>' +
      '<div class="chips">' +
      chip('Pasteur', t.pasteur == null ? '?' : t.pasteur + ' min', t.pasteur != null && t.pasteur <= LIVE.anchors.pasteur.max ? 'ok' : 'bad') +
      chip('Orsay', t.orsay == null ? '?' : t.orsay + ' min', t.orsay != null && t.orsay <= LIVE.anchors.orsay.max ? 'ok' : 'bad') +
      chip('Étréchy (voiture)', t.carEtrechy == null ? '?' : t.carEtrechy + ' min', 'neutral') +
      chip('zone', a.zone || '', 'neutral') +
      '</div>' + flags +
      '<div class="actions"><button class="act seen-btn" data-act="seen">Marquer vu</button>' +
      '<button class="act applied-btn" data-act="applied">J’ai postulé</button></div>' +
      '</div></article>';
  }

  function paintLive() {
    var sec = document.getElementById('live-sec');
    if (!sec) return;
    refreshCards();
    // une annonce deja presente dans le rapport (construit par le PC) n'est pas repetee ici
    var liste = [];
    for (var i = 0; i < liveAds.length; i++) {
      if (document.querySelector('.card[data-id="' + liveAds[i].id + '"]')) continue;
      liste.push(liveAds[i]);
    }
    var host = document.getElementById('live-list');
    if (host) host.innerHTML = liste.map(function (a) { return liveCard(a); }).join('');
    sec.style.display = liste.length ? 'block' : 'none';
    var n = document.getElementById('live-count');
    if (n) n.textContent = liste.length;
    wireCards();
    applyFilter();
    sortCards(sortMode);
    refreshCards().forEach(paint);
    counters();
  }

  function toLiveAd(a) {
    if (!a || !a.id) return null;
    var zip = a.postalCode ? String(a.postalCode) : '';
    var ref = LIVE.zips[zip];
    if (!ref) return null;

    var price = Math.round(Number(a.price) || 0);
    var surface = Math.round(Number(a.surfaceArea)) || null;
    var rooms = a.roomsQuantity == null ? null : Number(a.roomsQuantity);
    var beds = a.bedroomsQuantity == null ? null : Number(a.bedroomsQuantity);
    var desc = String(a.description || '').replace(/<[^>]+>/g, ' ').toLowerCase();

    if (!price || price > LIVE.priceCeil) return null;
    if (rooms != null && rooms < LIVE.minRooms) return null;
    if (beds != null && beds < LIVE.minBedrooms) return null;
    if (surface && surface < LIVE.minSurface) return null;
    if (surface && price / surface < LIVE.minEurPerM2) return null;
    if (desc.indexOf('colocation') >= 0 || desc.indexOf('chambre chez') >= 0) return null;

    var t = { pasteur: ref[0], orsay: ref[1], carEtrechy: ref[2] };

    function ramp(x, ideal, max) {
      if (x == null) return 1;
      var r = (x - ideal) / Math.max(1, max - ideal);
      return Math.max(0, Math.min(1, r));
    }

    var s = 100;
    var over = (price - LIVE.target) / Math.max(1, LIVE.maxPrice - LIVE.target);
    if (over > 0) s -= Math.min(1, over) * 18;
    s -= ramp(t.pasteur, LIVE.anchors.pasteur.ideal, LIVE.anchors.pasteur.max) * 30;
    s -= ramp(t.orsay, LIVE.anchors.orsay.ideal, LIVE.anchors.orsay.max) * 32;
    if (t.pasteur == null) s -= 12;
    if (t.orsay == null) s -= 12;
    s -= ramp(t.carEtrechy, LIVE.anchors.car.ideal, LIVE.anchors.car.ideal + 40) * LIVE.anchors.car.weight;
    if (surface >= 60) s += 4;
    if (surface >= 70) s += 2;
    s = Math.round(Math.max(0, Math.min(100, s)));

    var flags = [];
    if (beds == null) flags.push("nombre de chambres non précisé dans l'annonce");
    if (surface == null) flags.push('surface non précisée');
    if (price > LIVE.maxPrice) flags.push(price + ' € : ' + Math.round(price - LIVE.maxPrice) + ' € au-dessus du plafond');
    if (surface && surface < 45) flags.push(surface + ' m² : étroit pour deux');
    if (t.pasteur != null && t.pasteur > LIVE.anchors.pasteur.max) flags.push('Pasteur ' + t.pasteur + ' min (limite ' + LIVE.anchors.pasteur.max + ')');
    if (t.orsay != null && t.orsay > LIVE.anchors.orsay.max) flags.push('Orsay ' + t.orsay + ' min (limite ' + LIVE.anchors.orsay.max + ')');

    var dur = 0;
    for (var f = 0; f < flags.length; f++) {
      if (flags[f].indexOf('au-dessus du plafond') >= 0 || flags[f].indexOf('(limite') >= 0) dur++;
    }

    var typeFr = a.propertyType === 'house' ? 'maison' : 'appartement';
    var pieces = rooms || 1;
    var photos = [];
    var src = a.photos || [];
    for (var i = 0; i < src.length; i++) {
      var u = src[i] && src[i].url;
      if (u) photos.push(u);
    }

    return {
      id: 'bc-' + a.id,
      subject: a.title || (typeFr + ' ' + pieces + ' pièces ' + (a.city || '')),
      url: 'https://www.bienici.com/annonce/location/' + slug(a.city || '') + '/' + typeFr + '/' +
        pieces + 'piece' + (pieces > 1 ? 's' : '') + '/' + a.id,
      price: price,
      city: a.city || '',
      zip: zip,
      rooms: rooms,
      bedrooms: beds,
      surface: surface,
      pubAt: a.publicationDate ? new Date(a.publicationDate).getTime() : 0,
      images: photos.slice(0, 10).map(function (p) { return sized(p, 520, 390); }),
      image: photos[0] ? sized(photos[0], 400, 300) : null,
      score: s,
      bucket: s >= 60 && !dur ? 'match' : 'maybe',
      flags: flags,
      travel: t,
      zone: ref[3] || '',
    };
  }

  function refreshLive(force) {
    if (!LIVE || !LIVE.zones || !LIVE.zones.length || liveBusy) return;
    if (!force && liveAt && Date.now() - liveAt < 3 * 60000) {
      liveStatus('vérifié ' + ago(liveAt));
      return;
    }
    liveBusy = true;
    liveStatus('recherche des annonces publiées depuis…');

    var ctl = new AbortController();
    var stop = setTimeout(function () { ctl.abort(); }, 15000);

    function page(p) {
      var size = LIVE.pageSize || 60;
      var f = {
        size: size,
        from: (p - 1) * size,
        filterType: 'rent',
        propertyType: ['flat', 'house'],
        onTheMarket: [true],
        maxPrice: LIVE.priceCeil,
        minRooms: LIVE.minRooms,
        page: p,
        sortBy: 'publicationDate',
        sortOrder: 'desc',
        zoneIdsByTypes: { zoneIds: LIVE.zones },
      };
      var u = LIVE.api + '?filters=' + encodeURIComponent(JSON.stringify(f)) + '&extensionType=extended';
      return fetch(u, { signal: ctl.signal, cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (j) { return (j && j.realEstateAds) || []; });
    }

    function more(prev, p) {
      return prev.then(function (acc) {
        return page(p).then(function (l) { return acc.concat(l); }, function () { return acc; });
      });
    }

    var total = Math.max(1, LIVE.pages || 2);
    var chain = page(1);
    for (var k = 2; k <= total; k++) chain = more(chain, k);

    chain.then(function (list) {
      clearTimeout(stop);
      var connus = {};
      var i;
      for (i = 0; i < liveAds.length; i++) connus[liveAds[i].id] = 1;
      for (i = 0; i < cards.length; i++) connus[cards[i].dataset.id] = 1;

      // On ne garde que ce qui est paru depuis la derniere visite sur ce telephone
      // (avec 12 h de marge la premiere fois, 7 jours sans historique). Sinon les
      // annonces anciennes que le rapport n'a jamais affichees passeraient pour neuves.
      var depuis = liveAt ? liveAt - 12 * 3600 * 1000 : Date.now() - 7 * 24 * 3600 * 1000;

      var trouve = [];
      for (i = 0; i < list.length; i++) {
        var ad = toLiveAd(list[i]);
        if (!ad || connus[ad.id]) continue;
        if (!ad.pubAt || ad.pubAt < depuis) continue;
        connus[ad.id] = 1;
        trouve.push(ad);
      }
      trouve.sort(function (x, y) { return (y.pubAt || 0) - (x.pubAt || 0); });

      liveAds = trouve.concat(liveAds).slice(0, 40);
      liveAt = Date.now();
      saveLive();
      paintLive();
      liveStatus(trouve.length
        ? trouve.length + ' nouvelle(s) · vérifié ' + ago(liveAt)
        : 'rien de nouveau · vérifié ' + ago(liveAt));
      liveBusy = false;
    }).catch(function () {
      clearTimeout(stop);
      liveBusy = false;
      liveStatus('hors ligne — ' + (liveAt ? 'dernier essai ' + ago(liveAt) : 'jamais vérifié'));
      var sec = document.getElementById('live-sec');
      if (sec && liveAds.length) sec.style.display = 'block';
    });
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

  function boot() {

  // 1. cartes du rapport + etat deja memorise
  refreshCards();
  wireCards();

  // 2. filtres
  var filters = document.querySelectorAll('.filters button');
  Array.prototype.forEach.call(filters, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(filters, function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      filterMode = b.dataset.filter;
      applyFilter();
    });
  });

  // 3. tri : score (defaut) ou date de publication
  var SORT_KEY = KEY + '-sort';
  try { sortMode = localStorage.getItem(SORT_KEY) || 'score'; } catch (e) {}

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

  // 4. annonces trouvees par le telephone
  loadLive();
  paintLive();
  var liveBtn = document.getElementById('live-refresh');
  if (liveBtn) liveBtn.addEventListener('click', function () { refreshLive(true); });
  if (LIVE && LIVE.zones && LIVE.zones.length) {
    liveStatus(liveAt ? 'vérifié ' + ago(liveAt) : 'jamais vérifié sur cet appareil');
    refreshLive(false);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && (!liveAt || Date.now() - liveAt > 10 * 60000)) refreshLive(false);
    });
    setInterval(function () { if (!document.hidden) refreshLive(false); }, 5 * 60000);
  } else if (liveBtn) {
    liveBtn.style.display = 'none';
  }

  refreshCards().forEach(paint);
  counters();
  // la synchro avec le PC peut arriver apres l'affichage : on repeint alors
  window.__colocRepaint = function () { refreshCards().forEach(paint); counters(); };
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

export function renderReport({ cfg, matches, maybes, rejected, ranAt, live = null }) {
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
  .livebar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 0}
  .livebar button{font:inherit;font-size:12.5px;padding:7px 13px;border-radius:999px;border:1px solid rgba(77,171,247,.5);background:rgba(77,171,247,.12);color:#a9d6ff;cursor:pointer}
  .livebar button:active{background:rgba(77,171,247,.26)}
  .livebar .st{color:var(--mut);font-size:12px}
  #live-list .card{border-left-color:#4dabf7}
  #live-sec h2{color:#a9d6ff}
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

<div class="livebar">
  <button id="live-refresh">Vérifier les nouvelles annonces</button>
  <span class="st" id="live-state">…</span>
</div>

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

<section class="sec" id="live-sec" style="display:none">
  <h2>Trouvées par ton téléphone <span class="count" id="live-count">0</span></h2>
  <p class="sub">Publiées depuis le dernier passage, cherchées directement à l'ouverture de cette page — le PC peut rester éteint. Trajets estimés par code postal.</p>
  <div id="live-list"></div>
</section>

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
<script>window.__LIVE__ = ${JSON.stringify(live ?? {}).split('<').join('\\u003c')};</script>
<script>${SCRIPT}</script>
</body></html>`;
}

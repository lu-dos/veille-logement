#!/usr/bin/env node
// coloc-hunter — surveille les annonces de location dans les zones utiles
// (Pasteur 75015 + Orsay 91400) et pousse les bonnes sur le telephone.
// Trois seaux : retenus / hesitation / ecartes. Aucune colocation.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openTab, cdpAlive } from './lib/cdp.mjs';
import { openPlaywrightTab } from './lib/pw.mjs';
import { collect } from './lib/leboncoin.mjs';
import { collectPap } from './lib/pap.mjs';
import { collectCitya } from './lib/agences.mjs';
import { collectBienici } from './lib/bienici.mjs';
import { loadCache, saveCache, geocode } from './lib/geo.mjs';
import { hardFilter, scoreAd } from './lib/score.mjs';
import { notify } from './lib/notify.mjs';
import { serverBaseInfo, adActions, openUrl } from './lib/lan.mjs';
import { renderReport } from './lib/report.mjs';
import { taillesChambres, resumeChambres } from './lib/chambres.mjs';
import { buildLive } from './lib/live.mjs';
import { publish, publishLocal, PAGES_URL } from './publish.mjs';

const ROOT = import.meta.dirname;
const CFG = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
// Le topic ntfy vit dans un secret GitHub cote runner : il ne doit pas etre public.
if (process.env.NTFY_TOPIC) CFG.notify.topic = process.env.NTFY_TOPIC;
const STATE_DIR = path.join(ROOT, process.env.STATE_DIR || '.cache');
const STORE_FILE = path.join(STATE_DIR, 'store.json');
const OUT_FILE = path.join(STATE_DIR, 'last-run.json');

const args = new Set(process.argv.slice(2));
const NO_NOTIFY = args.has('--no-notify');
const DRY = args.has('--dry');
// Sans navigateur : on ne touche pas a Brave (ni Leboncoin ni PAP), seule la source
// JSON Bien'ici tourne. C'est le mode utilise sur un runner GitHub, PC eteint.
const NO_BROWSER = args.has('--no-browser') || process.env.NO_BROWSER === '1';
const NO_PUBLISH = args.has('--no-publish');
// VPS : Chromium local (Playwright) au lieu du Brave du PC. PAP y repond, Leboncoin non.
const PW = process.env.PW === '1';
const NO_LEBONCOIN = process.env.NO_LEBONCOIN === '1';
// Pas de serveur local joignable (VPS, runner) : les boutons des notifications
// renvoient vers la page publiee au lieu d'une adresse du reseau local.
const NO_SERVER = NO_BROWSER || process.env.NO_SERVER === '1';

const strip = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const log = (...a) => console.log(...a.map(strip));

async function loadJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const fmtTravel = (t) =>
  `Pasteur ${t.pasteur == null ? '?' : t.pasteur + ' min'} / Orsay ${t.orsay == null ? '?' : t.orsay + ' min'}` +
  (t.carEtrechy == null ? '' : ` / Etrechy ${t.carEtrechy} min`);

function buildMessage(a, prefix) {
  const eurM2 = a.surface ? (a.price / a.surface).toFixed(1) : '?';
  const nomSite = { leboncoin: 'Leboncoin', pap: 'PAP', bienici: "Bien'ici", citya: 'Citya' };
  const principal = a.primarySource || (a.source === 'les deux' ? 'leboncoin' : a.source) || 'leboncoin';
  const sites = [nomSite[principal] || principal];
  if (a.otherSource && a.otherSource !== principal) sites.push(nomSite[a.otherSource] || a.otherSource);
  const lines = [
    `${prefix}${a.subject}`,
    '',
    `Logement entier : ${a.price} EUR/mois (${a.surface ?? '?'} m2, ${eurM2} EUR/m2)`,
    `${a.rooms ?? '?'} pieces, ${a.bedrooms ?? '?'} chambres`,
    ...(resumeChambres(taillesChambres(a.description || a.body), a.bedrooms)
      ? [`chambres : ${resumeChambres(taillesChambres(a.description || a.body), a.bedrooms)}`]
      : []),
    fmtTravel(a.travel),
    `zone: ${a.zone}`,
    `site: ${sites.join(' + ')}`,
  ];
  if (a.flags?.length) {
    lines.push('', 'A verifier :');
    for (const f of a.flags) lines.push(`- ${f}`);
  }
  // lien direct garde dans le texte : secours si le tunnel est indisponible
  lines.push('', `ouvrir : ${a.url}`);
  return lines.join('\n');
}

async function main() {
  await mkdir(STATE_DIR, { recursive: true });
  const lockFile = path.join(STATE_DIR, 'run.lock');
  if (existsSync(lockFile)) {
    const age = Date.now() - Number(await readFile(lockFile, 'utf8').catch(() => 0));
    if (age < 15 * 60 * 1000) {
      log('run deja en cours, on saute ce tour');
      return;
    }
  }
  await writeFile(lockFile, String(Date.now()));
  try {
    await run();
  } finally {
    await rm(lockFile, { force: true });
  }
}

async function run() {
  await loadCache();
  const store = await loadJson(STORE_FILE, {});

  // Sur le PC, la memoire publiee (VPS ou runner) complete la notre : une annonce
  // deja notifiee ailleurs ne repart pas sur le telephone. On ne reprend que les
  // drapeaux, jamais les annonces inconnues.
  if (!process.env.STATE_DIR) {
    const partage = path.join(ROOT, '.cache', 'pages', '.state', 'store.json');
    if (existsSync(partage)) {
      try {
        const autre = JSON.parse(await readFile(partage, 'utf8'));
        let n = 0;
        for (const [id, a] of Object.entries(autre)) {
          const mine = store[id];
          if (!mine) continue;
          if (a.notified && !mine.notified) { mine.notified = true; n++; }
          if (a.asked && !mine.asked) { mine.asked = true; n++; }
        }
        if (n) log(`  ${n} drapeau(x) de notification repris de la memoire publiee`);
      } catch {}
    }
  }

  if (!NO_BROWSER && !PW && !(await cdpAlive())) {
    log('Brave sans CDP - relance avec restauration de session...');
    try {
      execFileSync('brave-cli', ['open', 'about:blank'], { stdio: 'ignore', shell: true, timeout: 90000 });
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
    if (!(await cdpAlive())) {
      console.error('Brave CDP injoignable sur 9222 - lance: brave-cli open about:blank');
      process.exit(2);
    }
  }

  log(`coloc-hunter ${new Date().toLocaleString('fr-FR')}${NO_BROWSER ? ' (sans navigateur)' : PW ? ' (Chromium local)' : ''}`);
  let ads = [];

  // Source 1 : Bien'ici, API JSON. Aucun navigateur, marche depuis n'importe quelle IP.
  if (CFG.sources?.bienici?.enabled !== false) {
    try {
      ads = await collectBienici(CFG, log);
    } catch (e) {
      log(`  bien'ici indisponible ce tour : ${e.message}`);
    }
  }

  // Sources 2 et 3 : Leboncoin et PAP, qui exigent un vrai navigateur.
  // Sur le PC c'est Brave (session reelle). Sur le VPS c'est Chromium + Playwright :
  // PAP y repond, Leboncoin bloque l'IP (DataDome) donc on l'ignore la-bas.
  if (!NO_BROWSER) {
    const tab = PW ? await openPlaywrightTab() : await openTab();
    try {
      if (!NO_LEBONCOIN) ads = ads.concat(await collect(tab, CFG.zones, log));
      else log('  Leboncoin ignore (IP datacenter refusee par le site)');
      // deuxieme source : PAP. Une source qui casse ne doit jamais tuer le tour.
      if (CFG.sources?.pap?.enabled !== false) {
        try {
          // PAP ne rend qu'une page par tour : on fait tourner les communes par
          // groupes, sinon les memes 15 annonces reviennent et le reste est invisible.
          const groupes = Math.max(1, CFG.sources?.pap?.groups ?? 4);
          const turnFile = path.join(STATE_DIR, 'pap-group.txt');
          const precedent = Number((await readFile(turnFile, 'utf8').catch(() => '0')).trim()) || 0;
          const groupe = ((precedent % groupes) + groupes) % groupes;
          await writeFile(turnFile, String((groupe + 1) % groupes));
          const pap = await collectPap(
            tab,
            {
              zones: CFG.zones,
              maxPrice: CFG.budget.max_total_eur,
              maxPages: CFG.sources?.pap?.maxPages ?? 2,
              group: groupe,
              groups: groupes,
            },
            log,
          );
          ads = ads.concat(pap);
        } catch (e) {
          log(`  PAP indisponible ce tour : ${e.message}`);
        }
      }
      // troisieme source : les reseaux d'agences (Citya). Le sitemap donne les
      // annonces, la fiche donne prix / surface / photos. Une source qui casse
      // ne doit jamais tuer le tour.
      if (CFG.sources?.citya?.enabled !== false) {
        try {
          const citya = await collectCitya(
            tab,
            {
              zones: CFG.zones,
              maxNew: CFG.sources?.citya?.maxNew ?? 6,
              cacheFile: path.join(STATE_DIR, 'citya-cache.json'),
            },
            log,
          );
          ads = ads.concat(citya);
        } catch (e) {
          log(`  Citya indisponible ce tour : ${e.message}`);
        }
      }
    } finally {
      await tab.close();
    }
  } else if (ads.length) {
    log('  Leboncoin et PAP ignores (mode sans navigateur)');
  }

  const byId = new Map();
  for (const a of ads) if (a?.id) byId.set(a.id, { ...(byId.get(a.id) || {}), ...a });
  const collected = [...byId.values()];

  // PAP ne fournit pas de coordonnees. L'API d'adresses de l'Etat tombe souvent
  // (503) : on apprend donc les coordonnees des communes sur Bien'ici, qui les
  // donne toujours, et on garde cette table d'un tour a l'autre. L'API ne sert
  // plus que pour une commune encore inconnue.
  const CITY_GEO = path.join(STATE_DIR, 'city-geo.json');
  let cityGeo = await loadJson(CITY_GEO, {});
  let appris = 0;
  for (const a of collected) {
    if (a.lat == null || a.lon == null || !a.zip) continue;
    const connu = cityGeo[a.zip];
    if (connu && connu.lat === a.lat && connu.lon === a.lon) continue;
    cityGeo[a.zip] = { lat: a.lat, lon: a.lon, city: a.city || connu?.city || '' };
    appris++;
  }
  if (appris) await writeFile(CITY_GEO, JSON.stringify(cityGeo));

  const noGeo = collected.filter((a) => (a.lat == null || a.lon == null) && a.zip);
  if (noGeo.length) {
    const spots = await pool(noGeo, 3, async (a) => {
      const local = cityGeo[a.zip];
      if (local) {
        a.lat = local.lat;
        a.lon = local.lon;
        return a;
      }
      try {
        const g = await geocode(a.city || a.zip, a.zip);
        if (g) {
          a.lat = g.lat;
          a.lon = g.lon;
          cityGeo[a.zip] = { lat: g.lat, lon: g.lon, city: a.city || '' };
        }
      } catch {}
      return a;
    });
    const ok = spots.filter((a) => a.lat != null).length;
    log(`  ${ok}/${noGeo.length} annonces geocodees (${Object.keys(cityGeo).length} communes connues)`);
  }

  // meme logement sur deux sites : on fusionne (prix + code postal + surface).
  // La premiere source garde l'identite de l'annonce, la seconde ne comble que les trous.
  const merged = new Map();
  for (const a of collected) {
    const key = `${a.zip}|${a.price}|${a.surface ?? '-'}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, a); continue; }
    const patch = {};
    for (const [k, v] of Object.entries(a)) if (v != null && v !== '') patch[k] = v;
    const memeSite = String(prev.source) === String(a.source);
    merged.set(key, {
      ...prev,
      ...patch,
      id: prev.id,
      url: prev.url,
      source: memeSite ? a.source : 'les deux',
      // deux sites pour le meme logement : on garde lequel porte l'annonce et
      // lequel la complete, pour afficher les deux badges cote a cote.
      primarySource: prev.primarySource || prev.source || 'leboncoin',
      otherSource: prev.otherSource || (memeSite ? null : a.source),
      otherUrl: prev.otherUrl || (memeSite ? null : a.url),
    });
  }
  const deduped = [...merged.values()];
  if (deduped.length !== collected.length) log(`${collected.length - deduped.length} doublon(s) entre sites fusionnes`);
  const all = deduped;
  log(`\n${all.length} annonces uniques`);

  const kept = [];
  const rejected = [];
  for (const a of all) {
    const why = hardFilter(a, CFG);
    if (why.length) rejected.push({ ...a, rejectedBecause: why });
    else kept.push(a);
  }
  const nColoc = rejected.filter((r) => r.rejectedBecause.some((w) => w.includes('colocation') || w.includes('suspect'))).length;
  log(`${kept.length} candidates | ${nColoc} coloc/prix suspects ecartes | ${rejected.length - nColoc} autres ecartes`);

  // rafraichit la fiche (photo, prix, titre) sans perdre la note deja calculee
  for (const a of kept) {
    const prev = store[a.id];
    if (prev && prev.scored) store[a.id] = { ...prev, ...a };
  }

  // horodatage de presence : une annonce vue dans cette collecte est marquee.
  // Si une source tombe (PAP muet un tour), ses annonces restent affichees
  // quelques heures au lieu de disparaitre du rapport.
  const nowIso = new Date().toISOString();
  for (const a of all) if (store[a.id]) store[a.id].lastPresentAt = nowIso;

  const fresh = kept.filter((a) => !store[a.id]?.scored);
  log(`${fresh.length} nouvelles a evaluer, ${kept.length - fresh.length} deja connues`);

  const evaluated = await pool(fresh, 4, async (a) => {
    try {
      const r = await scoreAd(a, CFG);
      return { ...a, ...r, scored: true, seenAt: new Date().toISOString() };
    } catch (e) {
      log(`  ! score ${a.id}: ${e.message}`);
      return null;
    }
  });
  await saveCache();

  for (const e of evaluated) {
    if (!e) continue;
    const prev = store[e.id] || {};
    store[e.id] = { ...e, notified: prev.notified ?? false, asked: prev.asked ?? false };
  }

  // Une source muette ne doit pas faire disparaitre ses annonces : on garde celles
  // dont la derniere presence date de moins de 36 h.
  const keptIds = new Set(kept.map((a) => a.id));
  const horizon = Date.now() - 36 * 3600 * 1000;
  const survivors = Object.values(store).filter(
    (a) =>
      a &&
      a.scored &&
      !keptIds.has(a.id) &&
      a.lastPresentAt &&
      new Date(a.lastPresentAt).getTime() > horizon,
  );
  if (survivors.length) log(`  ${survivors.length} annonce(s) gardee(s) d'un tour precedent (source muette)`);

  const results = [...kept.map((a) => store[a.id]), ...survivors]
    .filter((a) => a && a.scored)
    .sort((x, y) => y.score - x.score);

  const matches = results.filter((a) => a.bucket === 'match');
  const maybes = results.filter((a) => a.bucket === 'maybe');

  // Signature du contenu publie : elle ne bouge que si une annonce apparait,
  // disparait ou change. Sans elle, l'horodatage du rapport suffirait a republier
  // la meme page tous les quarts d'heure et a saturer GitHub Pages.
  const signature = createHash('sha1')
    .update(
      JSON.stringify(
        results.map((a) => [
          a.id, a.price, a.surface, a.bucket, a.score, a.source,
          a.primarySource || '', a.otherSource || '', a.subject,
          (a.images || []).length, a.image || '', a.publishedAt,
        ]),
      ) + '|' + rejected.length,
    )
    .digest('hex')
    .slice(0, 16);
  const sigFile = path.join(STATE_DIR, 'signature.txt');
  const signaturePrecedente = (await readFile(sigFile, 'utf8').catch(() => '')).trim();
  const changed = signaturePrecedente !== signature;
  log(changed ? '  contenu : nouveau par rapport a la derniere publication' : '  contenu : identique, rien a republier');

  const toAlert = matches.filter((a) => !store[a.id].notified).slice(0, CFG.scoring.max_alerts_per_run);
  const toAsk = CFG.scoring.notify_maybe
    ? maybes.filter((a) => !store[a.id].asked).slice(0, CFG.scoring.max_maybe_alerts_per_run)
    : [];

  if (!NO_NOTIFY && !DRY) {
    // Base des boutons : tunnel public si dispo (marche en 4G), sinon IP du LAN.
    // En mode sans navigateur (runner GitHub), il n'y a ni serveur ni tunnel :
    // le tap ouvre directement l'annonce, et un bouton ramene au rapport publie.
    const { base, via } = NO_SERVER ? { base: '', via: 'aucun (pas de serveur local)' } : serverBaseInfo(CFG);
    // Sans serveur local (VPS, runner), taper la notification n'ouvre plus le site
    // source mais LA CARTE du rapport : carrousel, prix au m2, trajets, vu/postule.
    // C'est la meme fiche que sur le site, ouverte en un tap depuis le telephone.
    const carteDe = (a) => PAGES_URL + '#a-' + encodeURIComponent(a.id);
    const click = (a) => (NO_SERVER ? carteDe(a) : openUrl(base, a));
    const actions = (a) =>
      NO_SERVER
        ? [
            { type: 'view', label: "Voir l'annonce", url: a.url },
            { type: 'view', label: 'Rapport', url: PAGES_URL },
          ]
        : adActions(base, a);
    log(`  boutons d'action via ${via}${base ? ' : ' + base : ''}`);
    for (const a of toAlert) {
      const title = `${a.score}/100 - ${a.price} EUR - ${a.city}`;
      try {
        await notify({ ...CFG.notify, clickUrl: click(a) }, title, buildMessage(a, ''), a.url, a.imageLarge || a.image, actions(a));
        store[a.id].notified = true;
        log(`  OK  ${a.city} ${a.price}EUR (${a.score}/100)`);
      } catch (e) {
        log(`  ! notif echouee: ${e.message}`);
      }
    }
    for (const a of toAsk) {
      const title = `? ${a.score}/100 - ${a.price} EUR - ${a.city}`;
      try {
        await notify({ ...CFG.notify, priority: 2, clickUrl: click(a) }, title, buildMessage(a, '[a verifier] '), a.url, a.imageLarge || a.image, actions(a));
        store[a.id].asked = true;
        log(`  ?   ${a.city} ${a.price}EUR (${a.score}/100) - ${a.flags[0] || 'a verifier'}`);
      } catch (e) {
        log(`  ! notif hesitante echouee: ${e.message}`);
      }
    }
    if (!toAlert.length && !toAsk.length) log('  rien de nouveau a notifier');
  } else {
    log(`  [dry] ${toAlert.length} notif(s) sure(s) + ${toAsk.length} hesitation(s)`);
  }

  await writeFile(STORE_FILE, JSON.stringify(store));
  await writeFile(
    OUT_FILE,
    JSON.stringify(
      { ranAt: new Date().toISOString(), total: all.length, kept: kept.length, matches: matches.length, maybes: maybes.length, rejected },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(ROOT, 'rapport.html'),
    renderReport({
      cfg: CFG,
      matches,
      maybes,
      rejected,
      ranAt: new Date(),
      // donnees embarquees : le telephone interroge Bien'ici lui-meme
      live: buildLive({ cfg: CFG, ads: results }),
    }),
  );

  log(`\n${matches.length} retenus | ${maybes.length} en hesitation | ${rejected.length} ecartes -> rapport.html`);
  for (const a of matches.slice(0, 8)) {
    log(`  OK  ${String(a.score).padStart(3)} | ${String(a.price).padStart(4)} EUR | ${a.city.padEnd(15)} | ${fmtTravel(a.travel)}`);
  }
  for (const a of maybes.slice(0, 8)) {
    log(`  ?   ${String(a.score).padStart(3)} | ${String(a.price).padStart(4)} EUR | ${a.city.padEnd(15)} | ${a.flags[0] || ''}`);
  }
  if (!matches.length && !maybes.length) log('  (rien) - elargis les zones ou monte le budget dans config.json');

  // adresse fixe (GitHub Pages) : publiee apres chaque tour, jamais bloquante.
  // Un echec reseau ici ne doit pas faire echouer la collecte.
  if (!NO_PUBLISH) {
    try {
      if (process.env.PUBLISH_LOCAL === '1') {
        // runner GitHub : le workflow commite lui-meme
        const r = publishLocal({ log, changed, signature });
        if (!r.skipped) await writeFile(sigFile, signature);
      } else {
        const pub = await publish({ log, changed, signature });
        if (!pub.skipped) await writeFile(sigFile, signature);
        if (pub.pushed) log(`  adresse fixe a jour : ${PAGES_URL}`);
      }
    } catch (e) {
      log(`  publication Pages impossible ce tour : ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('ERREUR:', e.message);
  process.exit(1);
});

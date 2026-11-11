// Publie le rapport sur GitHub Pages : une adresse FIXE, qui marche meme quand le PC
// est eteint. Le tunnel Cloudflare reste utile pour la fiche "deja cliquee" en direct,
// mais le lien que tu gardes sur ton telephone ne change plus jamais.
//
// On ne pousse que si le rapport a vraiment change (ou si l'adresse du tunnel a bouge) :
// pousser 72 fois par jour pour un horodatage different ne sert a rien et sature
// les builds GitHub.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = import.meta.dirname;
const REPO = 'lu-dos/veille-logement';
const DIR = path.join(ROOT, '.cache', 'pages');
const REPORT = path.join(ROOT, 'rapport.html');
const STATE = path.join(ROOT, '.cache', 'publish-state.json');
export const PAGES_URL = 'https://lu-dos.github.io/veille-logement/';
export const SURGE_URL = 'https://veille-logement-ludo.surge.sh/';
// surge.sh : hebergement statique gratuit, independant de GitHub (qui tombe parfois).
const SURGE_LOGIN = 'ludorouge7@gmail.com';
const SURGE_TOKEN =
  process.env.SURGE_TOKEN ||
  (() => {
    try { return readFileSync(path.join(ROOT, '.cache', 'surge-token.txt'), 'utf8').trim(); } catch { return ''; }
  })();

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: DIR, stdio: 'pipe', encoding: 'utf8', ...opts });

function prepare(html, stamp) {
  // page publique : on demande aux moteurs de ne pas l'indexer
  const noindex = '<meta name="robots" content="noindex,nofollow">';
  let out = html.replace(/<head>/i, `<head>${noindex}`);
  out = out.replace(
    '</body>',
    `<div style="text-align:center;color:#4d5666;font-size:11px;padding:22px 0 8px">
       version publiee le ${stamp} · adresse fixe, lisible PC eteint
     </div></body>`,
  );
  return out;
}

function readTunnel() {
  try { return readFileSync(path.join(ROOT, '.cache', 'tunnel-url.txt'), 'utf8').trim(); } catch { return ''; }
}

// Le PC doit rafraichir son marqueur de vie a chaque run, meme quand le rapport
// n'a pas change : sinon le runner GitHub croit le PC eteint et prend le relais.
function heartbeatFresh(dir) {
  try {
    const h = JSON.parse(readFileSync(path.join(dir, 'heartbeat.json'), 'utf8'));
    return Date.now() - new Date(h.at).getTime() < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

// Ecrit les fichiers publics dans un dossier. Le PC les pousse depuis son clone,
// le runner GitHub directement dans sa copie du depot.
function writePublicFiles(dir, { html, stamp, tunnel, heartbeat = false }) {
  writeFileSync(path.join(dir, 'index.html'), prepare(html, stamp));
  writeFileSync(path.join(dir, '.nojekyll'), '');
  // adresse du tunnel du moment : la page publiee s'en sert pour synchroniser l'etat
  // quand le PC est joignable (sinon elle reste autonome).
  writeFileSync(path.join(dir, 'tunnel.txt'), (tunnel || '') + '\n');
  // marqueur de vie du PC : le runner GitHub ne prend le relais que si le PC est muet.
  // Le runner ne doit surtout pas l'ecrire, sinon il se croirait lui-meme vivant.
  if (heartbeat) {
    writeFileSync(path.join(dir, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString(), host: 'pc' }) + '\n');
  }
  mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  try {
    writeFileSync(
      path.join(dir, '.github', 'workflows', 'pages.yml'),
      readFileSync(path.join(ROOT, 'pages-workflow.yml'), 'utf8'),
    );
  } catch {}
}

// Mode runner GitHub : on ecrit index.html a la racine du depot et on s'arrete la.
// C'est le workflow qui commite (il a le droit de pousser, pas besoin de clone).
export function publishLocal({ log = () => {} } = {}) {
  if (!existsSync(REPORT)) throw new Error('rapport.html absent');
  const stamp = new Date().toLocaleString('fr-FR');
  writePublicFiles(ROOT, { html: readFileSync(REPORT, 'utf8'), stamp, tunnel: readTunnel() });
  log(`  index.html ecrit a la racine (${stamp})`);
  return { stamp };
}

// Deuxieme adresse, volontairement hors GitHub : si Pages tombe (panne du 11/11),
// le telephone garde un lien qui rend le HTML et execute le JavaScript.
function publishSurge({ log = () => {} } = {}) {
  const SITE = path.join(ROOT, '.cache', 'surge-site');
  mkdirSync(SITE, { recursive: true });
  writeFileSync(
    path.join(SITE, 'index.html'),
    prepare(readFileSync(REPORT, 'utf8'), new Date().toLocaleString('fr-FR')),
  );
  const tunnel = readTunnel();
  if (tunnel) writeFileSync(path.join(SITE, 'tunnel.txt'), tunnel + '\n');

  const r = spawnSync('npx', ['--yes', 'surge', SITE, 'veille-logement-ludo.surge.sh'], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, SURGE_LOGIN, SURGE_TOKEN },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  if (r.status !== 0) throw new Error(`surge code ${r.status} : ${out.slice(-200)}`);
  log(`  surge : publie -> ${SURGE_URL}`);
  return SURGE_URL;
}

export async function publish({ log = () => {}, force = false } = {}) {
  if (!existsSync(REPORT)) throw new Error('rapport.html absent');

  const html = readFileSync(REPORT, 'utf8');
  const tunnel = readTunnel();
  const hash = createHash('sha1').update(html).digest('hex').slice(0, 16);

  let last = {};
  try { last = JSON.parse(readFileSync(STATE, 'utf8')); } catch {}
  if (!force && last.hash === hash && last.tunnel === tunnel && heartbeatFresh(DIR)) {
    log('  pages : deja a jour');
    return { url: PAGES_URL, pushed: false };
  }

  // adresse de secours d'abord : elle ne depend ni de GitHub ni d'un build.
  try {
    publishSurge({ log });
  } catch (e) {
    log(`  surge indisponible : ${e.message.slice(0, 120)}`);
  }

  if (!existsSync(path.join(DIR, '.git'))) {
    mkdirSync(path.dirname(DIR), { recursive: true });
    log('  pages : premier clone');
    execFileSync('git', ['clone', '--depth', '1', `https://github.com/${REPO}.git`, DIR], { stdio: 'pipe' });
  } else {
    try { git(['pull', '--rebase', '--autostash']); } catch {}
  }

  const stamp = new Date().toLocaleString('fr-FR');

  // Un seul commit, reecrit a chaque fois : pas 70 commits par jour. On repart
  // toujours du dernier etat du depot (le runner GitHub y laisse son etat), puis
  // on reecrit nos fichiers par-dessus. Reessai : le runner peut pousser en meme temps.
  for (let essai = 1; essai <= 3; essai++) {
    try {
      git(['fetch', 'origin', 'main']);
      git(['reset', '--hard', 'origin/main']);
      writePublicFiles(DIR, { html, stamp, tunnel, heartbeat: true });
      git(['add', '-A']);
      if (!git(['status', '--porcelain']).trim()) {
        writeFileSync(STATE, JSON.stringify({ hash, tunnel, at: new Date().toISOString() }));
        log('  pages : rien de neuf');
        return { url: PAGES_URL, pushed: false };
      }
      let hasCommit = true;
      try { git(['rev-parse', '--verify', 'HEAD']); } catch { hasCommit = false; }
      git(hasCommit
        ? ['commit', '--amend', '-m', 'snapshot rapport', '--no-verify']
        : ['commit', '-m', 'snapshot rapport', '--no-verify']);
      git(['push', '--force', 'origin', 'HEAD:main']);
      writeFileSync(STATE, JSON.stringify({ hash, tunnel, at: new Date().toISOString() }));
      log(`  pages : publie -> ${PAGES_URL}`);
      return { url: PAGES_URL, pushed: true };
    } catch (e) {
      if (essai === 3) throw e;
      log(`  pages : push concurrent, nouvelle tentative (${essai}/3)`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('publish.mjs')) {
  publish({ log: console.log, force: process.argv.includes('--force') })
    .then((r) => console.log(r.pushed ? `OK ${r.url}` : `deja a jour ${r.url}`))
    .catch((e) => {
      console.error('echec publication :', e.message);
      process.exit(1);
    });
}

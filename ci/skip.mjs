// Arbitrage entre collecteurs. Un seul collecte a la fois, pour ne pas notifier
// deux fois la meme annonce ni se battre sur le depot.
//
// Chacun declare d'ou il parle (heartbeat.json) et a qui il laisse la main :
//   - le VPS (OWN=vps) s'efface devant le PC, qui voit en plus Leboncoin ;
//   - le runner GitHub (OWN=runner) s'efface devant le PC et le VPS.
// Personne ne s'efface devant lui-meme : c'est ce qui permet au VPS de repartir
// toutes les 10 min sans se croire deja actif.
//
// Sans heartbeat (premier passage, ou plus personne), on collecte.
// Un lancement manuel (workflow_dispatch) collecte toujours : c'est un test voulu.
// Sortie standard = uniquement du "cle=valeur" pour $GITHUB_OUTPUT.
import { readFileSync } from 'node:fs';

const OWN = process.env.OWN || 'runner';
const DEFER_TO = (process.env.DEFER_TO || 'pc,vps')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const WINDOW = Number(process.env.WINDOW_MIN || 40);

let beat = null;
try {
  beat = JSON.parse(readFileSync('heartbeat.json', 'utf8'));
} catch {}
const at = beat && beat.at ? new Date(beat.at).getTime() : 0;
const host = beat && beat.host ? String(beat.host) : null;

const age = at ? Math.round((Date.now() - at) / 60000) : null;
const manuel = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const autreActif = at > 0 && age < WINDOW && host !== OWN && DEFER_TO.includes(host);
const skip = !manuel && autreActif;

const raison = manuel
  ? 'lancement manuel'
  : age == null
    ? 'heartbeat absent'
    : `${host || 'inconnu'} vu il y a ${age} min`;
console.error(`${raison} -> ${skip ? 'collecteur actif, on laisse la main' : 'on prend le relais'}`);
console.log(`skip=${skip}`);

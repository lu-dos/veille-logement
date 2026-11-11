// Le runner GitHub ne prend le relais que si le PC n'a rien publie depuis 40 min.
// Sans heartbeat (premier passage, ou PC eteint), il collecte.
// Un lancement manuel (workflow_dispatch) collecte toujours : c'est un test voulu.
// Sortie standard = uniquement du "cle=valeur" pour $GITHUB_OUTPUT.
import { readFileSync } from 'node:fs';

let at = 0;
try {
  at = new Date(JSON.parse(readFileSync('heartbeat.json', 'utf8')).at).getTime();
} catch {}

const age = at ? Math.round((Date.now() - at) / 60000) : null;
const manuel = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const skip = !manuel && at > 0 && age < 40;

const raison = manuel ? 'lancement manuel' : age == null ? 'heartbeat absent' : `PC vu il y a ${age} min`;
console.error(`${raison} -> ${skip ? 'PC actif, runner en veille' : 'le runner prend le relais'}`);
console.log(`skip=${skip}`);

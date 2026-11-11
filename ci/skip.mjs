// Le runner GitHub ne prend le relais que si le PC n'a rien publie depuis 40 min.
// Sans heartbeat (premier passage, ou PC eteint), il collecte.
import { readFileSync } from 'node:fs';

let at = 0;
try {
  at = new Date(JSON.parse(readFileSync('heartbeat.json', 'utf8')).at).getTime();
} catch {}

const age = at ? Math.round((Date.now() - at) / 60000) : null;
const skip = at > 0 && age < 40;

console.log(`heartbeat PC : ${age == null ? 'absent' : age + ' min'} -> ${skip ? 'PC actif, runner en veille' : 'le runner prend le relais'}`);
console.log(`skip=${skip}`);

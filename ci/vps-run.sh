#!/bin/bash
# Collecte depuis le VPS (cron, toutes les 3 min).
#
# Pourquoi : le planificateur GitHub ne livre quasiment aucun run et le PC doit
# rester allume. Le VPS, lui, tourne en permanence. Il ne collecte que lorsque le
# PC ne publie plus (heartbeat de plus de 40 min), pour ne jamais doubler.
#
# Cadence : toutes les 3 min pour reperer une annonce presque tout de suite, mais
# publication seulement quand le contenu change (voir .state/publish-skip.flag).
#
# Ce qu'il sait faire : PAP (Chromium Playwright : accepte depuis cette IP) et
# Bien'ici (API JSON). Leboncoin refuse l'IP du VPS (DataDome), il reste PC-only.
set -u

# cron demarre avec un PATH minimal : node/npm vivent dans /usr/bin ici
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME="${HOME:-/home/ludo}"

cd "$(dirname "$0")/.." || exit 1

# le journal ne doit pas grossir sans fin (cron y ecrit tout)
LOG="$HOME/veille-logement.log"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2000000 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# un seul tour a la fois
exec 9> /tmp/veille-logement.lock
flock -n 9 || { echo "tour deja en cours"; exit 0; }

# secrets : NTFY_TOPIC, SURGE_LOGIN, SURGE_TOKEN (jamais dans le depot)
if [ -f "$HOME/.veille-logement.env" ]; then
  set -a
  . "$HOME/.veille-logement.env"
  set +a
fi

export STATE_DIR=.state
export PW=1                # Chromium local au lieu du Brave du PC
export NO_LEBONCOIN=1      # site inaccessible depuis une IP datacenter
export NO_SERVER=1         # pas de serveur local : boutons vers la page publiee
export PUBLISH_LOCAL=1     # ecrit index.html a la racine du depot
export HEARTBEAT=1         # declare le VPS vivant pour le runner GitHub
export HEARTBEAT_HOST=vps
export OWN=vps             # je ne m'efface que devant le PC
export DEFER_TO=pc
export TZ=Europe/Paris

git fetch -q origin main
# On repart toujours de l'etat du depot. Un tour precedent peut s'etre arrete sans
# pousser (contenu identique) : sans ça, un arbre de travail modifie ferait echouer
# le pull suivant. Les fichiers de travail (.state/publish.json, pap-group.txt,
# signature.txt) ne sont pas suivis par git, ils survivent au reset.
git reset --hard -q origin/main

skip=$(node ci/skip.mjs 2>/dev/null | sed -n 's/^skip=//p')
if [ "$skip" = "true" ]; then
  echo "$(date -Is) un autre collecteur est actif, VPS en veille"
  exit 0
fi

echo "$(date -Is) collecte VPS"
node run.mjs
status=$?
[ $status -ne 0 ] && { echo "collecte en echec ($status)"; exit $status; }

# Contenu identique au dernier envoi : run.mjs a laisse ce drapeau. Rien a pousser
# (le marqueur de vie repart seul toutes les 12 min). C'est ce qui permet de
# collecter toutes les 3 minutes sans 480 deploiements par jour.
if [ -f .state/publish-skip.flag ]; then
  rm -f .state/publish-skip.flag
  echo "$(date -Is) rien de neuf, pas de publication"
  exit 0
fi

# copie de secours hors GitHub (le PC et le runner ne tournent pas ici)
node publish.mjs --surge 2>&1 | sed 's/^/  /' || echo "  surge indisponible ce tour"

git add -A
if git diff --cached --quiet; then
  echo "rien de neuf"
  exit 0
fi

# Un seul commit VPS dans l'historique, reecrit a chaque tour (comme le PC) :
# sinon 144 commits et 144 deploiements Pages par jour.
auteur=$(git log -1 --format=%ce 2>/dev/null || echo '')
if [ "$auteur" = "vps@veille-logement.invalid" ]; then
  git -c user.email=vps@veille-logement.invalid -c user.name="veille-logement vps" \
    commit -q --amend -m "collecte VPS $(date -u +%Y-%m-%dT%H:%MZ)"
else
  git -c user.email=vps@veille-logement.invalid -c user.name="veille-logement vps" \
    commit -qm "collecte VPS $(date -u +%Y-%m-%dT%H:%MZ)"
fi

for i in 1 2 3; do
  # notre commit reecrit : force-with-lease ne passe que si personne n'a pousse entre-temps
  if git push -q --force-with-lease origin HEAD:main; then
    echo "pousse sur le depot"
    exit 0
  fi
  git pull --rebase --autostash -q origin main || git rebase --abort
  if git push -q origin HEAD:main; then
    echo "pousse sur le depot (apres rebase)"
    exit 0
  fi
  sleep 5
done

echo "echec du push apres 3 essais"
exit 1

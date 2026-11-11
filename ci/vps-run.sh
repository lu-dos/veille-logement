#!/bin/bash
# Collecte depuis le VPS (cron, toutes les 10 min).
#
# Pourquoi : le planificateur GitHub ne livre quasiment aucun run et le PC doit
# rester allume. Le VPS, lui, tourne en permanence. Il ne collecte que lorsque le
# PC ne publie plus (heartbeat de plus de 40 min), pour ne jamais doubler.
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

git pull --rebase --autostash -q || git pull --rebase --autostash -q

skip=$(node ci/skip.mjs 2>/dev/null | sed -n 's/^skip=//p')
if [ "$skip" = "true" ]; then
  echo "$(date -Is) un autre collecteur est actif, VPS en veille"
  exit 0
fi

echo "$(date -Is) collecte VPS"
node run.mjs
status=$?
[ $status -ne 0 ] && { echo "collecte en echec ($status)"; exit $status; }

# copie de secours hors GitHub (le PC et le runner ne tournent pas ici)
node publish.mjs --surge 2>&1 | sed 's/^/  /' || echo "  surge indisponible ce tour"

git add -A
if git diff --cached --quiet; then
  echo "rien de neuf"
  exit 0
fi

git -c user.email=vps@veille-logement.invalid -c user.name="veille-logement vps" \
  commit -qm "collecte VPS $(date -u +%Y-%m-%dT%H:%MZ)"

for i in 1 2 3; do
  if git push -q origin HEAD:main; then
    echo "pousse sur le depot"
    exit 0
  fi
  git pull --rebase --autostash -q origin main || git rebase --abort
  sleep 5
done

echo "echec du push apres 3 essais"
exit 1

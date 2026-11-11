#!/bin/zsh
# Avvio senza Terminale, usato da STEM.app. Il registro va in runtime/server.log.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PORT=$(sed -n 's/^NEXUS_PORT=//p' .env 2>/dev/null); PORT=${PORT:-4321}
if curl -s -m 1 "localhost:$PORT/api/status" > /dev/null; then # già acceso: riapro l'HUD, se non c'è
  curl -s -X POST -H 'content-type: application/json' "localhost:$PORT/api/hud" > /dev/null
  exit 0
fi
[ -d node_modules/@mediapipe/tasks-vision ] || npm install --silent # anche dopo un pull che aggiunge un pacchetto
mkdir -p runtime # su una copia presa dalla repository non c'è ancora
NEXUS_APP=1 exec node server.mjs >> runtime/server.log 2>&1

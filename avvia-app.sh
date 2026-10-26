#!/bin/zsh
# Avvio senza Terminale, usato da STEM.app. Il registro va in runtime/server.log.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if curl -s -m 1 localhost:4321/api/status > /dev/null; then # già acceso: riapro solo l'HUD
  curl -s -X POST -H 'content-type: application/json' localhost:4321/api/hud > /dev/null
  exit 0
fi
[ -d node_modules ] || npm install --silent
STEM_APP=1 exec node server.mjs >> runtime/server.log 2>&1

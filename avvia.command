#!/bin/zsh
# Doppio clic per avviare Nexus. Chiudi questa finestra per spegnerlo.
cd "$(dirname "$0")"
[ -d node_modules/@mediapipe/tasks-vision ] || npm install --silent # anche dopo un pull che aggiunge un pacchetto
exec node server.mjs

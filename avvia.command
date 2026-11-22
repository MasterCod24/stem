#!/bin/zsh
# Doppio clic per avviare Nexus. Chiudi questa finestra per spegnerlo.
cd "$(dirname "$0")"
[ -d node_modules/@mediapipe/tasks-vision ] || npm install --silent # anche dopo un pull che aggiunge un pacchetto
[ -f runtime/kokoro/kokoro-v1.0.onnx ] || ./installa-kokoro.sh # la voce, la prima volta: circa 500 MB
exec node server.mjs

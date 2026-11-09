#!/bin/zsh
# Doppio clic per avviare STEM. Chiudi questa finestra per spegnerlo.
cd "$(dirname "$0")"
[ -d node_modules/@mediapipe/tasks-vision ] || npm install --silent # anche dopo un pull che aggiunge un pacchetto

if ! grep -qE '^ELEVENLABS_API_KEY=sk_[0-9A-Za-z]+$' .env 2>/dev/null; then
  echo "Incolla la chiave ElevenLabs UNA volta e premi invio (non si vede mentre incolli; solo invio = voce di sistema):"
  read -s RAW
  # Tiene solo l'ultima cosa che ha la forma di una chiave, anche se hai incollato altro testo
  KEY=$(print -r -- "$RAW" | grep -oE 'sk_[0-9A-Za-z]+' | tail -1)
  unset RAW
  if [ -n "$KEY" ]; then
    touch .env
    grep -v '^ELEVENLABS_API_KEY=' .env > .env.tmp
    echo "ELEVENLABS_API_KEY=$KEY" >> .env.tmp
    mv .env.tmp .env
    chmod 600 .env
    echo "Chiave ricevuta: sk_…${KEY: -4} (${#KEY} caratteri), salvata in .env"
  else
    echo "Nessuna chiave riconosciuta: uso la voce di sistema."
  fi
  unset KEY
fi

exec node server.mjs

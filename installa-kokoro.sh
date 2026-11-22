#!/bin/zsh
# Installa la voce di Nexus (Kokoro, kokoro-onnx) in runtime/kokoro, una volta sola: Python 3.12 o 3.13 di Homebrew
# (kokoro-onnx 0.6.1 non va sul 3.14), i pacchetti alle versioni provate il 22/11 e il modello dalla release ufficiale.
# Circa 500 MB: 160 il Python, 310 il modello, 27 le voci. Il modello entra solo se l'impronta SHA-256 è quella giusta.
set -e
cd "$(dirname "$0")"
D=runtime/kokoro
mkdir -p $D
PY=$(command -v python3.12 || command -v python3.13 || true)
[ -n "$PY" ] || { echo "Serve Python 3.12 o 3.13: brew install python@3.12"; exit 1; }
[ -x $D/venv/bin/python ] || "$PY" -m venv $D/venv
$D/venv/bin/pip install -q --disable-pip-version-check kokoro-onnx==0.6.1 onnxruntime==1.32.0 numpy==2.5.5 phonemizer==3.6.0 espeakng-loader==0.2.4
U=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
for riga in 'kokoro-v1.0.onnx 7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5' \
            'voices-v1.0.bin bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'; do
  f=${riga% *}; h=${riga#* }
  [ -f $D/$f ] && [ "$(shasum -a 256 $D/$f | cut -d' ' -f1)" = $h ] && continue
  echo "Scarico $f…"
  curl -sSL --fail -o $D/$f.tmp $U/$f
  [ "$(shasum -a 256 $D/$f.tmp | cut -d' ' -f1)" = $h ] || { rm -f $D/$f.tmp; echo "$f: l'impronta non è quella attesa, buttato"; exit 1; }
  mv $D/$f.tmp $D/$f
done
echo "Kokoro installato in $D"

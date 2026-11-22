# voce-kokoro.py — la voce di Nexus: Kokoro (kokoro-onnx) sul Mac, sempre acceso, lanciato da voice.mjs.
# Un processo solo che carica il modello una volta: `say` invece riparte e ricarica la voce a ogni frase (0,8–1,4 s anche per
# «Guardo subito.», misurato il 22/11). Niente rete: il testo arriva da voice.mjs e l'audio torna a lui.
# Ingresso, una riga JSON per frase: {"id", "testo", "voce", "velocita"}. Uscita, una riga JSON per risposta:
# {"id", "wav": base64, "ms"} oppure {"id", "errore"}. All'avvio, quando è pronto: {"pronto": true, "ms"}.
# «voce» è il nome di una voce di Kokoro («im_nicola») o una miscela: «im_nicola:0.7+bm_george:0.3».
import base64, json, os, struct, sys, time

import numpy as np
from kokoro_onnx import Kokoro

CARTELLA = sys.argv[1]
t0 = time.perf_counter()
kokoro = Kokoro(os.path.join(CARTELLA, 'kokoro-v1.0.onnx'), os.path.join(CARTELLA, 'voices-v1.0.bin'))
stili = {}

def stile(voce):
    if '+' not in voce and ':' not in voce:
        return voce  # una voce sola: kokoro-onnx la cerca da sé
    if voce not in stili:
        pesi = []
        for parte in voce.split('+'):
            nome, _, peso = parte.partition(':')
            pesi.append((nome.strip(), float(peso) if peso else 1.0))
        tot = sum(p for _, p in pesi)
        stili[voce] = sum(kokoro.get_voice_style(n) * (p / tot) for n, p in pesi).astype(np.float32)
    return stili[voce]

def wav(campioni, frequenza):  # WAV 16 bit mono: il browser lo decodifica senza altro
    pcm = (np.clip(campioni, -1, 1) * 32767).astype('<i2').tobytes()
    testa = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(pcm), b'WAVE', b'fmt ', 16, 1, 1, frequenza, frequenza * 2, 2, 16, b'data', len(pcm))
    return testa + pcm

def scrivi(o):
    sys.stdout.write(json.dumps(o) + '\n')
    sys.stdout.flush()

kokoro.create('Pronto.', voice='im_nicola', speed=1.0, lang='it')  # la prima sintesi prepara onnxruntime: non la paga Tony
scrivi({'pronto': True, 'ms': round((time.perf_counter() - t0) * 1000)})

for riga in sys.stdin:
    try:
        d = json.loads(riga)
    except ValueError:
        continue
    try:
        t = time.perf_counter()
        campioni, frequenza = kokoro.create(str(d['testo'])[:2000], voice=stile(str(d.get('voce') or 'im_nicola')),
                                            speed=float(d.get('velocita') or 1.0), lang='it')
        scrivi({'id': d.get('id'), 'wav': base64.b64encode(wav(campioni, frequenza)).decode(), 'ms': round((time.perf_counter() - t) * 1000)})
    except Exception as e:  # una frase che non va non ferma la voce
        scrivi({'id': d.get('id'), 'errore': f'{type(e).__name__}: {e}'[:300]})

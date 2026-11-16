# aiuti.py — gli attrezzi che lo script del cervello trova già pronti dentro costruisci_in_blender (gabbia.py li importa).
# Tutto in mm e nelle coordinate dell'HUD: Y in alto, come in mostra_ologramma. V() le porta in quelle di Blender (Z in alto),
# e l'esportazione glTF (Y in alto) le riporta uguali: il punto (x, y, z) scritto qui è il punto (x, y, z) del file.
# Niente primitive di Blender: le forme nascono da anelli di vertici uniti a quadrilateri (regola di Tony del 16/11).
import math
import bmesh
import bpy
from mathutils import Matrix, Vector, noise  # noise: rumore di Perlin per le superfici organiche (noise.noise(Vector((x, y, z))))

def V(x, y, z):
    """Punto dell'HUD (Y in alto) → vettore di Blender (Z in alto). Serve solo con bm.verts.new: gli attrezzi qui sotto
    prendono già coordinate dell'HUD, e passargli un V() lo convertirebbe due volte (il 16/11 il cervello l'ha fatto)."""
    return Vector((x, -z, y))

def trasforma(bm, rotazione=(0, 0, 0), posizione=(0, 0, 0), vertici=None):
    """Ruota attorno all'origine e poi sposta, in coordinate dell'HUD: «rotazione» in gradi come in mostra_ologramma
    (matrice Rx·Ry·Rz, quella di forme.js e di three.js). Per esempio una rivoluzione nasce lungo Y: (90, 0, 0) la mette
    lungo +Z. Senza vertici lavora su tutti quelli di bm."""
    rx, ry, rz = (math.radians(g) for g in rotazione)
    M = Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rz, 3, 'Z')
    t = Vector(posizione)
    for v in (vertici if vertici is not None else bm.verts):
        h = M @ Vector((v.co.x, v.co.z, -v.co.y)) + t
        v.co = V(h.x, h.y, h.z)

def anello(bm, punti):
    """Una lista di punti (x, y, z) diventa una lista di vertici."""
    return [bm.verts.new(V(*p)) for p in punti]

def loft(bm, anelli, chiuso=True):
    """Unisce a quadrilateri ogni anello al successivo. Gli anelli hanno tutti lo stesso numero di punti e lo stesso verso.
    chiuso=False per le strisce aperte (l'ultimo punto non torna al primo)."""
    for A, B in zip(anelli, anelli[1:]):
        if len(A) != len(B):
            raise ValueError(f'loft: anelli di {len(A)} e {len(B)} punti, devono essere uguali')
        n = len(A)
        for j in range(n if chiuso else n - 1):
            k = (j + 1) % n
            bm.faces.new((A[j], A[k], B[k], B[j]))

def tappo(bm, anello_v):
    """Chiude un anello di 2n vertici con n−1 quadrilateri, unendo il punto k al punto 2n−1−k.
    Va bene per gli anelli fatti a due lati affacciati: profilo_naca, profilo_tondo e i rettangoli dagli angoli tondi."""
    N = len(anello_v)
    if N % 2:
        raise ValueError(f'tappo: servono un numero pari di punti, non {N}')
    n = N // 2
    for k in range(n - 1):
        bm.faces.new((anello_v[k], anello_v[k + 1], anello_v[N - 2 - k], anello_v[N - 1 - k]))

def tappo_piano(bm, anello_v):
    """Chiude un anello piano con un n-gono piano: niente artefatti di luce, perché la faccia è piatta."""
    return bm.faces.new(anello_v)

def mezzi_passi(n):
    """2n angoli a mezzo passo: nessun punto cade proprio sul bordo d'attacco o d'uscita, e k si affaccia a 2n−1−k."""
    return [2 * math.pi * (k + 0.5) / (2 * n) for k in range(2 * n)]

def profilo_naca(corda, curvatura=0.0, pos_curvatura=0.4, spessore=0.12, n=32, uscita_min=0.6):
    """Profilo alare NACA a 4 cifre nel piano (u, v): u lungo la corda da −corda/2 a +corda/2 (bordo d'attacco a −u),
    v perpendicolare. 2n punti in senso antiorario, pronti per tappo(). uscita_min: mezzo spessore minimo in mm."""
    pts = []
    for ph in mezzi_passi(n):
        x = (1 + math.cos(ph)) / 2
        yt = 5 * spessore * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        yt = max(yt, uscita_min / corda)
        m, p = curvatura, pos_curvatura
        if m and x < p:
            yc, dy = m / p ** 2 * (2 * p * x - x * x), 2 * m / p ** 2 * (p - x)
        elif m:
            yc, dy = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x), 2 * m / (1 - p) ** 2 * (p - x)
        else:
            yc, dy = 0.0, 0.0
        th, s = math.atan(dy), (1 if ph < math.pi else -1)
        pts.append(((x - s * yt * math.sin(th) - 0.5) * corda, (yc + s * yt * math.cos(th)) * corda))
    return pts

def profilo_tondo(lungo, largo, esponente=8, n=32):
    """Rettangolo dagli angoli tondi (superellisse): esponente 2 è un'ellisse, 8 un rettangolo smussato, 40 quasi vivo.
    Stessa disposizione dei punti di profilo_naca, quindi i due si uniscono in un loft."""
    pts = []
    for ph in mezzi_passi(n):
        x = (1 + math.cos(ph)) / 2
        g = max(0.0, 1 - abs(2 * x - 1) ** esponente) ** (1 / esponente)
        pts.append(((x - 0.5) * lungo, (1 if ph < math.pi else -1) * largo / 2 * g))
    return pts

def ruota2d(pts, gradi, du=0.0, dv=0.0):
    c, s = math.cos(math.radians(gradi)), math.sin(math.radians(gradi))
    return [(u * c - v * s + du, u * s + v * c + dv) for u, v in pts]

def offset2d(pts, e):
    """Allarga (e > 0) o stringe un contorno chiuso di e mm lungo la normale: serve per i raccordi a strati."""
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    sg = 1 if area > 0 else -1
    out = []
    for i in range(n):
        (a0, b0), (a1, b1) = pts[i - 1], pts[(i + 1) % n]
        da, db = a1 - a0, b1 - b0
        L = math.hypot(da, db) or 1.0
        out.append((pts[i][0] + e * sg * db / L, pts[i][1] - e * sg * da / L))
    return out

def raccordo_circolare(r, n=8):
    """Gli strati di un raccordo di raggio r fra una parete e un piano: lista di (altezza, allargamento) dal piede alla
    fine del raccordo. Al piede la sezione è allargata di r, a quota r non lo è più."""
    out = []
    for i in range(n + 1):
        b = (math.pi / 2) * (1 - i / n)
        out.append((r * (1 - math.sin(b)), r * (1 - math.cos(b))))
    return out

def bezier(controlli, u):
    """Bézier cubica: quattro punti di controllo (tuple della stessa lunghezza), u da 0 a 1."""
    a, b = 1 - u, u
    P = controlli
    return tuple(a ** 3 * P[0][i] + 3 * a * a * b * P[1][i] + 3 * a * b * b * P[2][i] + b ** 3 * P[3][i] for i in range(len(P[0])))

def bezier_tangente(controlli, u):
    a, b = 1 - u, u
    P = controlli
    return tuple(3 * a * a * (P[1][i] - P[0][i]) + 6 * a * b * (P[2][i] - P[1][i]) + 3 * b * b * (P[3][i] - P[2][i]) for i in range(len(P[0])))

def bezier_punti(controlli, n):
    return [bezier(controlli, i / n) for i in range(n + 1)]

def rivoluzione(bm, profilo, n=96, chiuso=False):
    """Fa girare attorno all'asse Y un profilo [(r, y), …] in n passi (multiplo di 4).
    chiuso=True: il profilo è un poligono chiuso tutto fuori dall'asse (una flangia, un disco col foro, un guscio): esce un
    anello chiuso. chiuso=False: il profilo va da un punto sull'asse (r = 0) a un altro, o tocca l'asse a un capo solo:
    le punte sull'asse si chiudono con una griglia «O» di quadrilateri, alla quota del profilo. Restituisce gli anelli."""
    if n % 4:
        raise ValueError('rivoluzione: n deve essere un multiplo di 4')
    prof = [(float(r), float(y)) for r, y in profilo]
    ang = [math.pi / 4 + 2 * math.pi * j / n for j in range(n)]
    def giro(r, y):
        return [bm.verts.new(V(r * math.cos(a), y, r * math.sin(a))) for a in ang]
    if chiuso:
        anelli = [giro(r, y) for r, y in prof]
        loft(bm, anelli + [anelli[0]])
        return anelli
    capi = []
    if prof[0][0] <= 1e-6:
        capi.append('inizio')
    if prof[-1][0] <= 1e-6:
        capi.append('fine')
    corpo = prof[1 if 'inizio' in capi else 0: len(prof) - (1 if 'fine' in capi else 0)]
    if len(corpo) < 1:
        raise ValueError('rivoluzione: servono punti fuori dall\'asse')
    anelli = [giro(r, y) for r, y in corpo]
    loft(bm, anelli)
    if 'inizio' in capi:
        _tappo_o(bm, anelli[0], [prof[1], prof[0]], n)
    if 'fine' in capi:
        _tappo_o(bm, anelli[-1], [prof[-2], prof[-1]], n)
    return anelli

def _tappo_o(bm, ultimo, tratto, n):
    """Griglia «O»: un quadrato di k×k quadrilateri al centro e quattro anelli di passaggio fino all'ultimo anello.
    La quota segue il tratto di profilo dall'ultimo anello all'asse (lineare: per una punta tonda si mette un punto in più)."""
    (r0, y0), (_, y1) = tratto
    def quota(rho):
        return y1 + (y0 - y1) * min(1.0, rho / r0)
    k = n // 4
    hs = 0.5 * r0
    G = {}
    for i in range(k + 1):
        for l in range(k + 1):
            x, z = -hs + 2 * hs * i / k, -hs + 2 * hs * l / k
            G[i, l] = bm.verts.new(V(x, quota(math.hypot(x, z)), z))
    for i in range(k):
        for l in range(k):
            bm.faces.new((G[i, l], G[i + 1, l], G[i + 1, l + 1], G[i, l + 1]))
    # bordo del quadrato nello stesso verso degli anelli: angolo da π/4 (x = r cos, z = r sin), un lato ogni quarto di giro
    bordo = [G[k - m, k] for m in range(k)] + [G[0, k - m] for m in range(k)] + [G[m, 0] for m in range(k)] + [G[k, m] for m in range(k)]
    passi = [bordo]
    for s in range(1, 4):
        f = s / 4
        a = []
        for j in range(n):
            b, e = bordo[j].co, ultimo[j].co
            x, z = b.x + (e.x - b.x) * f, -(b.y + (e.y - b.y) * f)
            a.append(bm.verts.new(V(x, quota(math.hypot(x, z)), z)))
        passi.append(a)
    passi.append(ultimo)
    loft(bm, passi)

def oggetto(nome, bm, raccordo=1.0, angolo=35, collezione=None):
    """Chiude il lavoro su un pezzo: normali verso fuori, liscio dove la superficie è curva e vivo sugli spigoli oltre
    `angolo` gradi, raccordi procedurali di `raccordo` mm su quegli spigoli (0 per niente) e normali pesate.
    Ogni oggetto diventa un file GLB e un pezzo dell'ologramma: il nome è l'id del file (minuscole, cifre e trattini)."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if e.is_manifold and e.calc_face_angle(0) > math.radians(angolo):
            e.smooth = False
    me = bpy.data.meshes.new(nome)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(nome, me)
    (collezione or bpy.context.scene.collection).objects.link(ob)
    if raccordo > 0:
        bv = ob.modifiers.new('raccordi', 'BEVEL')
        bv.width, bv.segments, bv.limit_method, bv.angle_limit = raccordo, 2, 'ANGLE', math.radians(max(angolo, 40))
        bv.harden_normals, bv.use_clamp_overlap = True, True
    wn = ob.modifiers.new('normali', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    return ob

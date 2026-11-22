# vivo.py — un modello aperto in Blender davanti a Tony, comandato dalle mani dell'HUD.
# Blender -Y modello.blend --python vivo.py -- --porta 4440 --gettone <segreto>
# -Y: niente script automatici del file. Il .blend l'ha scritto il cervello, e il suo codice gira solo nella gabbia.
# Ascolta su 127.0.0.1:<porta> righe JSON {"gettone": …, "tipo": …}: i gesti di public/ologramma/gesti.js, con le
# coordinate 0..1 dello schermo, più «info», «misura» e «foto» per le prove. Chi chiede «risposta» riceve una riga JSON.
import bpy, sys, json, math, socket, threading, time, collections
from mathutils import Vector, Quaternion, Euler
from bpy_extras import view3d_utils

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(nome, d=None):
    return ARGS[ARGS.index(nome) + 1] if nome in ARGS else d
PORTA = int(arg('--porta', '4440'))
GETTONE = arg('--gettone', '')

coda = collections.deque()  # (messaggio, ora d'arrivo, connessione): li applica solo il thread di Blender
S = {'pronto': False, 'esploso': 0.0, 'presa': None, 'cursore': None, 'fase': 'spente', 'tolti': [],
     'centro': Vector(), 'raggio': 1.0, 'misura': None}
ORIG, DIREZ, PRESA = {}, {}, {}  # posizione di partenza, verso dell'esploso, spostamento a mano
disegni = collections.deque(maxlen=4000)  # istanti dei disegni del 3D
attese = []                               # ore d'arrivo dei gesti applicati e non ancora disegnati
latenze = collections.deque(maxlen=4000)  # arrivo → disegno, in ms


def ascolta():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', PORTA))
    srv.listen(4)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=cliente, args=(c,), daemon=True).start()


def cliente(c):
    with c, c.makefile('r', encoding='utf-8') as f:
        for riga in f:
            try:
                m = json.loads(riga)
            except ValueError:
                continue
            if isinstance(m, dict) and m.get('gettone') == GETTONE:
                coda.append((m, time.perf_counter(), c))


def vista():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                reg = next(r for r in area.regions if r.type == 'WINDOW')
                return win, area, reg, area.spaces.active
    return None


def pezzi():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def ingombro(objs):
    pts = [o.matrix_world @ Vector(v) for o in objs for v in o.bound_box]
    lo = Vector(tuple(min(p[i] for p in pts) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in pts) for i in range(3)))
    return (lo + hi) / 2, max((hi - lo).length / 2, 1e-6)


def prepara():
    v = vista()
    if not v:
        return False
    win, area, reg, sp = v
    objs = pezzi()
    if objs:
        S['centro'], S['raggio'] = ingombro(objs)
    for o in objs:
        ORIG[o.name] = o.location.copy()
        c, _ = ingombro([o])
        d = c - S['centro']
        # Esploso radiale dal centro del modello: i pezzi lontani vanno più lontano, quelli al centro restano
        DIREZ[o.name] = d * 1.2 + (d.normalized() * S['raggio'] * 0.35 if d.length > S['raggio'] * 1e-3 else Vector())
        o.select_set(False)
    sh = sp.shading
    sh.type = 'SOLID'
    sh.light = 'STUDIO'
    sh.show_cavity = True
    ov = sp.overlay
    ov.show_floor = False
    ov.show_axis_x = ov.show_axis_y = ov.show_axis_z = False
    ov.show_cursor = False
    ov.show_object_origins = False
    sp.clip_start = S['raggio'] / 2000
    sp.clip_end = S['raggio'] * 100
    rv = sp.region_3d
    rv.view_perspective = 'PERSP'
    rv.view_location = S['centro']
    rv.view_distance = S['raggio'] * 2.6
    rv.view_rotation = Euler((math.radians(65), 0, math.radians(-35))).to_quaternion()
    with bpy.context.temp_override(window=win, area=area):
        bpy.ops.screen.screen_full_area(use_hide_panels=True)
    bpy.types.SpaceView3D.draw_handler_add(disegna, (), 'WINDOW', 'POST_PIXEL')
    S['pronto'] = True
    return True


def sotto(x, y):
    win, area, reg, sp = vista()
    co = (x * reg.width, (1 - y) * reg.height)
    rv = sp.region_3d
    o = view3d_utils.region_2d_to_origin_3d(reg, rv, co)
    d = view3d_utils.region_2d_to_vector_3d(reg, rv, co)
    hit, _, _, _, obj, _ = bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(), o, d)
    return bpy.context.scene.objects.get(obj.name) if hit and obj else None


def esplodi(e):
    S['esploso'] = min(1.0, max(0.0, e))
    for o in pezzi():
        if o.name in ORIG:
            o.location = ORIG[o.name] + DIREZ[o.name] * S['esploso'] + PRESA.get(o.name, Vector())


def applica(m, t, conn):
    tipo = m.get('tipo')
    win, area, reg, sp = vista()
    rv = sp.region_3d
    num = lambda k, d=0.0: float(m.get(k, d)) if isinstance(m.get(k, d), (int, float)) and math.isfinite(m.get(k, d)) else d
    if tipo == 'ruota':  # come in scena.js: la mano trascina il modello
        dx, dy = max(-1, min(1, num('dx'))), max(-1, min(1, num('dy')))
        q = Quaternion((0, 0, 1), -dx * math.pi * 1.4) @ rv.view_rotation
        p = q @ Quaternion((1, 0, 0), -dy * math.pi * 0.9)
        rv.view_rotation = p if (p @ Vector((0, 1, 0))).z > 0.05 else q  # mai oltre il polo
    elif tipo == 'zoom':
        f = max(0.2, min(5, num('fattore', 1)))
        rv.view_distance = max(S['raggio'] * 0.3, min(S['raggio'] * 15, rv.view_distance / f))
    elif tipo == 'esplodi':
        esplodi(S['esploso'] + num('delta'))
    elif tipo == 'cursore':
        S['cursore'] = (num('x', 0.5), num('y', 0.5))
    elif tipo == 'stato':
        S['fase'] = m.get('fase', 'spente')
    elif tipo == 'afferra':
        o = sotto(num('x', 0.5), num('y', 0.5))
        S['presa'] = o.name if o else None
        for p in pezzi():
            p.select_set(p is o)
    elif tipo == 'sposta' and S['presa'] in bpy.context.scene.objects:
        o = bpy.context.scene.objects[S['presa']]
        a = view3d_utils.location_3d_to_region_2d(reg, rv, o.matrix_world.translation)
        if a is not None:
            b = (a[0] + num('dx') * reg.width, a[1] - num('dy') * reg.height)
            delta = view3d_utils.region_2d_to_location_3d(reg, rv, b, o.matrix_world.translation) - o.matrix_world.translation
            PRESA[o.name] = PRESA.get(o.name, Vector()) + delta
            esplodi(S['esploso'])
    elif tipo == 'lascia':
        S['presa'] = None
        for p in pezzi():
            p.select_set(False)
    elif tipo == 'lancia' and S['presa'] in bpy.context.scene.objects:  # solo il pezzo preso, come nell'HUD
        bpy.context.scene.objects[S['presa']].hide_set(True)
        S['tolti'].append(S['presa'])
        S['presa'] = None
    elif tipo == 'ricomponi':
        PRESA.clear()
        for o in pezzi():
            o.hide_set(False)
            o.select_set(False)
        S['tolti'], S['presa'] = [], None
        esplodi(0)
    elif tipo == 'misura':  # prove: disegni al secondo e ritardo arrivo → disegno
        if m.get('inizio'):
            disegni.clear(); latenze.clear(); S['misura'] = time.perf_counter()
        else:
            S['misura'] = None
            secondi = collections.Counter(int(d) for d in disegni)
            conti = sorted(secondi[k] for k in list(secondi)[1:-1]) or [0]
            lat = sorted(latenze) or [0]
            rispondi(conn, {'fps_mediana': conti[len(conti) // 2], 'fps_p10': conti[len(conti) // 10], 'fps_minimo': conti[0],
                            'latenza_mediana_ms': round(lat[len(lat) // 2], 1), 'latenza_p90_ms': round(lat[int(len(lat) * 0.9)], 1),
                            'gesti': len(lat)})
            return
    elif tipo == 'foto':
        with bpy.context.temp_override(window=win, area=area):
            bpy.ops.screen.screenshot_area(filepath=str(m.get('file')))
    if tipo in ('ruota', 'zoom', 'esplodi', 'sposta', 'cursore'):
        attese.append(t)
    if m.get('risposta'):
        rispondi(conn, info())


def info():
    rv = vista()[3].region_3d
    return {'pezzi': len(pezzi()), 'esploso': round(S['esploso'], 3), 'presa': S['presa'], 'tolti': list(S['tolti']),
            'distanza': round(rv.view_distance, 2), 'raggio': round(S['raggio'], 2),
            'spostati': sum(1 for o in pezzi() if (o.location - ORIG.get(o.name, o.location)).length > S['raggio'] * 1e-4),
            'nascosti': sum(1 for o in pezzi() if o.hide_get())}


def rispondi(conn, d):
    try:
        conn.sendall((json.dumps(d) + '\n').encode())
    except OSError:
        pass


def disegna():
    ora = time.perf_counter()
    disegni.append(ora)
    while attese:
        latenze.append((ora - attese.pop()) * 1000)
    if S['cursore'] and S['fase'] in ('pronto', 'azione'):
        import gpu
        from gpu_extras.batch import batch_for_shader
        reg = bpy.context.region
        cx, cy = S['cursore'][0] * reg.width, (1 - S['cursore'][1]) * reg.height
        r = 9 if S['presa'] else 6
        pts = [(cx, cy)] + [(cx + r * math.cos(a * math.pi / 12), cy + r * math.sin(a * math.pi / 12)) for a in range(25)]
        sh = gpu.shader.from_builtin('UNIFORM_COLOR')
        sh.uniform_float('color', (0.0, 0.94, 1.0, 0.9))
        gpu.state.blend_set('ALPHA')
        batch_for_shader(sh, 'TRI_FAN', {'pos': pts}).draw(sh)
        gpu.state.blend_set('NONE')


def giro():
    if not S['pronto']:
        return 0.0 if prepara() else 0.2
    n = 0
    while coda:
        m, t, c = coda.popleft()
        try:
            applica(m, t, c)
        except Exception as e:  # un gesto sbagliato non deve fermare Blender
            print('[vivo]', m.get('tipo'), e)
        n += 1
    if n:  # Blender ridisegna solo quando arriva un gesto, come nell'uso vero
        vista()[1].tag_redraw()
    return 0.004


threading.Thread(target=ascolta, daemon=True).start()
bpy.app.timers.register(giro, first_interval=0.3, persistent=True)

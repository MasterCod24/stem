# vivo.py — gli ologrammi di O.S.C.A.R. dentro Blender, al posto dell'HUD (richiesta di Tony del 22/11).
# Blender --factory-startup -Y --python vivo.py -- --porta <p> --gettone <segreto>
# -Y: niente script automatici dei .blend, che li ha scritti il cervello: il suo codice gira solo nella gabbia.
#
# Il server (blender.mjs) si collega a 127.0.0.1:<porta> e manda righe JSON col gettone:
#   {tipo:'ologramma', stato, mesh, percorsi, campo, info, materiali, rid}  il modello di ologramma.mjs (contratto in
#                     public/ologramma/LEGGIMI-ologramma.md), le mesh delle forme native, i percorsi dei cavi e il campo
#   {tipo:<gesto>}    i gesti di public/ologramma/gesti.js, coordinate 0..1 dello schermo
#   {tipo:'foto', file, rid}   una foto della vista, PNG largo al massimo 960 px
#   {tipo:'messaggio', testo}  una riga per la scheda (per esempio una modifica rifiutata)
# Risponde {rid, …} e manda {evento:'cambia', id, campi} quando Tony cambia un pezzo nella scheda,
# {evento:'togli', id} quando lo lancia via con le mani.
#
# Coordinate: il modello è in coordinate dell'HUD (mm, Y in alto); Blender ha Z in alto: blender = C · hud.
import bpy, blf, gpu, sys, os, json, math, socket, threading, time, collections
import numpy as np
from mathutils import Vector, Matrix, Euler
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader
from bpy.props import StringProperty, FloatProperty, EnumProperty, FloatVectorProperty, BoolProperty, CollectionProperty, PointerProperty

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(nome, d=None):
    return ARGS[ARGS.index(nome) + 1] if nome in ARGS else d
PORTA = int(arg('--porta', '4440'))
GETTONE = arg('--gettone', '')

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # HUD → Blender
CI = C.inverted()
def hb(v):  # un vettore dell'HUD in Blender
    return Vector((v[0], -v[2], v[1]))

# ---------------------------------------------------------------- colori (gli stessi dati dell'HUD, schiariti per la luce di Blender)
# Rischio = 1/fs, lo sforzo diviso lo snervamento: dal blu al viola e al magenta, rosso solo da fs 1 in giù (regola di Tony).
TAPPE_RISCHIO = [(0, (0.006, 0.04, 0.7)), (0.35, (0.1, 0.03, 0.8)), (0.6, (0.42, 0.02, 0.55)), (0.9, (0.6, 0.02, 0.42)), (0.985, (0.68, 0.02, 0.32)), (1, (1, 0.1, 0.01))]
# Densità dal blu petrolio (leggero) al ciano (denso), in scala logaritmica dal PA12 all'acciaio. Nell'HUD stava sotto la
# soglia del bagliore; qui è tre volte più chiara, se no sotto la luce di Blender è quasi nera.
TAPPE_DENSITA = [(0, (0.015, 0.147, 0.368)), (0.35, (0.018, 0.297, 0.539)), (0.7, (0.024, 0.472, 0.656)), (1, (0.036, 0.684, 0.805))]
DENSITA_SCALA = (900, 8000)
GRIGIO = (0.62, 0.64, 0.67)
SPENTO = (0.16, 0.17, 0.18)
# Flussi dichiarati sui cavi: colore, impulsi al secondo, passo in raggi del cavo, coda in frazioni del passo (come l'HUD)
FLUSSO = {'elettrico': ((0.85, 0.98, 1.0), 3.4, 8, 0.1), 'fluido': ((0.12, 0.31, 1.0), 0.45, 16, 0.6),
          'aria': ((0.62, 0.86, 0.93), 0.9, 11, 0.42), 'dati': ((0.24, 1.0, 0.82), 2.6, 5, 0.22)}


def scala(tappe, t):
    t = min(1.0, max(0.0, t if math.isfinite(t) else 0.0))
    k = 0
    while k < len(tappe) - 2 and t > tappe[k + 1][0]:
        k += 1
    (t0, a), (t1, b) = tappe[k], tappe[k + 1]
    w = (t - t0) / (t1 - t0)
    return tuple(a[c] + (b[c] - a[c]) * w for c in range(3))


def scala_np(tappe, t):
    t = np.clip(np.nan_to_num(t), 0, 1)
    xs = np.array([x for x, _ in tappe])
    return np.stack([np.interp(t, xs, [c[i] for _, c in tappe]) for i in range(3)], axis=1)


def colore_densita(rho):
    if not rho:
        return SPENTO
    return scala(TAPPE_DENSITA, math.log(rho / DENSITA_SCALA[0]) / math.log(DENSITA_SCALA[1] / DENSITA_SCALA[0]))


def da_hex(h):  # «#rrggbb» sRGB → lineare
    v = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v)


def numero(x, cifre):  # all'italiana: punto per le migliaia, virgola per i decimali
    s = f'{x:,.{cifre}f}'
    return s.replace(',', '§').replace('.', ',').replace('§', '.')


def mm_cm(mm):
    return f"{numero(mm, 1 if mm < 100 else 0)} mm · {numero(mm / 10, 2 if mm < 100 else 1)} cm"


# ---------------------------------------------------------------- stato
S = {'pronto': False, 'applicando': False, 'modello': None, 'versione': None, 'stato': None, 'modo': 'solido',
     'esploso': 0.0, 'esploso_vis': 0.0, 'presa': None, 'cursore': None, 'fase': 'spente', 'sezione': None,
     'messaggio': '', 'materiali': [], 'campo': None, 'ultimo': time.perf_counter(), 'flussi': False, 'misura': None}
PEZZI = {}  # id → {'obj', 'dati', 'base', 'centro', 'dir1', 'dir2', 'D2', 'presa', 'firma', 'percorso'}
MODELLO = {'centro': Vector(), 'raggio': 1.0}
MODELLI_FILE = {}  # file → oggetto modello fuori dalla scena: i pezzi dello stesso file ne condividono la mesh
coda = collections.deque()
CONN = [None]
disegni = collections.deque(maxlen=4000)
attese, latenze = [], collections.deque(maxlen=4000)


def ascolta():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', PORTA))
    srv.listen(2)
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
                CONN[0] = c
                coda.append((m, time.perf_counter(), c))


def manda(d, conn=None):
    c = conn or CONN[0]
    if c:
        try:
            c.sendall((json.dumps(d) + '\n').encode())
        except OSError:
            pass


def vista():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                reg = next(r for r in area.regions if r.type == 'WINDOW')
                return win, area, reg, area.spaces.active
    return None


def ridisegna():
    v = vista()
    if v:
        v[1].tag_redraw()


# ---------------------------------------------------------------- la scheda: proprietà modificabili da Tony
def materiali_voci(self, context):
    return VOCI_MATERIALI


VOCI_MATERIALI = [('generico', 'Generico (non si calcola)', '')]


def cambiato(campo):
    def f(self, context):
        self = self.id_data.oscar  # anche una misura: il pezzo è l'oggetto che la tiene
        if S['applicando'] or self.pid not in PEZZI:
            return
        if campo == 'misure':
            valore = {m.chiave: round(m.valore, 4) for m in self.misure}
        elif campo == 'colore':
            valore = '#%02x%02x%02x' % tuple(round(max(0, min(1, c)) * 255) for c in self.colore) if self.ha_colore else ''
        else:
            valore = getattr(self, campo)
        S['messaggio'] = 'Mando la modifica a O.S.C.A.R.…'
        manda({'evento': 'cambia', 'id': self.pid, 'campi': {'misure' if campo == 'misure' else campo: valore}})
    return f


class OscarMisura(bpy.types.PropertyGroup):
    chiave: StringProperty()
    valore: FloatProperty(min=0.0001, max=100000, precision=2, unit='NONE', update=cambiato('misure'))


class OscarPezzo(bpy.types.PropertyGroup):
    pid: StringProperty()
    nome: StringProperty(maxlen=60, update=cambiato('nome'))
    materiale: EnumProperty(items=materiali_voci, update=cambiato('materiale'))
    materiale_vero: StringProperty(maxlen=60, update=cambiato('materiale_vero'))
    fattura: StringProperty(maxlen=140, update=cambiato('fattura'))
    ha_colore: BoolProperty(update=cambiato('colore'))
    colore: FloatVectorProperty(subtype='COLOR_GAMMA', size=3, min=0, max=1, default=(0.8, 0.8, 0.8), update=cambiato('colore'))
    misure: CollectionProperty(type=OscarMisura)
    forma: StringProperty()


MODI = [('solido', 'Solido', 'Il colore di ogni pezzo'), ('raggi-x', 'Raggi X', 'Si vede dentro'),
        ('densita', 'Densità', 'Dal leggero al denso'), ('sforzi', 'Sforzi', 'Dove il pezzo lavora e dove cede')]


def modo_cambiato(self, context):
    if not S['applicando']:
        applica_modo(self.oscar_modo)


def esploso_cambiato(self, context):
    if not S['applicando']:
        S['esploso'] = self.oscar_esploso


def sezione_cambiata(self, context):
    if S['applicando']:
        return
    sc = self
    S['sezione'] = None if sc.oscar_sezione == 'no' else {'asse': sc.oscar_sezione, 'posizione': sc.oscar_sezione_mm, 'verso': 1}
    applica_sezione()


class OSCAR_PT_pezzo(bpy.types.Panel):
    bl_space_type, bl_region_type, bl_category, bl_label = 'VIEW_3D', 'UI', 'O.S.C.A.R.', 'Pezzo'

    def draw(self, context):
        L = self.layout
        o = context.active_object
        if not o or not o.oscar.pid or not o.select_get():
            L.label(text='Scegli un pezzo: clic, o pizzico fermo')
            return
        p, d = o.oscar, PEZZI.get(o.oscar.pid, {}).get('dati', {})
        L.label(text=p.pid, icon='MESH_DATA')
        L.prop(p, 'nome', text='Nome')
        L.prop(p, 'materiale_vero', text='Materiale')
        L.prop(p, 'fattura', text='Come è fatto')
        L.prop(p, 'materiale', text='Calcolo')
        r = L.row(align=True)
        r.prop(p, 'ha_colore', text='Colore')
        r.prop(p, 'colore', text='')
        if p.misure:
            b = L.box()
            b.label(text='Misure (si cambiano qui)')
            for m in p.misure:
                r = b.row()
                r.prop(m, 'valore', text=m.chiave + (' (mm per unità)' if m.chiave == 'scala' else ' mm'))
                if m.chiave != 'scala':
                    r.label(text=numero(m.valore / 10, 2) + ' cm')
        b = L.box()
        b.label(text='Ingombro')
        for asse, mm in zip(('X', 'Y (alto)', 'Z'), PEZZI.get(p.pid, {}).get('dim', (0, 0, 0))):
            b.label(text=f'{asse}: {mm_cm(mm)}')
        info = PEZZI.get(p.pid, {}).get('info', '')
        for riga in info.split('\n'):
            if riga:
                L.label(text=riga)
        if d.get('flusso'):
            L.label(text=f"Flusso {d['flusso']}: disegnato, non simulato")


class OSCAR_PT_modello(bpy.types.Panel):
    bl_space_type, bl_region_type, bl_category, bl_label = 'VIEW_3D', 'UI', 'O.S.C.A.R.', 'Modello'

    def draw(self, context):
        L, sc, st = self.layout, context.scene, S['stato'] or {}
        L.label(text=(st.get('titolo') or 'Nessun modello')[:60])
        L.prop(sc, 'oscar_modo', expand=True)
        L.prop(sc, 'oscar_esploso', text='Esploso', slider=True)
        r = L.row(align=True)
        r.prop(sc, 'oscar_sezione', text='Sezione')
        if sc.oscar_sezione != 'no':
            r.prop(sc, 'oscar_sezione_mm', text='mm')
        if st.get('massa_kg'):
            L.label(text=f"Massa: {numero(st['massa_kg'], 3)} kg")
        a = st.get('analisi')
        if a and a.get('stato') == 'fatta':
            L.label(text=f"Sforzo massimo: {numero(a['sforzo_max_MPa'], 1)} MPa")
            L.label(text=f"Sicurezza minima: {numero(a['fs_min'], 2)}" + (' (cede)' if a['fs_min'] < 1 else ''))
        elif a:
            L.label(text=f"Analisi: {a.get('stato')}")
        if S['messaggio']:
            for riga in S['messaggio'].split('\n')[:4]:
                L.label(text=riga[:90])


# ---------------------------------------------------------------- dallo stato di ologramma.mjs agli oggetti di Blender
def matrice_hud(p):
    t, g = p.get('posizione') or (0, 0, 0), p.get('rotazione') or (0, 0, 0)
    r = Matrix.Rotation(math.radians(g[0]), 4, 'X') @ Matrix.Rotation(math.radians(g[1]), 4, 'Y') @ Matrix.Rotation(math.radians(g[2]), 4, 'Z')
    return Matrix.Translation(t) @ r  # mondo = T · Rx · Ry · Rz · locale, come forme.matrice


def raccolta():
    c = bpy.data.collections.get('O.S.C.A.R.')
    if not c:
        c = bpy.data.collections.new('O.S.C.A.R.')
        bpy.context.scene.collection.children.link(c)
    return c


def mesh_nativa(pid, m):
    v = np.asarray(m['v'], dtype=np.float64).reshape(-1, 3)
    f = np.asarray(m['f'], dtype=np.int64).reshape(-1, 3)
    me = bpy.data.meshes.new('oscar-' + pid)
    me.from_pydata(np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1).tolist(), [], f.tolist())
    me.validate()
    try:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(35))
    except Exception:
        pass
    return me


def modello_file(misure):
    """L'oggetto (fuori dalla scena) per un file: dal modello.blend accanto al GLB se c'è, se no importato."""
    f = misure.get('file')
    if not f:
        raise ValueError(misure.get('_errore') or 'il server non ha dato il file')
    if f in MODELLI_FILE and MODELLI_FILE[f].name in bpy.data.objects:
        return MODELLI_FILE[f]
    cartella, base = os.path.split(f)
    nome, est = os.path.splitext(base)
    est = est.lower()[1:]
    blend = os.path.join(cartella, 'modello.blend')
    ob = None
    if est == 'glb' and os.path.exists(blend):
        with bpy.data.libraries.load(blend, link=False) as (src, dst):
            dst.objects = [nome] if nome in src.objects else []
        ob = next((o for o in dst.objects if o and o.type == 'MESH'), None)
    if ob is None:
        prima = set(bpy.data.objects)
        win, area, reg, sp = vista()
        with bpy.context.temp_override(window=win, area=area, region=reg):
            if est == 'glb':
                bpy.ops.import_scene.gltf(filepath=f)
            elif est == 'stl':
                bpy.ops.wm.stl_import(filepath=f, forward_axis='NEGATIVE_Z', up_axis='Y')
            elif est == 'obj':
                bpy.ops.wm.obj_import(filepath=f, forward_axis='NEGATIVE_Z', up_axis='Y')
            elif est == 'ply':
                bpy.ops.wm.ply_import(filepath=f, forward_axis='NEGATIVE_Z', up_axis='Y')
            else:
                raise ValueError(f'Blender non apre i file .{est}')
        nuovi = [o for o in bpy.data.objects if o not in prima]
        mesh = [o for o in nuovi if o.type == 'MESH']
        if not mesh:
            raise ValueError(f'{base}: nessuna mesh nel file')
        # Tutte le mesh del file in una sola, con le trasformazioni applicate: un file è un pezzo
        dati = []
        for o in mesh:
            m = o.data.copy()
            m.transform(o.matrix_world)
            dati.append(m)
        me = dati[0]
        if len(dati) > 1:
            import bmesh
            bm = bmesh.new()
            for m in dati:
                bm.from_mesh(m)
            bm.to_mesh(me)
            bm.free()
        for o in nuovi:
            bpy.data.objects.remove(o)
        ob = bpy.data.objects.new('oscar-' + nome, me)
    # centra e scala come geometrie.leggiFile: (v − centro) · scala, in coordinate dell'HUD
    MODELLI_FILE[f] = ob
    return ob


def costruisci(pid, p, mesh):
    if p['forma'] == 'file':
        tipo = modello_file({**p['misure'], '_errore': p.get('errore')})
        ob = tipo.copy()  # condivide la mesh: 18 pale da un file solo costano una mesh
        ob.name = pid
        mw = tipo.matrix_world.copy()
        pts = [mw @ Vector(c) for c in tipo.bound_box]
        cen = sum(pts, Vector()) / 8 if p['misure'].get('centra', True) else Vector()
        k = p['misure'].get('scala', 1) or 1
        proprio = Matrix.Scale(k, 4) @ Matrix.Translation(-cen) @ mw
    else:
        ob = bpy.data.objects.new(pid, mesh_nativa(pid, mesh))
        proprio = Matrix.Identity(4)
    raccolta().objects.link(ob)
    return ob, proprio


def aggiorna_scheda(ob, p, d):
    o = ob.oscar
    o.pid, o.forma = p['id'], p['forma']
    o.nome = p.get('nome') or p['id']
    chiavi = {k for k, _, _ in VOCI_MATERIALI}
    o.materiale = p.get('materiale') if p.get('materiale') in chiavi else 'generico'
    o.materiale_vero = p.get('materiale_vero') or ''
    o.fattura = p.get('fattura') or ''
    o.ha_colore = bool(p.get('colore'))
    if p.get('colore'):
        o.colore = [int(p['colore'][i:i + 2], 16) / 255 for i in (1, 3, 5)]
    o.misure.clear()
    m = p.get('misure') or {}
    for k in (['scala'] if p['forma'] == 'file' else [k for k, v in m.items() if isinstance(v, (int, float)) and not isinstance(v, bool)]):
        x = o.misure.add()
        x.chiave = k
        x.valore = float(m.get(k, 1) or 1)


def applica_stato(msg):
    st = msg['stato']
    S['applicando'] = True
    try:
        VOCI_MATERIALI[:] = [(k, n, '') for k, n in msg.get('materiali', [])] or VOCI_MATERIALI
        nuovo = st.get('modello') != S['modello']
        if nuovo:
            for p in list(PEZZI.values()):
                if p['obj'] and p['obj'].name in bpy.data.objects:
                    bpy.data.objects.remove(p['obj'])
            PEZZI.clear()
        S['stato'], S['modello'], S['versione'] = st, st.get('modello'), st.get('versione')
        ids = {p['id'] for p in st.get('pezzi', [])}
        for pid in [k for k in PEZZI if k not in ids]:
            ob = PEZZI.pop(pid)['obj']
            if ob and ob.name in bpy.data.objects:
                bpy.data.objects.remove(ob)
        pezzi_info = {x['id']: x for x in msg.get('info', [])}
        for p in st.get('pezzi', []):
            pid = p['id']
            firma = json.dumps([p['forma'], p['misure']], sort_keys=True)
            R = PEZZI.get(pid)
            if not R or R['firma'] != firma or not R['obj'] or R['obj'].name not in bpy.data.objects:
                if R and R['obj'] and R['obj'].name in bpy.data.objects:
                    bpy.data.objects.remove(R['obj'])
                try:
                    ob, proprio = costruisci(pid, p, msg.get('mesh', {}).get(pid))
                except Exception as e:
                    S['messaggio'] = f'«{pid}» non si apre: {e}'
                    PEZZI.pop(pid, None)
                    continue
                R = PEZZI[pid] = {'obj': ob, 'firma': firma, 'presa': Vector(), 'proprio': proprio}
            R['dati'] = p
            R['percorso'] = msg.get('percorsi', {}).get(pid)
            R['info'] = pezzi_info.get(pid, {}).get('testo', '')
            R['densita'] = pezzi_info.get(pid, {}).get('densita')
            ob = R['obj']
            R['base'] = C @ matrice_hud(p) @ CI @ R['proprio']
            ob.matrix_world = R['base']
            pts = [R['base'] @ Vector(c) for c in ob.bound_box]
            lo = Vector([min(q[i] for q in pts) for i in range(3)])
            hi = Vector([max(q[i] for q in pts) for i in range(3)])
            R['centro'], R['lo'], R['hi'] = (lo + hi) / 2, lo, hi
            R['dim'] = (hi.x - lo.x, hi.z - lo.z, hi.y - lo.y)  # assi dell'HUD: X, Y in alto, Z verso Tony
            aggiorna_scheda(ob, p, R)
        ricalcola()
        v, prima = st.get('vista') or {}, ({} if nuovo else S.get('vista_server') or {})
        S['vista_server'] = v
        cambia = lambda k: nuovo or json.dumps(v.get(k), sort_keys=True) != json.dumps(prima.get(k), sort_keys=True)
        sc = bpy.context.scene
        if cambia('esploso'):
            S['esploso'] = sc.oscar_esploso = float(v.get('esploso') or 0)
            if nuovo:
                S['esploso_vis'] = S['esploso']
        if cambia('sezione'):
            S['sezione'] = v.get('sezione')
            sc.oscar_sezione = S['sezione']['asse'] if S['sezione'] else 'no'
            if S['sezione']:
                sc.oscar_sezione_mm = float(S['sezione'].get('posizione', 0))
        if cambia('isolato'):
            S['isolato'] = v.get('isolato')
        S['campo'] = carica_campo(msg.get('campo'))
        if cambia('modo'):
            modo = v.get('modo') or 'solido'
            sc.oscar_modo = S['modo'] = 'solido' if modo == 'ologramma' else modo
        applica_modo(S['modo'])
        applica_sezione()
        visibili()
        if cambia('selezionato'):
            sel = v.get('selezionato')
            for R in PEZZI.values():
                R['obj'].select_set(R['dati']['id'] == sel)
            if sel in PEZZI:
                bpy.context.view_layer.objects.active = PEZZI[sel]['obj']
        if nuovo:
            inquadra()
        S['flussi'] = any(R['dati'].get('flusso') and R['percorso'] for R in PEZZI.values())
        posa()
    finally:
        S['applicando'] = False


def visibili():
    tolti = set((S['stato'] or {}).get('tolti') or [])
    iso = S.get('isolato')
    for pid, R in PEZZI.items():
        R['obj'].hide_set(pid in tolti or bool(iso and iso != pid))


def ricalcola():
    """L'esploso a due livelli dell'HUD: prima i gruppi dal centro del modello, poi i pezzi dal centro del gruppo."""
    tolti = set((S['stato'] or {}).get('tolti') or [])
    vivi = [R for pid, R in PEZZI.items() if pid not in tolti] or list(PEZZI.values())
    if not vivi:
        return
    lo = Vector([min(R['lo'][i] for R in vivi) for i in range(3)])
    hi = Vector([max(R['hi'][i] for R in vivi) for i in range(3)])
    MODELLO['centro'], MODELLO['raggio'] = (lo + hi) / 2, max(1e-3, (hi - lo).length / 2)
    gruppi = collections.defaultdict(list)
    for pid, R in PEZZI.items():
        gruppi['g:' + R['dati']['gruppo'] if R['dati'].get('gruppo') else 'p:' + pid].append(R)
    for G in gruppi.values():
        glo = Vector([min(R['lo'][i] for R in G) for i in range(3)])
        ghi = Vector([max(R['hi'][i] for R in G) for i in range(3)])
        gc, rg = (glo + ghi) / 2, max(1e-3, (ghi - glo).length / 2)
        es = [hb(R['dati']['esplodi']) for R in G if R['dati'].get('esplodi')]
        if es:
            d1 = sum(es, Vector()) / len(es)
        else:
            d = gc - MODELLO['centro']
            d1 = d.normalized() if d.length > 1e-3 * MODELLO['raggio'] else Vector()
        for R in G:
            d2 = R['centro'] - gc
            R['dir1'] = d1
            R['dir2'] = d2.normalized() if len(G) > 1 and d2.length > 1e-3 * rg else Vector()
            R['D2'] = 0.35 * rg


def liscio(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def posa():
    e = S['esploso_vis']
    s1, s2, D1 = liscio(0, 0.6, e), liscio(0.4, 1, e), 0.5 * MODELLO['raggio']
    for R in PEZZI.values():
        off = R['dir1'] * (D1 * s1) + R['dir2'] * (R['D2'] * s2) + R['presa']
        R['obj'].matrix_world = Matrix.Translation(off) @ R['base']


def inquadra():
    rv = vista()[3].region_3d
    rv.view_perspective = 'PERSP'
    rv.view_location = MODELLO['centro']
    rv.view_distance = MODELLO['raggio'] * 2.6
    rv.view_rotation = Euler((math.radians(65), 0, math.radians(-35))).to_quaternion()
    sp = vista()[3]
    sp.clip_start = MODELLO['raggio'] / 2000
    sp.clip_end = MODELLO['raggio'] * 100


def applica_modo(modo):
    S['modo'] = modo
    sh = vista()[3].shading
    sh.show_xray = modo == 'raggi-x'
    sh.xray_alpha = 0.3
    sh.color_type = 'VERTEX' if modo == 'sforzi' else 'OBJECT'
    for R in PEZZI.values():
        d, ob = R['dati'], R['obj']
        if modo == 'densita':
            c = colore_densita(R.get('densita'))
        elif d.get('colore'):
            c = da_hex(d['colore'])
        else:
            c = GRIGIO
        ob.color = (*c, 1)
        if modo == 'sforzi':
            colora_sforzi(R)
    ridisegna()


def carica_campo(c):
    if not c or not c.get('file') or not os.path.exists(c['file']):
        return None
    fs = np.fromfile(c['file'], dtype=np.float32)
    if fs.size != c['nx'] * c['ny'] * c['nz']:
        return None
    return {**c, 'fs': fs.reshape(c['nz'], c['ny'], c['nx'])}


def colora_sforzi(R):
    """Il colore del rischio su ogni vertice, letto dentro il pezzo lungo la normale come faceva lo shader dell'HUD."""
    me, d, c = R['obj'].data, R['dati'], S['campo']
    n = len(me.vertices)
    col = np.tile(np.array([*SPENTO, 1.0], dtype=np.float32), (n, 1))
    if c is not None and d.get('calcolo') and d['forma'] != 'file' and n:
        co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co)
        no = np.empty(n * 3, np.float32); me.vertices.foreach_get('normal', no)
        M = np.array(CI @ R['base'])  # dal locale di Blender al mondo dell'HUD
        p = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
        nn = no.reshape(-1, 3) @ M[:3, :3].T
        nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
        h, o0, fs = c['h'], np.array(c['origine']), c['fs']
        dims = np.array([c['nx'], c['ny'], c['nz']])
        val = np.full(n, -1.0)
        for k in (0.5, 1, 1.6, 2.4, 0.2):
            idx = np.floor((p - nn * (k * h) - o0) / h).astype(np.int64)
            ok = np.all((idx >= 0) & (idx < dims), axis=1) & (val < 0)
            v = np.full(n, -1.0)
            v[ok] = fs[idx[ok, 2], idx[ok, 1], idx[ok, 0]]
            val = np.where((val < 0) & (v >= 0), v, val)
        pieni = val >= 0
        r = np.where(pieni, np.minimum(1, 1 / np.maximum(val, 1e-9)), 0)
        col[pieni, :3] = scala_np(TAPPE_RISCHIO, r[pieni])
    a = me.color_attributes.get('sforzi') or me.color_attributes.new('sforzi', 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set('color', col.ravel())
    me.color_attributes.active_color = a
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def applica_sezione():
    rv = vista()[3].region_3d
    s = S['sezione']
    if not s:
        rv.use_clip_planes = False
        ridisegna()
        return
    # Si tiene la parte con la coordinata minore della posizione (verso 1), come la sezione dell'HUD. Blender tiene i punti
    # con piano · (x, y, z, 1) ≥ 0. I piani scritti da Python da soli non tagliano (provato il 22/11 su Blender 5.2): prima
    # serve il taglio a riquadro di Blender, qui su tutta la vista, poi si sostituiscono i suoi piani col nostro.
    win, area, reg, sp = vista()
    with bpy.context.temp_override(window=win, area=area, region=reg):
        rv.use_clip_planes = False
        bpy.ops.view3d.clip_border(xmin=0, xmax=reg.width, ymin=0, ymax=reg.height)
    asse = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[s['asse']]
    n = hb(asse) * (-1 if s.get('verso', 1) == 1 else 1)
    q = hb(asse * float(s.get('posizione', 0)))
    lontano = (0, 0, 0, 1e9)
    rv.clip_planes = [(n.x, n.y, n.z, -n.dot(q)), lontano, lontano, lontano, lontano, lontano]
    rv.use_clip_planes = True
    ridisegna()


# ---------------------------------------------------------------- gesti delle mani
def sotto(x, y):
    win, area, reg, sp = vista()
    co = (x * reg.width, (1 - y) * reg.height)
    rv = sp.region_3d
    o = view3d_utils.region_2d_to_origin_3d(reg, rv, co)
    d = view3d_utils.region_2d_to_vector_3d(reg, rv, co)
    hit, _, _, _, obj, _ = bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(), o, d)
    return bpy.data.objects.get(obj.name) if hit and obj else None


def num(m, k, d=0.0):
    v = m.get(k, d)
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else d


def gesto(m):
    tipo = m.get('tipo')
    win, area, reg, sp = vista()
    rv = sp.region_3d
    if tipo == 'ruota':  # la mano trascina il modello, come nella scena dell'HUD di prima
        dx, dy = max(-1, min(1, num(m, 'dx'))), max(-1, min(1, num(m, 'dy')))
        from mathutils import Quaternion
        q = Quaternion((0, 0, 1), -dx * math.pi * 1.4) @ rv.view_rotation
        p = q @ Quaternion((1, 0, 0), -dy * math.pi * 0.9)
        rv.view_rotation = p if (p @ Vector((0, 1, 0))).z > 0.05 else q
    elif tipo == 'zoom':
        f = max(0.2, min(5, num(m, 'fattore', 1)))
        rv.view_distance = max(MODELLO['raggio'] * 0.3, min(MODELLO['raggio'] * 15, rv.view_distance / f))
    elif tipo == 'esplodi':
        S['esploso'] = min(1.0, max(0.0, S['esploso'] + num(m, 'delta')))
        S['esploso_vis'] = S['esploso']
        posa()
    elif tipo == 'cursore':
        S['cursore'] = (num(m, 'x', 0.5), num(m, 'y', 0.5))
    elif tipo == 'stato':
        S['fase'] = m.get('fase', 'spente')
    elif tipo == 'afferra':
        o = sotto(num(m, 'x', 0.5), num(m, 'y', 0.5))
        S['presa'] = o.oscar.pid if o and o.oscar.pid in PEZZI else None
        for R in PEZZI.values():
            R['obj'].select_set(R['dati']['id'] == S['presa'])
        if S['presa']:
            bpy.context.view_layer.objects.active = PEZZI[S['presa']]['obj']
    elif tipo == 'sposta' and S['presa'] in PEZZI:
        R = PEZZI[S['presa']]
        w = R['obj'].matrix_world.translation
        a = view3d_utils.location_3d_to_region_2d(reg, rv, w)
        if a is not None:
            b = (a[0] + num(m, 'dx') * reg.width, a[1] - num(m, 'dy') * reg.height)
            R['presa'] = R['presa'] + (view3d_utils.region_2d_to_location_3d(reg, rv, b, w) - w)
            posa()
    elif tipo == 'lascia':
        S['presa'] = None
    elif tipo == 'lancia' and S['presa'] in PEZZI:  # solo il pezzo preso; il server lo mette fra i tolti
        PEZZI[S['presa']]['obj'].hide_set(True)
        manda({'evento': 'togli', 'id': S['presa']})
        S['presa'] = None
    elif tipo == 'ricomponi':  # i pezzi spostati tornano a posto e l'esploso si chiude; i tolti restano tolti
        for R in PEZZI.values():
            R['presa'] = Vector()
        S['esploso'] = 0.0
        bpy.context.scene.oscar_esploso = 0.0
        posa()


def foto(m):
    win, area, reg, sp = vista()
    tmp = m['file'] + '.grande.png'
    with bpy.context.temp_override(window=win, area=area):
        bpy.ops.screen.screenshot_area(filepath=tmp)
    img = bpy.data.images.load(tmp)
    w, h = img.size
    if w > 960:
        img.scale(960, max(1, round(h * 960 / w)))
    img.filepath_raw = m['file']
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    os.remove(tmp)


def applica(m, t, conn):
    tipo = m.get('tipo')
    risposta = {'rid': m.get('rid')} if m.get('rid') is not None else None
    try:
        if tipo == 'ologramma':
            applica_stato(m)
            if risposta:
                risposta['versione'] = S['versione']
        elif tipo == 'foto':  # si scatta al giro dopo, quando la vista è già ridisegnata con l'esploso al suo posto
            S['esploso_vis'] = S['esploso']
            posa()
            ridisegna()
            S['foto'] = (m, conn, time.perf_counter() + 0.08)
            return
        elif tipo == 'imposta':  # prove: cambia un campo della scheda come Tony, cioè passando dal suo update
            ob = PEZZI[m['id']]['obj'].oscar
            if m['campo'] == 'misura':
                next(x for x in ob.misure if x.chiave == m['chiave']).valore = float(m['valore'])
            else:
                setattr(ob, m['campo'], m['valore'])
            if risposta:
                risposta.update(info())
        elif tipo == 'messaggio':
            S['messaggio'] = str(m.get('testo', ''))[:400]
        elif tipo == 'info':
            if risposta:
                risposta.update(info())
        elif tipo == 'misura':
            if m.get('inizio'):
                disegni.clear(); latenze.clear(); S['misura'] = True
            else:
                S['misura'] = None
                secondi = collections.Counter(int(d) for d in disegni)
                conti = sorted(secondi[k] for k in list(secondi)[1:-1]) or [0]
                lat = sorted(latenze) or [0]
                risposta.update({'fps_mediana': conti[len(conti) // 2], 'fps_p10': conti[len(conti) // 10],
                                 'latenza_mediana_ms': round(lat[len(lat) // 2], 1), 'latenza_p90_ms': round(lat[int(len(lat) * 0.9)], 1), 'gesti': len(lat)})
        else:
            gesto(m)
            if tipo in ('ruota', 'zoom', 'esplodi', 'sposta', 'cursore'):
                attese.append(t)
            if risposta:
                risposta.update(info())
    except Exception as e:
        print('[vivo]', tipo, repr(e))
        if risposta:
            risposta['errore'] = repr(e)
    if risposta:
        manda(risposta, conn)


def info():
    tolti = set((S['stato'] or {}).get('tolti') or [])
    return {'modello': S['modello'], 'versione': S['versione'], 'pezzi': len(PEZZI), 'esploso': round(S['esploso'], 3),
            'presa': S['presa'], 'modo': S['modo'], 'distanza': round(vista()[3].region_3d.view_distance, 2),
            'raggio': round(MODELLO['raggio'], 2), 'nascosti': sum(1 for R in PEZZI.values() if R['obj'].hide_get()),
            'spostati': sum(1 for R in PEZZI.values() if R['presa'].length > 1e-6), 'tolti': sorted(tolti),
            'sforzi': sum(1 for R in PEZZI.values() if R['dati'].get('calcolo') and S['campo'] is not None and R['dati']['forma'] != 'file'),
            'selezionato': next((pid for pid, R in PEZZI.items() if R['obj'].select_get()), None), 'messaggio': S['messaggio'],
            'sezione': bool(vista()[3].region_3d.use_clip_planes), 'colorati': colorati()}


def colorati():  # prove: i vertici che negli sforzi hanno un colore del campo, non il grigio di chi è fuori dal calcolo
    n = 0
    for R in PEZZI.values():
        a = R['obj'].data.color_attributes.get('sforzi')
        if a and S['modo'] == 'sforzi':
            c = np.empty(len(a.data) * 4, np.float32)
            a.data.foreach_get('color', c)
            n += int(np.sum(np.abs(c.reshape(-1, 4)[:, :3] - np.array(SPENTO)).sum(axis=1) > 0.02))
    return n


# ---------------------------------------------------------------- sopra la vista: cursore, misure in mm e cm, legenda, flussi
def testo(x, y, s, col=(0.86, 0.96, 1.0, 0.95), dim=13):
    blf.size(0, dim * bpy.context.preferences.system.ui_scale)
    blf.color(0, *col)
    blf.position(0, x, y, 0)
    blf.draw(0, s)


def linee(pts, col, larghezza=1.5, prof=False):
    sh = gpu.shader.from_builtin('POLYLINE_UNIFORM_COLOR')
    sh.uniform_float('viewportSize', gpu.state.viewport_get()[2:])
    sh.uniform_float('lineWidth', larghezza)
    sh.uniform_float('color', col)
    batch_for_shader(sh, 'LINES', {'pos': pts}).draw(sh)


def disegna_2d():
    ora = time.perf_counter()
    disegni.append(ora)
    while attese:
        latenze.append((ora - attese.pop()) * 1000)
    reg, rv = bpy.context.region, bpy.context.region_data
    gpu.state.blend_set('ALPHA')
    # Le misure, come le quote dell'HUD: del pezzo scelto, o del modello intero
    sel = [R for R in PEZZI.values() if R['obj'].select_get() and not R['obj'].hide_get()]
    soggetti = sel[:1] or [R for R in PEZZI.values() if not R['obj'].hide_get()]
    if soggetti:
        pts = [R['obj'].matrix_world @ Vector(c) for R in soggetti for c in R['obj'].bound_box]
        lo = Vector([min(q[i] for q in pts) for i in range(3)])
        hi = Vector([max(q[i] for q in pts) for i in range(3)])
        spigoli = [(lo, Vector((hi.x, lo.y, lo.z))), (lo, Vector((lo.x, hi.y, lo.z))), (lo, Vector((lo.x, lo.y, hi.z)))]
        a = 0.95 if sel else 0.55
        for p0, p1 in spigoli:
            q0, q1 = (view3d_utils.location_3d_to_region_2d(reg, rv, p) for p in (p0, p1))
            if q0 is None or q1 is None or (q1 - q0).length < 18:
                continue
            linee([q0, q1], (0.0, 0.94, 1.0, a))
            mm = (p1 - p0).length
            mid = (q0 + q1) / 2
            testo(mid.x + 6, mid.y + 6, mm_cm(mm), (0.86, 0.96, 1.0, a))
    if S['modo'] in ('sforzi', 'densita'):
        legenda(reg)
    if S['cursore'] and S['fase'] in ('pronto', 'azione'):
        cx, cy = S['cursore'][0] * reg.width, (1 - S['cursore'][1]) * reg.height
        r = 9 if S['presa'] else 6
        pts = [(cx, cy)] + [(cx + r * math.cos(k * math.pi / 12), cy + r * math.sin(k * math.pi / 12)) for k in range(25)]
        sh = gpu.shader.from_builtin('UNIFORM_COLOR')
        sh.uniform_float('color', (0.0, 0.94, 1.0, 0.9))
        batch_for_shader(sh, 'TRI_FAN', {'pos': pts}).draw(sh)
    gpu.state.blend_set('NONE')


def legenda(reg):
    x0, y0, L, H = 24, 30, 420, 10
    if S['modo'] == 'sforzi':
        cols, titolo, tappe = [scala(TAPPE_RISCHIO, i / 23) for i in range(24)], 'Sforzi: sforzo / snervamento', [(0.25, 'fs 4'), (0.5, 'fs 2'), (0.75, 'fs 1,33'), (0.97, 'cede')]
        if S['campo'] is None:
            titolo = 'Sforzi: nessuna analisi (chiedila a O.S.C.A.R.)'
    else:
        cols, titolo = [scala(TAPPE_DENSITA, i / 23) for i in range(24)], 'Densità (kg/m³)'
        tappe = [(0, '900'), (math.log(2700 / 900) / math.log(8000 / 900), '2.700'), (1, '8.000')]
    pos, col = [], []
    for i in range(23):
        xa, xb = x0 + L * i / 23, x0 + L * (i + 1) / 23
        for (x, y, c) in ((xa, y0, cols[i]), (xb, y0, cols[i + 1]), (xb, y0 + H, cols[i + 1]), (xa, y0, cols[i]), (xb, y0 + H, cols[i + 1]), (xa, y0 + H, cols[i])):
            pos.append((x, y)); col.append((*c, 1))
    sh = gpu.shader.from_builtin('SMOOTH_COLOR')
    batch_for_shader(sh, 'TRIS', {'pos': pos, 'color': col}).draw(sh)
    testo(x0, y0 + H + 8, titolo)
    for t, s in tappe:
        testo(x0 + L * t - 8, y0 - 16, s, dim=11)


def disegna_3d():
    if not S['flussi']:
        return
    ora = time.perf_counter()
    gpu.state.blend_set('ADDITIVE')
    gpu.state.depth_test_set('NONE')  # il flusso è un dato dichiarato: si vede anche dentro i pezzi
    for R in PEZZI.values():
        d = R['dati']
        fl = FLUSSO.get(d.get('flusso'))
        if not fl or not R['percorso'] or R['obj'].hide_get():
            continue
        M = R['obj'].matrix_world @ R['proprio'].inverted()
        pts = [M @ (C @ Vector(p)) for p in R['percorso']]
        cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            cum.append(cum[-1] + (b - a).length)
        Ltot = cum[-1]
        if Ltot <= 0:
            continue
        colore, vel, passo_r, coda_f = fl
        passo = passo_r * float(d['misure'].get('r', 1))
        coda = coda_f * passo
        def punto(s):
            k = max(0, min(len(cum) - 2, next((i for i in range(len(cum) - 1) if cum[i + 1] >= s), len(cum) - 2)))
            w = (s - cum[k]) / max(1e-9, cum[k + 1] - cum[k])
            return pts[k].lerp(pts[k + 1], max(0, min(1, w)))
        segmenti = []
        s0 = (ora * vel * passo) % passo
        s = s0
        while s < Ltot:
            a, b = max(0, s - coda), s
            segmenti += [punto(a), punto(b)]
            s += passo
        if segmenti:
            linee(segmenti, (*colore, 0.95), larghezza=4)
    gpu.state.depth_test_set('LESS_EQUAL')
    gpu.state.blend_set('NONE')


# ---------------------------------------------------------------- avvio e giro
def prepara():
    v = vista()
    if not v:
        return False
    win, area, reg, sp = v
    for o in list(bpy.data.objects):  # il cubo, la camera e la luce della scena di partenza
        bpy.data.objects.remove(o)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 0.001
    sc.unit_settings.length_unit = 'MILLIMETERS'
    sc.view_settings.view_transform = 'Standard'  # i colori dei dati come sono, senza la curva di AgX
    sh = sp.shading
    sh.type, sh.light, sh.color_type = 'SOLID', 'STUDIO', 'OBJECT'
    sh.show_cavity = True
    sh.background_type = 'VIEWPORT'
    sh.background_color = (0.012, 0.018, 0.026)
    ov = sp.overlay
    ov.show_floor = False
    ov.show_axis_x = ov.show_axis_y = ov.show_axis_z = False
    ov.show_cursor = False
    ov.show_object_origins = False
    ov.show_text = False
    sp.show_region_toolbar = False
    sp.show_region_ui = True
    with bpy.context.temp_override(window=win, area=area):
        bpy.ops.screen.screen_full_area(use_hide_panels=False)
    vista()[3].show_region_ui = True
    bpy.types.SpaceView3D.draw_handler_add(disegna_2d, (), 'WINDOW', 'POST_PIXEL')
    bpy.types.SpaceView3D.draw_handler_add(disegna_3d, (), 'WINDOW', 'POST_VIEW')
    S['pronto'] = True
    return True


def scheda_davanti():
    for reg in vista()[1].regions:
        if reg.type == 'UI':
            try:
                reg.active_panel_category = 'O.S.C.A.R.'
            except Exception:
                return False
            return reg.active_panel_category == 'O.S.C.A.R.'
    return False


def giro():
    if not S['pronto']:
        return 0.0 if prepara() else 0.2
    if not S.get('scheda') and S['modello'] is not None:
        S['scheda'] = scheda_davanti()
    n = 0
    while coda:
        m, t, c = coda.popleft()
        applica(m, t, c)
        n += 1
    ora = time.perf_counter()
    dt, S['ultimo'] = ora - S['ultimo'], ora
    if S.get('foto') and ora >= S['foto'][2]:
        m, c, _ = S.pop('foto')
        r = {'rid': m.get('rid'), 'file': m.get('file')}
        try:
            foto(m)
        except Exception as e:
            r['errore'] = repr(e)
        manda(r, c)
    if abs(S['esploso_vis'] - S['esploso']) > 1e-3:  # l'esploso chiesto a voce scorre in circa mezzo secondo
        S['esploso_vis'] += (S['esploso'] - S['esploso_vis']) * (1 - math.exp(-dt * 6))
        posa()
        n += 1
    if n or S['flussi']:
        ridisegna()
    return 0.004 if n else (1 / 30 if S['flussi'] else 0.01)


CLASSI = (OscarMisura, OscarPezzo, OSCAR_PT_modello, OSCAR_PT_pezzo)
for c in CLASSI:
    bpy.utils.register_class(c)
bpy.types.Object.oscar = PointerProperty(type=OscarPezzo)
bpy.types.Scene.oscar_modo = EnumProperty(items=MODI, update=modo_cambiato)
bpy.types.Scene.oscar_esploso = FloatProperty(min=0, max=1, update=esploso_cambiato)
bpy.types.Scene.oscar_sezione = EnumProperty(items=[('no', 'No', ''), ('x', 'X', ''), ('y', 'Y', ''), ('z', 'Z', '')], update=sezione_cambiata)
bpy.types.Scene.oscar_sezione_mm = FloatProperty(update=sezione_cambiata)
threading.Thread(target=ascolta, daemon=True).start()
bpy.app.timers.register(giro, first_interval=0.3, persistent=True)

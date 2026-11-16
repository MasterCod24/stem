# gabbia.py — gira dentro Blender, in background e nella gabbia di sandbox-exec (mac-mcp.mjs, costruisci_in_blender):
#   Blender -b --factory-startup --python gabbia.py -- <cartella della versione> <script del cervello>
# Esegue lo script con gli attrezzi di aiuti.py già pronti, poi esporta un GLB per ogni oggetto mesh e scrive rapporto.json:
# triangoli, quadrilateri, chiusura e ingombro nel mondo. Salva anche modello.blend, che Tony può aprire in Blender.
import json, math, os, sys, time, traceback

T0 = time.time()
ARG = sys.argv[sys.argv.index('--') + 1:]
OUT, SCRIPT = ARG[0], ARG[1]
RAPPORTO = os.path.join(OUT, 'rapporto.json')

def scrivi(d):
    with open(RAPPORTO, 'w') as f:
        json.dump(d, f, ensure_ascii=False)

try:
    import bpy, bmesh
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import aiuti
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    codice = open(SCRIPT, encoding='utf-8').read()
    ambiente = {'__name__': '__main__', 'bpy': bpy, 'bmesh': bmesh, 'math': math}
    ambiente.update({k: v for k, v in vars(aiuti).items() if not k.startswith('_')})
    exec(compile(codice, 'script', 'exec'), ambiente)
except Exception:
    righe = traceback.format_exc().strip().splitlines()
    scrivi({'errore': '\n'.join(righe[-12:])})
    sys.exit(0)

def triangoli(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m = ev.to_mesh()
    m.calc_loop_triangles()
    n = len(m.loop_triangles)
    ev.to_mesh_clear()
    return n

def ingombro(ob):
    """Ingombro nel mondo, nelle coordinate dell'HUD (Y in alto): quello che l'HUD vedrà nel file."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m = ev.to_mesh()
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for v in m.vertices:
        w = ob.matrix_world @ v.co
        p = (w.x, w.z, -w.y)
        lo = [min(a, b) for a, b in zip(lo, p)]
        hi = [max(a, b) for a, b in zip(hi, p)]
    ev.to_mesh_clear()
    return [round(v, 1) for v in lo], [round(v, 1) for v in hi]

pezzi, nomi = [], set()
try:
    for ob in sorted((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: o.name):
        base = ''.join(c if c.isascii() and (c.isalnum() or c == '-') else '-' for c in ob.name.lower()).strip('-')[:36] or 'pezzo'
        nome, i = base, 2
        while nome in nomi:
            nome, i = f'{base}-{i}', i + 1
        nomi.add(nome)
        me = ob.data
        lati = [len(p.vertices) for p in me.polygons]
        bm = bmesh.new()
        bm.from_mesh(me)
        chiuso = len(bm.edges) > 0 and all(e.is_manifold for e in bm.edges)
        bm.free()
        prima = triangoli(ob)
        # decimazione selettiva solo nell'esportazione: unisce le facce complanari (entro 0,3°) e lascia gli spigoli vivi;
        # il sorgente in modello.blend resta com'era
        dec = ob.modifiers.new('decimazione', 'DECIMATE')
        dec.decimate_type, dec.angle_limit, dec.delimit = 'DISSOLVE', math.radians(0.3), {'SHARP'}
        pesi = [i for i, m in enumerate(ob.modifiers) if m.type == 'WEIGHTED_NORMAL']
        if pesi:
            ob.modifiers.move(len(ob.modifiers) - 1, pesi[0])
        dopo = triangoli(ob)
        for o in bpy.context.scene.objects:
            o.select_set(False)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        percorso = os.path.join(OUT, nome + '.glb')
        bpy.ops.export_scene.gltf(filepath=percorso, export_format='GLB', use_selection=True, export_apply=True,
                                  export_materials='NONE', export_yup=True, export_animations=False)
        ob.modifiers.remove(dec)
        lo, hi = ingombro(ob)
        byte = os.path.getsize(percorso)
        pezzi.append({'nome': nome, 'file': percorso, 'facce': len(lati), 'quadrilateri': sum(1 for n in lati if n == 4),
                      'chiuso': chiuso, 'triangoli_sorgente': prima, 'triangoli': dopo, 'kB': round(byte / 1024),
                      'min': lo, 'max': hi})
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'modello.blend'), compress=True)
except Exception:
    righe = traceback.format_exc().strip().splitlines()
    scrivi({'errore': "nell'esportazione: " + '\n'.join(righe[-8:]), 'pezzi': pezzi})
    sys.exit(0)
scrivi({'pezzi': pezzi, 'secondi': round(time.time() - T0, 2)})

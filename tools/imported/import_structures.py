"""Estruturas importadas dos modelos de ref/ (OBJ do Tripo, um mapa UV por
modelo) para as facções: ref/*.zip -> Legião de Ares, ref/coa/*.zip ->
Coalizão, ref/swarm/*.zip -> Enxame.

Cada modelo vira uma malha estática reduzida que mantém o mapa UV original
(que casa sem costuras com a pintura do modelo), só deslocado para a fatia
da estrutura no atlas da facção art/textures/skins/structural/
<civ>_structures.png (+ _norm, _spec), feito por structures_texture.py com
as cores do atlas da facção. Ganha também pontos de encaixe calculados pela
caixa do modelo: projectile (alto, centro), garrisoned_01/02 (alto, cantos
da frente) e 01/02 (chão, cantos da frente, para bandeiras); o reator ganha
smoke (topo da chaminé).

Gera art/meshes/structural/<civ>/<nome>.dae.
Uso (na pasta do mod):
  python3 tools/imported/structures_texture.py [civ ...]
  blender -b -P tools/imported/import_structures.py -- civ [nome ...]
"""
import glob
import os
import sys
import tempfile
import zipfile

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402
import structures_texture as atlas  # noqa: E402

# civ -> nome -> (eixo da medida, medida em metros, faces); o zip e a fatia
# vêm de structures_texture.FACTIONS. A frente dos modelos já é -Y.
STRUCTURES = {
	"ares": {
		"cc_citadel": ("x", 30.0, 14000),
		"barracks_war_hall": ("y", 30.0, 12000),
		"lab_research": ("y", 28.0, 10000),
		"vehicle_garage": ("x", 36.0, 12000),
		"helipad": ("x", 32.0, 10000),
		"reactor": ("x", 24.0, 10000),
		"planetary_fortress": ("x", 36.0, 14000),
	},
	"coa": {
		"cc_command_tower": ("x", 40.0, 16000),
		"barracks_garrison": ("x", 30.0, 12000),
		"lab_space": ("y", 30.0, 12000),
		"vehicle_garage": ("x", 38.0, 12000),
		"helipad": ("y", 34.0, 10000),
		"reactor": ("x", 26.0, 12000),
		"fortress": ("x", 38.0, 16000),
	},
	"swarm": {
		"spawn_barracks": ("x", 30.0, 14000),
		"gene_laboratory": ("x", 28.0, 14000),
		"vehicle_garage": ("x", 38.0, 14000),
		"landing_pad": ("x", 32.0, 12000),
		"reactor": ("x", 26.0, 12000),
		"fortress": ("y", 36.0, 16000),
	},
}


def extract(folder, zip_name):
	out = tempfile.mkdtemp(prefix="mw_ref_")
	with zipfile.ZipFile(os.path.join(bc.MOD, folder, zip_name)) as z:
		z.extractall(out)
	return out


def empty(name, pos):
	e = bpy.data.objects.new(name, None)
	e.location = pos
	bpy.context.scene.collection.objects.link(e)
	return e


def highest_point(mesh, radius):
	"""Ponto mais alto da malha (para a fumaça do reator)."""
	top = max(mesh.data.vertices, key=lambda v: v.co.z).co
	near = [v.co for v in mesh.data.vertices if (v.co - top).length < radius]
	return sum(near, Vector()) / len(near)


def to_slot(mesh, index):
	"""Mapa UV do modelo -> fatia da estrutura no atlas."""
	su, sv, du, dv = atlas.uv_transform(index)
	me = mesh.data
	for extra in [u.name for u in me.uv_layers][1:]:
		me.uv_layers.remove(me.uv_layers[extra])
	layer = me.uv_layers[0]
	layer.name = "atlas"
	for d in layer.data:
		u, v = d.uv
		d.uv = (du + su * min(max(u, 0.0), 1.0), dv + sv * min(max(v, 0.0), 1.0))


def build(civ, name):
	axis, size, faces = STRUCTURES[civ][name]
	cfg = atlas.FACTIONS[civ]
	index, zip_name = [(i, z) for i, (n, z) in enumerate(cfg["slots"]) if n == name][0]
	folder = extract(cfg["folder"], zip_name)
	bc.reset()
	bc.import_file(glob.glob(os.path.join(folder, "*.obj"))[0])
	mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
	bc.keep_only([mesh])
	mesh.name = mesh.data.name = name
	bc.clean_mesh(mesh, merge=1e-6)
	bc.decimate(mesh, faces)
	bc.normalize([mesh], size, axis=axis)
	to_slot(mesh, index)
	bc.fix_normals(mesh, angle=40)
	bc.triangulate(mesh)

	lo, hi = bc.world_bounds([mesh])
	w, d, h = hi - lo
	props = [
		empty("prop_projectile", (0, 0, h * 0.85)),
		empty("prop_garrisoned_01", (-w * 0.3, lo.y + d * 0.2, h * 0.75)),
		empty("prop_garrisoned_02", (w * 0.3, lo.y + d * 0.2, h * 0.75)),
		empty("prop_01", (-w * 0.45, lo.y + 0.5, 0)),
		empty("prop_02", (w * 0.45, lo.y + 0.5, 0)),
	]
	if name == "reactor":
		props.append(empty("prop_smoke", highest_point(mesh, w * 0.08)))
	mesh.data.materials.clear()
	mat = bpy.data.materials.new(name)
	mesh.data.materials.append(mat)
	path = os.path.join(bc.MOD, "art", "meshes", "structural", civ, name + ".dae")
	os.makedirs(os.path.dirname(path), exist_ok=True)
	bc.select([mesh] + props)
	bpy.ops.wm.collada_export(filepath=path, check_existing=False, selected=True, include_children=False,
		include_armatures=False, include_animations=False, apply_modifiers=True, triangulate=True,
		use_object_instantiation=False, active_uv_only=True, use_texture_copies=False,
		export_global_forward_selection="Y", export_global_up_selection="Z", apply_global_orientation=False)
	print("ESTRUTURA %s/%s tris=%d tamanho=%.1f x %.1f x %.1f" % (civ, name, bc.triangle_count(mesh), w, d, h))
	if os.environ.get("MW_PREVIEW"):
		mat.use_nodes = True
		node = mat.node_tree.nodes.new("ShaderNodeTexImage")
		node.image = bpy.data.images.load(os.path.join(atlas.TEX, civ + "_structures.png"))
		mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
		bc.render_frames([mesh], os.path.join(os.environ["MW_PREVIEW"], "%s_%s.png" % (civ, name)),
			views=("front", "persp", "rear"), res=420)


args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
civs = [args[0]] if args else list(STRUCTURES)
for civ in civs:
	for n in args[1:] or list(STRUCTURES[civ]):
		build(civ, n)

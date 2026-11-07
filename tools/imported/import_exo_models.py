"""Modelos de refs/exo/*.zip (OBJ do Tripo) como arte do jogo: tanques para a
MCC e a Coalizão, avião, drone e fábrica de tanques.

Cada modelo vira uma malha estática reduzida, com a frente em -Y, e ganha:
  - textura: a do Tripo (mapa UV original) repintada com as cores da facção
    (structures_texture.restyle, estilo mcc_struct.png / coa_struct.png), ou,
    nos modelos que vieram sem textura, uma pintura procedural assada com AO
    num mapa UV novo (PAINTS);
  - normal (do Tripo, ou vehicle/flat_norm.png) e spec (rugosidade/metal do
    Tripo, ou do brilho da cor);
  - pontos de encaixe: projectile e muzzle na boca do canhão (o vértice mais
    à frente acima de MUZZLE_MIN_Z da altura), nos tanques;
  - um actor por facção (art/actors/vehicle/<civ>/<nome>.xml; os sem facção
    em art/actors/vehicle/exo/ e structures/exo/).

Uso (na pasta do mod):  blender -b -P tools/imported/import_exo_models.py [-- nome ...]
"""
import glob
import os
import sys
import tempfile
import zipfile

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402
import structures_texture as st  # noqa: E402

REFS = os.path.join(bc.MOD, "refs", "exo")
SKINS = os.path.join(bc.MOD, "art", "textures", "skins")
# Estilo de cada facção para repintar as texturas do Tripo.
STYLES = {"mcc": ("mcc_struct.png", "red", 110), "coa": ("coa_struct.png", "blue", 120)}
MUZZLE_MIN_Z = 0.45

# nome -> zip, giro em Z (graus, para a frente ficar em -Y), eixo e medida
# (m), faces, tipo (vehicle/structure), textura e facções.
#   tex: ("tripo", cor, normal|None, rugosidade|None, metal|None) com sufixos
#        dos arquivos do zip, ou ("paint", esquema de PAINTS).
#   civs: facções com actor e textura próprios; [] = arte neutra, cores do modelo.
#   share: facções com actor próprio, mas a textura original do modelo.
MODELS = {
	"red_tank": dict(zip="red tank 3d model.zip", rot=0, axis="y", size=18.0, faces=14000, kind="vehicle", muzzle=True,
		tex=("tripo", "_basecolor.JPEG", "_normal.JPEG", "_roughness.JPEG", "_metallic.JPEG"), civs=["mcc", "coa"]),
	"military_tank": dict(zip="military tank 3d model.zip", rot=0, axis="y", size=13.0, faces=14000, kind="vehicle", muzzle=True,
		tex=("tripo", "_0_0.jpg", "_0_3.jpg", "_roughness.JPEG", "_metallic.JPEG"), civs=["mcc"]),
	"futuristic_tank": dict(zip="futuristic tank 3d model.zip", rot=90, axis="y", size=18.0, faces=14000, kind="vehicle", muzzle=True,
		tex=("paint", "coa_armour"), civs=[], atlas=["coa"], low_frac=0.3),
	"military_aircraft": dict(zip="military aircraft 3d model.zip", rot=90, axis="y", size=20.0, faces=12000, kind="vehicle", muzzle=True,
		tex=("tripo", "_0_0.jpg", None, None, None), civs=[], share=["mcc", "coa", "mla", "ares", "swarm"],
		rig="vtol"),
	"quadrotor_drone": dict(zip="quadrotor drone 3d model.zip", rot=0, axis="x", size=9.0, faces=10000, kind="vehicle", muzzle=False,
		tex=("paint", "drone_grey"), civs=[]),
	"tank_factory": dict(zip="tank factory 3d model.zip", rot=0, axis="x", size=36.0, faces=14000, kind="structure", muzzle=False,
		tex=("tripo", "_0_0.jpg", None, None, None), civs=[]),
}

# Atlas de veículos de cada facção (1024 x 512, mesma disposição em todos) e
# as regiões usadas pela projeção em caixa (px, origem em cima).
VEHICLE_ATLAS = {
	"mcc": "vehicle/mcc_veh_01.png", "coa": "vehicle/coe_veh.png", "mla": "vehicle/mla_veh_01.png",
	"ares": "vehicle/ares/mla_veh_01.png", "swarm": "vehicle/swarm/mla_veh_01.png",
}
ATLAS_NORM, ATLAS_SPEC = "vehicle/mcc_veh_01_norm.png", "vehicle/mcc_veh_01_spec.png"
ATLAS_SIZE = (1024, 512)
REGIONS = {
	"side": (6, 6, 554, 194),        # casco com o emblema
	"front": (6, 200, 554, 378),     # faixa de baixo do casco
	"top": (6, 6, 554, 194),
	"bottom": (402, 390, 554, 506),  # grade escura
	"low": (570, 4, 888, 60),        # pneus/esteiras
}
# Gradiente do Enxame (o mesmo de tools/factions/gen_factions.py TINTS), para
# fazer a textura de veículo que ele não tinha a partir da da MLA.
SWARM_TINT = ([(10, 4, 14), (70, 26, 92), (150, 78, 175), (228, 196, 238)], 0.72)

# Pinturas procedurais (cores lineares): casco, painéis de cima, parte de baixo
# (esteiras/trem de pouso) e a fração da altura que conta como parte de baixo.
PAINTS = {
	"coa_armour": dict(hull=(0.62, 0.64, 0.66), top=(0.10, 0.22, 0.52), low=(0.07, 0.07, 0.08), low_frac=0.28),
	"drone_grey": dict(hull=(0.30, 0.32, 0.34), top=(0.55, 0.36, 0.10), low=(0.06, 0.06, 0.07), low_frac=0.35),
}


def extract(zip_name):
	out = tempfile.mkdtemp(prefix="mw_exo_")
	with zipfile.ZipFile(os.path.join(REFS, zip_name)) as z:
		z.extractall(out)
	return out


def find(folder, suffix):
	return glob.glob(os.path.join(folder, "*" + suffix))[0]


def load_pixels(path):
	img = bpy.data.images.load(path)
	px = bc.pixels(img)[..., :3].copy()
	bpy.data.images.remove(img)
	return px


def tripo_textures(folder, tex, base, civ):
	"""Cor (repintada para a facção, se houver), normal e spec do Tripo."""
	_, color, normal, rough, metal = tex
	col = load_pixels(find(folder, color))
	if civ:
		style_file, accent, accent_max = STYLES[civ]
		style = load_pixels(os.path.join(st.TEX, style_file)) * 255
		ramps, luma = st.ramps(style, st.painted(style), accent)
		col = st.restyle(col * 255, ramps, luma, accent, accent_max, src_accent="any") / 255
	bc.save_png(col, os.path.join(SKINS, base + ".png"))
	files = {"baseTex": base + ".png", "normTex": "vehicle/flat_norm.png", "specTex": base + "_spec.png"}
	if normal:
		bc.save_png(load_pixels(find(folder, normal)), os.path.join(SKINS, base + "_norm.png"))
		files["normTex"] = base + "_norm.png"
	if rough and metal:
		r = load_pixels(find(folder, rough))[..., :1]
		m = load_pixels(find(folder, metal))[..., :1]
		spec = np.clip((1 - r) * 0.55 + m * 0.25, 0, 1)
	else:
		spec = np.clip(0.08 + col.mean(axis=2, keepdims=True) * 0.5, 0, 1)
	bc.save_png(np.repeat(spec, 3, axis=2), os.path.join(SKINS, base + "_spec.png"))
	return files


def paint_material(scheme, height):
	"""Casco com painéis; superfícies de cima na cor de destaque; parte de
	baixo escura."""
	p = PAINTS[scheme]
	mat = bpy.data.materials.new(scheme)
	mat.use_nodes = True
	nt = mat.node_tree
	n, link = nt.nodes, nt.links.new
	bsdf = n["Principled BSDF"]
	geo = n.new("ShaderNodeNewGeometry")
	tc = n.new("ShaderNodeTexCoord")
	sep_n = n.new("ShaderNodeSeparateXYZ")
	link(geo.outputs["Normal"], sep_n.inputs[0])
	sep_p = n.new("ShaderNodeSeparateXYZ")
	link(tc.outputs["Object"], sep_p.inputs[0])

	def rgb(c):
		return (*c, 1)

	# Cima: normal apontando para cima.
	top = n.new("ShaderNodeMapRange")
	top.inputs["From Min"].default_value, top.inputs["From Max"].default_value = 0.55, 0.8
	link(sep_n.outputs["Z"], top.inputs["Value"])
	mix_top = n.new("ShaderNodeMix")
	mix_top.data_type = "RGBA"
	mix_top.inputs[6].default_value, mix_top.inputs[7].default_value = rgb(p["hull"]), rgb(p["top"])
	link(top.outputs["Result"], mix_top.inputs["Factor"])
	# Baixo: altura abaixo de low_frac.
	low = n.new("ShaderNodeMapRange")
	low.inputs["From Min"].default_value = height * p["low_frac"]
	low.inputs["From Max"].default_value = height * (p["low_frac"] - 0.05)
	link(sep_p.outputs["Z"], low.inputs["Value"])
	mix_low = n.new("ShaderNodeMix")
	mix_low.data_type = "RGBA"
	link(mix_top.outputs[2], mix_low.inputs[6])
	mix_low.inputs[7].default_value = rgb(p["low"])
	link(low.outputs["Result"], mix_low.inputs["Factor"])
	# Painéis: ladrilhos em coordenadas do objeto, linhas finas mais escuras.
	brick = n.new("ShaderNodeTexBrick")
	brick.inputs["Scale"].default_value = 0.8
	brick.inputs["Mortar Size"].default_value = 0.015
	brick.inputs["Color1"].default_value = (1, 1, 1, 1)
	brick.inputs["Color2"].default_value = (0.9, 0.9, 0.9, 1)
	brick.inputs["Mortar"].default_value = (0.45, 0.45, 0.45, 1)
	link(tc.outputs["Object"], brick.inputs["Vector"])
	mul = n.new("ShaderNodeMix")
	mul.data_type = "RGBA"
	mul.blend_type = "MULTIPLY"
	mul.inputs["Factor"].default_value = 1.0
	link(mix_low.outputs[2], mul.inputs[6])
	link(brick.outputs["Color"], mul.inputs[7])
	link(mul.outputs[2], bsdf.inputs["Base Color"])
	bsdf.inputs["Roughness"].default_value = 0.5
	return mat


def swarm_vehicle_texture():
	"""vehicle/swarm/mla_veh_01.png: a da MLA retinta como o gerador de facções faz."""
	out = os.path.join(SKINS, VEHICLE_ATLAS["swarm"])
	if os.path.exists(out):
		return
	stops, strength = SWARM_TINT
	rgb = load_pixels(os.path.join(SKINS, VEHICLE_ATLAS["mla"]))
	lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
	stops = np.array(stops, np.float32) / 255
	pos = lum * (len(stops) - 1)
	i0 = np.clip(np.floor(pos).astype(int), 0, len(stops) - 2)
	t = (pos - i0)[..., None]
	grad = stops[i0] * (1 - t) + stops[i0 + 1] * t
	os.makedirs(os.path.dirname(out), exist_ok=True)
	bc.save_png(rgb * (1 - strength) + grad * strength, out)


def box_uv(mesh, low_frac):
	"""Projeção em caixa no atlas de veículos: cada face vai para a região do
	seu lado (pela normal), com o modelo inteiro esticado na região."""
	import bmesh
	lo, hi = bc.world_bounds([mesh])
	size = hi - lo
	me = mesh.data
	for extra in [u.name for u in me.uv_layers]:
		me.uv_layers.remove(me.uv_layers[extra])
	me.uv_layers.new(name="atlas")
	bm = bmesh.new()
	bm.from_mesh(me)
	uv = bm.loops.layers.uv.verify()
	W, H = ATLAS_SIZE
	nx = lambda p, a: (p[a] - lo[a]) / max(size[a], 1e-6)
	for f in bm.faces:
		n = f.normal
		ax = max(range(3), key=lambda i: abs(n[i]))
		c = f.calc_center_median()
		if low_frac and c.z < lo.z + size.z * low_frac and ax != 2:
			region, fu, fv = "low", (lambda p: nx(p, 1)), (lambda p: nx(p, 2) / low_frac)
		elif ax == 0:
			flip = n.x < 0
			region, fu, fv = "side", (lambda p, f=flip: 1 - nx(p, 1) if f else nx(p, 1)), (lambda p: nx(p, 2))
		elif ax == 1:
			flip = n.y > 0
			region, fu, fv = "front", (lambda p, f=flip: 1 - nx(p, 0) if f else nx(p, 0)), (lambda p: nx(p, 2))
		else:
			region = "top" if n.z > 0 else "bottom"
			fu, fv = (lambda p: nx(p, 0)), (lambda p: 1 - nx(p, 1))
		x0, y0, x1, y1 = REGIONS[region]
		for loop in f.loops:
			p = loop.vert.co
			u, v = min(max(fu(p), 0.0), 1.0), min(max(fv(p), 0.0), 1.0)
			loop[uv].uv = ((x0 + (x1 - x0) * u) / W, 1 - (y1 - (y1 - y0) * v) / H)
	bm.to_mesh(me)
	bm.free()


def atlas_files(civ):
	return {"baseTex": VEHICLE_ATLAS[civ], "normTex": ATLAS_NORM, "specTex": ATLAS_SPEC}


def empty(name, pos):
	e = bpy.data.objects.new(name, None)
	e.location = pos
	bpy.context.scene.collection.objects.link(e)
	return e


def muzzle_point(mesh):
	co = np.array([v.co[:] for v in mesh.data.vertices])
	zmax = co[:, 2].max()
	high = co[co[:, 2] > zmax * MUZZLE_MIN_Z]
	front = high[high[:, 1] < high[:, 1].min() + 0.25]
	return Vector(front.mean(axis=0))


def rig_vtol(meshes, tip, folder_rel):
	"""VTOL: vtol_root > body > nacelle_l/nacelle_r (motores nas pontas das
	asas, |x| > NACELLE_X, giram em torno do eixo X do pivô). Pele rígida.
	Animações: idle (paira, motores na vertical), walk (voo: nariz baixo e
	motores inclinados para a frente), attack (recuo) e death (perde o
	controle). Exporta as malhas com o esqueleto e as animações; devolve
	(armadura, ações, linhas de animação do actor)."""
	import math
	NACELLE_X = 4.5
	any_mesh = next(iter(meshes))
	co = np.array([v.co[:] for v in any_mesh.data.vertices])
	pivots = {}
	for side, sign in (("l", -1), ("r", 1)):
		sel = co[co[:, 0] * sign > NACELLE_X]
		pivots[side] = Vector(((sel[:, 0].min() + sel[:, 0].max()) / 2, (sel[:, 1].min() + sel[:, 1].max()) / 2,
			(sel[:, 2].min() + sel[:, 2].max()) / 2))
	lo, hi = bc.world_bounds([any_mesh])
	center = (lo + hi) / 2
	up = Vector((0, 0, 1))
	bones = [
		("vtol_root", None, Vector((0, 0, 0)), up, False),
		("vtol_body", "vtol_root", center, center + up, True),
		("vtol_nacelle_l", "vtol_body", pivots["l"], pivots["l"] + up, True),
		("vtol_nacelle_r", "vtol_body", pivots["r"], pivots["r"] + up, True),
		("prop_projectile", "vtol_body", tip, tip + up * 0.5, False),
		("prop_muzzle", "vtol_body", tip, tip + up * 0.5, False),
	]
	arm = bc.new_armature("vtol", bones)
	for m in meshes:
		bc.bind_rigid(m, arm, lambda i, m=m: "vtol_nacelle_l" if m.data.vertices[i].co.x < -NACELLE_X else
			"vtol_nacelle_r" if m.data.vertices[i].co.x > NACELLE_X else "vtol_body")
	rest = bc.rest_matrices(arm)
	L = bc.local_pose
	X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
	controls = ["vtol_body", "vtol_nacelle_l", "vtol_nacelle_r"]

	def pose(body_move=(0, 0, 0), body_rot=(), tilt=0.0):
		return {"vtol_body": L(rest, "vtol_body", move=body_move, rot=body_rot),
			"vtol_nacelle_l": L(rest, "vtol_nacelle_l", rot=[(X, tilt)]),
			"vtol_nacelle_r": L(rest, "vtol_nacelle_r", rot=[(X, tilt)])}

	def idle(t):
		s = math.sin(2 * math.pi * t)
		return pose((0, 0, 0.25 * s), [(Y, 1.5 * math.sin(2 * math.pi * t + 0.7)), (X, 1.0 * s)], 3 * s)

	def walk(t):
		s = math.sin(2 * math.pi * t)
		return pose((0.2 * s, 0, 0.12 * math.sin(4 * math.pi * t)), [(X, 7), (Y, -5 * s)], 38 + 3 * s)

	def attack(t):
		r = 0.0 if t < 0.1 else math.exp(-(t - 0.1) * 9) * (1 - math.exp(-(t - 0.1) * 60))
		return pose((0, 0.35 * r, 0.1 * r), [(X, -4 * r)], -6 * r)

	def death(t):
		return pose((0, -1.5 * t, -2.0 * t * t), [(X, 35 * t * t), (Y, 140 * t)], 60 * t)

	actions = {
		"idle": bc.make_action(arm, "idle", 60, idle, controls),
		"walk": bc.make_action(arm, "walk", 60, walk, controls),
		"attack": bc.make_action(arm, "attack", 24, attack, controls),
		"death": bc.make_action(arm, "death", 45, death, controls),
	}
	bc.skeleton_xml(arm, "vtol", "VTOL", "VTOL dos modelos de refs/exo (tools/imported/import_exo_models.py)")
	for m in meshes:
		bc.export_mesh(m, arm, "%s/exo/%s.dae" % (folder_rel, m.name))
	for n, act in actions.items():
		bc.export_action(arm, act, "vehicle/vtol/%s.dae" % n, any_mesh)
	anims = [("Idle", "vehicle/vtol/idle.dae", 100, ""), ("Walk", "vehicle/vtol/walk.dae", 100, ""),
		("Run", "vehicle/vtol/walk.dae", 100, ""), ("attack_ranged", "vehicle/vtol/attack.dae", 100, ' event="0.1"'),
		("Death", "vehicle/vtol/death.dae", 100, "")]
	return arm, actions, anims


RIGS = {"vtol": rig_vtol}


def actor_xml(name, mesh_rel, files, kind, muzzle, comment, rig=None):
	attack = ""
	props = ""
	if muzzle:
		props = '\t\t\t<props>\n\t\t\t\t<prop actor="props/units/weapons/ammo/tracer_heavy.xml" attachpoint="projectile"/>\n\t\t\t</props>\n'
		attack = ('\t\t<variant name="attack_ranged">\n\t\t\t<props>\n'
			'\t\t\t\t<prop actor="particle/muzzleflash_1.xml" attachpoint="muzzle"/>\n'
			'\t\t\t</props>\n\t\t</variant>\n')
	size = "large" if kind == "structure" else "small"
	if rig:
		props = ("\t\t\t<animations>\n%s\t\t\t</animations>\n" % "".join(
			'\t\t\t\t<animation%s file="%s" name="%s" speed="%d"/>\n' % (ev, f, n, sp) for n, f, sp, ev in rig[2])) + props
	return """<?xml version="1.0" encoding="utf-8"?>
<!-- %s Gerado por tools/imported/import_exo_models.py (modelo de refs/exo,
     ver CREDITS.md). -->
<actor version="1">
	<castshadow/>
	<group>
		<variant frequency="1" name="Base">
			<mesh>%s</mesh>
%s			<textures>
				<texture file="%s" name="baseTex"/>
				<texture file="%s" name="normTex"/>
				<texture file="%s" name="specTex"/>
			</textures>
		</variant>
	</group>
	<group>
		<variant frequency="1" name="Idle"/>
%s	</group>
	<group>
		<variant frequency="1" name="alive"/>
		<variant name="death">
			<props>
				<prop actor="particle/destruction_smoke_%s.xml" attachpoint="root"/>
				<prop actor="particle/destruction_dust_%s.xml" attachpoint="root"/>
			</props>
		</variant>
	</group>
	<material>basic_trans_norm_spec.xml</material>
</actor>
""" % (comment, mesh_rel, props, files["baseTex"], files["normTex"], files["specTex"], attack, size, size)


def build(name):
	cfg = MODELS[name]
	folder = extract(cfg["zip"])
	bc.reset()
	bc.import_file(glob.glob(os.path.join(folder, "*.obj"))[0])
	mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
	bc.keep_only([mesh])
	mesh.name = mesh.data.name = name
	bc.clean_mesh(mesh, merge=1e-6)
	bc.decimate(mesh, cfg["faces"])
	bc.normalize([mesh], cfg["size"], axis=cfg["axis"], rotate_z=cfg["rot"])
	bc.fix_normals(mesh, angle=40)
	lo, hi = bc.world_bounds([mesh])
	folder_rel = "structural" if cfg["kind"] == "structure" else "vehicle"
	variants = cfg["civs"] or [None]
	tex = cfg["tex"]
	files_by_civ = {}
	if tex[0] == "paint":
		mesh.data.materials.clear()
		mesh.data.materials.append(paint_material(tex[1], hi.z - lo.z))
		civ = variants[0]
		base = "%s/%s%s" % (folder_rel, (civ + "/") if civ else "exo/", name)
		files = bc.bake_textures(mesh, base, size=1024, normal=False)
		files.setdefault("normTex", "vehicle/flat_norm.png")
		files_by_civ[civ] = files
	else:
		for extra in [u.name for u in mesh.data.uv_layers][1:]:
			mesh.data.uv_layers.remove(mesh.data.uv_layers[extra])
		for civ in variants:
			base = "%s/%s%s" % (folder_rel, (civ + "/") if civ else "exo/", name)
			files_by_civ[civ] = tripo_textures(folder, tex, base, civ)
	bc.triangulate(mesh)
	# share: actors das facções com a mesma malha e a textura original.
	for civ in cfg.get("share", []):
		files_by_civ[civ] = files_by_civ[None]
	meshes = {mesh: files_by_civ}
	if cfg.get("atlas"):
		if "swarm" in cfg["atlas"]:
			swarm_vehicle_texture()
		veh = mesh.copy()
		veh.data = mesh.data.copy()
		veh.name = veh.data.name = name + "_veh"
		bpy.context.scene.collection.objects.link(veh)
		box_uv(veh, cfg.get("low_frac", 0.0))
		meshes[veh] = {civ: atlas_files(civ) for civ in cfg["atlas"]}

	tip = muzzle_point(mesh) if cfg["muzzle"] else None
	for m in meshes:
		m.data.materials.clear()
		m.data.materials.append(bpy.data.materials.new(m.name))
	actor_dir = "structures" if cfg["kind"] == "structure" else "vehicle"
	if cfg.get("rig"):
		rig = RIGS[cfg["rig"]](meshes, tip, folder_rel)
	else:
		rig = None
		props = [empty("prop_projectile", tip), empty("prop_muzzle", tip)] if tip is not None else []
		for m in meshes:
			mesh_rel = "%s/exo/%s.dae" % (folder_rel, m.name)
			path = os.path.join(bc.MOD, "art", "meshes", mesh_rel)
			os.makedirs(os.path.dirname(path), exist_ok=True)
			bc.select([m] + props)
			bpy.ops.wm.collada_export(filepath=path, check_existing=False, selected=True, include_children=False,
				include_armatures=False, include_animations=False, apply_modifiers=True, triangulate=True,
				use_object_instantiation=False, active_uv_only=True, use_texture_copies=False,
				export_global_forward_selection="Y", export_global_up_selection="Z", apply_global_orientation=False)
	for m, by_civ in meshes.items():
		mesh_rel = "%s/exo/%s.dae" % (folder_rel, m.name)
		for civ, files in by_civ.items():
			rel = "%s/%s/%s.xml" % (actor_dir, civ or "exo", name)
			comment = "%s%s." % (name.replace("_", " ").capitalize(), (" (" + civ + ")") if civ else " (genérico)")
			out = os.path.join(bc.MOD, "art", "actors", rel)
			os.makedirs(os.path.dirname(out), exist_ok=True)
			with open(out, "w", encoding="utf-8") as f:
				f.write(actor_xml(name, mesh_rel, files, cfg["kind"], cfg["muzzle"], comment, rig))
	d = hi - lo
	print("MODELO %s tris=%d tamanho=%.1f x %.1f x %.1f malhas=%s" % (name, bc.triangle_count(mesh), d.x, d.y, d.z,
		{m.name: list(c) for m, c in meshes.items()}))
	if os.environ.get("MW_PREVIEW"):
		for m, by_civ in meshes.items():
			for civ, files in by_civ.items():
				mat = m.data.materials[0]
				mat.use_nodes = True
				for old_node in [x for x in mat.node_tree.nodes if x.type == "TEX_IMAGE"]:
					mat.node_tree.nodes.remove(old_node)
				node = mat.node_tree.nodes.new("ShaderNodeTexImage")
				node.image = bpy.data.images.load(os.path.join(SKINS, files["baseTex"]))
				mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
				bc.render_frames([m], os.path.join(os.environ["MW_PREVIEW"], "exo_%s_%s.png" % (name, civ or "generic")),
					arm=rig[0] if rig else None, act=rig[1].get("walk") if rig else None, frames=(1,),
					views=("front", "side", "persp"), res=300)


names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else list(MODELS)
for n in names:
	build(n)

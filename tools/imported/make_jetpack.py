"""Jetpack da Coalizão (prop no ponto "back" do soldado, no lugar da mochila).

Corpo central achatado, dois propulsores cilíndricos com bocais cônicos e
uma faixa azul. Textura própria pequena (cores lisas por peça). Pontos de
encaixe jet_l / jet_r na saída dos bocais, onde o actor põe as chamas.
Medidas do mesmo jeito que a mochila mla_bag_01_01.dae (o ponto "back" fica
nas costas; +Y para trás, +Z para cima).

Gera art/meshes/props/armor/coa/jetpack.dae e
art/textures/skins/props/armor/coa/jetpack.png.
Uso (na pasta do mod):  blender -b -P tools/imported/make_jetpack.py
"""
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

MESH = os.path.join(bc.MOD, "art", "meshes", "props", "armor", "coa", "jetpack.dae")
TEXTURE = os.path.join(bc.MOD, "art", "textures", "skins", "props", "armor", "coa", "jetpack.png")
# Cores (linear 0..1) e a célula da textura 4x1 que cada peça usa.
COLORS = [(0.20, 0.22, 0.25), (0.62, 0.64, 0.66), (0.10, 0.28, 0.62), (0.05, 0.05, 0.06)]
BODY, PLATE, STRIPE, NOZZLE = range(4)
SIDE = 0.36       # distância dos propulsores ao centro
BACK = 0.42       # quanto os propulsores ficam para trás das costas
NOZZLE_Z = -1.05  # saída dos bocais


def texture():
	img = np.zeros((16, 64, 3), np.float32)
	for i, c in enumerate(COLORS):
		img[:, i * 16:(i + 1) * 16] = c
	# Leve ruído para não parecer plástico.
	img *= 0.92 + 0.08 * np.random.default_rng(1).random(img.shape[:2])[..., None]
	bc.save_png(img, TEXTURE)


def uv_cell(bm, faces, cell):
	"""Todas as faces de uma peça amostram o meio da sua célula de cor."""
	uv = bm.loops.layers.uv.verify()
	u = (cell * 16 + 8) / 64.0
	for f in faces:
		for loop in f.loops:
			loop[uv].uv = (u, 0.5)


def add(bm, geom_fn, cell, matrix):
	before = set(bm.faces)
	geom_fn(bm)
	new = [f for f in bm.faces if f not in before]
	bmesh.ops.transform(bm, matrix=matrix, verts=list({v for f in new for v in f.verts}))
	uv_cell(bm, new, cell)


def cube(sx, sy, sz):
	return lambda bm: bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((sx, sy, sz, 1)))


def cylinder(r1, r2, depth, segments=12):
	return lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
		radius1=r1, radius2=r2, depth=depth)


def build():
	bc.reset()
	me = bpy.data.meshes.new("jetpack")
	bm = bmesh.new()
	T = Matrix.Translation
	# Corpo e placa de proteção.
	add(bm, cube(0.62, 0.30, 1.05), BODY, T((0, 0.17, 0.05)))
	add(bm, cube(0.56, 0.06, 0.70), PLATE, T((0, 0.34, 0.15)))
	add(bm, cube(0.64, 0.32, 0.10), STRIPE, T((0, 0.17, 0.45)))
	for side in (-1, 1):
		x = side * SIDE
		# Tanque/propulsor, anel azul, bocal cônico.
		add(bm, cylinder(0.17, 0.17, 1.20), BODY, T((x, BACK, -0.05)))
		add(bm, cylinder(0.185, 0.185, 0.10), STRIPE, T((x, BACK, 0.35)))
		add(bm, cylinder(0.12, 0.20, 0.22), NOZZLE, T((x, BACK, NOZZLE_Z + 0.11)))
		add(bm, cylinder(0.09, 0.12, 0.10), PLATE, T((x, BACK, 0.62)))
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	bm.to_mesh(me)
	bm.free()
	ob = bpy.data.objects.new("jetpack", me)
	bpy.context.scene.collection.objects.link(ob)
	mat = bpy.data.materials.new("jetpack")
	me.materials.append(mat)
	bc.triangulate(ob)
	props = []
	for name, side in (("prop_jet_l", -1), ("prop_jet_r", 1)):
		e = bpy.data.objects.new(name, None)
		e.location = (side * SIDE, BACK, NOZZLE_Z)
		bpy.context.scene.collection.objects.link(e)
		props.append(e)
	os.makedirs(os.path.dirname(MESH), exist_ok=True)
	bc.select([ob] + props)
	bpy.ops.wm.collada_export(filepath=MESH, check_existing=False, selected=True, include_children=False,
		include_armatures=False, include_animations=False, apply_modifiers=True, triangulate=True,
		use_object_instantiation=False, active_uv_only=True, use_texture_copies=False,
		export_global_forward_selection="Y", export_global_up_selection="Z", apply_global_orientation=False)
	print("JETPACK tris=%d" % bc.triangle_count(ob))


texture()
build()

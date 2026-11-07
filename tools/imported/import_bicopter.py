"""BiCopter (BiCopter.zip): drone de dois rotores carenados.

O FBX vem sem textura (um material cinza): cada peça ganha uma cor (corpo
oliva, chassi grafite, carenagens, motores de aço, pás escuras), assada com
AO numa textura só. Esqueleto novo e pele rígida por peça:
  bicopter_root > body > rotor_l, rotor_r
Animações: idle (paira, rotores girando), walk (inclina o nariz para a
frente), death (perde o controle e cai girando).

Gera art/meshes/vehicle/bicopter.dae, art/skeletons/bicopter.xml,
art/animation/vehicle/bicopter/*.dae e art/textures/skins/vehicle/bicopter*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_bicopter.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "bicopter"
WIDTH = 7.0
ROTOR_FRAMES = 12   # uma volta dos rotores
FACES = 6000
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
# Peça do FBX -> (osso, cor, rugosidade).
PARTS = {
	"BiCopter": ("body", (0.30, 0.33, 0.22), 0.5),
	"Back": ("body", (0.30, 0.33, 0.22), 0.5),
	"Chassis": ("body", (0.16, 0.17, 0.18), 0.4),
	"L_Protect": ("body", (0.24, 0.26, 0.18), 0.5),
	"R_Protect": ("body", (0.24, 0.26, 0.18), 0.5),
	"Motors": ("body", (0.45, 0.46, 0.47), 0.3),
	"L_Helli": ("rotor_l", (0.06, 0.06, 0.06), 0.6),
	"R_Helli": ("rotor_r", (0.06, 0.06, 0.06), 0.6),
}

src = bc.extract("BiCopter.zip")
bc.reset()
bc.import_file(os.path.join(src, "BiCopter.fbx"))
objs = [bpy.data.objects[n] for n in PARTS]
bc.keep_only(objs)
for o in objs:
	o.data = o.data.copy()  # malhas compartilhadas entre peças
bc.normalize(objs, WIDTH, axis="x")
rotor_center = {}
for o in objs:
	bone, rgb, rough = PARTS[o.name]
	bc.set_flat_material([o], rgb, rough)
	g = o.vertex_groups.new(name=bone)
	g.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
	if bone.startswith("rotor"):
		lo, hi = bc.world_bounds([o])
		rotor_center[bone] = (lo + hi) / 2
mesh = bc.join(objs, NAME)
bc.clean_mesh(mesh, merge=1e-4)
bc.decimate(mesh, FACES)
textures = bc.bake_textures(mesh, "vehicle/" + NAME, size=1024, normal=False)

lo, hi = bc.world_bounds([mesh])
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))
nose = Vector((0, lo.y, center.z))
up = Vector((0, 0, 1))
bones = [
	("bicopter_root", None, Vector(), up, False),
	("body", "bicopter_root", center, center + up, True),
	("rotor_l", "body", rotor_center["rotor_l"], rotor_center["rotor_l"] + up, True),
	("rotor_r", "body", rotor_center["rotor_r"], rotor_center["rotor_r"] + up, True),
	("prop_projectile", "body", nose, nose + up * 0.5, False),
	("prop_rotor_l", "rotor_l", rotor_center["rotor_l"], rotor_center["rotor_l"] + up * 0.5, False),
	("prop_rotor_r", "rotor_r", rotor_center["rotor_r"], rotor_center["rotor_r"] + up * 0.5, False),
]
arm = bc.new_armature(NAME, bones)
bc.parent_to(mesh, arm)
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["body", "rotor_l", "rotor_r"]


def rotors(turns):
	"""Rotores em sentidos contrários."""
	return {"rotor_l": L(rest, "rotor_l", rot=[(Z, 360 * turns)]),
		"rotor_r": L(rest, "rotor_r", rot=[(Z, -360 * turns)])}


def idle(t):
	# 48 quadros = 4 voltas dos rotores; o corpo sobe e desce uma vez.
	v = rotors(4 * t)
	v["body"] = L(rest, "body", move=(0, 0, 0.15 * math.sin(2 * math.pi * t)),
		rot=[(X, 1.5 * math.sin(2 * math.pi * t + 1)), (Y, 1.2 * math.sin(2 * math.pi * t))])
	return v


def walk(t):
	v = rotors(4 * t)
	v["body"] = L(rest, "body", move=(0, 0, 0.08 * math.sin(4 * math.pi * t)),
		rot=[(X, 9 + 1.0 * math.sin(2 * math.pi * t)), (Y, 2 * math.sin(2 * math.pi * t))])
	return v


def death(t):
	# Rotores perdendo giro, corpo tomba e gira caindo.
	turns = 3 * t - 1.2 * t * t
	v = rotors(turns)
	v["body"] = L(rest, "body", move=(0, 0, -center.z * 0.6 * t * t),
		rot=[(X, -12 * t), (Y, 28 * t), (Z, 260 * t * t)])
	return v


actions = {
	"idle": bc.make_action(arm, "idle", 4 * ROTOR_FRAMES, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", 4 * ROTOR_FRAMES, walk, CONTROLS),
	"death": bc.make_action(arm, "death", 40, death, CONTROLS),
}
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "BiCopter", "BiCopter (tools/imported/import_bicopter.py)")
bc.export_mesh(mesh, arm, "vehicle/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "vehicle/%s/%s.dae" % (NAME, n), mesh)
print("BICOPTER tris", bc.triangle_count(mesh), textures)
if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	bc.render_frames([mesh], os.path.join(out, NAME + "_walk.png"), arm, actions["walk"], frames=(1, 4), views=("front", "side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_death.png"), arm, actions["death"], frames=(1, 20, 41), views=("side", "persp"))

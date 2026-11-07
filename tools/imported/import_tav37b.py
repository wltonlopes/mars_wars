"""TAV-37B (tav-37b-space-shuttle.zip): nave orbital de corpo sustentador.

O .dae (SketchUp, dentro de outro zip) vem quase todo com cinzas lisos e
muitas peças internas: a casca ganha pintura de ônibus espacial (dorso claro
com painéis, barriga de placas térmicas escuras, bordas de ataque cinza),
vidros escuros, e tudo é assado com AO numa textura só. Esqueleto novo, pele
rígida:  tav37b_root > body  (+ pontos de encaixe dos motores).
Animações: idle (paira balançando), walk (voo: nariz baixo e inclinação
lateral), death (perde sustentação, mergulha girando).

Gera art/meshes/vehicle/tav37b.dae, art/skeletons/tav37b.xml,
art/animation/vehicle/tav37b/*.dae e art/textures/skins/vehicle/tav37b*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_tav37b.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "tav37b"
LENGTH = 30.0
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

src = bc.extract("tav-37b-space-shuttle.zip", inner="source/space+shuttle+avatar+(2).zip")
bc.reset()
bc.import_file(os.path.join(src, "inner", "model.dae"))
objs = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.polygons)]
bc.keep_only(objs + [o for o in bpy.data.objects if o.type == "EMPTY"])
for o in objs:
	if o.data.users > 1:
		o.data = o.data.copy()
# Materiais ligados ao objeto (SketchUp) passam para a malha antes de juntar.
for o in objs:
	mats = [s.material for s in o.material_slots]
	for s in o.material_slots:
		s.link = "DATA"
	o.data.materials.clear()
	for m in mats:
		o.data.materials.append(m)
bc.normalize(objs, LENGTH, axis="y")
for e in [o for o in bpy.data.objects if o.type == "EMPTY"]:
	bpy.data.objects.remove(e)
mesh = bc.join(objs, NAME)
bc.clean_mesh(mesh, merge=1e-4)
bc.fix_normals(mesh)


def paint():
	"""Pintura procedural (coordenadas do objeto, normal geométrica)."""
	mat = bpy.data.materials.new("tav_paint")
	mat.use_nodes = True
	nt = mat.node_tree
	n, link = nt.nodes, nt.links.new
	bsdf = n["Principled BSDF"]
	geo = n.new("ShaderNodeNewGeometry")
	sep = n.new("ShaderNodeSeparateXYZ")
	link(geo.outputs["Normal"], sep.inputs[0])
	# Barriga (normal para baixo) escura, dorso claro.
	ramp = n.new("ShaderNodeValToRGB")
	ramp.color_ramp.elements[0].position = 0.25
	ramp.color_ramp.elements[0].color = (0.035, 0.037, 0.04, 1)
	ramp.color_ramp.elements[1].position = 0.45
	ramp.color_ramp.elements[1].color = (0.78, 0.79, 0.8, 1)
	mapz = n.new("ShaderNodeMapRange")
	mapz.inputs["From Min"].default_value = -1
	mapz.inputs["From Max"].default_value = 1
	link(sep.outputs["Z"], mapz.inputs["Value"])
	link(mapz.outputs["Result"], ramp.inputs["Fac"])
	# Painéis/placas: ladrilhos em coordenadas do objeto, leve variação.
	tc = n.new("ShaderNodeTexCoord")
	brick = n.new("ShaderNodeTexBrick")
	brick.inputs["Scale"].default_value = 0.9
	brick.inputs["Mortar Size"].default_value = 0.012
	brick.inputs["Color1"].default_value = (1, 1, 1, 1)
	brick.inputs["Color2"].default_value = (0.86, 0.86, 0.86, 1)
	brick.inputs["Mortar"].default_value = (0.55, 0.55, 0.55, 1)
	link(tc.outputs["Object"], brick.inputs["Vector"])
	mix = n.new("ShaderNodeMix")
	mix.data_type = "RGBA"
	mix.blend_type = "MULTIPLY"
	mix.inputs["Factor"].default_value = 1.0
	link(ramp.outputs["Color"], mix.inputs[6])
	link(brick.outputs["Color"], mix.inputs[7])
	link(mix.outputs[2], bsdf.inputs["Base Color"])
	return mat


hull = paint()
dark = bpy.data.materials.new("tav_glass")
dark.use_nodes = True
dark.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.03, 0.05, 0.08, 1)
for i, slot in enumerate(mesh.material_slots):
	name = slot.material.name.lower() if slot.material else ""
	slot.material = dark if "glass" in name else hull
textures = bc.bake_textures(mesh, "vehicle/" + NAME, size=1024, normal=False)

lo, hi = bc.world_bounds([mesh])
center = (lo + hi) / 2
rear = Vector((center.x, hi.y, center.z))
nose = Vector((center.x, lo.y, center.z))
up = Vector((0, 0, 1))
side = (hi.x - lo.x) * 0.18
bones = [
	("tav37b_root", None, Vector(), up, False),
	("body", "tav37b_root", center, center + up, True),
	("prop_engine_l", "body", rear - Vector((side, 0, 0)), rear - Vector((side, 0, 0)) + up, False),
	("prop_engine_r", "body", rear + Vector((side, 0, 0)), rear + Vector((side, 0, 0)) + up, False),
	("prop_projectile", "body", nose, nose + up, False),
]
arm = bc.new_armature(NAME, bones)
g = mesh.vertex_groups.new(name="body")
g.add([v.index for v in mesh.data.vertices], 1.0, "REPLACE")
bc.parent_to(mesh, arm)
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["body"]


def idle(t):
	s = math.sin(2 * math.pi * t)
	return {"body": L(rest, "body", move=(0, 0, 0.35 * s),
		rot=[(Y, 2.0 * math.sin(2 * math.pi * t + 0.8)), (X, 1.0 * s)])}


def walk(t):
	s = math.sin(2 * math.pi * t)
	return {"body": L(rest, "body", move=(0.3 * s, 0, 0.2 * math.sin(4 * math.pi * t)),
		rot=[(X, 4), (Y, -6 * s), (Z, 1.5 * s)])}


def death(t):
	return {"body": L(rest, "body", move=(0, -4 * t, -center.z * t * t),
		rot=[(X, 28 * t * t), (Y, 120 * t)])}


actions = {
	"idle": bc.make_action(arm, "idle", 120, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", 90, walk, CONTROLS),
	"death": bc.make_action(arm, "death", 50, death, CONTROLS),
}
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "TAV-37B", "TAV-37B (tools/imported/import_tav37b.py)")
bc.export_mesh(mesh, arm, "vehicle/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "vehicle/%s/%s.dae" % (NAME, n), mesh)
print("TAV37B tris", bc.triangle_count(mesh), textures)
if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	bc.render_frames([mesh], os.path.join(out, NAME + "_rest.png"), views=("persp", "rear", "below"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_walk.png"), arm, actions["walk"], frames=(1, 23, 68), views=("front", "persp"))

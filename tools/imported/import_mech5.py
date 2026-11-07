"""Mech5 (Mech5_final3.zip): andador bípede com dois canhões nos ombros.

Usa o esqueleto do .blend (Root, Hip, Torso, Weapon_L/R, pernas) e a textura
deserto empacotada nele (assada sobre o mapa UV original, com AO e o normal
map). Animações novas, feitas com IK nos tornozelos:
  idle (respiração), walk (passada), attack (recuo dos dois canhões), death.

Gera art/meshes/vehicle/mech5.dae, art/skeletons/mech5.xml,
art/animation/vehicle/mech5/*.dae e art/textures/skins/vehicle/mech5*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_mech5.py
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "mech5"
HEIGHT = 12.0
WALK_FRAMES = 40
STRIDE = 3.6
LIFT = 1.1

src = bc.extract("Mech5_final3.zip")
# O .blend de 2011 abre com uma tela onde os operadores de objeto não
# funcionam: anexa os objetos numa cena limpa.
bc.reset()
with bpy.data.libraries.load(os.path.join(src, "Mech5_final3.blend")) as (data_from, data_to):
	data_to.objects = ["Mech5", "Armature"]
	data_to.images = ["Mech5_desert.png.001", "Mech5_nor2.png"]
for o in data_to.objects:
	bpy.context.scene.collection.objects.link(o)
bpy.ops.file.pack_all()
mesh = bpy.data.objects["Mech5"]
arm = bpy.data.objects["Armature"]
bc.keep_only([mesh, arm])
arm.animation_data_clear()
for t in list(bpy.data.actions):
	bpy.data.actions.remove(t)

# Bordas duras do modelo original (edge split) e nada de grupo solto.
bc.select([mesh])
for m in list(mesh.modifiers):
	if m.type == "EDGE_SPLIT":
		bpy.ops.object.modifier_apply(modifier=m.name)
if mesh.vertex_groups.get("Group"):
	mesh.vertex_groups.remove(mesh.vertex_groups["Group"])

bc.normalize([mesh, arm], HEIGHT, rotate_z=0)

# Materiais: a textura deserto e o normal map empacotados no .blend.
desert = bpy.data.images["Mech5_desert.png.001"]
normal = bpy.data.images["Mech5_nor2.png"]
for slot in mesh.material_slots:
	mat = slot.material
	tree = bc.ensure_nodes(mat)
	if mat.name.startswith("Mech_desert"):
		bsdf = tree.nodes["Principled BSDF"]
		tex = tree.nodes.new("ShaderNodeTexImage")
		tex.image = desert
		tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
		ntex = tree.nodes.new("ShaderNodeTexImage")
		ntex.image = normal
		normal.colorspace_settings.name = "Non-Color"
		nm = tree.nodes.new("ShaderNodeNormalMap")
		tree.links.new(ntex.outputs["Color"], nm.inputs["Color"])
		tree.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
textures = bc.bake_textures(mesh, "vehicle/" + NAME, size=1024, reuse_uv=True)

# Esqueleto: pontos de encaixe nas bocas dos canhões; IK nos tornozelos.
bones = arm.data.bones
def head(n): return arm.matrix_world @ bones[n].head_local
def tail(n): return arm.matrix_world @ bones[n].tail_local
up = Vector((0, 0, 0.5))
bc.add_bones(arm, [
	("prop_muzzle_l", "Weapon_L", tail("Weapon_L"), tail("Weapon_L") + up, False),
	("prop_muzzle_r", "Weapon_R", tail("Weapon_R"), tail("Weapon_R") + up, False),
	("prop_projectile", "Weapon_R", tail("Weapon_R"), tail("Weapon_R") + up, False),
	("prop_root", "Root", Vector(), up, False),
])
# Alvos com a mesma orientação dos pés: copiar a rotação deixa o pé reto.
select = bc.select
select([arm])
bpy.ops.object.mode_set(mode="EDIT")
for side in "LR":
	foot = arm.data.edit_bones["Foot_" + side]
	t = arm.data.edit_bones.new("ik_" + side)
	t.head, t.tail, t.roll = foot.head.copy(), foot.tail.copy(), foot.roll
	t.use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")
for side in "LR":
	bc.ik(arm, "Lowleg_" + side, "ik_" + side, 2)
	c = arm.pose.bones["Foot_" + side].constraints.new("COPY_ROTATION")
	c.target, c.subtarget = arm, "ik_" + side
	c.target_space = c.owner_space = "POSE"

rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}


def local(name, rot=(), move=Vector()):
	"""Pose local do osso: rotações (eixo da armadura, graus) em torno da
	cabeça e deslocamento no espaço da armadura."""
	r3 = rest[name].to_3x3()
	m = Matrix()
	for axis, deg in rot:
		m = Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ m
	basis = r3.inverted().to_4x4() @ m @ r3.to_4x4()
	basis.translation = r3.inverted() @ Vector(move)
	return ("local", basis)


def target(side, dy=0.0, dz=0.0, dx=0.0):
	m = rest["ik_" + side].copy()
	m.translation += Vector((dx, dy, dz))
	return ("world", m)


CONTROLS = ["Root", "Hip", "Torso", "Weapon_L", "Weapon_R", "ik_L", "ik_R"]
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def idle(t):
	s = math.sin(2 * math.pi * t)
	return {"Root": local("Root", move=(0, 0, -0.08 + 0.08 * s)),
		"Torso": local("Torso", rot=[(Z, 3 * math.sin(2 * math.pi * t + 1)), (X, 1.2 * s)]),
		"ik_L": target("L"), "ik_R": target("R")}


def walk(t):
	v = {}
	for side, ph in (("L", 0.0), ("R", 0.5)):
		dy, dz = bc.walk_foot(t, ph, STRIDE, LIFT)
		v["ik_" + side] = target(side, dy, dz)
	bob = -0.35 + 0.25 * math.cos(4 * math.pi * t)
	sway = 0.18 * math.sin(2 * math.pi * t)
	v["Root"] = local("Root", move=(sway, 0, bob), rot=[(Y, 2.5 * math.sin(2 * math.pi * t))])
	v["Torso"] = local("Torso", rot=[(Z, -5 * math.sin(2 * math.pi * t)), (X, -2)])
	return v


def attack(t):
	# Disparo no quadro 2: os canos voltam e o tronco joga para trás.
	k = 0.0 if t < 0.06 else math.exp(-(t - 0.06) * 9) * (1 - math.exp(-(t - 0.06) * 60))
	return {"Torso": local("Torso", rot=[(X, -7 * k)]),
		"Weapon_L": local("Weapon_L", move=(0, 0.9 * k, 0)),
		"Weapon_R": local("Weapon_R", move=(0, 0.9 * k, 0)),
		"Root": local("Root", move=(0, 0.25 * k, -0.15 * k)),
		"ik_L": target("L"), "ik_R": target("R")}


def death(t):
	e = min(1.0, t / 0.75)
	e = e * e * (3 - 2 * e)
	fall = max(0.0, (t - 0.45) / 0.55)
	fall = fall * fall
	return {"Root": local("Root", move=(0, -1.6 * fall, -2.8 * e - 1.2 * fall), rot=[(X, -32 * fall), (Y, 8 * e)]),
		"Torso": local("Torso", rot=[(X, -25 * e), (Z, 10 * e)]),
		"Weapon_L": local("Weapon_L", rot=[(X, -20 * e)]),
		"Weapon_R": local("Weapon_R", rot=[(X, 15 * e)]),
		"ik_L": target("L", dx=0.6 * e), "ik_R": target("R", dy=-1.2 * e, dx=-0.4 * e)}


actions = {
	"idle": bc.make_action(arm, "idle", 60, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", WALK_FRAMES, walk, CONTROLS),
	"attack": bc.make_action(arm, "attack", 24, attack, CONTROLS),
	"death": bc.make_action(arm, "death", 45, death, CONTROLS),
}
bc.clear_constraints(arm)
bc.remove_bones(arm, ["ik_L", "ik_R"])
print("vértices sem peso:", bc.limit_weights(mesh))

bc.skeleton_xml(arm, NAME, "Mech5", "Mech5 (tools/imported/import_mech5.py)")
bc.export_mesh(mesh, arm, "vehicle/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "vehicle/%s/%s.dae" % (NAME, n), mesh)

print("MECH5 tris", bc.triangle_count(mesh), "texturas", textures,
	'speed="%d"' % round(100 / (STRIDE / 0.5)))
if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	bc.render_frames([mesh], os.path.join(out, NAME + "_rest.png"), views=("front", "side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_walk.png"), arm, actions["walk"], frames=(1, 11, 21, 31), views=("side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_death.png"), arm, actions["death"], frames=(1, 25, 46), views=("side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_attack.png"), arm, actions["attack"], frames=(1, 4, 12), views=("side",))

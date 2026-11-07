"""XV8 Crisis (xv8-crisis.zip): armadura de combate bípede com armas nos
antebraços e propulsores nas costas.

O FBX já tem pele (20 ossos sem nome): os ossos ganham nomes, as caudas
passam a apontar para a junta seguinte (para a IK funcionar) e as texturas PBR
(cor x AO, normal) são assadas numa textura só. Animações novas:
  idle, walk (IK nos pés), attack (braços apontam e recuam), death.

Gera art/meshes/vehicle/xv8.dae, art/skeletons/xv8.xml,
art/animation/vehicle/xv8/*.dae e art/textures/skins/vehicle/xv8*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_xv8.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "xv8"
HEIGHT = 6.0
ROTATE_Z = 180.0  # o FBX olha para +Y
WALK_FRAMES = 32
STRIDE = 1.9
LIFT = 0.55
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

# Ossos do FBX -> nomes (lado = lado do próprio XV8, que olha para -Y).
BONES = {
	"Bone001": "pelvis", "Bone002": "spine", "Bone003": "neck", "Bone004": "head",
	"Bone013": "clavicle_r", "Bone014": "shoulder_r", "Bone015": "upperarm_r", "Bone016": "forearm_r",
	"Bone017": "clavicle_l", "Bone018": "shoulder_l", "Bone019": "upperarm_l", "Bone020": "forearm_l",
	"Bone005": "hip_r", "Bone006": "thigh_r", "Bone007": "shin_r", "Bone008": "foot_r",
	"Bone009": "hip_l", "Bone010": "thigh_l", "Bone011": "shin_l", "Bone012": "foot_l",
}
# Material do FBX -> prefixo das texturas em textures/.
MATERIALS = {"01___Default": "01", "02___Default": "02", "05___Default": "05", "Wall_Paint": "Wall"}

src = bc.extract("xv8-crisis.zip", inner="source/XV8.rar")
tex_dir = os.path.join(src, "textures")
bc.reset()
bc.import_file(os.path.join(src, "inner", "XV8", "XV8_skinned.fbx"))
arm = bpy.data.objects["Armature"]
mesh = bpy.data.objects["Box001"]
bc.keep_only([arm, mesh])
arm.animation_data_clear()
for a in list(bpy.data.actions):
	bpy.data.actions.remove(a)
bc.normalize([arm, mesh], HEIGHT, rotate_z=ROTATE_Z)


def tex_file(prefix, kind):
	"""As texturas vêm com nomes variados ('01 - Default_X', '01_-_Default_X',
	'Wall Paint_X', 'Wall_Paint_X')."""
	want = kind.lower()
	for f in sorted(os.listdir(tex_dir)):
		low = f.lower().replace(" ", "_")
		if low.startswith(prefix.lower()) and low[:-4].endswith(want):
			return os.path.join(tex_dir, f)
	return None


for slot in mesh.material_slots:
	mat = slot.material
	prefix = MATERIALS.get(mat.name)
	mat.use_nodes = True
	nt = mat.node_tree
	nt.nodes.clear()
	out = nt.nodes.new("ShaderNodeOutputMaterial")
	bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
	nt.links.new(bsdf.outputs[0], out.inputs[0])
	if not prefix:
		bsdf.inputs["Base Color"].default_value = (0.08, 0.08, 0.09, 1)
		continue
	base = nt.nodes.new("ShaderNodeTexImage")
	base.image = bpy.data.images.load(tex_file(prefix, "base_color"))
	col = base.outputs["Color"]
	ao_file = tex_file(prefix, "mixed_ao")
	if ao_file:
		ao = nt.nodes.new("ShaderNodeTexImage")
		ao.image = bpy.data.images.load(ao_file)
		ao.image.colorspace_settings.name = "Non-Color"
		mix = nt.nodes.new("ShaderNodeMix")
		mix.data_type = "RGBA"
		mix.blend_type = "MULTIPLY"
		mix.inputs["Factor"].default_value = 1.0
		nt.links.new(col, mix.inputs[6])
		nt.links.new(ao.outputs["Color"], mix.inputs[7])
		col = mix.outputs[2]
	nt.links.new(col, bsdf.inputs["Base Color"])
	nfile = tex_file(prefix, "normal")
	if nfile:
		nimg = nt.nodes.new("ShaderNodeTexImage")
		nimg.image = bpy.data.images.load(nfile)
		nimg.image.colorspace_settings.name = "Non-Color"
		nm = nt.nodes.new("ShaderNodeNormalMap")
		nt.links.new(nimg.outputs["Color"], nm.inputs["Color"])
		nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

textures = bc.bake_textures(mesh, "vehicle/" + NAME, size=1024, ao=False)

# Ossos: nomes, caudas apontando para a junta seguinte, pontos de encaixe.
bc.rename_bones(arm, BONES)
bc.select([arm])
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
for b in eb:
	b.use_connect = False
chains = [("pelvis", "spine"), ("spine", "neck"), ("neck", "head"),
	("clavicle_r", "shoulder_r"), ("shoulder_r", "upperarm_r"), ("upperarm_r", "forearm_r"),
	("clavicle_l", "shoulder_l"), ("shoulder_l", "upperarm_l"), ("upperarm_l", "forearm_l"),
	("hip_r", "thigh_r"), ("thigh_r", "shin_r"), ("shin_r", "foot_r"),
	("hip_l", "thigh_l"), ("thigh_l", "shin_l"), ("shin_l", "foot_l")]
for a, b in chains:
	if (eb[b].head - eb[a].head).length > 1e-3:
		eb[a].tail = eb[b].head
for n in ("pelvis", "hip_r", "hip_l", "clavicle_r", "clavicle_l"):
	if (eb[n].tail - eb[n].head).length < 1e-3:
		eb[n].tail = eb[n].head + Vector((0, 0, 0.2))
eb["head"].tail = eb["head"].head + Vector((0, 0, 0.4))
for s in "rl":
	f = eb["foot_" + s]
	f.tail = f.head + Vector((0, -0.5, -0.3))
	fa = eb["forearm_" + s]
	fa.tail = fa.head + Vector((0, 0, -0.8))
# Bocas das armas: ponta do antebraço; projectile no direito.
muzzles = {}
for s in "rl":
	fa = eb["forearm_" + s]
	muzzles[s] = fa.tail.copy()
for s in "rl":
	p = eb.new("prop_muzzle_" + s)
	p.head, p.tail, p.parent, p.use_deform = muzzles[s], muzzles[s] + Vector((0, 0, 0.3)), eb["forearm_" + s], False
p = eb.new("prop_projectile")
p.head, p.tail, p.parent, p.use_deform = muzzles["r"], muzzles["r"] + Vector((0, 0, 0.3)), eb["forearm_r"], False
p = eb.new("prop_jet")
back = eb["spine"].head + Vector((0, 0.9, 0.4))
p.head, p.tail, p.parent, p.use_deform = back, back + Vector((0, 0, -0.3)), eb["spine"], False
bpy.ops.object.mode_set(mode="OBJECT")
bc.parent_to(mesh, arm)

helpers = bc.ik_targets(arm, [("foot_r", "shin_r", 2), ("foot_l", "shin_l", 2)])
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["pelvis", "spine", "head", "upperarm_r", "upperarm_l", "forearm_r", "forearm_l"] + helpers


def feet(**d):
	return {"ik_foot_" + s: bc.world_pose(rest, "ik_foot_" + s, move=d.get(s, (0, 0, 0))) for s in "rl"}


def aim(k, recoil=0.0):
	"""Os canhões dos antebraços já apontam para a frente no repouso: sobe um
	pouco os braços (k=1) e o recuo levanta os canos."""
	return {"upperarm_r": L(rest, "upperarm_r", rot=[(X, -18 * k + 4 * recoil)]),
		"upperarm_l": L(rest, "upperarm_l", rot=[(X, -18 * k + 4 * recoil)]),
		"forearm_r": L(rest, "forearm_r", rot=[(X, 8 * k - 14 * recoil)]),
		"forearm_l": L(rest, "forearm_l", rot=[(X, 8 * k - 14 * recoil)])}


def idle(t):
	s = math.sin(2 * math.pi * t)
	v = feet()
	v["pelvis"] = L(rest, "pelvis", move=(0, 0, -0.06 + 0.05 * s))
	v["spine"] = L(rest, "spine", rot=[(X, 1.5 * s)])
	v["head"] = L(rest, "head", rot=[(Z, 12 * math.sin(2 * math.pi * t + 0.7))])
	v.update({"upperarm_r": L(rest, "upperarm_r", rot=[(X, -4 - 2 * s)]),
		"upperarm_l": L(rest, "upperarm_l", rot=[(X, -4 + 2 * s)])})
	return v


def walk(t):
	v = {}
	for s, ph in (("l", 0.0), ("r", 0.5)):
		dy, dz = bc.walk_foot(t, ph, STRIDE, LIFT)
		v["ik_foot_" + s] = bc.world_pose(rest, "ik_foot_" + s, move=(0, dy, dz))
	c = math.cos(2 * math.pi * t)
	v["pelvis"] = L(rest, "pelvis", move=(0, 0, -0.22 + 0.12 * math.cos(4 * math.pi * t)), rot=[(Z, 6 * math.sin(2 * math.pi * t))])
	v["spine"] = L(rest, "spine", rot=[(X, -6), (Z, -9 * math.sin(2 * math.pi * t))])
	v["upperarm_r"] = L(rest, "upperarm_r", rot=[(X, -10 - 14 * c)])
	v["upperarm_l"] = L(rest, "upperarm_l", rot=[(X, -10 + 14 * c)])
	return v


def attack(t):
	k = min(1.0, t / 0.25)
	k = k * k * (3 - 2 * k)
	r = 0.0 if t < 0.3 else math.exp(-(t - 0.3) * 12) * (1 - math.exp(-(t - 0.3) * 80))
	v = feet()
	v.update(aim(k, r))
	v["spine"] = L(rest, "spine", rot=[(X, 5 * r)])
	v["pelvis"] = L(rest, "pelvis", move=(0, 0.12 * r, 0))
	return v


def death(t):
	e = min(1.0, t / 0.8)
	e = e * e * (3 - 2 * e)
	v = feet(r=(0, -0.4 * e, 0), l=(0.2 * e, 0.3 * e, 0))
	v["pelvis"] = L(rest, "pelvis", move=(0, 0.5 * e, -2.2 * e), rot=[(X, 70 * e), (Y, -10 * e)])
	v["spine"] = L(rest, "spine", rot=[(X, 15 * e)])
	v["head"] = L(rest, "head", rot=[(X, 25 * e)])
	v["upperarm_r"] = L(rest, "upperarm_r", rot=[(Y, -40 * e)])
	v["upperarm_l"] = L(rest, "upperarm_l", rot=[(Y, 40 * e)])
	return v


actions = {
	"idle": bc.make_action(arm, "idle", 60, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", WALK_FRAMES, walk, CONTROLS),
	"attack": bc.make_action(arm, "attack", 30, attack, CONTROLS),
	"death": bc.make_action(arm, "death", 40, death, CONTROLS),
}
bc.clear_constraints(arm)
bc.remove_bones(arm, helpers)
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "XV8", "XV8 Crisis (tools/imported/import_xv8.py)")
bc.export_mesh(mesh, arm, "vehicle/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "vehicle/%s/%s.dae" % (NAME, n), mesh)
print("XV8 tris", bc.triangle_count(mesh), textures, 'speed="%d"' % round(100 / (STRIDE / 0.5)))
if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	for a in actions.values():
		a.use_fake_user = True
	bc.render_frames([mesh], os.path.join(out, NAME + "_rest.png"), views=("front", "side", "back"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_walk.png"), arm, actions["walk"], frames=(1, 9, 17, 25), views=("side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_attack.png"), arm, actions["attack"], frames=(1, 10, 31), views=("side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_death.png"), arm, actions["death"], frames=(1, 20, 41), views=("side", "persp"))

"""Spider tank (spider-tank.zip): tanque andador de seis pernas com canhão
principal, torreta lateral e metralhadora de queixo.

O .glb traz duas cópias do tanque (fica a primeira), escotilha aberta e
fechada (fica a fechada) e ~61 mil faces (reduzidas). As cinco texturas PBR
são assadas numa só. Esqueleto do próprio modelo (ossos ValveBiped.* sem o
prefixo). Animações novas, com IK nas pontas das pernas:
  idle (torre varrendo), walk (marcha em tripé), attack (recuo do canhão),
  death (pernas cedem).

Gera art/meshes/vehicle/spider_tank.dae, art/skeletons/spider_tank.xml,
art/animation/vehicle/spider_tank/*.dae e
art/textures/skins/vehicle/spider_tank*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_spider_tank.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "spider_tank"
HEIGHT = 8.0
FACES = 16000
WALK_FRAMES = 36
STRIDE = 2.6
LIFT = 1.3
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
LEGS = ["L_leg_front", "R_leg_front", "L_leg_middle", "R_leg_middle", "L_leg_back", "R_leg_back"]
# Tripés: frente e trás de um lado com o meio do outro.
PHASE = {"L_leg_front": 0.0, "R_leg_middle": 0.0, "L_leg_back": 0.0,
	"R_leg_front": 0.5, "L_leg_middle": 0.5, "R_leg_back": 0.5}

src = bc.extract("spider-tank.zip")
bc.reset()
bc.import_file(os.path.join(src, "source", "Spider tank.glb"))
arm = bpy.data.objects["6legv2_ARM"]
parts = [bpy.data.objects[n] for n in ("body.smd", "cannon.smd", "close.smd", "leg.smd")]
bc.keep_only([arm] + parts)
arm.animation_data_clear()
mesh = bc.join(parts, NAME)
bc.clean_mesh(mesh, merge=1e-5)
# O tanque olha para +Y no arquivo.
bc.normalize([arm, mesh], HEIGHT, rotate_z=180)
bc.decimate(mesh, FACES)
textures = bc.bake_textures(mesh, "vehicle/" + NAME, size=1024)

bc.rename_bones(arm, {b.name: b.name.replace("ValveBiped.", "") for b in arm.data.bones})
bc.parent_to(mesh, arm)

# Boca do canhão principal: ponta da frente dos vértices do osso head3.
g = mesh.vertex_groups["head3"].index
pts = [v.co for v in mesh.data.vertices if any(x.group == g and x.weight > 0.5 for x in v.groups)]
front = min(p.y for p in pts)
tip = [p for p in pts if p.y < front + 0.15]
muzzle = sum(tip, Vector()) / len(tip)
g = mesh.vertex_groups["gun"].index
pts = [v.co for v in mesh.data.vertices if any(x.group == g and x.weight > 0.5 for x in v.groups)]
front = min(p.y for p in pts)
tip = [p for p in pts if p.y < front + 0.1]
chin = sum(tip, Vector()) / len(tip)
up = Vector((0, 0, 0.4))
bc.add_bones(arm, [
	("prop_projectile", "head3", muzzle, muzzle + up, False),
	("prop_muzzle", "head3", muzzle, muzzle + up, False),
	("prop_chin_gun", "gun", chin, chin + up, False),
])

# IK: alvo na ponta de cada perna (cauda do osso *2), cadeia de 3 ossos.
bc.select([arm])
bpy.ops.object.mode_set(mode="EDIT")
for leg in LEGS:
	shin = arm.data.edit_bones[leg + "2"]
	t = arm.data.edit_bones.new("ik_" + leg)
	t.head = shin.tail.copy()
	t.tail = shin.tail + Vector((0, 0, 0.5))
	t.use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")
for leg in LEGS:
	bc.ik(arm, leg + "2", "ik_" + leg, 3)
helpers = ["ik_" + leg for leg in LEGS]
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["base", "body", "head2", "head3", "turret_base", "gun_base"] + helpers


def tips(**moves):
	return {"ik_" + leg: bc.world_pose(rest, "ik_" + leg, move=moves.get(leg, (0, 0, 0))) for leg in LEGS}


def idle(t):
	s = math.sin(2 * math.pi * t)
	v = tips()
	v["base"] = L(rest, "base", move=(0, 0, -0.1 + 0.08 * s))
	v["head2"] = L(rest, "head2", rot=[(Z, 14 * math.sin(2 * math.pi * t))])
	v["turret_base"] = L(rest, "turret_base", rot=[(Z, -25 * math.sin(2 * math.pi * t + 1.3))])
	return v


def walk(t):
	v = {}
	for leg in LEGS:
		dy, dz = bc.walk_foot(t, PHASE[leg], STRIDE, LIFT)
		v["ik_" + leg] = bc.world_pose(rest, "ik_" + leg, move=(0, dy, dz))
	v["base"] = L(rest, "base", move=(0, 0, -0.15 + 0.1 * math.cos(4 * math.pi * t)),
		rot=[(Y, 2.0 * math.sin(2 * math.pi * t)), (X, 1.0 * math.cos(4 * math.pi * t))])
	return v


def attack(t):
	r = 0.0 if t < 0.05 else math.exp(-(t - 0.05) * 10) * (1 - math.exp(-(t - 0.05) * 70))
	v = tips()
	v["head3"] = L(rest, "head3", move=(0, 0.8 * r, 0))
	v["head2"] = L(rest, "head2", rot=[(X, 5 * r)])
	v["base"] = L(rest, "base", move=(0, 0.3 * r, -0.12 * r), rot=[(X, 2 * r)])
	return v


def death(t):
	e = min(1.0, t / 0.6)
	e = e * e * (3 - 2 * e)
	moves = {}
	for leg in LEGS:
		side = -1 if leg.startswith("L") else 1
		end = rest["ik_" + leg].translation
		moves[leg] = (side * 1.4 * e, end.y * 0.25 * e, 0)
	v = tips(**moves)
	v["base"] = L(rest, "base", move=(0, 0, -3.0 * e), rot=[(Y, 9 * e), (X, -5 * e)])
	v["head2"] = L(rest, "head2", rot=[(Z, 30 * e), (X, -8 * e)])
	return v


actions = {
	"idle": bc.make_action(arm, "idle", 90, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", WALK_FRAMES, walk, CONTROLS),
	"attack": bc.make_action(arm, "attack", 30, attack, CONTROLS),
	"death": bc.make_action(arm, "death", 40, death, CONTROLS),
}
bc.clear_constraints(arm)
bc.remove_bones(arm, helpers)
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "Spider tank", "Spider tank (tools/imported/import_spider_tank.py)")
bc.export_mesh(mesh, arm, "vehicle/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "vehicle/%s/%s.dae" % (NAME, n), mesh)
print("SPIDER tris", bc.triangle_count(mesh), textures, 'speed="%d"' % round(100 / (STRIDE / 0.5)))
if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	bc.render_frames([mesh], os.path.join(out, NAME + "_rest.png"), views=("front", "side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_walk.png"), arm, actions["walk"], frames=(1, 10, 19, 28), views=("side", "persp"))
	bc.render_frames([mesh], os.path.join(out, NAME + "_death.png"), arm, actions["death"], frames=(1, 41), views=("side", "persp"))

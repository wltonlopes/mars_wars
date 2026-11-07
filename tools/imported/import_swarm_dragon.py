"""Bio-Dragão do Enxame (refs/exo/purple dragon 3d model.zip, OBJ do Tripo,
malha única sem esqueleto): arma biológica que cospe ácido. Substitui o
elefante provisório do Acid Behemoth (units/swarm/behemoth).

  - Malha inteira (≈ 4,8 mil faces), 10 m de comprimento, frente em -Y (o
    arquivo vem com a cabeça em +Y: gira 180°).
  - Textura: a cor do Tripo (já roxa, na paleta do Enxame); spec tirado do
    brilho; normal plana.
  - Esqueleto (prefixo drg_, raiz única para o conversor do jogo): raiz >
    pélvis > dorso > peito > pescoço > cabeça; pélvis > cauda 1 > cauda 2;
    pernas da frente (peito > braço > antebraço > mão) e de trás (pélvis >
    coxa > canela > pé). Juntas medidas pela silhueta do modelo.
  - Pesos: cada vértice fica com os dois ossos mais próximos da sua região
    (perna do lado dele ou corpo), pelo inverso da distância ao osso.
  - Animações (IK nos pés): idle (respira, cabeça vigia, cauda balança),
    walk (passo de quadrúpede: trás-esq, frente-esq, trás-dir, frente-dir,
    com o corpo ondulando como um lagarto), attack (recolhe o pescoço, ergue
    a cabeça e dá o bote cuspindo fogo roxo e dourado), melee (ergue o peito e a pata,
    crava a garra e morde; o template troca para ele quando o inimigo chega
    perto), death (as pernas cedem e tomba de lado).

Gera art/meshes/skeletal/swarm_bio_dragon.dae, art/skeletons/swarm_bio_dragon.xml,
art/animation/units/swarm_bio_dragon/*.dae, art/actors/units/swarm/bio_dragon.xml
e art/textures/skins/skeletal/swarm/bio_dragon*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_swarm_dragon.py
"""
import glob
import math
import os
import sys
import tempfile
import zipfile

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "swarm_bio_dragon"
ZIP = os.path.join(bc.MOD, "refs", "exo", "purple dragon 3d model.zip")
LENGTH = 10.0
TEX = os.path.join(bc.MOD, "art", "textures", "skins", "skeletal", "swarm")
WALK_FRAMES = 48
STRIDE = 1.6
LIFT = 0.55
DUTY = 0.65
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
TAU = 2 * math.pi

# Juntas (metros, frente em -Y). O modelo tem a perna de trás direita um
# passo mais para trás.
J = {
	"pelvis": (0, 2.6, 3.0), "spine": (0, 0.6, 3.3), "chest": (0, -1.0, 3.4), "neck": (0, -2.6, 3.5),
	"head": (0, -3.7, 3.6), "snout": (0, -5.0, 2.7), "tail1": (0, 3.8, 2.9), "tail2": (0, 5.0, 2.6),
	"shoulder_l": (-0.9, -1.0, 2.1), "elbow_l": (-1.38, -1.4, 1.1), "wrist_l": (-1.3, -1.9, 0.4), "hand_l": (-1.2, -2.45, 0.05),
	"shoulder_r": (0.95, -1.0, 2.1), "elbow_r": (1.2, -1.4, 1.1), "wrist_r": (1.33, -1.9, 0.4), "hand_r": (1.38, -2.45, 0.05),
	"hip_l": (-1.1, 2.45, 2.1), "knee_l": (-1.3, 2.95, 1.25), "ankle_l": (-1.37, 3.2, 0.45), "toe_l": (-1.39, 2.6, 0.05),
	"hip_r": (1.0, 2.9, 2.1), "knee_r": (1.25, 3.6, 1.25), "ankle_r": (1.33, 3.72, 0.45), "toe_r": (1.4, 3.1, 0.05),
}
BONES = [
	# nome, pai, cabeça, cauda
	("drg_root", None, (0, 0, 0), (0, 0, 0.8)),
	("drg_pelvis", "drg_root", J["pelvis"], J["spine"]),
	("drg_spine", "drg_pelvis", J["spine"], J["chest"]),
	("drg_chest", "drg_spine", J["chest"], J["neck"]),
	("drg_neck", "drg_chest", J["neck"], J["head"]),
	("drg_head", "drg_neck", J["head"], J["snout"]),
	("drg_tail1", "drg_pelvis", J["pelvis"], J["tail1"]),
	("drg_tail2", "drg_tail1", J["tail1"], J["tail2"]),
]
for s in "lr":
	BONES += [
		("drg_arm_" + s, "drg_chest", J["shoulder_" + s], J["elbow_" + s]),
		("drg_forearm_" + s, "drg_arm_" + s, J["elbow_" + s], J["wrist_" + s]),
		("drg_hand_" + s, "drg_forearm_" + s, J["wrist_" + s], J["hand_" + s]),
		("drg_thigh_" + s, "drg_pelvis", J["hip_" + s], J["knee_" + s]),
		("drg_shin_" + s, "drg_thigh_" + s, J["knee_" + s], J["ankle_" + s]),
		("drg_foot_" + s, "drg_shin_" + s, J["ankle_" + s], J["toe_" + s]),
	]
BODY = ["drg_pelvis", "drg_spine", "drg_chest", "drg_neck", "drg_head", "drg_tail1", "drg_tail2"]


def extract():
	out = tempfile.mkdtemp(prefix="mw_dragon_")
	with zipfile.ZipFile(ZIP) as z:
		z.extractall(out)
	return out


def textures(folder):
	os.makedirs(TEX, exist_ok=True)
	col = bc.pixels(bpy.data.images.load(glob.glob(os.path.join(folder, "*_basecolor.JPEG"))[0]))[..., :3]
	bc.save_png(col, os.path.join(TEX, "bio_dragon.png"))
	# Brilho úmido nas partes claras (carapaça), fosco nas escuras.
	luma = col @ np.array([0.299, 0.587, 0.114])
	spec = np.clip(0.06 + luma * 0.9, 0, 1)[..., None]
	bc.save_png(np.repeat(spec, 3, axis=2), os.path.join(TEX, "bio_dragon_spec.png"))


def segment_distance(p, a, b):
	ab = b - a
	t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
	return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def skin(mesh):
	co = np.array([v.co[:] for v in mesh.data.vertices])
	seg = {n: (np.array(h, float), np.array(t, float)) for n, _, h, t in BONES}
	names = [n for n, *_ in BONES if n != "drg_root"]
	col = {n: i for i, n in enumerate(names)}
	dist = np.stack([segment_distance(co, *seg[n]) for n in names], axis=1)
	x, y, z = co.T
	allowed = np.zeros_like(dist, bool)

	def allow(mask, bones):
		for b in bones:
			allowed[mask, col[b]] = True

	side_x = np.abs(x) > 0.45
	front = (y > -2.9) & (y < -0.5) & side_x & (z < 2.3)
	hind = (y > 1.9) & (y < 4.3) & side_x & (z < 2.3)
	for s, m in (("l", x < 0), ("r", x >= 0)):
		allow(front & m, ["drg_arm_" + s, "drg_forearm_" + s, "drg_hand_" + s])
		allow(front & m & (z > 1.7), ["drg_chest"])
		allow(hind & m, ["drg_thigh_" + s, "drg_shin_" + s, "drg_foot_" + s])
		allow(hind & m & (z > 1.7), ["drg_pelvis"])
	allow(~front & ~hind, BODY)
	w = np.where(allowed, 1.0 / (dist ** 4 + 1e-5), 0.0)
	top = np.argsort(-w, axis=1)[:, :2]
	groups = {n: mesh.vertex_groups.new(name=n) for n in names}
	for i in range(len(co)):
		a, b = top[i]
		wa, wb = w[i, a], w[i, b]
		groups[names[a]].add([i], wa / (wa + wb), "REPLACE")
		if wb / (wa + wb) > 0.05:
			groups[names[b]].add([i], wb / (wa + wb), "REPLACE")


src = extract()
bc.reset()
bc.import_file(glob.glob(os.path.join(src, "*.obj"))[0])
mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
bc.keep_only([mesh])
mesh.name = mesh.data.name = NAME
bc.clean_mesh(mesh, merge=1e-6)
bc.normalize([mesh], LENGTH, axis="y", rotate_z=180)
bc.fix_normals(mesh, angle=40)
for extra in [u.name for u in mesh.data.uv_layers][1:]:
	mesh.data.uv_layers.remove(mesh.data.uv_layers[extra])
textures(src)

arm = bc.new_armature(NAME, [(n, p, h, t, True) for n, p, h, t in BONES])
mouth = Vector(J["snout"]) + Vector((0, 0.15, 0.1))
bc.add_bones(arm, [
	("prop_projectile", "drg_head", mouth, mouth + Vector((0, 0, 0.3)), False),
	("prop_mouth", "drg_head", mouth, mouth + Vector((0, 0, 0.3)), False),
])
skin(mesh)
bc.parent_to(mesh, arm)

FEET = {"fl": ("drg_hand_l", "drg_forearm_l"), "fr": ("drg_hand_r", "drg_forearm_r"),
	"hl": ("drg_foot_l", "drg_shin_l"), "hr": ("drg_foot_r", "drg_shin_r")}
helpers = bc.ik_targets(arm, [(f, b, 2) for f, b in FEET.values()])
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["drg_root"] + BODY + helpers


def smooth(v):
	v = min(1.0, max(0.0, v))
	return v * v * (3 - 2 * v)


def foot(key, move=(0, 0, 0), pitch=0.0):
	"""Alvo da IK de um pé (fl, fr, hl, hr); pitch > 0 = ponta para baixo."""
	name = "ik_" + FEET[key][0]
	return {name: bc.world_pose(rest, name, move=move, rot=[(X, pitch)])}


def planted(**moves):
	v = {}
	for k in FEET:
		v.update(foot(k, *moves.get(k, ((0, 0, 0),))))
	return v


# Passo de quadrúpede (sequência lateral): trás-esq, frente-esq, trás-dir,
# frente-dir, cada pé 65% do tempo no chão.
PHASE = {"hl": 0.0, "fl": 0.25, "hr": 0.5, "fr": 0.75}


def idle(t):
	"""Respira (o peito sobe), a cabeça vigia de um lado para o outro e a
	cauda balança devagar."""
	b = math.sin(TAU * t * 2)
	look = math.sin(TAU * t)
	v = planted()
	v["drg_root"] = L(rest, "drg_root", move=(0, 0, -0.04 + 0.04 * b))
	v["drg_spine"] = L(rest, "drg_spine", rot=[(X, -1.2 * b)])
	v["drg_chest"] = L(rest, "drg_chest", rot=[(X, -1.5 * b)])
	v["drg_neck"] = L(rest, "drg_neck", rot=[(Z, 10 * look), (X, 3 * math.sin(TAU * t + 1.0))])
	v["drg_head"] = L(rest, "drg_head", rot=[(Z, 8 * look), (X, -4 * math.sin(TAU * t * 2 + 0.5))])
	v["drg_tail1"] = L(rest, "drg_tail1", rot=[(Z, 9 * math.sin(TAU * t + 2.0))])
	v["drg_tail2"] = L(rest, "drg_tail2", rot=[(Z, 14 * math.sin(TAU * t + 1.2)), (X, 3 * b)])
	return v


def walk(t):
	"""Cada pé faz a passada com rolagem (calcanhar, chapado, ponta); o corpo
	ondula de lado como um lagarto (pélvis e peito giram opostos), sobe e
	desce com os apoios, a cabeça fica firme e a cauda chicoteia."""
	v = {}
	for k, ph in PHASE.items():
		dy, dz = bc.walk_foot(t, ph, STRIDE, LIFT, duty=DUTY)
		p = (t + ph) % 1.0
		if p < DUTY:
			s = p / DUTY
			pitch = -8 * (1 - smooth(s / 0.2)) + 18 * smooth((s - 0.75) / 0.25)
		else:
			s = (p - DUTY) / (1 - DUTY)
			pitch = 18 * (1 - smooth(s / 0.5)) - 8 * smooth((s - 0.5) / 0.5)
		v.update(foot(k, (0, dy, dz), pitch))
	wave = math.sin(TAU * t)
	v["drg_root"] = L(rest, "drg_root", move=(0.06 * wave, 0, -0.12 + 0.06 * math.cos(2 * TAU * t)))
	v["drg_pelvis"] = L(rest, "drg_pelvis", rot=[(Z, 6 * wave), (Y, 3 * math.cos(TAU * t))])
	v["drg_spine"] = L(rest, "drg_spine", rot=[(Z, -5 * wave)])
	v["drg_chest"] = L(rest, "drg_chest", rot=[(Z, -6 * math.sin(TAU * t + 0.6)), (Y, -3 * math.cos(TAU * t + 0.6))])
	# O pescoço desfaz o giro do peito: a cabeça segue reta.
	v["drg_neck"] = L(rest, "drg_neck", rot=[(Z, 7 * math.sin(TAU * t + 0.8)), (X, 2 * math.cos(2 * TAU * t))])
	v["drg_head"] = L(rest, "drg_head", rot=[(Z, 3 * math.sin(TAU * t + 1.0))])
	v["drg_tail1"] = L(rest, "drg_tail1", rot=[(Z, -12 * math.sin(TAU * t - 0.6))])
	v["drg_tail2"] = L(rest, "drg_tail2", rot=[(Z, -18 * math.sin(TAU * t - 1.3))])
	return v


def attack(t):
	"""Firma as patas da frente, recolhe o pescoço e ergue a cabeça (até
	0.4), dá o bote para a frente e cospe (0.5), depois volta."""
	load = smooth(t / 0.4) * (1 - smooth((t - 0.45) / 0.1))
	strike = smooth((t - 0.42) / 0.1) * (1 - smooth((t - 0.65) / 0.3))
	crouch = smooth(t / 0.3) * (1 - smooth((t - 0.75) / 0.25))
	v = planted(fl=((0, -0.25 * crouch, 0),), fr=((0, -0.2 * crouch, 0),))
	v["drg_root"] = L(rest, "drg_root", move=(0, 0.25 * load - 0.35 * strike, -0.25 * crouch))
	v["drg_spine"] = L(rest, "drg_spine", rot=[(X, -4 * load + 3 * strike)])
	v["drg_chest"] = L(rest, "drg_chest", rot=[(X, -10 * load + 6 * strike)])
	v["drg_neck"] = L(rest, "drg_neck", rot=[(X, -28 * load + 22 * strike)])
	v["drg_head"] = L(rest, "drg_head", rot=[(X, -18 * load + 16 * strike)])
	v["drg_tail1"] = L(rest, "drg_tail1", rot=[(X, -8 * load + 6 * strike)])
	v["drg_tail2"] = L(rest, "drg_tail2", rot=[(X, -10 * load), (Z, 10 * strike)])
	return v


def melee(t):
	"""Corpo a corpo (golpe em 0.5): recua o corpo e ergue o peito e a pata
	da frente esquerda (até 0.4), crava a garra no chão à frente e morde
	para baixo junto (0.5), depois volta."""
	up = smooth(t / 0.38) * (1 - smooth((t - 0.42) / 0.08))
	hit = smooth((t - 0.4) / 0.1) * (1 - smooth((t - 0.6) / 0.35))
	paw_up = smooth(t / 0.3) * (1 - smooth((t - 0.4) / 0.1))
	v = planted(fl=((0.1 * paw_up, 0.35 * paw_up - 0.75 * hit, 1.1 * paw_up), -35 * paw_up + 15 * hit),
		fr=((0, -0.15 * hit, 0),), hl=((0, 0.1 * up, 0),), hr=((0, 0.1 * up, 0),))
	v["drg_root"] = L(rest, "drg_root", move=(0, 0.45 * up - 0.4 * hit, -0.1 * up - 0.25 * hit))
	v["drg_pelvis"] = L(rest, "drg_pelvis", rot=[(X, -3 * up + 2 * hit)])
	v["drg_spine"] = L(rest, "drg_spine", rot=[(X, -6 * up + 4 * hit), (Z, 4 * up)])
	v["drg_chest"] = L(rest, "drg_chest", rot=[(X, -12 * up + 10 * hit), (Z, 6 * up - 4 * hit)])
	v["drg_neck"] = L(rest, "drg_neck", rot=[(X, -20 * up + 26 * hit), (Z, -8 * up + 6 * hit)])
	v["drg_head"] = L(rest, "drg_head", rot=[(X, -12 * up + 20 * hit)])
	v["drg_tail1"] = L(rest, "drg_tail1", rot=[(X, -6 * up), (Z, -10 * up + 12 * hit)])
	v["drg_tail2"] = L(rest, "drg_tail2", rot=[(X, -8 * up), (Z, -16 * up + 20 * hit)])
	return v


def death(t):
	"""Leva o golpe (cabeça para trás), as patas da frente cedem, depois as
	de trás, e o corpo tomba de lado; pescoço e cauda caem soltos."""
	hit = math.sin(math.pi * min(1.0, t / 0.2)) if t < 0.2 else 0.0
	fold_f = smooth((t - 0.12) / 0.35)
	fold_h = smooth((t - 0.3) / 0.35)
	roll = smooth((t - 0.5) / 0.4)
	v = planted(fl=((0.15 * fold_f, -0.3 * fold_f, 0), 30 * fold_f), fr=((-0.1 * fold_f, -0.2 * fold_f, 0), 30 * fold_f),
		hl=((0.1 * fold_h, 0.3 * fold_h, 0), 25 * fold_h), hr=((-0.1 * fold_h, 0.2 * fold_h, 0), 25 * fold_h))
	drop = 1.1 * fold_f * 0.5 + 1.1 * fold_h * 0.5
	v["drg_root"] = L(rest, "drg_root", move=(0.6 * roll, 0, -drop - 0.4 * roll), rot=[(Y, 75 * roll)])
	v["drg_chest"] = L(rest, "drg_chest", rot=[(X, 8 * fold_f - 6 * hit)])
	v["drg_neck"] = L(rest, "drg_neck", rot=[(X, -20 * hit + 25 * roll), (Z, 15 * roll)])
	v["drg_head"] = L(rest, "drg_head", rot=[(X, -15 * hit + 20 * roll)])
	v["drg_tail1"] = L(rest, "drg_tail1", rot=[(X, 10 * fold_h), (Z, -10 * roll)])
	v["drg_tail2"] = L(rest, "drg_tail2", rot=[(X, 15 * fold_h), (Z, -15 * roll)])
	return v


actions = {
	"idle": bc.make_action(arm, "idle", 72, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", WALK_FRAMES, walk, CONTROLS),
	"attack": bc.make_action(arm, "attack", 36, attack, CONTROLS),
	"melee": bc.make_action(arm, "melee", 30, melee, CONTROLS),
	"death": bc.make_action(arm, "death", 54, death, CONTROLS),
}
bc.clear_constraints(arm)
bc.remove_bones(arm, helpers)
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "Swarm Bio-Dragon", "Bio-Dragão do Enxame (tools/imported/import_swarm_dragon.py)")
bc.export_mesh(mesh, arm, "skeletal/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "units/%s/%s.dae" % (NAME, n), mesh)
# Por ciclo o corpo anda STRIDE / DUTY metros.
WALK_SPEED = round(100 * DUTY / STRIDE)
print("DRAGON tris", bc.triangle_count(mesh), 'speed="%d"' % WALK_SPEED)

ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- Bio-Dragão do Enxame: malha, esqueleto, animações e textura de
     tools/imported/import_swarm_dragon.py (modelo de refs/exo, ver CREDITS.md).
     Walk/Run: {stride} m por ciclo -> speed {speed}. -->
<actor version="1">
  <castshadow/>
  <group>
    <variant frequency="1" name="Base">
      <mesh>skeletal/{name}.dae</mesh>
      <animations>
        <animation file="units/{name}/idle.dae" name="Idle" speed="100"/>
        <animation file="units/{name}/walk.dae" name="Walk" speed="{speed}"/>
        <animation file="units/{name}/walk.dae" name="Run" speed="{speed}"/>
        <animation event="0.5" load="0.5" file="units/{name}/attack.dae" name="attack_ranged" speed="100"/>
        <animation event="0.5" file="units/{name}/melee.dae" name="attack_melee" speed="100"/>
        <animation file="units/{name}/death.dae" name="Death" speed="100"/>
      </animations>
      <textures>
        <texture file="skeletal/swarm/bio_dragon.png" name="baseTex"/>
        <texture file="vehicle/flat_norm.png" name="normTex"/>
        <texture file="skeletal/swarm/bio_dragon_spec.png" name="specTex"/>
      </textures>
    </variant>
  </group>
  <group>
    <variant frequency="1" name="Idle">
      <props>
        <prop actor="particle/dragon_smolder.xml" attachpoint="mouth"/>
      </props>
    </variant>
    <variant name="attack_ranged">
      <props>
        <prop actor="particle/dragon_breath_purple.xml" attachpoint="mouth"/>
        <prop actor="particle/dragon_breath_gold.xml" attachpoint="mouth"/>
        <prop actor="particle/dragon_embers_gold.xml" attachpoint="mouth"/>
      </props>
    </variant>
  </group>
  <group>
    <variant frequency="1" name="alive"/>
    <variant name="death">
      <props>
        <prop actor="props/units/blood_01.xml" attachpoint="root"/>
        <prop actor="particle/dragon_smolder.xml" attachpoint="mouth"/>
      </props>
    </variant>
  </group>
  <material>basic_trans_norm_spec.xml</material>
</actor>
"""
with open(os.path.join(bc.MOD, "art", "actors", "units", "swarm", "bio_dragon.xml"), "w", encoding="utf-8") as f:
	f.write(ACTOR.format(name=NAME, speed=WALK_SPEED, stride="%.2f" % (STRIDE / DUTY)))

if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	mat = bpy.data.materials.new("prev")
	mat.use_nodes = True
	node = mat.node_tree.nodes.new("ShaderNodeTexImage")
	node.image = bpy.data.images.load(os.path.join(TEX, "bio_dragon.png"))
	mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
	mesh.data.materials.clear()
	mesh.data.materials.append(mat)
	os.environ["MW_SHADING"] = os.environ.get("MW_SHADING", "SINGLE")
	for n, frames in (("walk", (1, 13, 25, 37)), ("attack", (1, 15, 19, 26)), ("melee", (1, 13, 17, 22)), ("death", (1, 20, 55)), ("idle", (1, 37))):
		bc.render_frames([mesh], os.path.join(out, "dragon_%s.png" % n), arm, actions[n], frames=frames,
			views=("side", "front", "persp"), res=420)

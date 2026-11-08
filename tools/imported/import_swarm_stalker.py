"""Stalker do Enxame (refs/exo/purple demon 3d model.zip, OBJ do Tripo, malha
única sem esqueleto): predador bípede curvado, garras no braço esquerdo
(x < 0) e uma lâmina-foice no direito (x > 0). Substitui o tigre provisório
do Stalker (units/swarm/stalker).

  - Malha inteira (≈ 8,5 mil faces), HEIGHT m de altura, frente em -Y (como
    vem no arquivo).
  - Textura: a cor do Tripo (já roxa); spec tirado do brilho; normal plana.
  - Esqueleto (prefixo stk_, raiz única para o conversor do jogo): raiz >
    pélvis > lombar > peito > pescoço > cabeça; peito > braço > antebraço >
    mão (a direita tem mais um osso para as garras menores); pélvis > coxa >
    canela > pé (perna digitígrada: joelho para a frente, tornozelo alto).
    Juntas medidas por fatias de altura do modelo (com 1 m de altura).
  - Pesos: cada vértice fica com os dois ossos mais próximos da sua região
    (braço do lado dele, perna do lado dele ou tronco), pelo inverso da
    distância ao osso.
  - Animações (IK nos pés): idle (respira curvado, a cabeça fareja, as garras
    se abrem), walk (passo pesado e gingado, garras balançando), run (corrida
    inclinada com fase de voo), attack_melee em duas variantes (golpe de
    foice cruzado e rasgo com as garras, ambos em 0.5) e death (leva o golpe,
    os joelhos cedem e tomba de lado).

Gera art/meshes/skeletal/swarm_stalker.dae, art/skeletons/swarm_stalker.xml,
art/animation/units/swarm_stalker/*.dae, art/actors/units/swarm/stalker.xml
e art/textures/skins/skeletal/swarm/stalker*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_swarm_stalker.py
Prévia (folhas de quadros):  MW_PREVIEW=/pasta blender -b -P ...
"""
import glob
import math
import os
import sys
import tempfile
import zipfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_common as bc  # noqa: E402

NAME = "swarm_stalker"
ZIP = os.path.join(bc.MOD, "refs", "exo", "purple demon 3d model.zip")
HEIGHT = 2.4
TEX = os.path.join(bc.MOD, "art", "textures", "skins", "skeletal", "swarm")
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
TAU = 2 * math.pi
# Passada (metros que o pé anda no apoio), altura do pé e fração no chão.
WALK = dict(frames=32, stride=0.95, lift=0.32, duty=0.6)
RUN = dict(frames=20, stride=1.7, lift=0.5, duty=0.38)

# Juntas no modelo com 1 m de altura (frente em -Y). O corpo fica um pouco
# para x < 0 e o pé esquerdo (x < 0) mais atrás que o direito.
CX = -0.05
J0 = {
	"pelvis": (CX, 0.11, 0.45), "spine": (CX, 0.10, 0.60), "chest": (CX, 0.02, 0.73), "neck": (CX - 0.01, -0.12, 0.81),
	"head": (CX - 0.02, -0.20, 0.86), "snout": (CX - 0.02, -0.36, 0.76),
	"shoulder_l": (-0.28, -0.04, 0.76), "elbow_l": (-0.42, -0.07, 0.63), "wrist_l": (-0.46, -0.19, 0.43), "claw_l": (-0.43, -0.28, 0.18),
	"shoulder_r": (0.14, -0.05, 0.77), "elbow_r": (0.28, -0.08, 0.61), "wrist_r": (0.36, -0.17, 0.44), "claw_r": (0.51, -0.37, 0.15),
	"claw2_r": (0.22, -0.31, 0.21),
	"hip_l": (-0.15, 0.10, 0.44), "knee_l": (-0.27, -0.15, 0.30), "ankle_l": (-0.30, 0.27, 0.12), "toe_l": (-0.40, 0.08, 0.02),
	"hip_r": (0.06, 0.10, 0.44), "knee_r": (0.11, -0.07, 0.32), "ankle_r": (0.17, 0.15, 0.13), "toe_r": (0.19, -0.06, 0.03),
}
J = {k: tuple(c * HEIGHT for c in v) for k, v in J0.items()}
BONES = [
	# nome, pai, cabeça, cauda
	("stk_root", None, (0, 0, 0), (0, 0, 0.4)),
	("stk_pelvis", "stk_root", J["pelvis"], J["spine"]),
	("stk_spine", "stk_pelvis", J["spine"], J["chest"]),
	("stk_chest", "stk_spine", J["chest"], J["neck"]),
	("stk_neck", "stk_chest", J["neck"], J["head"]),
	("stk_head", "stk_neck", J["head"], J["snout"]),
	("stk_hand2_r", "stk_forearm_r", J["wrist_r"], J["claw2_r"]),
]
for s in "lr":
	BONES[-1:-1] = [
		("stk_upperarm_" + s, "stk_chest", J["shoulder_" + s], J["elbow_" + s]),
		("stk_forearm_" + s, "stk_upperarm_" + s, J["elbow_" + s], J["wrist_" + s]),
		("stk_hand_" + s, "stk_forearm_" + s, J["wrist_" + s], J["claw_" + s]),
		("stk_thigh_" + s, "stk_pelvis", J["hip_" + s], J["knee_" + s]),
		("stk_shin_" + s, "stk_thigh_" + s, J["knee_" + s], J["ankle_" + s]),
		("stk_foot_" + s, "stk_shin_" + s, J["ankle_" + s], J["toe_" + s]),
	]
BODY = ["stk_pelvis", "stk_spine", "stk_chest", "stk_neck", "stk_head"]
ARM = {s: ["stk_upperarm_" + s, "stk_forearm_" + s, "stk_hand_" + s] + (["stk_hand2_r"] if s == "r" else []) for s in "lr"}
LEG = {s: ["stk_thigh_" + s, "stk_shin_" + s, "stk_foot_" + s] for s in "lr"}


def extract():
	out = tempfile.mkdtemp(prefix="mw_stalker_")
	with zipfile.ZipFile(ZIP) as z:
		z.extractall(out)
	return out


def textures(folder):
	os.makedirs(TEX, exist_ok=True)
	col = bc.pixels(bpy.data.images.load(glob.glob(os.path.join(folder, "*_basecolor.JPEG"))[0]))[..., :3]
	bc.save_png(col, os.path.join(TEX, "stalker.png"))
	# Brilho de quitina nas partes claras, fosco nas escuras.
	luma = col @ np.array([0.299, 0.587, 0.114])
	spec = np.clip(0.05 + luma * 1.1, 0, 1)[..., None]
	bc.save_png(np.repeat(spec, 3, axis=2), os.path.join(TEX, "stalker_spec.png"))


def segment_distance(p, a, b):
	ab = b - a
	t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
	return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def regions(co):
	"""Máscaras (no modelo de 1 m) de braço e perna de cada lado; o resto é
	tronco. As garras descem até a altura do joelho, então o braço é
	separado da perna pela distância para fora e para a frente."""
	x, y, z = (co / HEIGHT).T
	arm_l = ((x < -0.39) & (z > 0.15)) | ((x < -0.34) & (z > 0.15) & (z < 0.32) & (y < -0.18)) | ((x < -0.3) & (z > 0.5))
	arm_r = ((x > 0.15) & (z > 0.47)) | ((x > 0.19) & (z > 0.37)) | ((x > 0.36) & (z > 0.1)) \
		| ((x > 0.13) & (z > 0.15) & (z < 0.45) & (y < -0.19))
	low = (z < 0.38) | ((z < 0.47) & (np.abs(x - CX) > 0.06))
	leg_l = low & (x < CX) & ~arm_l
	leg_r = low & (x >= CX) & ~arm_r
	return {"arm_l": arm_l, "arm_r": arm_r & ~arm_l, "leg_l": leg_l, "leg_r": leg_r}


def skin(mesh):
	co = np.array([v.co[:] for v in mesh.data.vertices])
	seg = {n: (np.array(h, float), np.array(t, float)) for n, _, h, t in BONES}
	names = [n for n, *_ in BONES if n != "stk_root"]
	col = {n: i for i, n in enumerate(names)}
	dist = np.stack([segment_distance(co, *seg[n]) for n in names], axis=1)
	allowed = np.zeros_like(dist, bool)
	z = co[:, 2] / HEIGHT

	def allow(mask, bones):
		for b in bones:
			allowed[mask, col[b]] = True

	r = regions(co)
	for s in "lr":
		allow(r["arm_" + s], ARM[s])
		# Ombro: mistura com o peito.
		allow(r["arm_" + s] & (z > 0.66), ["stk_chest"])
		# O pé só pega a parte baixa: o espinho atrás da canela fica com ela.
		allow(r["leg_" + s], LEG[s][:2])
		allow(r["leg_" + s] & (z < 0.15), LEG[s][2:])
		allow(r["leg_" + s] & (z > 0.36), ["stk_pelvis"])
	body = ~(r["arm_l"] | r["arm_r"] | r["leg_l"] | r["leg_r"])
	allow(body, BODY)
	# Ombreiras e trapézio: também seguem o braço do lado.
	x = co[:, 0] / HEIGHT
	allow(body & (z > 0.62) & (x < CX - 0.14), ["stk_upperarm_l"])
	allow(body & (z > 0.62) & (x > CX + 0.14), ["stk_upperarm_r"])
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
bc.normalize([mesh], HEIGHT, axis="z")
bc.fix_normals(mesh, angle=40)
for extra in [u.name for u in mesh.data.uv_layers][1:]:
	mesh.data.uv_layers.remove(mesh.data.uv_layers[extra])
textures(src)

arm = bc.new_armature(NAME, [(n, p, h, t, True) for n, p, h, t in BONES])
skin(mesh)
bc.parent_to(mesh, arm)

FEET = {s: ("stk_foot_" + s, "stk_shin_" + s) for s in "lr"}
helpers = bc.ik_targets(arm, [(f, b, 2) for f, b in FEET.values()])
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["stk_root"] + BODY + ARM["l"] + ARM["r"] + helpers
# O pé esquerdo fica 0,3 m atrás do direito em repouso: andando, os dois
# vêm para a mesma linha.
# Queda da morte: quanto ajoelha, quanto tomba para a frente, em torno de onde e
# quanto desce no fim (medido pela altura mínima da malha no último quadro).
DEATH_KNEEL = 0.6
DEATH_PITCH = 45
DEATH_PIVOT = (CX * HEIGHT, -0.45, 0)
DEATH_DROP = 0.0
FEET_GAP = (J["ankle_l"][1] - J["ankle_r"][1]) / 2


def smooth(v):
	v = min(1.0, max(0.0, v))
	return v * v * (3 - 2 * v)


def pulse(t, a, b, c, d):
	"""0 até a, sobe até b, fica em 1 até c, desce até d."""
	return smooth((t - a) / max(b - a, 1e-6)) * (1 - smooth((t - c) / max(d - c, 1e-6)))


def foot(side, move=(0, 0, 0), pitch=0.0, yaw=0.0):
	"""Alvo da IK de um pé; pitch > 0 = ponta para baixo."""
	name = "ik_stk_foot_" + side
	return {name: bc.world_pose(rest, name, move=move, rot=[(X, pitch), (Z, yaw)])}


def planted(**moves):
	v = {}
	for s in "lr":
		v.update(foot(s, *moves.get(s, ((0, 0, 0),))))
	return v


def arm_pose(side, swing=0.0, fore=0.0, out=0.0, twist=0.0, hand=0.0):
	"""swing < 0 = braço para a frente/cima (graus em X); fore > 0 = dobra o
	cotovelo levando o antebraço para a frente; out > 0 = abre para fora;
	hand > 0 = garra para a frente."""
	sign = 1 if side == "l" else -1
	v = {"stk_upperarm_" + side: L(rest, "stk_upperarm_" + side, rot=[(X, swing), (Y, sign * out), (Z, sign * twist)]),
		"stk_forearm_" + side: L(rest, "stk_forearm_" + side, rot=[(X, -fore)]),
		"stk_hand_" + side: L(rest, "stk_hand_" + side, rot=[(X, -hand)])}
	if side == "r":
		v["stk_hand2_r"] = L(rest, "stk_hand2_r", rot=[(X, -hand * 0.7)])
	return v


def roll_pitch(p, duty):
	"""Rolagem do pé na passada (p = fase do pé, 0..duty apoio): pousa com a
	ponta, firma, o calcanhar sobe antes de sair do chão e a ponta pende no
	voo."""
	if p < duty:
		s = p / duty
		return 6 * (1 - smooth(s / 0.2)) - 14 * smooth((s - 0.7) / 0.3)
	s = (p - duty) / (1 - duty)
	return -14 * (1 - smooth(s / 0.35)) + 22 * smooth((s - 0.2) / 0.4) * (1 - smooth((s - 0.75) / 0.25)) + 6 * smooth((s - 0.75) / 0.25)


def idle(t):
	"""Respira curvado (o peito sobe), passa o peso de uma perna para a
	outra, a cabeça fareja e vira, as garras se abrem e fecham."""
	b = math.sin(TAU * t * 2)
	w = math.sin(TAU * t)
	v = planted()
	v["stk_root"] = L(rest, "stk_root", move=(0.03 * w, 0, -0.03 + 0.025 * b))
	v["stk_pelvis"] = L(rest, "stk_pelvis", rot=[(Y, -2 * w)])
	v["stk_spine"] = L(rest, "stk_spine", rot=[(X, -1.5 * b)])
	v["stk_chest"] = L(rest, "stk_chest", rot=[(X, -2.5 * b), (Z, 4 * math.sin(TAU * t + 0.8))])
	v["stk_neck"] = L(rest, "stk_neck", rot=[(Z, 12 * math.sin(TAU * t + 1.3)), (X, 4 * math.sin(TAU * t * 3))])
	v["stk_head"] = L(rest, "stk_head", rot=[(Z, 8 * math.sin(TAU * t + 1.6)), (X, -3 * math.sin(TAU * t * 4 + 0.5))])
	for s, ph in (("l", 0.0), ("r", 0.4)):
		k = math.sin(TAU * t + TAU * ph)
		v.update(arm_pose(s, swing=2 * k - 1.5 * b, fore=3 * math.sin(TAU * 2 * t + ph), out=2 + 2 * k,
			hand=6 * math.sin(TAU * 2 * t + TAU * ph)))
	return v


def gait(t, g, lean):
	"""Passo bípede (esquerdo em fase 0, direito em 0.5) com rolagem do pé;
	o corpo afunda a cada pisada e ginga de lado, o tronco gira contra a
	pélvis e os braços balançam opostos às pernas."""
	stride, lift, duty = g["stride"], g["lift"], g["duty"]
	v = {}
	for s, ph, gap in (("l", 0.0, -FEET_GAP), ("r", 0.5, FEET_GAP)):
		dy, dz = bc.walk_foot(t, ph, stride, lift, duty=duty)
		p = (t + ph) % 1.0
		# No voo o pé passa por fora (não raspa na outra perna).
		dx = 0.08 * math.sin(math.pi * (p - duty) / (1 - duty)) * (-1 if s == "l" else 1) if p >= duty else 0.0
		v.update(foot(s, (dx, dy + gap, dz), roll_pitch(p, duty)))
	impact = sum(math.exp(-((t - c) % 1.0) * 16) for c in (0.03, 0.53))
	sway = math.sin(TAU * t)
	v["stk_root"] = L(rest, "stk_root", move=(0.07 * sway, 0, -0.1 - 0.07 * math.cos(2 * TAU * (t - 0.05)) - 0.04 * impact),
		rot=[(X, lean)])
	yaw = 7 * math.cos(TAU * t)
	v["stk_pelvis"] = L(rest, "stk_pelvis", rot=[(Z, -yaw), (Y, 3 * sway)])
	v["stk_spine"] = L(rest, "stk_spine", rot=[(Z, 0.8 * yaw), (X, 2 * impact)])
	v["stk_chest"] = L(rest, "stk_chest", rot=[(Z, 0.8 * yaw), (Y, -2 * sway), (X, 1.5 * impact)])
	# O pescoço desfaz o giro do tronco: a cabeça segue reta, de olho no alvo.
	v["stk_neck"] = L(rest, "stk_neck", rot=[(Z, -1.2 * yaw), (X, -lean * 0.8 - 2 * impact)])
	v["stk_head"] = L(rest, "stk_head", rot=[(X, -lean * 0.4 + 2 * math.sin(2 * TAU * t))])
	c = math.cos(TAU * t)
	for s, sign in (("l", 1), ("r", -1)):
		lag = sign * math.cos(TAU * t - 0.8)
		amp = 14 if g is RUN else 10
		v.update(arm_pose(s, swing=sign * amp * c - lean * 0.6, fore=6 + 8 * (0.5 - 0.5 * lag), out=3 + 2 * impact,
			hand=4 * lag))
	return v


def walk(t):
	return gait(t, WALK, 3)


def run(t):
	return gait(t, RUN, 14)


def slash(t):
	"""Foice (braço direito, x > 0): gira o tronco e ergue a lâmina por fora
	até o alto (até 0.42), avança o pé e corta em diagonal cruzando o corpo
	(golpe em 0.5), segue o movimento e volta."""
	wind = pulse(t, 0.0, 0.4, 0.44, 0.52)
	cut = pulse(t, 0.42, 0.52, 0.62, 0.95)
	crouch = pulse(t, 0.05, 0.4, 0.6, 0.95)
	v = planted(r=((0.05 * cut, -0.35 * cut, 0.12 * pulse(t, 0.35, 0.45, 0.45, 0.55)),), l=((0, 0.1 * cut, 0),))
	v["stk_root"] = L(rest, "stk_root", move=(0, 0.12 * wind - 0.28 * cut, -0.12 * crouch))
	v["stk_spine"] = L(rest, "stk_spine", rot=[(Z, 12 * wind - 16 * cut), (X, -4 * wind + 8 * cut)])
	v["stk_chest"] = L(rest, "stk_chest", rot=[(Z, 16 * wind - 22 * cut), (X, -6 * wind + 10 * cut), (Y, 5 * wind - 6 * cut)])
	v["stk_neck"] = L(rest, "stk_neck", rot=[(Z, -18 * wind + 22 * cut), (X, -8 * wind)])
	v["stk_head"] = L(rest, "stk_head", rot=[(X, -6 * wind + 4 * cut)])
	v.update(arm_pose("r", swing=40 * wind - 75 * cut, fore=-10 * wind + 25 * cut, out=55 * wind - 30 * cut,
		twist=-15 * wind + 20 * cut, hand=-20 * wind + 25 * cut))
	v.update(arm_pose("l", swing=-15 * wind + 10 * cut, fore=10 * wind, out=10 * wind + 5 * cut, hand=10 * wind))
	return v


def rake(t):
	"""Garras (braço esquerdo, x < 0): ergue o braço para a frente e para o
	alto, recuando o tronco (até 0.42), e rasga de cima para baixo dando o
	bote com a cabeça (golpe em 0.5); a foice fica de guarda."""
	up = pulse(t, 0.0, 0.4, 0.44, 0.52)
	hit = pulse(t, 0.42, 0.52, 0.6, 0.95)
	v = planted(l=((0, -0.3 * hit, 0.1 * pulse(t, 0.36, 0.44, 0.44, 0.52)),), r=((0, 0.08 * up, 0),))
	v["stk_root"] = L(rest, "stk_root", move=(0, 0.15 * up - 0.3 * hit, -0.06 * up - 0.18 * hit))
	v["stk_spine"] = L(rest, "stk_spine", rot=[(X, -8 * up + 10 * hit), (Z, -8 * up + 10 * hit)])
	v["stk_chest"] = L(rest, "stk_chest", rot=[(X, -12 * up + 16 * hit), (Z, -10 * up + 14 * hit)])
	v["stk_neck"] = L(rest, "stk_neck", rot=[(X, -14 * up + 18 * hit), (Z, 8 * up - 10 * hit)])
	v["stk_head"] = L(rest, "stk_head", rot=[(X, -10 * up + 14 * hit)])
	v.update(arm_pose("l", swing=-110 * up - 45 * hit, fore=-35 * up + 25 * hit, out=15 * up - 8 * hit,
		hand=-35 * up + 35 * hit))
	v.update(arm_pose("r", swing=-20 * up - 10 * hit, fore=25 * up + 10 * hit, out=8 * up, hand=10 * up))
	return v


def death(t):
	"""Leva o golpe (tronco joga para trás), os joelhos cedem e cai de
	joelhos, depois desaba para a frente (girando em torno dos joelhos, um
	pouco de lado) com o peito no chão; os braços se abrem e caem soltos."""
	hit = math.sin(math.pi * min(1.0, t / 0.2)) if t < 0.2 else 0.0
	kneel = smooth((t - 0.12) / 0.36)
	fall = smooth((t - 0.42) / 0.4) ** 1.5
	limp = smooth((t - 0.15) / 0.5)
	knee_move = Vector((0, 0.12 * hit - 0.1 * kneel, -DEATH_KNEEL * kneel))
	tilt = [(X, DEATH_PITCH * fall), (Y, -12 * fall)]
	rf = Matrix()
	for axis, deg in tilt:
		rf = Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ rf
	rf = rf.to_3x3()
	pivot = Vector(DEATH_PIVOT)
	move = pivot - rf @ pivot + rf @ knee_move + Vector((0, 0, -DEATH_DROP * fall))
	v = planted(l=((0, 0.15 * kneel + 0.2 * fall, 0), -20 * kneel - 15 * fall), r=((0.05 * kneel, 0.05 * kneel + 0.3 * fall, 0), -30 * kneel - 10 * fall))
	v["stk_root"] = L(rest, "stk_root", move=move, rot=[(X, -8 * hit + 6 * kneel)] + tilt)
	v["stk_spine"] = L(rest, "stk_spine", rot=[(X, -10 * hit + 6 * kneel - 6 * fall)])
	v["stk_chest"] = L(rest, "stk_chest", rot=[(X, -12 * hit + 6 * kneel - 8 * fall), (Z, 8 * limp)])
	# A cabeça vira de lado ao bater no chão.
	v["stk_neck"] = L(rest, "stk_neck", rot=[(X, -20 * hit + 10 * limp - 25 * fall), (Z, 25 * fall)])
	v["stk_head"] = L(rest, "stk_head", rot=[(X, -10 * hit - 15 * fall), (Y, 20 * fall)])
	for s, d in (("l", 0.0), ("r", 0.08)):
		flop = math.sin(TAU * 1.5 * max(0.0, t - 0.8 - d)) * math.exp(-max(0.0, t - 0.8 - d) * 6) if t > 0.8 + d else 0.0
		v.update(arm_pose(s, swing=15 * hit - 20 * limp - 5 * fall + 8 * flop, fore=-5 * limp - 30 * fall + 10 * flop,
			out=8 + 15 * limp + 40 * fall, hand=-15 * limp - 25 * fall))
	return v


actions = {
	"idle": bc.make_action(arm, "idle", 72, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", WALK["frames"], walk, CONTROLS),
	"run": bc.make_action(arm, "run", RUN["frames"], run, CONTROLS),
	"slash": bc.make_action(arm, "slash", 30, slash, CONTROLS),
	"rake": bc.make_action(arm, "rake", 30, rake, CONTROLS),
	"death": bc.make_action(arm, "death", 54, death, CONTROLS),
}

if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	mat = bpy.data.materials.new("prev")
	mat.use_nodes = True
	node = mat.node_tree.nodes.new("ShaderNodeTexImage")
	node.image = bpy.data.images.load(os.path.join(TEX, "stalker.png"))
	mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
	mesh.data.materials.clear()
	mesh.data.materials.append(mat)
	os.environ["MW_SHADING"] = os.environ.get("MW_SHADING", "SINGLE")
	sets = (("walk", (1, 9, 17, 25)), ("run", (1, 6, 11, 16)), ("slash", (1, 13, 16, 20)),
		("rake", (1, 13, 16, 20)), ("death", (1, 16, 30, 55)), ("idle", (1, 19, 37)))
	if os.environ.get("MW_PREVIEW_SET"):  # ex.: "run:1,6;death:55"
		sets = [(a, tuple(int(f) for f in b.split(","))) for a, b in (x.split(":") for x in os.environ["MW_PREVIEW_SET"].split(";"))]
	for n, frames in sets:
		bc.render_frames([mesh], os.path.join(out, "stalker_%s.png" % n), arm, actions[n], frames=frames,
			views=tuple(os.environ.get("MW_PREVIEW_VIEWS", "side,front,persp").split(",")),
			res=int(os.environ.get("MW_PREVIEW_RES", 360)))
	if os.environ.get("MW_WEIGHTS"):  # caixa x0,x1,y0,y1,z0,z1 no modelo de 1 m
		b = [float(c) for c in os.environ["MW_WEIGHTS"].split(",")]
		names = {g.index: g.name for g in mesh.vertex_groups}
		from collections import Counter
		cnt = Counter()
		for vx in mesh.data.vertices:
			x, y, z = vx.co / HEIGHT
			if b[0] < x < b[1] and b[2] < y < b[3] and b[4] < z < b[5]:
				top = max(vx.groups, key=lambda g: g.weight)
				cnt[names[top.group]] += 1
		print("WEIGHTS", dict(cnt))
	if os.environ.get("MW_BOUNDS"):  # ex.: "death:1,30,55"
		for item in os.environ["MW_BOUNDS"].split(";"):
			n, fr = item.split(":")
			arm.animation_data.action = actions[n]
			for f in fr.split(","):
				bpy.context.scene.frame_set(int(f))
				lo, hi = bc.world_bounds([mesh])
				print("BOUNDS", n, f, tuple(round(c, 2) for c in lo), tuple(round(c, 2) for c in hi))
			arm.animation_data.action = None
	if os.environ.get("MW_PREVIEW_ONLY"):
		sys.exit(0)

bc.clear_constraints(arm)
bc.remove_bones(arm, helpers)
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "Swarm Stalker", "Stalker do Enxame (tools/imported/import_swarm_stalker.py)")
bc.export_mesh(mesh, arm, "skeletal/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "units/%s/%s.dae" % (NAME, n), mesh)
# Por ciclo o corpo anda stride / duty metros.
SPEED = {k: round(100 * g["duty"] / g["stride"]) for k, g in (("walk", WALK), ("run", RUN))}
print("STALKER tris", bc.triangle_count(mesh), SPEED)

ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- Stalker do Enxame: malha, esqueleto, animações e textura de
     tools/imported/import_swarm_stalker.py (modelo de refs/exo, ver CREDITS.md).
     Walk/Run: {walk_m} / {run_m} m por ciclo -> speed {walk} / {run}. -->
<actor version="1">
  <castshadow/>
  <group>
    <variant frequency="1" name="Base">
      <mesh>skeletal/{name}.dae</mesh>
      <animations>
        <animation file="units/{name}/idle.dae" name="Idle" speed="100"/>
        <animation file="units/{name}/walk.dae" name="Walk" speed="{walk}"/>
        <animation file="units/{name}/run.dae" name="Run" speed="{run}"/>
        <animation event="0.5" file="units/{name}/slash.dae" name="attack_melee" speed="100"/>
        <animation event="0.5" file="units/{name}/rake.dae" name="attack_melee" speed="100"/>
        <animation file="units/{name}/death.dae" name="Death" speed="100"/>
      </animations>
      <textures>
        <texture file="skeletal/swarm/stalker.png" name="baseTex"/>
        <texture file="vehicle/flat_norm.png" name="normTex"/>
        <texture file="skeletal/swarm/stalker_spec.png" name="specTex"/>
      </textures>
    </variant>
  </group>
  <group>
    <variant frequency="1" name="alive"/>
    <variant name="death">
      <props>
        <prop actor="props/units/blood_01.xml" attachpoint="root"/>
      </props>
    </variant>
  </group>
  <material>basic_trans_norm_spec.xml</material>
</actor>
"""
with open(os.path.join(bc.MOD, "art", "actors", "units", "swarm", "stalker.xml"), "w", encoding="utf-8") as f:
	f.write(ACTOR.format(name=NAME, walk=SPEED["walk"], run=SPEED["run"],
		walk_m="%.2f" % (WALK["stride"] / WALK["duty"]), run_m="%.2f" % (RUN["stride"] / RUN["duty"])))

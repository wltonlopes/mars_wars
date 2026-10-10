#!/usr/bin/env python3
"""Gera as animações da moto dos piratas e do piloto dela.

Piloto (units/pira/bike_rider), em art/animation/biped/bike_rider/:
  ride_idle.dae   parado, sentado na moto
  ride_move.dae   pilotando (mais inclinado, trepidando)
  ride_shoot.dae  saca a submetralhadora do coldre, atira para a frente e
                  volta ao guidão
  ride_death.dae  é arremessado para o lado quando a moto tomba e cai no chão

Moto (vehicle/pira/bike_male.xml e bike_female.xml):
  art/meshes/vehicle/bike_rigged.dae     a malha de bike.dae com esqueleto
                                         (bike_root, wheel_front, wheel_rear)
  art/animation/vehicle/bike/idle.dae    parada
  art/animation/vehicle/bike/move.dae    uma volta completa das duas rodas
  art/animation/vehicle/bike/death.dae   tomba de lado, as rodas ainda girando

bike.dae (exportada do Blender) não é alterada: ao reexportar a moto, basta
rodar este script de novo. As rodas são achadas sozinhas (as duas partes
soltas da malha que tocam o chão).

As poses são calculadas por cinemática inversa a partir da geometria da moto
(art/meshes/vehicle/bike.dae): quadril no banco, mãos nas manoplas e pés no
apoio lateral do motor. O .dae de saída é uma cópia de um .dae de animação do mod com a
library_animations trocada, então usa o mesmo esqueleto bípede.

Uso:  python3 tools/animation/gen_bike_rider.py [--preview pasta]
"""
import os
import sys
import re
import numpy as np
from dae_rig import Rig, write_animation

MOD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ANIM = os.path.join(MOD, "art", "animation", "biped")
TEMPLATE = os.path.join(ANIM, "assault_rifle", "ready", "idle_2.dae")
AIM_REFERENCE = os.path.join(ANIM, "assault_rifle", "shooting", "stand_1.dae")
OUT_DIR = os.path.join(ANIM, "bike_rider")
BIKE_MESH = os.path.join(MOD, "art", "meshes", "vehicle", "bike.dae")
BIKE_RIGGED = os.path.join(MOD, "art", "meshes", "vehicle", "bike_rigged.dae")
BIKE_ANIM_DIR = os.path.join(MOD, "art", "animation", "vehicle", "bike")
BIKE_SKELETON = os.path.join(MOD, "art", "skeletons", "bike.xml")

# Morte: a moto tomba para o lado +X até o guidão encostar no chão.
DEATH_FRAMES = 37
FALL_ANGLE = 74.0
FPS = 30.0

# Geometria da moto, em coordenadas da malha (Z para cima, frente = -Y).
RIDE_POINT = np.array([0.0, 0.41, 2.65])      # prop_ride: origem do piloto
SEAT = np.array([0.0, 0.62, 3.22])            # junta do quadril sobre o banco
GRIP = np.array([0.88, -0.74, 3.68])          # punho, logo atrás da manopla (lado +X)
PEG = np.array([0.66, 0.12, 1.98])            # tornozelo sobre o apoio lateral do motor (lado +X)


def rot_x(deg):
	a = np.radians(deg); c, s = np.cos(a), np.sin(a)
	return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(deg):
	a = np.radians(deg); c, s = np.cos(a), np.sin(a)
	return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(deg):
	a = np.radians(deg); c, s = np.cos(a), np.sin(a)
	return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def unit(v):
	return v / np.linalg.norm(v)


def axis_angle(axis, angle):
	x, y, z = unit(axis)
	c, s = np.cos(angle), np.sin(angle)
	K = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
	return np.eye(3) + s * K + (1 - c) * (K @ K)


def swing(a, b):
	"""Menor rotação que leva a direção `a` até `b`."""
	a, b = unit(a), unit(b)
	axis = np.cross(a, b)
	n = np.linalg.norm(axis)
	if n < 1e-8:
		return np.eye(3)
	return axis_angle(axis, np.arctan2(n, np.dot(a, b)))


def slerp(R0, R1, t):
	D = R0.T @ R1
	angle = np.arccos(np.clip((np.trace(D) - 1) / 2, -1, 1))
	if angle < 1e-6:
		return R0
	axis = np.array([D[2, 1] - D[1, 2], D[0, 2] - D[2, 0], D[1, 0] - D[0, 1]])
	return R0 @ axis_angle(axis, angle * t)


def smooth(t):
	t = np.clip(t, 0, 1)
	return t * t * (3 - 2 * t)


class Poser:
	def __init__(self):
		self.rig = Rig(TEMPLATE)
		rig = self.rig
		self.rest = rig.rest_locals()
		self.rest_world = rig.world(self.rest)
		ref = Rig(AIM_REFERENCE)
		ref_locals = ref.frame_locals(4)
		ref_world = ref.world(ref_locals)
		# Mão direita apontando a arma para a frente, e dedos fechados.
		self.aim_hand = ref_world[ref.n("hand_R")][:3, :3]
		self.fingers = {rig.n(n): ref_locals[ref.n(n)] for n in ("finger_R", "fingertip_R", "finger_L", "fingertip_L")}

	def nid(self, name):
		return self.rig.n(name)

	def hand_rotation(self, side, fingers, palm):
		"""Rotação de mundo da mão com os dedos em `fingers` e a palma virada para `palm`."""
		rest = self.rest_world[self.nid("hand_" + side)][:3, :3]
		toward_body = np.array([1.0, 0, 0]) if side == "R" else np.array([-1.0, 0, 0])
		lf = np.array([0.0, 1, 0])
		lp = rest.T @ toward_body
		lp = unit(lp - lf * np.dot(lp, lf))
		f = unit(np.asarray(fingers, float))
		p = np.asarray(palm, float)
		p = unit(p - f * np.dot(p, f))
		L = np.column_stack([lf, lp, np.cross(lf, lp)])
		W = np.column_stack([f, p, np.cross(f, p)])
		return W @ L.T

	def solve(self, p):
		"""Pose completa (dict id -> matriz local) a partir dos parâmetros `p`."""
		rig = self.rig
		loc = {k: v.copy() for k, v in self.rest.items()}
		loc.update({k: v.copy() for k, v in self.fingers.items()})

		def world():
			return rig.world(loc)

		def set_world_rot(name, R):
			nid = self.nid(name)
			parent = rig.joints[nid]["parent"]
			pw = world()[parent][:3, :3] if parent else np.eye(3)
			loc[nid][:3, :3] = pw.T @ R

		# Tronco: quadril no banco (ou onde "hip_matrix" mandar) e coluna inclinada.
		hip = self.nid("hip")
		if "hip_matrix" in p:
			loc[hip][:3, 3], loc[hip][:3, :3] = p["hip_matrix"]
		else:
			loc[hip][:3, 3] = SEAT - RIDE_POINT + np.asarray(p.get("hip_offset", (0, 0, 0)), float)
			loc[hip][:3, :3] = rot_z(p.get("hip_yaw", 0)) @ rot_y(p.get("hip_roll", 0)) @ rot_x(p["hip_lean"]) @ self.rest_world[hip][:3, :3]
		body = loc[hip][:3, :3] @ self.rest_world[hip][:3, :3].T

		def lean(name, R):
			# Gira a junta nos eixos do corpo (X = lado, Z = cabeça), a partir de como ela está agora.
			set_world_rot(name, body @ R @ body.T @ world()[self.nid(name)][:3, :3])

		for name in ("spine", "spine1", "chest"):
			lean(name, rot_z(p.get("twist", 0) / 3) @ rot_x(p["spine_lean"] / 3))
		lean("neck", rot_x(p["neck_lean"]))
		lean("head", rot_z(p.get("head_yaw", 0)) @ rot_x(p["head_lean"]))

		def limb(upper, lower, end, target, pole, end_rot):
			w = world()
			a = w[self.nid(upper)][:3, 3]
			b = w[self.nid(lower)][:3, 3]
			c = w[self.nid(end)][:3, 3]
			l1, l2 = np.linalg.norm(b - a), np.linalg.norm(c - b)
			to = target - a
			d = min(np.linalg.norm(to), (l1 + l2) * 0.995)
			u = unit(to)
			side = np.asarray(pole, float)
			side = unit(side - u * np.dot(side, u))
			cos_a = np.clip((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
			joint = a + l1 * (cos_a * u + np.sqrt(1 - cos_a * cos_a) * side)
			set_world_rot(upper, swing(b - a, joint - a) @ w[self.nid(upper)][:3, :3])
			w = world()
			b, c = w[self.nid(lower)][:3, 3], w[self.nid(end)][:3, 3]
			R = swing(c - b, (a + u * d) - b) @ w[self.nid(lower)][:3, :3]
			if end_rot is not None:
				# Torce o antebraço/canela junto com a mão/pé, para a malha não estrangular.
				axis = R[:, 1]
				cur = R[:, 0] - axis * np.dot(R[:, 0], axis)
				want = end_rot[:, 0] - axis * np.dot(end_rot[:, 0], axis)
				if np.linalg.norm(cur) > 1e-4 and np.linalg.norm(want) > 1e-4:
					angle = np.arctan2(np.dot(np.cross(cur, want), axis), np.dot(cur, want))
					R = axis_angle(axis, angle * p.get("limb_twist", 0.5)) @ R
			set_world_rot(lower, R)
			if end_rot is not None:
				set_world_rot(end, end_rot)

		for side, sx in (("R", -1.0), ("L", 1.0)):
			mirror = np.array([sx, 1, 1])
			# Pernas: joelho para a frente e para fora, abraçando o tanque.
			foot_rest = self.rest_world[self.nid("foot_" + side)][:3, :3]
			foot = p.get("foot_" + side) or {"pos": PEG * mirror - RIDE_POINT, "pole": np.array([0.55 * sx, -1.0, 0.25]),
				"rot": rot_z(-12 * sx) @ rot_x(p.get("foot_pitch", -8)) @ foot_rest}
			limb("thigh_" + side, "leg_" + side, "foot_" + side, foot["pos"], np.asarray(foot["pole"], float), foot["rot"])
			# Braços: cotovelo para fora e para baixo.
			hand = p["hand_" + side]
			limb("arm_" + side, "forearm_" + side, "hand_" + side, hand["pos"],
				np.asarray(hand.get("pole", (0.8 * sx, 0.5, -0.6)), float), hand["rot"])
		return loc


def key(p0, p1, t):
	"""Interpola dois conjuntos de parâmetros (números, vetores e mãos)."""
	out = {}
	for k in p0:
		a, b = p0[k], p1[k]
		if isinstance(a, dict):
			out[k] = {"pos": a["pos"] + (b["pos"] - a["pos"]) * t, "rot": slerp(a["rot"], b["rot"], t),
				"pole": np.asarray(a["pole"]) + (np.asarray(b["pole"]) - np.asarray(a["pole"])) * t}
		else:
			out[k] = np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t
	return out


def build():
	P = Poser()
	grip = {}
	for side, sx in (("R", -1.0), ("L", 1.0)):
		grip[side] = {"pos": GRIP * np.array([sx, 1, 1]) - RIDE_POINT,
			"rot": P.hand_rotation(side, (0.25 * sx, -1, -0.25), (0, -0.15, -1)),
			"pole": (0.8 * sx, 0.5, -0.6)}

	def base(**kw):
		p = {"hip_lean": 14.0, "spine_lean": 24.0, "neck_lean": -20.0, "head_lean": -30.0, "head_yaw": 0.0,
			"hip_offset": np.zeros(3), "hip_roll": 0.0, "hip_yaw": 0.0, "twist": 0.0, "foot_pitch": -8.0,
			"hand_R": dict(grip["R"]), "hand_L": dict(grip["L"])}
		p.update(kw)
		return p

	anims = {}

	# Parado: respiração leve e a cabeça olhando em volta.
	n = 61
	frames = []
	for i in range(n):
		ph = 2 * np.pi * i / (n - 1)
		frames.append(P.solve(base(spine_lean=24 + 1.2 * np.sin(ph), hip_offset=np.array([0, 0, 0.006 * np.sin(ph)]),
			head_yaw=9 * np.sin(ph), head_lean=-30 + 1.5 * np.sin(2 * ph))))
	anims["ride_idle"] = frames

	# Pilotando: mais deitado sobre o tanque; o corpo trepida e balança, mas
	# as mãos e os pés ficam presos à moto (IK).
	n = 25
	frames = []
	for i in range(n):
		ph = 2 * np.pi * i / (n - 1)
		frames.append(P.solve(base(hip_lean=20, spine_lean=36 + 1.5 * np.sin(2 * ph), neck_lean=-26, head_lean=-40,
			hip_offset=np.array([0.012 * np.sin(ph), 0.03, -0.02 + 0.022 * np.sin(2 * ph)]),
			hip_roll=1.6 * np.sin(ph), head_yaw=2 * np.sin(ph))))
	anims["ride_move"] = frames

	# Tiro: mão direita do guidão ao coldre (coxa direita), saca, aponta para a
	# frente por cima do guidão, dispara rajada com recuo e volta ao guidão.
	n = 46
	rest_ride = base()
	holster_pos = SEAT - RIDE_POINT + np.array([-0.62, -0.05, 0.12])
	holster = base(hip_lean=10, spine_lean=14, twist=-10, neck_lean=-12, head_lean=-18, head_yaw=-8,
		hand_R={"pos": holster_pos, "rot": P.hand_rotation("R", (0.1, -0.35, -1), (1, 0, 0)), "pole": (-1, 0.9, 0.1)})
	aim_pos = np.array([-0.42, -1.18, 1.92])
	aim = base(hip_lean=8, spine_lean=8, twist=6, neck_lean=-6, head_lean=-10, head_yaw=4,
		hand_R={"pos": aim_pos, "rot": P.aim_hand, "pole": (-0.7, 0.2, -1)})
	frames = []
	for i in range(n):
		t = i / (n - 1)
		if t < 0.16:
			p = key(rest_ride, holster, smooth(t / 0.16))
		elif t < 0.36:
			p = key(holster, aim, smooth((t - 0.16) / 0.20))
		elif t < 0.84:
			# Rajada: quatro coices curtos (a mão recua e o cano sobe).
			k = (t - 0.36) / 0.48
			kick = max(0.0, np.sin(k * 4 * 2 * np.pi)) ** 2
			p = key(aim, aim, 0)
			p["hand_R"] = {"pos": aim_pos + np.array([0, 0.06, 0.035]) * kick,
				"rot": rot_x(-5 * kick) @ P.aim_hand, "pole": aim["hand_R"]["pole"]}
			p["spine_lean"] = 8 - 1.5 * kick
		else:
			p = key(aim, rest_ride, smooth((t - 0.84) / 0.16))
		frames.append(P.solve(p))
	anims["ride_shoot"] = frames
	anims["ride_death"] = rider_death(P, base)
	return P, anims


def fall_angle(t):
	"""Ângulo (graus) da moto tombando, t de 0 a 1: cai, quica e assenta."""
	if t < 0.42:
		return FALL_ANGLE * (t / 0.42) ** 2
	if t < 0.62:
		return FALL_ANGLE - 5 * np.sin((t - 0.42) / 0.20 * np.pi)
	return FALL_ANGLE


def bike_root(t):
	m = np.eye(4)
	m[:3, :3] = rot_y(fall_angle(t))
	return m


def ride_matrix(t):
	"""Ponto "ride" (origem do piloto) em coordenadas da moto parada, no instante t da morte."""
	m = np.eye(4)
	m[:3, 3] = RIDE_POINT
	return bike_root(t) @ m


def rider_death(P, base):
	"""O piloto solta o guidão, é jogado para o lado em que a moto tomba e
	fica estendido de costas no chão. As poses são montadas em coordenadas do
	chão e convertidas para o ponto "ride", que tomba junto com a moto."""
	rig = P.rig
	rest = P.rest_world
	hip_rest = rest[P.nid("hip")]
	ride = base()
	seat_local = SEAT - RIDE_POINT
	seat_rot = rot_x(ride["hip_lean"]) @ hip_rest[:3, :3]
	release, landing = 0.16, 0.52
	lying = rot_z(25) @ rot_x(-90) @ rot_y(90)
	land_pos = np.array([6.6, 0.3, 0.36])

	# Membros soltos, relativos ao quadril em pé (X = lado, -Y = frente, Z = cabeça).
	sprawl = {
		"hand_R": ((-1.25, -0.20, 1.80), (0, 1, -0.3)), "hand_L": ((1.40, -0.25, 0.85), (0, 1, -0.3)),
		"foot_R": ((-0.60, -0.45, -1.80), (-0.4, -1, 0)), "foot_L": ((0.45, -0.10, -2.00), (0.3, -1, 0))}

	frames = []
	for i in range(DEATH_FRAMES):
		t = i / (DEATH_FRAMES - 1)
		M = ride_matrix(t)
		Mr, inv = M[:3, :3], np.linalg.inv(M)
		to_local = lambda v: (inv @ np.append(v, 1))[:3]

		# Quadril: preso ao banco até soltar, depois um arco até o chão.
		seat_world = (M @ np.append(seat_local, 1))[:3]
		s = np.clip((t - release) / (landing - release), 0, 1)
		start = (ride_matrix(release) @ np.append(seat_local, 1))[:3]
		if t <= release:
			pos, rot = seat_world, Mr @ seat_rot
		else:
			pos = start + (land_pos - start) * s + np.array([0, 0, 1.3]) * 4 * s * (1 - s)
			rot = slerp(ride_matrix(release)[:3, :3] @ seat_rot, lying @ hip_rest[:3, :3], smooth(s))
			if t > landing:
				# Quica uma vez e escorrega um pouco.
				k = (t - landing) / (1 - landing)
				pos = pos + np.array([0.35 * smooth(k), 0, 0.12 * max(0.0, np.sin(k * np.pi * 2.2)) * (1 - k)])
		delta = rot @ hip_rest[:3, :3].T

		# Membros: do guidão/apoios para a pose solta (as mãos largam primeiro).
		p = dict(ride)
		p["hip_matrix"] = (to_local(pos), Mr.T @ rot)
		for name, (offset, pole) in sprawl.items():
			side = name[-1]
			joint = name
			w = smooth((t - (0.04 if name.startswith("hand") else release * 0.8)) / 0.3)
			if name.startswith("hand"):
				held = ride[name]
			else:
				sx = -1.0 if side == "R" else 1.0
				held = {"pos": PEG * np.array([sx, 1, 1]) - RIDE_POINT, "pole": np.array([0.55 * sx, -1.0, 0.25]),
					"rot": rot_z(-12 * sx) @ rot_x(-8) @ rest[P.nid(joint)][:3, :3]}
			flail = 0.25 * np.sin(t * 9 + (1.5 if side == "L" else 0)) * (1 - smooth((t - landing) / 0.2))
			loose_pos = pos + delta @ (np.array(offset) + np.array([0, -flail, flail]))
			loose_rot = delta @ (rot_x(35) @ rest[P.nid(joint)][:3, :3] if name.startswith("foot") else rest[P.nid(joint)][:3, :3])
			p[name] = {"pos": np.asarray(held["pos"]) * (1 - w) + to_local(loose_pos) * w,
				"rot": slerp(np.asarray(held["rot"]), Mr.T @ loose_rot, w),
				"pole": np.asarray(held["pole"], float) * (1 - w) + (Mr.T @ delta @ np.array(pole, float)) * w}
		limp = smooth(t / 0.5)
		p["spine_lean"] = ride["spine_lean"] * (1 - limp) - 10 * limp
		p["neck_lean"] = ride["neck_lean"] * (1 - limp) - 6 * limp
		p["head_lean"] = ride["head_lean"] * (1 - limp) - 12 * limp
		p["head_yaw"] = 30 * limp
		p["twist"] = 12 * limp
		frames.append(P.solve(p))
	return frames


class BikeRig:
	"""Esqueleto da moto: bike_root (o corpo) e uma junta no eixo de cada roda."""

	def __init__(self):
		self.source = open(BIKE_MESH, encoding="utf-8").read()
		pos, idx = triangles(BIKE_MESH)
		self.pos = pos

		# Partes soltas da malha (vértices de mesma posição contam como um só).
		ids = {}
		vid = np.array([ids.setdefault(tuple(np.round(v, 4)), len(ids)) for v in pos])
		parent = list(range(len(ids)))

		def find(x):
			while parent[x] != x:
				parent[x] = parent[parent[x]]
				x = parent[x]
			return x

		for a, b, c in vid[idx]:
			parent[find(a)] = find(b)
			parent[find(b)] = find(c)
		part = np.array([find(v) for v in vid])

		# Rodas: partes que tocam o chão, redondas no plano YZ; a da frente tem o menor Y.
		wheels = []
		for label in np.unique(part):
			v = pos[part == label]
			size = np.ptp(v, axis=0)
			if v[:, 2].min() < 0.2 and abs(size[1] - size[2]) < 0.25 * size[2] and size[0] < 0.6 * size[2]:
				wheels.append((v[:, 1].mean(), label))
		if len(wheels) != 2:
			sys.exit("esperava 2 rodas em bike.dae, achei %d" % len(wheels))
		wheels.sort()
		self.joint_of_vertex = np.zeros(len(pos), int)
		self.wheels = []
		for joint, (_, label) in enumerate(wheels, 1):
			v = pos[part == label]
			center = (v.min(axis=0) + v.max(axis=0)) / 2
			# Eixo de giro: direção em que a roda é mais fina.
			axis = np.linalg.svd(v - v.mean(axis=0))[2][2]
			axis = axis if axis[0] > 0 else -axis
			self.joint_of_vertex[part == label] = joint
			self.wheels.append({"center": center, "axis": axis, "radius": np.ptp(v[:, 2]) / 2})

		self.names = ["bike_root", "wheel_front", "wheel_rear", "prop_ride"]
		self.order = ["BikeArmature_" + n for n in self.names]
		self.text = self.build_text()

	def rest(self):
		out = {self.order[0]: np.eye(4)}
		for nid, offset in zip(self.order[1:], [w["center"] for w in self.wheels] + [RIDE_POINT]):
			m = np.eye(4)
			m[:3, 3] = offset
			out[nid] = m
		return out

	def pose(self, root=None, spin=(0.0, 0.0)):
		"""Matrizes locais com a moto em `root` e as rodas giradas `spin` voltas."""
		out = self.rest()
		if root is not None:
			out[self.order[0]] = root
		for nid, wheel, turns in zip(self.order[1:3], self.wheels, spin):
			# Girar para a frente (-Y): sentido positivo em torno de +X.
			out[nid][:3, :3] = axis_angle(wheel["axis"], 2 * np.pi * turns)
		return out

	def build_text(self):
		from dae_rig import fmt
		rest = self.rest()
		geometry = re.search(r'<geometry id="([^"]+)"', self.source).group(1)
		material = re.search(r"<bind_material>.*?</bind_material>", self.source, re.S).group(0)
		inverse = []
		world = {self.order[0]: rest[self.order[0]]}
		for nid in self.order[1:]:
			world[nid] = world[self.order[0]] @ rest[nid]
		for nid in self.order[:3]:
			inverse.append(np.linalg.inv(world[nid]))
		n = len(self.pos)
		controller = (
			'  <library_controllers>\n'
			'    <controller id="bike-skin" name="BikeArmature">\n'
			'      <skin source="#{g}">\n'
			'        <bind_shape_matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</bind_shape_matrix>\n'
			'        <source id="bike-skin-joints">\n'
			'          <Name_array id="bike-skin-joints-array" count="3">bike_root wheel_front wheel_rear</Name_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#bike-skin-joints-array" count="3" stride="1">\n'
			'              <param name="JOINT" type="name"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="bike-skin-bind_poses">\n'
			'          <float_array id="bike-skin-bind_poses-array" count="48">{inv}</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#bike-skin-bind_poses-array" count="3" stride="16">\n'
			'              <param name="TRANSFORM" type="float4x4"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="bike-skin-weights">\n'
			'          <float_array id="bike-skin-weights-array" count="1">1</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#bike-skin-weights-array" count="1" stride="1">\n'
			'              <param name="WEIGHT" type="float"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <joints>\n'
			'          <input semantic="JOINT" source="#bike-skin-joints"/>\n'
			'          <input semantic="INV_BIND_MATRIX" source="#bike-skin-bind_poses"/>\n'
			'        </joints>\n'
			'        <vertex_weights count="{n}">\n'
			'          <input semantic="JOINT" source="#bike-skin-joints" offset="0"/>\n'
			'          <input semantic="WEIGHT" source="#bike-skin-weights" offset="1"/>\n'
			'          <vcount>{vcount}</vcount>\n'
			'          <v>{v}</v>\n'
			'        </vertex_weights>\n'
			'      </skin>\n'
			'    </controller>\n'
			'  </library_controllers>\n'
			'  <library_animations>\n  </library_animations>\n').format(g=geometry, inv=fmt(np.array(inverse)), n=n,
				vcount=" ".join(["1"] * n), v=" ".join("%d 0" % j for j in self.joint_of_vertex))

		def joint(name, children=""):
			nid = "BikeArmature_" + name
			return ('<node id="{i}" name="{n}" sid="{n}" type="JOINT">\n<matrix sid="transform">{m}</matrix>\n{c}</node>\n'
				.format(i=nid, n=name, m=fmt(rest[nid]), c=children))

		scene = (
			'<visual_scene id="Scene" name="Scene">\n'
			'<node id="BikeArmature" name="BikeArmature" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n' +
			joint("bike_root", joint("wheel_front") + joint("wheel_rear") + joint("prop_ride")) +
			'<node id="bike" name="bike" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n'
			'<instance_controller url="#bike-skin">\n'
			'<skeleton>#BikeArmature_bike_root</skeleton>\n' + material + '\n'
			'</instance_controller>\n</node>\n</node>\n</visual_scene>')
		text = re.sub(r"<visual_scene .*?</visual_scene>", lambda m: scene, self.source, count=1, flags=re.S)
		return text.replace("  <library_visual_scenes>", controller + "  <library_visual_scenes>", 1)

	def animations(self):
		anims = {"idle": [self.pose() for i in range(31)]}
		n = 31
		anims["move"] = [self.pose(spin=(i / (n - 1), i / (n - 1))) for i in range(n)]
		frames = []
		for i in range(DEATH_FRAMES):
			t = i / (DEATH_FRAMES - 1)
			# As rodas vão parando.
			turns = 1.6 * (t - t * t / 2)
			frames.append(self.pose(bike_root(t), (turns, turns)))
		anims["death"] = frames
		return anims

	def write(self):
		for folder in (BIKE_ANIM_DIR, os.path.dirname(BIKE_SKELETON)):
			os.makedirs(folder, exist_ok=True)
		open(BIKE_RIGGED, "w", encoding="utf-8").write(self.text.replace("  <library_animations>\n  </library_animations>\n", ""))
		print("gravado", os.path.relpath(BIKE_RIGGED, MOD))
		for name, frames in self.animations().items():
			path = os.path.join(BIKE_ANIM_DIR, name + ".dae")
			write_animation(self, path, name, np.arange(len(frames)) / FPS, frames)
			print("gravado", os.path.relpath(path, MOD), len(frames), "quadros")
		open(BIKE_SKELETON, "w", encoding="utf-8").write(SKELETON_XML)
		print("gravado", os.path.relpath(BIKE_SKELETON, MOD))
		for wheel, name in zip(self.wheels, ("dianteira", "traseira")):
			print("  roda %s: raio %.2f, %.2f m por volta" % (name, wheel["radius"], 2 * np.pi * wheel["radius"]))


SKELETON_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Moto dos piratas (art/meshes/vehicle/bike_rigged.dae), gerada por
     tools/animation/gen_bike_rider.py. -->
<skeletons>
	<standard_skeleton title="Bike" id="bike">
		<bone name="bike_root">
			<bone name="wheel_front"></bone>
			<bone name="wheel_rear"></bone>
		</bone>
	</standard_skeleton>

	<skeleton title="Bike" target="bike">
		<identifier>
			<root>bike_root</root>
		</identifier>
		<bone name="bike_root"><target>bike_root</target>
			<bone name="wheel_front"><target>wheel_front</target></bone>
			<bone name="wheel_rear"><target>wheel_rear</target></bone>
		</bone>
	</skeleton>
</skeletons>
"""


def triangles(path):
	"""(posições, índices) dos triângulos da primeira malha de um .dae."""
	text = open(path, encoding="utf-8").read()
	pos = np.array(re.search(r'positions-array" count="\d+">([^<]*)<', text).group(1).split(), float).reshape(-1, 3)
	block = re.search(r"<triangles[^>]*>(.*?)</triangles>", text, re.S).group(1)
	stride = len(re.findall(r"<input ", block))
	idx = np.array(re.search(r"<p>([^<]*)</p>", block).group(1).split(), int).reshape(-1, 3, stride)[:, :, 0]
	return pos, idx


def preview(P, anims, folder):
	"""Folhas de contato (vistas lateral e de 3/4 pela frente e por trás) com a malha
	deformada, a moto e a arma, para conferir as poses sem abrir o jogo."""
	from PIL import Image, ImageDraw
	os.makedirs(folder, exist_ok=True)
	rig = P.rig
	skin = rig.skin()
	_, body_idx = triangles(TEMPLATE)
	bike_pos, bike_idx = triangles(BIKE_MESH)
	bike_pos = bike_pos - RIDE_POINT
	gun_pos, gun_idx = triangles(os.path.join(MOD, "art", "meshes", "props", "weapons", "rifles", "subm.dae"))
	S, W, H = 62, 520, 400
	light = unit(np.array([0.4, -0.5, 0.8]))

	def view_matrix(yaw, pitch):
		return rot_x(pitch) @ rot_z(yaw)

	# Câmera: depois de girar, X = direita da tela, Z = cima, Y = profundidade.
	views = [("lado", view_matrix(90, 0)), ("3/4 frente", view_matrix(35, -20)), ("3/4 trás", view_matrix(150, -20))]
	for name, frames in anims.items():
		picks = {"ride_shoot": [0, 7, 12, 17, 24, 40], "ride_death": [0, 9, 14, 19, 36]}.get(
			name, [0, len(frames) // 4, len(frames) // 2])
		sheet = Image.new("RGB", (W * len(views), H * len(picks)), (24, 24, 28))
		d = ImageDraw.Draw(sheet)
		for row, fi in enumerate(picks):
			world = rig.world(frames[fi])
			pts = rig.skinned(skin, world)
			# Na morte a moto tomba e leva junto o ponto "ride".
			dead = name == "ride_death"
			root = bike_root(fi / (len(frames) - 1)) if dead else np.eye(4)
			place = ride_matrix(fi / (len(frames) - 1)) if dead else np.eye(4)
			if dead:
				pts = pts @ place[:3, :3].T + place[:3, 3] - RIDE_POINT
				for nid in world:
					world[nid] = place @ world[nid]
					world[nid][:3, 3] -= RIDE_POINT
			held = "weapon_R" if name == "ride_shoot" else "sheath_R"
			m = world[rig.n("prop-" + held)]
			gun = gun_pos @ m[:3, :3].T + m[:3, 3]
			bike_now = (bike_pos + RIDE_POINT) @ root[:3, :3].T - RIDE_POINT
			meshes = [(bike_now, bike_idx, np.array([120, 125, 140])), (pts, body_idx, np.array([225, 170, 90])),
				(gun, gun_idx, np.array([230, 60, 60]))]
			for col, (label, V) in enumerate(views):
				ox, oy = col * W, row * H
				polys = []
				for pos, idx, color in meshes:
					v = pos @ V.T
					tri = v[idx]
					normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
					normal /= np.linalg.norm(normal, axis=1)[:, None] + 1e-9
					shade = 0.35 + 0.65 * np.abs(normal @ (V @ light))
					depth = tri[:, :, 1].mean(axis=1)
					for t, sh, dp in zip(tri, shade, depth):
						polys.append((dp, [(ox + W / 2 + q[0] * S, oy + H * 0.62 - q[2] * S) for q in t], tuple((color * sh).astype(int))))
				for dp, poly, color in sorted(polys, key=lambda x: -x[0]):
					d.polygon(poly, fill=color)
				d.text((ox + 6, oy + 4), "%s  quadro %d  %s" % (name, fi, label), fill=(230, 230, 230))
		sheet.save(os.path.join(folder, name + ".png"))


def main():
	BikeRig().write()
	P, anims = build()
	os.makedirs(OUT_DIR, exist_ok=True)
	for name, frames in anims.items():
		times = np.arange(len(frames)) / FPS
		write_animation(P.rig, os.path.join(OUT_DIR, name + ".dae"), name, times, frames)
		print("gravado", os.path.relpath(os.path.join(OUT_DIR, name + ".dae"), MOD), len(frames), "quadros")
	if "--preview" in sys.argv:
		preview(P, anims, sys.argv[sys.argv.index("--preview") + 1])


if __name__ == "__main__":
	main()

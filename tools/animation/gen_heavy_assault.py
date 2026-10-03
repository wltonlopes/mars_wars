#!/usr/bin/env python3
"""Gera as animações da infantaria pesada de escudo do MCC
(units/mcc/rifle_assalt_champion_heavy_assalt), em art/animation/biped/heavy_shield/:

  idle.dae    em guarda, agachado atrás do escudo, arma baixa ao lado
  walk.dae    avança devagar e pesado, sempre com o escudo à frente
  shoot.dae   ergue a arma ao lado do escudo e dispara três tiros com coice forte
  death.dae   cambaleia, solta o escudo e cai de costas

O escudo (prop "shield", preso à mão esquerda) fica de pé à frente do corpo;
a arma fica na mão direita. Mãos e pés são resolvidos por cinemática inversa,
como em gen_bike_rider.py.

Uso:  python3 tools/animation/gen_heavy_assault.py [--preview pasta]
"""
import os
import re
import sys
import numpy as np
from dae_rig import write_animation
from gen_bike_rider import (MOD, ANIM, FPS, Poser, rot_x, rot_y, rot_z, slerp, smooth, unit, triangles)

OUT_DIR = os.path.join(ANIM, "heavy_shield")

# Guarda: quadril baixo, pé esquerdo à frente (lado do escudo), direito atrás.
HIP = np.array([0.0, 0.05, 1.93])
FOOT = {"L": np.array([0.36, -0.30, 0.13]), "R": np.array([-0.44, 0.48, 0.13])}
FOOT_YAW = {"L": -6.0, "R": 28.0}
# Centro do escudo (placa de 1,5 x 3,1) e mão da arma, em guarda e mirando.
SHIELD = np.array([0.30, -0.98, 1.98])
GUN_LOW = np.array([-0.62, -0.42, 2.25])
GUN_AIM = np.array([-0.66, -0.80, 2.98])


def lerp(a, b, t):
	return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


class Heavy:
	def __init__(self):
		self.P = Poser()
		P = self.P
		self.hip_rest = P.rest_world[P.nid("hip")][:3, :3]
		# O escudo é filho rígido da mão esquerda.
		self.shield_in_hand = np.linalg.inv(P.rest_world[P.nid("hand_L")]) @ P.rest_world[P.nid("prop-shield")]

	def shield_hand(self, center, rot):
		"""Mão esquerda que deixa o escudo em `center` com a rotação `rot`
		(identidade = de pé, face para a frente, alça virada para o corpo)."""
		m = np.eye(4)
		m[:3, :3], m[:3, 3] = rot, center
		hand = m @ np.linalg.inv(self.shield_in_hand)
		return {"pos": hand[:3, 3], "rot": hand[:3, :3], "pole": (0.9, 0.5, -0.5)}

	def gun_hand(self, pos, pitch=0.0, yaw=0.0):
		"""Mão direita com a arma apontada para a frente (pitch > 0 abaixa o cano)."""
		return {"pos": np.asarray(pos, float), "rot": rot_z(yaw) @ rot_x(pitch) @ self.P.aim_hand, "pole": (-0.7, 0.4, -0.8)}

	def foot(self, side, pos, pitch=0.0, yaw=None):
		rest = self.P.rest_world[self.P.nid("foot_" + side)][:3, :3]
		sx = 1.0 if side == "L" else -1.0
		return {"pos": np.asarray(pos, float), "pole": (0.35 * sx, -1.0, 0.1),
			"rot": rot_z(FOOT_YAW[side] if yaw is None else yaw) @ rot_x(pitch) @ rest}

	def stance(self, **kw):
		"""Parâmetros da guarda; kw troca qualquer um deles."""
		p = {"hip_pos": HIP.copy(), "hip_lean": 10.0, "hip_yaw": -14.0, "hip_roll": 0.0,
			"spine_lean": 16.0, "twist": 8.0, "neck_lean": -8.0, "head_lean": -12.0, "head_yaw": 6.0,
			"hand_L": self.shield_hand(SHIELD, rot_x(-4)), "hand_R": self.gun_hand(GUN_LOW, 28, -8),
			"foot_L": self.foot("L", FOOT["L"]), "foot_R": self.foot("R", FOOT["R"])}
		p.update(kw)
		return p

	def solve(self, p):
		p = dict(p)
		if "hip_matrix" not in p:
			rot = rot_z(p["hip_yaw"]) @ rot_y(p["hip_roll"]) @ rot_x(p["hip_lean"]) @ self.hip_rest
			p["hip_matrix"] = (np.asarray(p["hip_pos"], float), rot)
		return self.P.solve(p)

	# Animações ------------------------------------------------------------
	def idle(self):
		n = 61
		frames = []
		for i in range(n):
			ph = 2 * np.pi * i / (n - 1)
			frames.append(self.solve(self.stance(
				hip_pos=HIP + np.array([0.012 * np.sin(ph), 0, 0.012 * np.sin(2 * ph)]),
				spine_lean=16 + 1.0 * np.sin(2 * ph), head_yaw=6 + 10 * np.sin(ph),
				hand_L=self.shield_hand(SHIELD + np.array([0, 0, 0.015 * np.sin(2 * ph)]), rot_x(-4) @ rot_z(2 * np.sin(ph))),
				hand_R=self.gun_hand(GUN_LOW + np.array([0, 0, 0.015 * np.sin(2 * ph + 1)]), 28, -8))))
		return frames

	def walk(self):
		"""Passo curto e pesado: um pé de cada vez desliza para trás no chão
		(apoio) e volta pelo ar (balanço); o corpo balança de um lado para o outro."""
		n = 31
		stride = 1.1
		frames = []
		for i in range(n):
			c = i / (n - 1)
			feet = {}
			for side, offset in (("L", 0.0), ("R", 0.5)):
				u = (c + offset) % 1.0
				base = np.array([FOOT[side][0], 0.08, 0.13])
				if u < 0.62:
					# Apoio: o pé fica no chão enquanto o corpo passa por cima.
					y, z, pitch = -stride / 2 + stride * u / 0.62, 0.0, 0.0
				else:
					k = (u - 0.62) / 0.38
					y = stride / 2 - stride * smooth(k)
					z = 0.26 * np.sin(k * np.pi)
					pitch = 14 * np.sin(k * np.pi)
				feet[side] = self.foot(side, base + np.array([0, y, z]), pitch, FOOT_YAW[side] * 0.4)
			ph = 2 * np.pi * c
			sway = np.sin(ph)
			frames.append(self.solve(self.stance(
				hip_pos=HIP + np.array([0.07 * sway, 0, 0.03 - 0.04 * abs(np.cos(ph))]),
				hip_roll=2.5 * sway, hip_yaw=-10 + 4 * np.sin(ph), spine_lean=18, twist=6 - 3 * np.sin(ph),
				head_yaw=4, foot_L=feet["L"], foot_R=feet["R"],
				hand_L=self.shield_hand(SHIELD + np.array([0.04 * sway, 0, 0.03 - 0.04 * abs(np.cos(ph))]), rot_x(-5) @ rot_y(1.5 * sway)),
				hand_R=self.gun_hand(GUN_LOW + np.array([0.03 * sway, 0.03 * np.cos(ph), 0.02 * np.cos(2 * ph)]), 30, -8))))
		return frames

	def shoot(self):
		n = 46
		shots = (0.36, 0.52, 0.68)
		frames = []
		for i in range(n):
			t = i / (n - 1)
			# Ergue a arma até 0,3; baixa depois de 0,84.
			up = smooth(t / 0.30) if t < 0.5 else 1 - smooth((t - 0.84) / 0.16)
			# Coice: pancada rápida que decai depois de cada tiro.
			kick = sum(np.exp(-(t - s) * 26) for s in shots if t >= s)
			pos = lerp(GUN_LOW, GUN_AIM, up) + np.array([0, 0.10, 0.05]) * kick
			frames.append(self.solve(self.stance(
				hip_pos=HIP + np.array([0, 0.035 * kick, -0.03 * up]),
				spine_lean=16 + 4 * up - 5 * kick, twist=8 - 6 * up, head_yaw=6 - 8 * up, head_lean=-12 - 4 * up,
				hand_L=self.shield_hand(SHIELD + np.array([0.05 * up, 0.03 * kick, 0]), rot_x(-4) @ rot_z(-5 * up)),
				hand_R=self.gun_hand(pos, 28 * (1 - up) - 9 * kick, -8 * (1 - up)))))
		return frames

	def death(self):
		n = 43
		P = self.P
		start = self.stance()
		start_rot = rot_z(start["hip_yaw"]) @ rot_x(start["hip_lean"]) @ self.hip_rest
		lying = rot_z(8) @ rot_x(-88)
		land = np.array([0.1, 1.55, 0.36])
		shield_rest = rot_x(-4)
		shield_down = rot_z(-35) @ rot_x(84)
		# Membros soltos, relativos ao quadril em pé (X = lado, -Y = frente, Z = cabeça).
		loose = {"hand_R": (-1.30, -0.15, 0.95), "foot_L": (0.50, -0.25, -1.85), "foot_R": (-0.42, -0.10, -2.02)}
		frames = []
		for i in range(n):
			t = i / (n - 1)
			stagger = smooth(t / 0.22)
			fall = smooth((t - 0.18) / 0.44)
			bounce = 0.10 * max(0.0, np.sin((t - 0.62) / 0.38 * np.pi * 2)) * (1 - t) if t > 0.62 else 0.0
			pos = lerp(HIP + np.array([0, 0.22 * stagger, -0.12 * stagger]), land, fall) + np.array([0, 0, 0.35 * 4 * fall * (1 - fall) * 0.4 + bounce])
			rot = slerp(rot_x(-12 * stagger) @ start_rot, lying @ self.hip_rest, fall)
			delta = rot @ self.hip_rest.T
			p = dict(start)
			p["hip_matrix"] = (pos, rot)
			# O escudo escapa da mão: tomba para o lado e deita no chão.
			drop = smooth((t - 0.08) / 0.5)
			center = lerp(SHIELD, np.array([1.55, 1.35, 0.12]), drop) + np.array([0, 0, 0.5 * 4 * drop * (1 - drop) * 0.5])
			p["hand_L"] = self.shield_hand(center, slerp(shield_rest, shield_down, drop))
			p["hand_L"]["pole"] = lerp((0.9, 0.5, -0.5), delta @ np.array([0.6, 1.0, 0.0]), drop)
			held = start["hand_R"]
			w = smooth((t - 0.05) / 0.4)
			p["hand_R"] = {"pos": lerp(held["pos"], pos + delta @ np.array(loose["hand_R"]), w),
				"rot": slerp(held["rot"], delta @ P.rest_world[P.nid("hand_R")][:3, :3], w),
				"pole": lerp(held["pole"], delta @ np.array([-0.3, 1.0, 0.0]), w)}
			for side in ("L", "R"):
				name = "foot_" + side
				w = smooth((t - 0.3) / 0.4)
				held = start[name]
				p[name] = {"pos": lerp(held["pos"], pos + delta @ np.array(loose[name]), w),
					"rot": slerp(held["rot"], delta @ rot_x(30) @ P.rest_world[P.nid(name)][:3, :3], w),
					"pole": lerp(held["pole"], delta @ np.array([0.4 if side == "L" else -0.4, -1.0, 0.0]), w)}
				# O pé não afunda no chão.
				p[name]["pos"][2] = max(p[name]["pos"][2], 0.13)
			p["spine_lean"] = lerp(16, -6, fall) - 14 * stagger * (1 - fall)
			p["neck_lean"] = lerp(-8, -4, fall)
			p["head_lean"] = lerp(-12, -14, fall) - 12 * stagger * (1 - fall)
			p["head_yaw"] = lerp(6, 28, fall)
			p["twist"] = lerp(8, -10, fall)
			frames.append(self.P.solve(p))
		return frames

	def build(self):
		return {"idle": self.idle(), "walk": self.walk(), "shoot": self.shoot(), "death": self.death()}


def preview(heavy, anims, folder):
	from PIL import Image, ImageDraw
	os.makedirs(folder, exist_ok=True)
	rig = heavy.P.rig
	skin = rig.skin()
	from gen_bike_rider import TEMPLATE
	_, body_idx = triangles(TEMPLATE)
	shield_path = os.path.join(MOD, "art", "meshes", "props", "shields", "mcc_01.dae")
	shield_pos, shield_idx = triangles(shield_path)
	scale = np.array(re.search(r'<matrix sid="transform">([^<]*)<', open(shield_path).read()).group(1).split(), float).reshape(4, 4)
	shield_pos = shield_pos @ scale[:3, :3].T
	gun_pos, gun_idx = triangles(os.path.join(MOD, "art", "meshes", "props", "weapons", "rifles", "rifle_auto.dae"))
	S, W, H = 78, 440, 400
	light = unit(np.array([0.4, -0.5, 0.8]))
	views = [("lado", rot_z(90)), ("3/4 frente", rot_x(-20) @ rot_z(35)), ("3/4 trás", rot_x(-20) @ rot_z(150))]
	picks = {"idle": [0], "walk": [0, 6, 12, 19, 25], "shoot": [0, 14, 17, 30], "death": [0, 9, 18, 26, 42]}
	for name, frames in anims.items():
		sheet = Image.new("RGB", (W * len(views), H * len(picks[name])), (24, 24, 28))
		d = ImageDraw.Draw(sheet)
		for row, fi in enumerate(picks[name]):
			world = rig.world(frames[fi])
			pts = rig.skinned(skin, world)
			meshes = [(pts, body_idx, np.array([225, 170, 90]))]
			for prop, pos, idx, color in (("prop-shield", shield_pos, shield_idx, (110, 150, 210)), ("prop-weapon_R", gun_pos, gun_idx, (230, 60, 60))):
				m = world[rig.n(prop)]
				meshes.append((pos @ m[:3, :3].T + m[:3, 3], idx, np.array(color)))
			for col, (label, V) in enumerate(views):
				ox, oy = col * W, row * H
				d.line((ox, oy + H - 40, ox + W, oy + H - 40), fill=(70, 70, 80))
				polys = []
				for pos, idx, color in meshes:
					tri = (pos @ V.T)[idx]
					normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
					normal /= np.linalg.norm(normal, axis=1)[:, None] + 1e-9
					shade = 0.35 + 0.65 * np.abs(normal @ (V @ light))
					for t3, sh, dp in zip(tri, shade, tri[:, :, 1].mean(axis=1)):
						polys.append((dp, [(ox + W / 2 + q[0] * S, oy + H - 40 - q[2] * S) for q in t3], tuple((color * sh).astype(int))))
				for dp, poly, color in sorted(polys, key=lambda x: -x[0]):
					d.polygon(poly, fill=color)
				d.text((ox + 6, oy + 4), "%s  quadro %d  %s" % (name, fi, label), fill=(230, 230, 230))
		sheet.save(os.path.join(folder, "heavy_" + name + ".png"))


def main():
	heavy = Heavy()
	anims = heavy.build()
	os.makedirs(OUT_DIR, exist_ok=True)
	for name, frames in anims.items():
		path = os.path.join(OUT_DIR, name + ".dae")
		write_animation(heavy.P.rig, path, "heavy_shield_" + name, np.arange(len(frames)) / FPS, frames)
		print("gravado", os.path.relpath(path, MOD), len(frames), "quadros")
	if "--preview" in sys.argv:
		preview(heavy, anims, sys.argv[sys.argv.index("--preview") + 1])


if __name__ == "__main__":
	main()

#!/usr/bin/env python3
"""Animações do robô operário (art/meshes/skeletal/worker_01.dae), usado pelos
trabalhadores de todas as civs.

O modelo é estático; este script cria um esqueleto para ele:
  worker_root
    arm_l, arm_r           braços (giram no ombro, para cima e para baixo)
      claw_l, claw_r       garras na ponta (giram no punho)
        drill              broca (acrescentada à malha, na garra esquerda)
        prop_braco, prop_furadeira   pontos de encaixe nas pontas
    prop_dust              poeira do trabalho (no chão, à frente)
    track_01..             rodinhas das esteiras (direita e esquerda juntas)
    prop_back, ...         demais pontos do modelo

e as animações:
  idle          parado: braços balançando de leve
  move          andando: só as rodinhas girando (braços parados)
  build         construindo/consertando: o braço direito martela, a broca
                gira encostada na obra
  work_drill    minerando (rocha, gelo, ruínas): a broca desce girando e o
                braço direito recolhe o material
  work_pick     colhendo (campos e frutas): os braços colhem alternados

O actor ganha também efeitos por animação: faíscas de solda e de broca,
poeira e cascalho, borrifo na colheita.

Gera:
  art/meshes/skeletal/worker_01_rigged.dae, art/skeletons/worker_01.xml
  art/animation/units/worker/*.dae
  art/particles/worker_*.xml + art/actors/particle/worker_*.xml
e atualiza art/actors/units/mla/worker.xml e mcc/worker.xml (as cópias
retintas das outras facções são refeitas pelo gerador de facções).

worker_01.dae não é alterada: ao reexportar do Blender, rode de novo.
Uso (na pasta do mod):  python3 tools/animation/gen_worker.py [--preview pasta]
"""
import importlib.util
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dae_rig import fmt, write_animation  # noqa: E402

MOD = os.path.normpath(os.path.join(HERE, "..", ".."))
MESH = os.path.join(MOD, "art/meshes/skeletal/worker_01.dae")
RIGGED = os.path.join(MOD, "art/meshes/skeletal/worker_01_rigged.dae")
ANIM_DIR = os.path.join(MOD, "art/animation/units/worker")
SKELETON = os.path.join(MOD, "art/skeletons/worker_01.xml")
ACTORS = ["units/mla/worker.xml", "units/mcc/worker.xml"]
RETINTED = [("units/mla/worker.xml", "ares"), ("units/mla/worker.xml", "pira"),
	("units/mla/worker.xml", "swarm"), ("units/mcc/worker.xml", "coa")]
FPS = 30.0
ARMATURE = "WorkerArmature"


def rot(axis, angle):
	c, s = np.cos(angle), np.sin(angle)
	if axis == "x":
		return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
	if axis == "y":
		return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
	return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def translate(p):
	m = np.eye(4)
	m[:3, 3] = p
	return m


class Worker:
	def __init__(self):
		self.text = open(MESH, encoding="utf-8").read()
		self.read()
		self.find_parts()
		self.add_drill()
		self.build_joints()

	# --------------------------------------------------------------- leitura
	def read(self):
		def source(kind, size):
			m = re.search(r'<float_array id="([^"]*-%s-array)" count="\d+">([^<]*)<' % kind, self.text)
			return m.group(1), np.array(m.group(2).split(), float).reshape(-1, size)

		self.pos_id, self.pos = source("positions", 3)
		self.nor_id, self.nor = source("normals", 3)
		self.uv_id, self.uv = source("map-0", 2)
		block = re.search(r"<triangles[^>]*>(.*?)</triangles>", self.text, re.S).group(1)
		inputs = re.findall(r'<input semantic="(\w+)"[^>]*offset="(\d+)"', block)
		offsets = {}
		for semantic, offset in inputs:
			offsets.setdefault(semantic, int(offset))
		if (offsets["VERTEX"], offsets["NORMAL"], offsets["TEXCOORD"]) != (0, 1, 2):
			sys.exit("worker_01.dae: esperava VERTEX, NORMAL e TEXCOORD nos offsets 0, 1 e 2")
		self.stride = max(int(o) for _, o in inputs) + 1
		self.tri = np.array(re.search(r"<p>([^<]*)</p>", block).group(1).split(), int).reshape(-1, 3, self.stride)

		# Incorpora a matriz do objeto (escala do Blender).
		node = re.search(r'<node id="([^"]+)"[^>]*>\s*<matrix sid="transform">([^<]*)</matrix>\s*<instance_geometry', self.text)
		self.mesh_matrix = np.array(node.group(2).split(), float).reshape(4, 4)
		M = self.mesh_matrix
		self.pos = (np.c_[self.pos, np.ones(len(self.pos))] @ M.T)[:, :3]
		self.nor = self.nor @ np.linalg.inv(M[:3, :3])
		self.nor /= np.linalg.norm(self.nor, axis=1)[:, None] + 1e-12
		self.props = {}
		for name, m in re.findall(r'<node id="(prop_[^"]+)"[^>]*>\s*<matrix sid="transform">([^<]*)</matrix>', self.text):
			self.props[name] = (M @ np.array(m.split(), float).reshape(4, 4))[:3, 3]

	def find_parts(self):
		ids = {}
		vid = np.array([ids.setdefault(tuple(np.round(v, 4)), len(ids)) for v in self.pos])
		parent = list(range(len(ids)))

		def find(x):
			while parent[x] != x:
				parent[x] = parent[parent[x]]
				x = parent[x]
			return x

		for a, b, c in vid[self.tri[:, :, 0]]:
			parent[find(a)] = find(b)
			parent[find(b)] = find(c)
		part = np.array([find(v) for v in vid])
		self.part = part
		boxes = {l: (self.pos[part == l].min(axis=0), self.pos[part == l].max(axis=0)) for l in np.unique(part)}

		# Braços: peças na altura do ombro (z 4..5), fora do tronco, à frente das
		# cápsulas dos ombros. A garra é a peça mais à frente de cada braço.
		self.arms = {}
		for side, sign in (("l", -1), ("r", 1)):
			arm = [l for l, (lo, hi) in boxes.items()
				if sign * (lo[0] + hi[0]) / 2 > 1.3 and lo[2] > 3.9 and hi[2] < 5.1 and hi[1] < 1.6]
			if not arm:
				sys.exit("braço %s não encontrado" % side)
			claw = min(arm, key=lambda l: boxes[l][0][1])
			lo = np.min([boxes[l][0] for l in arm], axis=0)
			hi = np.max([boxes[l][1] for l in arm], axis=0)
			shoulder = np.array([(lo[0] + hi[0]) / 2, hi[1] - 0.6, (lo[2] + hi[2]) / 2])
			wrist = np.array([(boxes[claw][0][0] + boxes[claw][1][0]) / 2, boxes[claw][1][1], (boxes[claw][0][2] + boxes[claw][1][2]) / 2])
			self.arms[side] = {"parts": arm, "claw": claw, "shoulder": shoulder, "wrist": wrist,
				"tip": np.array([wrist[0], boxes[claw][0][1], wrist[2]])}

		# Rodinhas das esteiras: peças pequenas e redondas no plano YZ, embaixo.
		wheels = [l for l, (lo, hi) in boxes.items()
			if hi[2] < 1.4 and abs((lo[0] + hi[0]) / 2) > 1.5 and 0.25 < hi[2] - lo[2] < 0.6
			and abs((hi[1] - lo[1]) - (hi[2] - lo[2])) < 0.15]
		self.tracks = []
		for label in sorted(wheels, key=lambda l: (boxes[l][0][1], boxes[l][0][2])):
			center = (boxes[label][0] + boxes[label][1]) / 2
			same = next((t for t in self.tracks if np.linalg.norm(t["center"][1:] - center[1:]) < 0.1), None)
			if same:
				same["parts"].append(label)
			else:
				self.tracks.append({"parts": [label], "center": np.array([0.0, center[1], center[2]]),
					"radius": (boxes[label][1][2] - boxes[label][0][2]) / 2})
		print("braços: ombros em %s; %d pares de rodinhas" % (
			", ".join("%s %s" % (k, np.round(a["shoulder"], 2)) for k, a in self.arms.items()), len(self.tracks)))

	def add_drill(self):
		"""Broca na garra esquerda: motor, haste e ponta em degraus, apontando
		para a frente (-Y); fica presa ao osso "drill"."""
		tip = self.arms["l"]["tip"]
		claw_vertices = self.part == self.arms["l"]["claw"]
		claw_tris = self.tri[np.isin(self.tri[:, 0, 0], np.where(claw_vertices)[0])]
		uv_index = int(claw_tris[0, 0, 2])

		pieces = [((0, 0.15, 0), (0.55, 0.5, 0.55)), ((0, -0.35, 0), (0.24, 0.6, 0.24))]
		length, steps = 1.3, 5
		for i in range(steps):
			w = 0.34 * (1 - i / steps) + 0.04
			pieces.append(((0, -0.65 - (i + 0.5) * length / steps, 0), (w, length / steps * 1.02, w), i % 2))
		pos, nor, tris = [], [], []
		faces = [((0, 0, 1), (1, 0, 0)), ((0, 0, -1), (1, 0, 0)), ((1, 0, 0), (0, 1, 0)), ((-1, 0, 0), (0, 1, 0)),
			((0, 1, 0), (1, 0, 0)), ((0, -1, 0), (1, 0, 0))]
		for piece in pieces:
			center, size = np.array(piece[0], float), np.array(piece[1], float) / 2
			R = rot("y", np.pi / 4) if len(piece) > 2 and piece[2] else np.eye(3)
			for n, t in faces:
				n, t = np.array(n, float), np.array(t, float)
				b = np.cross(n, t)
				base = len(pos)
				for s, r in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
					pos.append(tip + R @ (n * size + s * t * size + r * b * size + center))
					nor.append(R @ n)
				tris += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
		self.drill_start = len(self.pos)
		n0, nn0 = len(self.pos), len(self.nor)
		self.pos = np.vstack([self.pos, pos])
		self.nor = np.vstack([self.nor, nor])
		new = np.array([[(a + n0, a + nn0, uv_index), (b + n0, b + nn0, uv_index), (c + n0, c + nn0, uv_index)]
			for a, b, c in tris])
		pad = np.zeros((len(new), 3, self.stride), int)
		pad[:, :, :3] = new
		for extra in range(3, self.stride):
			pad[:, :, extra] = uv_index
		self.tri = np.concatenate([self.tri, pad])
		self.drill_tip = tip + np.array([0, -0.65 - length, 0])

	# ---------------------------------------------------------------- ossos
	def build_joints(self):
		"""(nome, pai, matriz de mundo em repouso). Pais antes dos filhos."""
		J = [("worker_root", None, np.eye(4))]
		for side in ("l", "r"):
			arm = self.arms[side]
			J.append(("arm_" + side, "worker_root", translate(arm["shoulder"])))
			J.append(("claw_" + side, "arm_" + side, translate(arm["wrist"])))
		J.append(("drill", "claw_l", translate(self.arms["l"]["tip"])))
		for i, track in enumerate(self.tracks, 1):
			J.append(("track_%02d" % i, "worker_root", translate(track["center"])))
		# Pontos de encaixe: os das pontas seguem garra e broca.
		J.append(("prop_braco", "claw_r", translate(self.arms["r"]["tip"] + [0, -0.3, 0])))
		J.append(("prop_furadeira", "drill", translate(self.drill_tip)))
		# Poeira do trabalho no chão, à frente do robô. Ponto próprio: um prop
		# de variante substitui o que já estiver no mesmo ponto (a cúpula de
		# vidro fica em "root").
		J.append(("prop_dust", "worker_root", translate((0.0, -2.0, 0.1))))
		for name, point in self.props.items():
			if name not in ("prop_braco", "prop_furadeira"):
				J.append((name, "worker_root", translate(point)))
		self.joints = J
		self.names = [j[0] for j in J]
		self.parent = {j[0]: j[1] for j in J}
		self.rest_world = {j[0]: j[2] for j in J}
		self.order = [ARMATURE + "_" + n for n in self.names]

		joint_of = np.zeros(len(self.pos), int)
		index = {n: i for i, n in enumerate(self.names)}
		for side in ("l", "r"):
			arm = self.arms[side]
			joint_of[np.isin(self.part[:len(self.part)], [p for p in arm["parts"] if p != arm["claw"]]) .nonzero()[0]] = index["arm_" + side]
			joint_of[(self.part == arm["claw"]).nonzero()[0]] = index["claw_" + side]
		for i, track in enumerate(self.tracks, 1):
			joint_of[np.isin(self.part, track["parts"]).nonzero()[0]] = index["track_%02d" % i]
		joint_of[self.drill_start:] = index["drill"]
		self.joint_of = joint_of

	def local(self, name, world):
		parent = self.parent[name]
		return world if parent is None else np.linalg.inv(self.rest_world[parent]) @ world

	def pose(self, arm_l=0.0, arm_r=0.0, wrist_l=0.0, wrist_r=0.0, drill=0.0, tracks=0.0, bob=0.0):
		"""Ângulos em graus (braço: + = desce a ponta; punho: giro em Y), broca e
		rodinhas em voltas, bob = sobe e desce do corpo (m)."""
		out = {}
		for name in self.names:
			out[ARMATURE + "_" + name] = self.local(name, self.rest_world[name])
		out[ARMATURE + "_worker_root"] = translate((0, 0, bob))
		for side, angle, wrist in (("l", arm_l, wrist_l), ("r", arm_r, wrist_r)):
			m = out[ARMATURE + "_arm_" + side].copy()
			m[:3, :3] = rot("x", np.radians(angle))
			out[ARMATURE + "_arm_" + side] = m
			m = out[ARMATURE + "_claw_" + side].copy()
			m[:3, :3] = rot("y", np.radians(wrist))
			out[ARMATURE + "_claw_" + side] = m
		m = out[ARMATURE + "_drill"].copy()
		m[:3, :3] = rot("y", 2 * np.pi * drill)
		out[ARMATURE + "_drill"] = m
		for i in range(1, len(self.tracks) + 1):
			m = out[ARMATURE + "_track_%02d" % i].copy()
			m[:3, :3] = rot("x", 2 * np.pi * tracks)
			out[ARMATURE + "_track_%02d" % i] = m
		return out

	# -------------------------------------------------------------- animações
	def animations(self):
		def frames(count, f):
			return [f(i / count) for i in range(count + 1)]

		s = lambda t, k=1, phase=0: np.sin(2 * np.pi * (k * t + phase))
		strike = lambda t, at: np.exp(-((t - at) * 14) ** 2)
		track_cycle = 2 * np.pi * float(np.median([t["radius"] for t in self.tracks]))
		self.move_distance = track_cycle
		return {
			"idle": (frames(60, lambda t: self.pose(arm_l=3 * s(t), arm_r=-3 * s(t, 1, 0.3), wrist_l=6 * s(t, 1, 0.1),
				wrist_r=-6 * s(t), bob=0.03 * s(t, 2))), None),
			# Andando: só as rodinhas giram; braços parados na posição de repouso.
			"move": (frames(24, lambda t: self.pose(tracks=t)), None),
			# Martelada do braço direito no meio do ciclo (event 0.5); a broca gira
			# encostada na obra.
			"build": (frames(36, lambda t: self.pose(
				arm_l=10 + 2 * s(t, 6), arm_r=-22 + 40 * strike(t, 0.5) + 10 * t * (1 - t),
				wrist_r=25 * strike(t, 0.5), drill=4 * t, bob=-0.05 * strike(t, 0.5))), 0.5),
			# Broca descendo e girando; o braço direito recolhe o material.
			"work_drill": (frames(30, lambda t: self.pose(
				arm_l=14 + 6 * s(t) + 1.5 * s(t, 10), arm_r=8 + 16 * s(t, 1, 0.5), wrist_r=-30 * s(t, 1, 0.5),
				drill=5 * t, bob=0.03 * s(t, 10))), 0.4),
			# Colheita: braços alternando, punhos virando para pegar.
			"work_pick": (frames(36, lambda t: self.pose(
				arm_l=8 + 14 * s(t), arm_r=8 - 14 * s(t), wrist_l=35 * s(t, 1, 0.25), wrist_r=-35 * s(t, 1, 0.25),
				bob=0.03 * s(t, 2))), 0.5),
		}

	# ------------------------------------------------------------------ malha
	def build_text(self):
		text = self.text
		for array_id, data in ((self.pos_id, self.pos), (self.nor_id, self.nor)):
			text = re.sub(r'(<float_array id="%s" count=")\d+(">)[^<]*' % re.escape(array_id),
				lambda m: m.group(1) + str(data.size) + m.group(2) + fmt(data), text)
			text = re.sub(r'(<accessor source="#%s" count=")\d+(")' % re.escape(array_id),
				lambda m: m.group(1) + str(len(data)) + m.group(2), text)
		text = re.sub(r'(<triangles[^>]*count=")\d+(")', lambda m: m.group(1) + str(len(self.tri)) + m.group(2), text, count=1)
		text = re.sub(r"(<triangles[^>]*>.*?<p>)[^<]*(</p>)",
			lambda m: m.group(1) + " ".join(map(str, self.tri.ravel())) + m.group(2), text, count=1, flags=re.S)

		inverse = np.array([np.linalg.inv(self.rest_world[n]) for n in self.names])
		geometry = re.search(r'<geometry id="([^"]+)"', text).group(1)
		material = re.search(r"<bind_material>.*?</bind_material>", text, re.S).group(0)
		count, n = len(self.names), len(self.pos)
		controller = (
			'  <library_controllers>\n'
			'    <controller id="worker-skin" name="{a}">\n'
			'      <skin source="#{g}">\n'
			'        <bind_shape_matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</bind_shape_matrix>\n'
			'        <source id="worker-skin-joints">\n'
			'          <Name_array id="worker-skin-joints-array" count="{c}">{names}</Name_array>\n'
			'          <technique_common><accessor source="#worker-skin-joints-array" count="{c}" stride="1"><param name="JOINT" type="name"/></accessor></technique_common>\n'
			'        </source>\n'
			'        <source id="worker-skin-bind_poses">\n'
			'          <float_array id="worker-skin-bind_poses-array" count="{c16}">{inv}</float_array>\n'
			'          <technique_common><accessor source="#worker-skin-bind_poses-array" count="{c}" stride="16"><param name="TRANSFORM" type="float4x4"/></accessor></technique_common>\n'
			'        </source>\n'
			'        <source id="worker-skin-weights">\n'
			'          <float_array id="worker-skin-weights-array" count="1">1</float_array>\n'
			'          <technique_common><accessor source="#worker-skin-weights-array" count="1" stride="1"><param name="WEIGHT" type="float"/></accessor></technique_common>\n'
			'        </source>\n'
			'        <joints>\n'
			'          <input semantic="JOINT" source="#worker-skin-joints"/>\n'
			'          <input semantic="INV_BIND_MATRIX" source="#worker-skin-bind_poses"/>\n'
			'        </joints>\n'
			'        <vertex_weights count="{n}">\n'
			'          <input semantic="JOINT" source="#worker-skin-joints" offset="0"/>\n'
			'          <input semantic="WEIGHT" source="#worker-skin-weights" offset="1"/>\n'
			'          <vcount>{vcount}</vcount>\n'
			'          <v>{v}</v>\n'
			'        </vertex_weights>\n'
			'      </skin>\n'
			'    </controller>\n'
			'  </library_controllers>\n').format(a=ARMATURE, g=geometry, c=count, c16=count * 16, names=" ".join(self.names),
				inv=fmt(inverse), n=n, vcount=" ".join(["1"] * n), v=" ".join("%d 0" % j for j in self.joint_of))

		children = {}
		for name, parent, _ in self.joints:
			children.setdefault(parent, []).append(name)

		def joint(name):
			nid = ARMATURE + "_" + name
			return ('<node id="{i}" name="{n}" sid="{n}" type="JOINT">\n<matrix sid="transform">{m}</matrix>\n{c}</node>\n'
				.format(i=nid, n=name, m=fmt(self.local(name, self.rest_world[name])),
					c="".join(joint(c) for c in children.get(name, []))))

		scene = ('<visual_scene id="Scene" name="Scene">\n'
			'<node id="{a}" name="{a}" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n'.format(a=ARMATURE) +
			joint("worker_root") +
			'<node id="worker" name="worker" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n'
			'<instance_controller url="#worker-skin">\n<skeleton>#{a}_worker_root</skeleton>\n'.format(a=ARMATURE) +
			material + '\n</instance_controller>\n</node>\n</node>\n</visual_scene>')
		text = re.sub(r"<visual_scene .*?</visual_scene>", lambda m: scene, text, count=1, flags=re.S)
		text = re.sub(r"\s*<library_animations>.*?</library_animations>", "", text, flags=re.S)
		return text.replace("  <library_visual_scenes>", controller + "  <library_animations>\n  </library_animations>\n  <library_visual_scenes>", 1)

	def skeleton_xml(self):
		children = {}
		for name, parent, _ in self.joints:
			children.setdefault(parent, []).append(name)

		def bones(name, target, depth):
			tab = "\t" * depth
			inner = "".join(bones(c, target, depth + 1) for c in children.get(name, []))
			tag = '<bone name="%s">' % name + ("<target>%s</target>" % name if target else "")
			return "%s%s\n%s%s</bone>\n" % (tab, tag, inner, tab) if inner else "%s%s</bone>\n" % (tab, tag)

		return ('<?xml version="1.0" encoding="utf-8"?>\n'
			'<!-- Robô operário (art/meshes/skeletal/worker_01_rigged.dae), gerado por\n'
			'     tools/animation/gen_worker.py. -->\n<skeletons>\n'
			'\t<standard_skeleton title="Worker" id="worker_01">\n' + bones("worker_root", False, 2) +
			'\t</standard_skeleton>\n\n\t<skeleton title="Worker" target="worker_01">\n'
			'\t\t<identifier>\n\t\t\t<root>worker_root</root>\n\t\t</identifier>\n' + bones("worker_root", True, 2) +
			'\t</skeleton>\n</skeletons>\n')

	def write(self):
		self.text = self.build_text()
		open(RIGGED, "w", encoding="utf-8").write(self.text.replace("  <library_animations>\n  </library_animations>\n", ""))
		os.makedirs(ANIM_DIR, exist_ok=True)
		self.events = {}
		for name, (poses, event) in self.animations().items():
			write_animation(self, os.path.join(ANIM_DIR, name + ".dae"), name, np.arange(len(poses)) / FPS, poses)
			self.events[name] = event
		open(SKELETON, "w", encoding="utf-8").write(self.skeleton_xml())
		print("gravado worker_01_rigged.dae (%d ossos) e %d animações" % (len(self.names), len(self.events)))


# ---------------------------------------------------------------- efeitos
PARTICLES = {
	"weld_sparks": ("Faíscas de solda/martelada na ponta da garra.", "sparks.png", "add", """    <constant name="emissionrate" value="60.0"/>
    <uniform name="lifetime" min="0.25" max="0.6"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.x" min="-3.0" max="3.0"/>
    <uniform name="velocity.y" min="0.5" max="4.0"/>
    <uniform name="velocity.z" min="-3.0" max="3.0"/>
    <uniform name="size" min="0.12" max="0.25"/>
    <constant name="color.r" value="1.0"/>
    <uniform name="color.g" min="0.75" max="0.95"/>
    <uniform name="color.b" min="0.35" max="0.6"/>
    <force y="-9.0"/>
"""),
	"weld_glow": ("Brilho branco-azulado da solda.", "flame_radiant.png", "add", """    <constant name="emissionrate" value="18.0"/>
    <uniform name="lifetime" min="0.05" max="0.12"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="size" min="0.35" max="0.6"/>
    <constant name="color.r" value="0.75"/>
    <constant name="color.g" value="0.88"/>
    <constant name="color.b" value="1.0"/>
"""),
	"drill_debris": ("Cascalho e pó arrancados pela broca.", "dust_128a.png", "over", """    <constant name="emissionrate" value="30.0"/>
    <uniform name="lifetime" min="0.5" max="1.0"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.x" min="-2.0" max="2.0"/>
    <uniform name="velocity.y" min="1.0" max="3.5"/>
    <uniform name="velocity.z" min="-2.0" max="2.0"/>
    <uniform name="velocity.angle" min="-2.0" max="2.0"/>
    <uniform name="size" min="0.15" max="0.35"/>
    <uniform name="color.r" min="0.45" max="0.6"/>
    <uniform name="color.g" min="0.32" max="0.42"/>
    <uniform name="color.b" min="0.25" max="0.32"/>
    <force y="-9.0"/>
"""),
	"work_dust": ("Poeira levantada pelo trabalho.", "dust_256a.png", "over", """    <constant name="emissionrate" value="6.0"/>
    <uniform name="lifetime" min="1.2" max="2.2"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.x" min="-0.6" max="0.6"/>
    <uniform name="velocity.y" min="0.2" max="0.9"/>
    <uniform name="velocity.z" min="-0.6" max="0.6"/>
    <uniform name="size" min="0.8" max="1.4"/>
    <constant name="size.growthRate" value="1.0"/>
    <uniform name="color.r" min="0.6" max="0.7"/>
    <uniform name="color.g" min="0.46" max="0.54"/>
    <uniform name="color.b" min="0.36" max="0.42"/>
"""),
	"harvest_mist": ("Borrifo de água e folhas na colheita da estufa.", "dust_128a.png", "over", """    <constant name="emissionrate" value="14.0"/>
    <uniform name="lifetime" min="0.6" max="1.2"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.x" min="-1.0" max="1.0"/>
    <uniform name="velocity.y" min="0.3" max="1.5"/>
    <uniform name="velocity.z" min="-1.0" max="1.0"/>
    <uniform name="size" min="0.15" max="0.3"/>
    <uniform name="color.r" min="0.35" max="0.5"/>
    <uniform name="color.g" min="0.6" max="0.75"/>
    <uniform name="color.b" min="0.3" max="0.45"/>
    <force y="-4.0"/>
"""),
}

# variante (nome da animação no jogo) -> (arquivo, [(efeito, ponto)])
WORK = [
	("build", "build", [("weld_sparks", "braco"), ("weld_glow", "braco"), ("drill_debris", "furadeira"), ("work_dust", "dust")]),
	("gather_rock", "work_drill", [("drill_debris", "furadeira"), ("weld_sparks", "furadeira"), ("work_dust", "dust")]),
	("gather_ore", "work_drill", [("drill_debris", "furadeira"), ("weld_sparks", "furadeira"), ("work_dust", "dust")]),
	("gather_ruins", "work_drill", [("drill_debris", "furadeira"), ("weld_sparks", "furadeira"), ("work_dust", "dust")]),
	("gather_tree", "work_drill", [("drill_debris", "furadeira"), ("work_dust", "dust")]),
	("gather_grain", "work_pick", [("harvest_mist", "braco"), ("harvest_mist", "furadeira")]),
	("gather_fruit", "work_pick", [("harvest_mist", "braco"), ("harvest_mist", "furadeira")]),
	("gather_meat", "work_pick", [("work_dust", "dust")]),
]


def write_particles():
	for name, (comment, texture, blend, body) in PARTICLES.items():
		open(os.path.join(MOD, "art/particles/worker_%s.xml" % name), "w", encoding="utf-8").write(
			'<?xml version="1.0" encoding="utf-8"?>\n<!-- %s (gen_worker.py) -->\n<particles>\n'
			'    <texture>art/textures/particles/%s</texture>\n    <blend mode="%s"/>\n\n%s</particles>\n' % (comment, texture, blend, body))
		open(os.path.join(MOD, "art/actors/particle/worker_%s.xml" % name), "w", encoding="utf-8").write(
			'<?xml version="1.0" encoding="utf-8"?>\n<actor version="1">\n  <group>\n    <variant name="Base">\n'
			'      <particles file="worker_%s.xml"/>\n    </variant>\n  </group>\n'
			'  <material>basic_trans.xml</material>\n</actor>\n' % name)


def update_actor(rel, worker):
	path = os.path.join(MOD, "art/actors", rel)
	text = open(path, encoding="utf-8").read()
	speed = round(100 / worker.move_distance)
	anims = ['<animation file="units/worker/idle.dae" name="Idle" speed="100"/>',
		'<!-- Uma volta das rodinhas por ciclo: speed %d faz a esteira não patinar. -->' % speed,
		'<animation file="units/worker/move.dae" name="Walk" speed="%d"/>' % speed,
		'<animation file="units/worker/move.dae" name="Run" speed="%d"/>' % speed]
	for variant, anim, _ in WORK:
		event = worker.events[anim]
		anims.append('<animation event="%g" file="units/worker/%s.dae" name="%s" speed="100"/>' % (event, anim, variant))
	block = ('{i}<!-- animações: gen_worker.py -->\n{i}<mesh>skeletal/worker_01_rigged.dae</mesh>\n{i}<animations>\n' +
		"".join("{i}\t" + a + "\n" for a in anims) + '{i}</animations>')
	text, count = re.subn(r"([ \t]*)(?:<!-- animações: gen_worker.py -->.*?</animations>|<mesh>skeletal/worker_01\.dae</mesh>)",
		lambda m: block.format(i=m.group(1)), text, count=1, flags=re.S)
	if not count:
		sys.exit(rel + " não usa skeletal/worker_01.dae")

	effects = "  <!-- efeitos de trabalho: gen_worker.py -->\n  <group>\n    <variant frequency=\"1\" name=\"Idle\"/>\n"
	for variant, _, props in WORK:
		effects += '    <variant name="%s">\n      <props>\n' % variant
		effects += "".join('        <prop actor="particle/worker_%s.xml" attachpoint="%s"/>\n' % p for p in props)
		effects += "      </props>\n    </variant>\n"
	effects += "  </group>\n"
	text = re.sub(r"  <!-- efeitos de trabalho: gen_worker.py -->\n.*?</group>\n", "", text, flags=re.S)
	text = text.replace("  <material>", effects + "  <material>", 1)
	open(path, "w", encoding="utf-8").write(text)
	print("actor:", rel)


def retint():
	sys.dont_write_bytecode = True
	argv, sys.argv = sys.argv, ["gen_factions"]
	spec = importlib.util.spec_from_file_location("gen_factions", os.path.join(MOD, "tools/factions/gen_factions.py"))
	factions = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(factions)
	sys.argv = argv
	wanted = {"art/actors/units/%s/worker.xml" % civ for _, civ in RETINTED}
	write = factions.write_bytes

	def only_workers(rel, data, body=None, actor_path=None):
		if rel in wanted:
			print("  cópia retinta:", rel, "" if write(rel, data, body, actor_path) else "(editada à mão, mantida)")
		return True

	factions.write_bytes = only_workers
	for base, civ in RETINTED:
		factions.tinted_actor(base, civ)
	json.dump(factions.MANIFEST, open(factions.MANIFEST_PATH, "w", encoding="utf-8"), indent="\t", sort_keys=True)


def preview(worker, folder):
	"""Folha com alguns quadros de cada animação (vista de 3/4)."""
	from PIL import Image, ImageDraw
	os.makedirs(folder, exist_ok=True)
	anims = worker.animations()
	W, H = 260, 300
	rows = list(anims.items())
	sheet = Image.new("RGB", (W * 4, H * len(rows)), (24, 24, 28))
	d = ImageDraw.Draw(sheet)
	inverse = {ARMATURE + "_" + n: np.linalg.inv(worker.rest_world[n]) for n in worker.names}
	yaw, pitch = np.radians(-40), np.radians(15)
	V = rot("x", pitch) @ rot("z", yaw)
	tri = worker.tri[:, :, 0]
	for r, (name, (poses, _)) in enumerate(rows):
		for c in range(4):
			frame = poses[int(c * (len(poses) - 1) / 4)]
			world = {}
			for n in worker.names:
				nid = ARMATURE + "_" + n
				parent = worker.parent[n]
				world[nid] = frame[nid] if parent is None else world[ARMATURE + "_" + parent] @ frame[nid]
			skin = np.array([world[ARMATURE + "_" + n] @ inverse[ARMATURE + "_" + n] for n in worker.names])
			p = np.einsum("nij,nj->ni", skin[worker.joint_of], np.c_[worker.pos, np.ones(len(worker.pos))])[:, :3] @ V.T
			t = p[tri]
			nrm = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
			nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-9
			shade = 0.35 + 0.65 * np.abs(nrm[:, 1])
			for i in np.argsort(-t[:, :, 1].mean(axis=1)):
				j = worker.joint_of[tri[i, 0]]
				base = (90, 150, 220) if worker.names[j].startswith("arm") else (230, 160, 60) if worker.names[j].startswith("claw") \
					else (230, 70, 70) if worker.names[j] == "drill" else (160, 160, 168)
				d.polygon([(c * W + W / 2 + q[0] * 26, r * H + H * 0.8 - q[2] * 26) for q in t[i]],
					fill=tuple(int(x * shade[i]) for x in base))
			d.text((c * W + 4, r * H + 4), "%s %d" % (name, c), fill=(230, 230, 230))
	sheet.save(os.path.join(folder, "worker_anims.png"))
	print("prévia:", os.path.join(folder, "worker_anims.png"))


def main():
	worker = Worker()
	worker.write()
	write_particles()
	for rel in ACTORS:
		update_actor(rel, worker)
	retint()
	if "--preview" in sys.argv:
		preview(worker, sys.argv[sys.argv.index("--preview") + 1])


if __name__ == "__main__":
	main()

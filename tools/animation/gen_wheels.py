#!/usr/bin/env python3
"""Rodas girando nos veículos de rodas do mod.

Para cada malha em VEHICLES (art/meshes/vehicle/<nome>.dae):
  - incorpora a transformação do objeto (escala/posição que vieram do
    Blender) nos vértices;
  - acha as rodas sozinho (partes soltas redondas no plano YZ, perto do chão,
    mais finas em X do que altas) e junta calotas e cubos à roda do mesmo eixo;
  - cria um esqueleto: a raiz, um osso por eixo (as rodas da esquerda e da
    direita giram no mesmo osso, em x = 0) e os pontos de encaixe (prop_*);
  - grava a malha com esqueleto, as animações idle/move e o esqueleto, e
    troca a malha nos actors listados (com as animações Idle/Walk/Run).

Gera, por veículo:
  art/meshes/vehicle/<nome>_rigged.dae
  art/animation/vehicle/<nome>/idle.dae e move.dae   (move = uma volta das rodas)
  art/skeletons/<nome>.xml

As malhas originais não são alteradas: ao reexportar do Blender, rode de novo.
As cópias retintas das facções (gen_factions.py) são refeitas a partir dos
actors base.

Uso (na pasta do mod):  python3 tools/animation/gen_wheels.py
"""
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dae_rig import fmt, write_animation  # noqa: E402

MOD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# malha -> actors feitos à mão que a usam (as cópias retintas vêm de RETINTED).
VEHICLES = {
	"coyote": ["vehicle/mla/coyote.xml", "vehicle/mla/coyote_drone.xml", "vehicle/coa/kutu.xml"],
	"kutu": ["vehicle/mla/kutu.xml"],
	"cavelion": ["vehicle/mcc/cavelion.xml"],
	"titan": ["vehicle/coa/titan_packed.xml", "vehicle/coa/titan_unpacked.xml"],
}
# Cópias retintas: (actor base, civ), refeitas pelo gerador de facções.
RETINTED = [("vehicle/mla/coyote.xml", "ares"), ("vehicle/mla/coyote.xml", "pira"),
	("vehicle/mla/kutu.xml", "pira"), ("vehicle/mcc/cavelion.xml", "coa")]

MOVE_FRAMES = 16
FPS = 30.0
MAX_BONES = 64


def axis_x(angle):
	c, s = np.cos(angle), np.sin(angle)
	return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


class Vehicle:
	def __init__(self, name):
		self.name = name
		self.path = os.path.join(MOD, "art", "meshes", "vehicle", name + ".dae")
		self.text = open(self.path, encoding="utf-8").read()
		self.read_mesh()
		self.bake()
		self.find_wheels()
		self.find_props()
		bone = getattr(self, "BONE", "wheel")
		# A raiz tem o nome do veículo: o conversor do jogo escolhe o esqueleto
		# pelo nome do osso raiz, então ele precisa ser único entre os esqueletos.
		self.names = [name + "_root"] + ["%s_%02d" % (bone, i + 1) for i in range(len(self.wheels))] + [n for n, _ in self.props]
		if len(self.names) > MAX_BONES:
			sys.exit("%s: %d ossos (limite %d)" % (name, len(self.names), MAX_BONES))
		self.armature = name.capitalize() + "Armature"
		self.order = [self.armature + "_" + n for n in self.names]
		self.rigged = self.build_text()

	# ------------------------------------------------------------- leitura
	def read_mesh(self):
		def source(kind):
			m = re.search(r'<float_array id="([^"]*-%s-array)" count="\d+">([^<]*)<' % kind, self.text)
			return m.group(1), np.array(m.group(2).split(), float).reshape(-1, 3)

		self.pos_id, self.pos = source("positions")
		self.nor_id, self.nor = source("normals")
		block = re.search(r"<triangles[^>]*>(.*?)</triangles>", self.text, re.S).group(1)
		inputs = re.findall(r'<input semantic="(\w+)"[^>]*offset="(\d+)"', block)
		offsets = {semantic: int(offset) for semantic, offset in inputs}
		if offsets.get("VERTEX") != 0 or offsets.get("NORMAL") != 1:
			sys.exit("%s: esperava VERTEX no offset 0 e NORMAL no 1" % self.name)
		stride = max(int(o) for _, o in inputs) + 1
		self.tri = np.array(re.search(r"<p>([^<]*)</p>", block).group(1).split(), int).reshape(-1, 3, stride)[:, :, 0]
		if len(re.findall(r"<triangles", self.text)) != 1:
			sys.exit("%s: esperava um só bloco de triângulos" % self.name)

	def bake(self):
		"""Aplica a matriz do objeto da malha aos vértices e normais."""
		node = re.search(r'<node id="([^"]+)"[^>]*>\s*<matrix sid="transform">([^<]*)</matrix>\s*<instance_geometry', self.text)
		self.mesh_matrix = np.array(node.group(2).split(), float).reshape(4, 4)
		M = self.mesh_matrix
		self.pos = np.c_[self.pos, np.ones(len(self.pos))] @ M.T
		self.pos = self.pos[:, :3]
		normal_matrix = np.linalg.inv(M[:3, :3]).T
		self.nor = self.nor @ normal_matrix.T
		self.nor /= np.linalg.norm(self.nor, axis=1)[:, None] + 1e-12

	def parts(self):
		ids = {}
		vid = np.array([ids.setdefault(tuple(np.round(v, 4)), len(ids)) for v in self.pos])
		parent = list(range(len(ids)))

		def find(x):
			while parent[x] != x:
				parent[x] = parent[parent[x]]
				x = parent[x]
			return x

		for a, b, c in vid[self.tri]:
			parent[find(a)] = find(b)
			parent[find(b)] = find(c)
		return np.array([find(v) for v in vid])

	def find_wheels(self):
		part = self.parts()
		height = np.ptp(self.pos[:, 2])
		ground = self.pos[:, 2].min()
		candidates = []
		for label in np.unique(part):
			v = self.pos[part == label]
			lo, hi = v.min(axis=0), v.max(axis=0)
			size = hi - lo
			center = (lo + hi) / 2
			# Redonda em YZ, mais fina em X que alta, encostando no chão (estepes e
			# peças redondas da carroceria ficam de fora), longe do eixo central.
			if abs(size[1] - size[2]) < 0.3 * size[2] and size[0] < size[2] and size[2] > 0.08 * height \
					and lo[2] - ground < 0.15 * size[2] and abs(center[0]) > 0.1 * np.ptp(self.pos[:, 0]):
				candidates.append({"labels": [label], "center": center, "radius": size[2] / 2})

		# Esquerda e direita (mesmo Y e Z) e calotas no mesmo eixo: um osso só.
		axles = []
		for wheel in sorted(candidates, key=lambda w: -w["radius"]):
			same = next((a for a in axles if np.linalg.norm(a["center"][1:] - wheel["center"][1:]) < 0.25 * a["radius"]), None)
			if same:
				same["labels"] += wheel["labels"]
			else:
				axles.append({"labels": list(wheel["labels"]), "center": np.array([0.0, *wheel["center"][1:]]),
					"radius": wheel["radius"]})
		if not axles:
			sys.exit("%s: nenhuma roda encontrada" % self.name)
		self.wheels = sorted(axles, key=lambda a: a["center"][1])
		self.joint_of_vertex = np.zeros(len(self.pos), int)
		for j, axle in enumerate(self.wheels, 1):
			self.joint_of_vertex[np.isin(part, axle["labels"])] = j

		# Uma volta da roda principal por ciclo; as outras dão voltas inteiras
		# (o mais perto do que andariam), para o ciclo emendar sem salto.
		self.cycle = 2 * np.pi * float(np.median([a["radius"] for a in self.wheels]))
		for axle in self.wheels:
			axle["turn"] = max(1, round(self.cycle / (2 * np.pi * axle["radius"]))) * 2 * np.pi

	def find_props(self):
		"""Pontos de encaixe (filhos do objeto da malha), já sem escala."""
		self.props = []
		for name, m in re.findall(r'<node id="(prop_[^"]+)"[^>]*>\s*<matrix sid="transform">([^<]*)</matrix>', self.text):
			world = self.mesh_matrix @ np.array(m.split(), float).reshape(4, 4)
			clean = np.eye(4)
			clean[:3, 3] = world[:3, 3]
			self.props.append((name, clean))

	# ------------------------------------------------------------------ poses
	def rest(self):
		out = {self.order[0]: np.eye(4)}
		for nid, axle in zip(self.order[1:], self.wheels):
			m = np.eye(4)
			m[:3, 3] = axle["center"]
			out[nid] = m
		for nid, (_, m) in zip(self.order[1 + len(self.wheels):], self.props):
			out[nid] = m.copy()
		return out

	def pose(self, cycle):
		"""Rodas giradas `cycle` ciclos para a frente (-Y): sentido positivo em +X."""
		out = self.rest()
		for nid, axle in zip(self.order[1:], self.wheels):
			out[nid][:3, :3] = axis_x(cycle * axle["turn"])
		return out

	# ------------------------------------------------------------------ malha
	def build_text(self):
		text = self.text
		for array_id, data in ((self.pos_id, self.pos), (self.nor_id, self.nor)):
			text = re.sub(r'(<float_array id="%s" count=")\d+(">)[^<]*' % re.escape(array_id),
				lambda m: m.group(1) + str(data.size) + m.group(2) + fmt(data), text)

		rest = self.rest()
		inverse = np.array([np.linalg.inv(rest[nid] if nid == self.order[0] else rest[self.order[0]] @ rest[nid])
			for nid in self.order])
		geometry = re.search(r'<geometry id="([^"]+)"', text).group(1)
		material = re.search(r"<bind_material>.*?</bind_material>", text, re.S).group(0)
		skin = self.name + "-skin"
		count, n = len(self.names), len(self.pos)
		controller = (
			'  <library_controllers>\n'
			'    <controller id="{s}" name="{a}">\n'
			'      <skin source="#{g}">\n'
			'        <bind_shape_matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</bind_shape_matrix>\n'
			'        <source id="{s}-joints">\n'
			'          <Name_array id="{s}-joints-array" count="{c}">{names}</Name_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#{s}-joints-array" count="{c}" stride="1"><param name="JOINT" type="name"/></accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="{s}-bind_poses">\n'
			'          <float_array id="{s}-bind_poses-array" count="{c16}">{inv}</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#{s}-bind_poses-array" count="{c}" stride="16"><param name="TRANSFORM" type="float4x4"/></accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="{s}-weights">\n'
			'          <float_array id="{s}-weights-array" count="1">1</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#{s}-weights-array" count="1" stride="1"><param name="WEIGHT" type="float"/></accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <joints>\n'
			'          <input semantic="JOINT" source="#{s}-joints"/>\n'
			'          <input semantic="INV_BIND_MATRIX" source="#{s}-bind_poses"/>\n'
			'        </joints>\n'
			'        <vertex_weights count="{n}">\n'
			'          <input semantic="JOINT" source="#{s}-joints" offset="0"/>\n'
			'          <input semantic="WEIGHT" source="#{s}-weights" offset="1"/>\n'
			'          <vcount>{vcount}</vcount>\n'
			'          <v>{v}</v>\n'
			'        </vertex_weights>\n'
			'      </skin>\n'
			'    </controller>\n'
			'  </library_controllers>\n').format(s=skin, a=self.armature, g=geometry, c=count, c16=count * 16,
				names=" ".join(self.names), inv=fmt(inverse), n=n, vcount=" ".join(["1"] * n),
				v=" ".join("%d 0" % j for j in self.joint_of_vertex))

		def joint(nid, children=""):
			name = nid[len(self.armature) + 1:]
			return ('<node id="{i}" name="{n}" sid="{n}" type="JOINT">\n<matrix sid="transform">{m}</matrix>\n{c}</node>\n'
				.format(i=nid, n=name, m=fmt(rest[nid]), c=children))

		scene = (
			'<visual_scene id="Scene" name="Scene">\n'
			'<node id="{a}" name="{a}" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n'.format(a=self.armature) +
			joint(self.order[0], "".join(joint(nid) for nid in self.order[1:])) +
			'<node id="{n}" name="{n}" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n'
			'<instance_controller url="#{s}">\n'
			'<skeleton>#{r}</skeleton>\n'.format(n=self.name, s=skin, r=self.order[0]) + material + '\n'
			'</instance_controller>\n</node>\n</node>\n</visual_scene>')
		text = re.sub(r"<visual_scene .*?</visual_scene>", lambda m: scene, text, count=1, flags=re.S)
		# write_animation troca a library_animations: deixa uma vazia no lugar.
		text = re.sub(r"\s*<library_animations>.*?</library_animations>", "", text, flags=re.S)
		return text.replace("  <library_visual_scenes>", controller + "  <library_animations>\n  </library_animations>\n  <library_visual_scenes>", 1)

	# --------------------------------------------------------------- gravação
	def skeleton_xml(self):
		children = "".join('\t\t\t<bone name="%s"></bone>\n' % n for n in self.names[1:])
		targets = "".join('\t\t\t<bone name="%s"><target>%s</target></bone>\n' % (n, n) for n in self.names[1:])
		title = self.name.capitalize()
		return ('<?xml version="1.0" encoding="utf-8"?>\n'
			'<!-- %s com rodas animadas (art/meshes/vehicle/%s_rigged.dae), gerado por\n'
			'     tools/animation/gen_wheels.py. -->\n'
			'<skeletons>\n'
			'\t<standard_skeleton title="%s" id="%s">\n'
			'\t\t<bone name="{r}">\n%s\t\t</bone>\n'
			'\t</standard_skeleton>\n\n'
			'\t<skeleton title="%s" target="%s">\n'
			'\t\t<identifier>\n\t\t\t<root>{r}</root>\n\t\t</identifier>\n'
			'\t\t<bone name="{r}"><target>{r}</target>\n%s\t\t</bone>\n'
			'\t</skeleton>\n'
			'</skeletons>\n').replace("{r}", self.names[0]) % (title, self.name, title, self.name, children, title, self.name, targets)

	def write(self):
		anim_dir = os.path.join(MOD, "art", "animation", "vehicle", self.name)
		os.makedirs(anim_dir, exist_ok=True)
		rigged = os.path.join(MOD, "art", "meshes", "vehicle", self.name + "_rigged.dae")
		open(rigged, "w", encoding="utf-8").write(self.rigged.replace("  <library_animations>\n  </library_animations>\n", ""))
		self.text = self.rigged
		frames = {"idle": [self.pose(0) for _ in range(2)],
			"move": [self.pose(i / MOVE_FRAMES) for i in range(MOVE_FRAMES + 1)]}
		for name, poses in frames.items():
			write_animation(self, os.path.join(anim_dir, name + ".dae"), name, np.arange(len(poses)) / FPS, poses)
		skeleton = os.path.join(MOD, "art", "skeletons", self.name + ".xml")
		open(skeleton, "w", encoding="utf-8").write(self.skeleton_xml())
		self.speed = round(100 / self.cycle)
		print("%-9s %d eixos (raios %s), %d ossos; uma volta = %.2f m -> speed=\"%d\"" % (
			self.name, len(self.wheels), ", ".join("%.2f" % a["radius"] for a in self.wheels),
			len(self.names), self.cycle, self.speed))


def update_actor(rel, vehicle):
	"""Troca a malha do actor pela versão com esqueleto e põe as animações."""
	path = os.path.join(MOD, "art", "actors", rel)
	text = open(path, encoding="utf-8").read()
	# Na primeira vez troca a linha da malha; nas seguintes, o bloco inteiro
	# já gravado por este script.
	pattern = r"([ \t]*)(?:<!-- rodas: gen_wheels.py -->.*?</animations>|<mesh>vehicle/%s\.dae</mesh>)" % vehicle.name

	def replace(m):
		ind = m.group(1)
		return ('{i}<!-- rodas: gen_wheels.py -->\n'
			'{i}<mesh>vehicle/{n}_rigged.dae</mesh>\n'
			'{i}<animations>\n'
			'{i}\t<animation file="vehicle/{n}/idle.dae" name="Idle" speed="100"/>\n'
			'{i}\t<!-- Uma volta das rodas por ciclo (~{c:.1f} m): speed {s} faz as rodas\n'
			'{i}\t     rolarem sem patinar em qualquer velocidade. -->\n'
			'{i}\t<animation file="vehicle/{n}/move.dae" name="Walk" speed="{s}"/>\n'
			'{i}\t<animation file="vehicle/{n}/move.dae" name="Run" speed="{s}"/>\n'
			'{i}</animations>').format(i=ind, n=vehicle.name, c=vehicle.cycle, s=vehicle.speed)

	text, count = re.subn(pattern, replace, text, count=1, flags=re.S)
	if not count:
		print("  ! %s não usa vehicle/%s.dae" % (rel, vehicle.name))
		return
	open(path, "w", encoding="utf-8").write(text)
	print("  actor:", rel)


def main():
	for name, actors in VEHICLES.items():
		vehicle = Vehicle(name)
		vehicle.write()
		for actor in actors:
			update_actor(actor, vehicle)

	# Cópias retintas das facções: refeitas a partir dos actors base.
	import importlib.util
	import json
	sys.dont_write_bytecode = True
	argv, sys.argv = sys.argv, ["gen_factions"]
	spec = importlib.util.spec_from_file_location("gen_factions", os.path.join(MOD, "tools", "factions", "gen_factions.py"))
	factions = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(factions)
	sys.argv = argv
	wanted = {"art/actors/vehicle/%s/%s" % (civ, os.path.basename(base)) for base, civ in RETINTED}
	write = factions.write_bytes

	def only_vehicles(rel, data, body=None, actor_path=None):
		if rel in wanted:
			print("  cópia retinta:", rel, "" if write(rel, data, body, actor_path) else "(editada à mão, mantida)")
		return True

	factions.write_bytes = only_vehicles
	for base, civ in RETINTED:
		factions.tinted_actor(base, civ)
	json.dump(factions.MANIFEST, open(factions.MANIFEST_PATH, "w", encoding="utf-8"), indent="\t", sort_keys=True)


if __name__ == "__main__":
	main()

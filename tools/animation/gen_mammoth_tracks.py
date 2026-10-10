#!/usr/bin/env python3
"""Lagartas animadas do Mammoth (veículo pesado do mcc).

A malha (art/meshes/vehicle/mammoth.dae) tem quatro lagartas lisas (frente e
trás de cada lado) com rodas octogonais dentro. Uma faixa lisa girando não
mostra movimento, então este script:

  - acrescenta sapatas (garras) em volta de cada lagarta, cada uma presa a um
    osso que corre pelo contorno dela;
  - prende cada roda a um osso que gira no próprio eixo.

Os ossos ficam em x = 0 e servem aos dois lados ao mesmo tempo (as lagartas e
rodas da esquerda e da direita são espelhadas), o que mantém o esqueleto com
menos de 64 ossos.

Gera:
  art/meshes/vehicle/mammoth_rigged.dae      malha + sapatas + esqueleto
  art/animation/vehicle/mammoth/idle.dae     parado
  art/animation/vehicle/mammoth/move.dae     um ciclo: as sapatas andam duas
                                             posições e as rodas giram junto
  art/skeletons/mammoth.xml                  esqueleto

mammoth.dae não é alterada: ao reexportar o modelo do Blender, basta rodar este
script de novo (lagartas e rodas são achadas sozinhas, pela forma).

Uso:  python3 tools/animation/gen_mammoth_tracks.py [--preview pasta]
"""
import os
import re
import sys

import numpy as np
from scipy.spatial import ConvexHull

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dae_rig import fmt, write_animation  # noqa: E402

MOD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MESH = os.path.join(MOD, "art", "meshes", "vehicle", "mammoth.dae")
RIGGED = os.path.join(MOD, "art", "meshes", "vehicle", "mammoth_rigged.dae")
ANIM_DIR = os.path.join(MOD, "art", "animation", "vehicle", "mammoth")
SKELETON = os.path.join(MOD, "art", "skeletons", "mammoth.xml")

# Sapatas: espaçamento aproximado, comprimento ao longo da lagarta e altura.
PITCH = 1.1
CLEAT_LENGTH = 0.45
CLEAT_HEIGHT = 0.16
# O ciclo da animação "move" anda este tanto de sapatas.
CYCLE_PITCHES = 2
MOVE_FRAMES = 12
FPS = 30.0
MAX_BONES = 64


def axis_x(angle):
	c, s = np.cos(angle), np.sin(angle)
	return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


def matrix(rotation, translation):
	m = np.eye(4)
	m[:3, :3] = rotation
	m[:3, 3] = translation
	return m


class Mesh:
	"""Fontes e triângulos da primeira malha do .dae (VERTEX, NORMAL, TEXCOORD)."""

	def __init__(self, path):
		self.text = open(path, encoding="utf-8").read()

		def source(kind):
			m = re.search(r'<float_array id="([^"]*-%s-array)" count="\d+">([^<]*)<' % kind, self.text)
			return m.group(1), np.array(m.group(2).split(), float)

		self.pos_id, pos = source("positions")
		self.nor_id, nor = source("normals")
		self.uv_id, uv = source("map-0")
		self.pos, self.nor, self.uv = pos.reshape(-1, 3), nor.reshape(-1, 3), uv.reshape(-1, 2)
		block = re.search(r"<triangles[^>]*>(.*?)</triangles>", self.text, re.S).group(1)
		offsets = [int(o) for o in re.findall(r'offset="(\d+)"', block)]
		if offsets != [0, 1, 2]:
			sys.exit("mammoth.dae: esperava VERTEX, NORMAL e TEXCOORD com offsets 0, 1 e 2")
		self.tri = np.array(re.search(r"<p>([^<]*)</p>", block).group(1).split(), int).reshape(-1, 3, 3)

	def parts(self):
		"""Rótulo da parte solta (conexa) de cada vértice."""
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
		return np.array([find(v) for v in vid])


class Tracks:
	def __init__(self):
		self.mesh = Mesh(MESH)
		pos = self.mesh.pos
		part = self.mesh.parts()

		bands, wheels = [], []
		for label in np.unique(part):
			v = pos[part == label]
			lo, hi = v.min(axis=0), v.max(axis=0)
			size = hi - lo
			# Lagarta: faixa comprida no chão, estreita em X.
			if lo[2] < 0.2 and size[1] > 5 and size[0] < 2.5 and abs(lo[0] + hi[0]) > 4:
				bands.append(label)
			# Roda: redonda no plano YZ, mais fina em X do que larga, longe do centro.
			elif abs(size[1] - size[2]) < 0.3 * size[2] and size[0] < size[2] and 0.5 < size[2] < 3.5 \
					and abs(lo[0] + hi[0]) > 4:
				wheels.append(label)
		if len(bands) != 4:
			sys.exit("esperava 4 lagartas em mammoth.dae, achei %d" % len(bands))

		# Lagartas espelhadas (mesmo perfil YZ) viram um par: frente e trás.
		self.profiles = []
		for label in bands:
			v = pos[part == label]
			if v[:, 0].mean() < 0:
				continue
			mirror = [b for b in bands if pos[part == b][:, 0].mean() < 0 and
				abs(pos[part == b][:, 1].mean() - v[:, 1].mean()) < 0.5]
			self.profiles.append({"labels": [label] + mirror, "x": (v[:, 0].min(), v[:, 0].max())})
		self.profiles.sort(key=lambda p: pos[part == p["labels"][0]][:, 1].mean())

		# Só conta como roda o que fica dentro do contorno de uma lagarta (painéis
		# quadrados do casco também passam no teste de forma).
		inside = []
		for label in wheels:
			v = pos[part == label]
			center = (v.min(axis=0) + v.max(axis=0)) / 2
			for profile in self.profiles:
				band = pos[part == profile["labels"][0]]
				if band[:, 1].min() < center[1] < band[:, 1].max() and center[2] < band[:, 2].max():
					inside.append(label)
					break
		wheels = inside

		# Rodas espelhadas também viram um par, girando no mesmo osso.
		self.wheels = []
		used = set()
		for label in wheels:
			if label in used:
				continue
			v = pos[part == label]
			center = (v.min(axis=0) + v.max(axis=0)) / 2
			pair = [label]
			for other in wheels:
				o = pos[part == other]
				oc = (o.min(axis=0) + o.max(axis=0)) / 2
				if other != label and other not in used and abs(oc[0] + center[0]) < 0.3 and \
						np.linalg.norm(oc[1:] - center[1:]) < 0.15:
					pair.append(other)
			used.update(pair)
			radius = (np.ptp(v[:, 1]) + np.ptp(v[:, 2])) / 4
			self.wheels.append({"labels": pair, "center": np.array([0.0, center[1], center[2]]), "radius": radius})
		# Calotas e cubos no mesmo eixo de uma roda giram com ela (um osso só).
		merged = []
		for wheel in sorted(self.wheels, key=lambda w: -w["radius"]):
			same = next((m for m in merged if np.linalg.norm(m["center"][1:] - wheel["center"][1:]) < 0.2), None)
			if same:
				same["labels"] += wheel["labels"]
			else:
				merged.append(wheel)
		self.wheels = sorted(merged, key=lambda w: (w["center"][1], w["center"][2]))

		self.part = part
		self.build_paths()

		self.props = []
		for name, m in re.findall(r'<node id="(prop_[^"]+)"[^>]*>\s*<matrix sid="transform">([^<]*)</matrix>', self.mesh.text):
			self.props.append((name, np.array(m.split(), float).reshape(4, 4)))

		self.names = ["track_root"] + ["wheel_%02d" % (i + 1) for i in range(len(self.wheels))]
		for p, profile in enumerate(self.profiles):
			self.names += ["cleat_%s_%02d" % ("fr"[p] if len(self.profiles) == 2 else str(p), i + 1) for i in range(profile["count"])]
		self.names += [name for name, _ in self.props]
		if len(self.names) > MAX_BONES:
			sys.exit("esqueleto com %d ossos (limite %d): aumente PITCH" % (len(self.names), MAX_BONES))
		self.order = ["MammothArmature_" + n for n in self.names]
		self.text = self.build_text()

	# ---------------------------------------------------------------- contorno
	def build_paths(self):
		"""Contorno externo de cada lagarta no plano YZ, percorrido em sentido
		horário (vista de +X): assim o eixo X x tangente aponta para fora."""
		pos = self.mesh.pos
		for profile in self.profiles:
			v = pos[self.part == profile["labels"][0]][:, 1:]
			hull = v[ConvexHull(v).vertices][::-1]   # ConvexHull dá anti-horário
			closed = np.vstack([hull, hull[:1]])
			lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
			profile["corners"] = closed
			profile["cumulative"] = np.concatenate([[0], np.cumsum(lengths)])
			profile["length"] = profile["cumulative"][-1]
			profile["count"] = max(4, int(round(profile["length"] / PITCH)))
			profile["pitch"] = profile["length"] / profile["count"]

	def path_frame(self, profile, s):
		"""Matriz (no espaço do modelo) de uma sapata a `s` metros do início do
		contorno: X = largura, Y = tangente, Z = para fora."""
		s %= profile["length"]
		i = min(np.searchsorted(profile["cumulative"], s, side="right") - 1, len(profile["corners"]) - 2)
		a, b = profile["corners"][i], profile["corners"][i + 1]
		t = (s - profile["cumulative"][i]) / max(1e-9, profile["cumulative"][i + 1] - profile["cumulative"][i])
		point = a + (b - a) * t
		tangent = (b - a) / np.linalg.norm(b - a)
		outward = np.array([-tangent[1], tangent[0]])
		rotation = np.column_stack([[1, 0, 0], [0, tangent[0], tangent[1]], [0, outward[0], outward[1]]])
		center = point + outward * (CLEAT_HEIGHT / 2)
		return matrix(rotation, [0.0, center[0], center[1]])

	# ------------------------------------------------------------------- poses
	def rest(self):
		out = {self.order[0]: np.eye(4)}
		k = 1
		for wheel in self.wheels:
			out[self.order[k]] = matrix(np.eye(3), wheel["center"])
			k += 1
		for profile in self.profiles:
			for i in range(profile["count"]):
				out[self.order[k]] = self.path_frame(profile, i * profile["pitch"])
				k += 1
		for name, m in self.props:
			out[self.order[k]] = m.copy()
			k += 1
		return out

	def pose(self, cycle):
		"""Matrizes locais com o veículo andando `cycle` ciclos para a frente (-Y):
		embaixo as sapatas vão para trás (+Y) e as rodas giram em torno de +X."""
		out = self.rest()
		k = 1
		for wheel in self.wheels:
			out[self.order[k]][:3, :3] = axis_x(cycle * wheel["turn"])
			k += 1
		for profile in self.profiles:
			for i in range(profile["count"]):
				# Recuar no contorno (horário) leva as sapatas de cima para a frente (-Y) e as
				# de baixo para trás (+Y): no chão elas ficam paradas.
				shift = cycle * CYCLE_PITCHES * profile["pitch"]
				out[self.order[k]] = self.path_frame(profile, i * profile["pitch"] - shift)
				k += 1
		return out

	# ------------------------------------------------------------------ malha
	def cleat_geometry(self):
		"""Caixas das sapatas, já na pose de repouso: (posições, normais, osso,
		triângulos em índices locais)."""
		pos, nor, joint, tris = [], [], [], []
		box = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
		faces = [((0, 3, 2, 1), (0, 0, -1)), ((4, 5, 6, 7), (0, 0, 1)), ((0, 1, 5, 4), (0, -1, 0)),
			((2, 3, 7, 6), (0, 1, 0)), ((1, 2, 6, 5), (1, 0, 0)), ((0, 4, 7, 3), (-1, 0, 0))]
		rest = self.rest()
		k = 1 + len(self.wheels)
		for profile in self.profiles:
			x0, x1 = profile["x"]
			for i in range(profile["count"]):
				m = rest[self.order[k]]
				for side in (1, -1):
					xc, hx = side * (x0 + x1) / 2, (x1 - x0) / 2 + 0.03
					for quad, normal in faces:
						base = len(pos)
						for c in quad:
							local = np.array([xc + box[c][0] * hx, box[c][1] * CLEAT_LENGTH / 2, box[c][2] * CLEAT_HEIGHT / 2])
							pos.append(m[:3, :3] @ local + m[:3, 3])
							nor.append(m[:3, :3] @ np.array(normal, float))
							joint.append(k)
						tri_a, tri_b = (base, base + 1, base + 2), (base, base + 2, base + 3)
						if side < 0 and normal[0] == 0:
							pass
						tris += [tri_a, tri_b]
				k += 1
		return np.array(pos), np.array(nor), np.array(joint), np.array(tris)

	def track_uv(self):
		"""Coordenada de textura da lagarta (o meio da faixa, por baixo)."""
		labels = self.profiles[0]["labels"]
		tri_part = self.part[self.mesh.tri[:, 0, 0]]
		chosen = self.mesh.tri[np.isin(tri_part, labels)]
		heights = self.mesh.pos[chosen[:, :, 0]][:, :, 2].mean(axis=1)
		lowest = chosen[np.argmin(heights)]
		return self.mesh.uv[lowest[:, 2]].mean(axis=0)

	def build_text(self):
		mesh = self.mesh
		for wheel in self.wheels:
			# Giro por ciclo: o mais perto do que a lagarta anda, em múltiplos de
			# 45° (a roda é octogonal), para o ciclo emendar sem salto.
			ideal = CYCLE_PITCHES * self.profiles[0]["pitch"] / wheel["radius"]
			wheel["turn"] = max(1, round(ideal / (np.pi / 4))) * np.pi / 4

		joint_of_vertex = np.zeros(len(mesh.pos), int)
		for j, wheel in enumerate(self.wheels, 1):
			joint_of_vertex[np.isin(self.part, wheel["labels"])] = j

		cpos, cnor, cjoint, ctri = self.cleat_geometry()
		n0, nn0, uv0 = len(mesh.pos), len(mesh.nor), len(mesh.uv)
		positions = np.vstack([mesh.pos, cpos])
		normals = np.vstack([mesh.nor, cnor])
		uvs = np.vstack([mesh.uv, self.track_uv()[None, :]])
		joints = np.concatenate([joint_of_vertex, cjoint])
		cleat_p = np.stack([ctri + n0, ctri + nn0, np.full(ctri.shape, uv0)], axis=-1)
		triangles = np.concatenate([mesh.tri, cleat_p])

		text = mesh.text
		text = re.sub(r'(<float_array id="%s" count=")\d+(">)[^<]*' % re.escape(mesh.pos_id),
			lambda m: m.group(1) + str(positions.size) + m.group(2) + fmt(positions), text)
		text = re.sub(r'(<float_array id="%s" count=")\d+(">)[^<]*' % re.escape(mesh.nor_id),
			lambda m: m.group(1) + str(normals.size) + m.group(2) + fmt(normals), text)
		text = re.sub(r'(<float_array id="%s" count=")\d+(">)[^<]*' % re.escape(mesh.uv_id),
			lambda m: m.group(1) + str(uvs.size) + m.group(2) + fmt(uvs), text)
		for array_id, count in ((mesh.pos_id, len(positions)), (mesh.nor_id, len(normals)), (mesh.uv_id, len(uvs))):
			text = re.sub(r'(<accessor source="#%s" count=")\d+(")' % re.escape(array_id),
				lambda m: m.group(1) + str(count) + m.group(2), text)
		text = re.sub(r'(<triangles[^>]*count=")\d+(")', lambda m: m.group(1) + str(len(triangles)) + m.group(2), text, count=1)
		text = re.sub(r"(<triangles[^>]*>.*?<p>)[^<]*(</p>)",
			lambda m: m.group(1) + " ".join(map(str, triangles.ravel())) + m.group(2), text, count=1, flags=re.S)
		self.positions, self.triangles, self.joints = positions, triangles[:, :, 0], joints

		rest = self.rest()
		world = {self.order[0]: rest[self.order[0]]}
		for nid in self.order[1:]:
			world[nid] = world[self.order[0]] @ rest[nid]
		inverse = np.array([np.linalg.inv(world[nid]) for nid in self.order])
		geometry = re.search(r'<geometry id="([^"]+)"', text).group(1)
		material = re.search(r"<bind_material>.*?</bind_material>", text, re.S).group(0)
		count = len(self.names)
		n = len(positions)
		controller = (
			'  <library_controllers>\n'
			'    <controller id="mammoth-skin" name="MammothArmature">\n'
			'      <skin source="#{g}">\n'
			'        <bind_shape_matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</bind_shape_matrix>\n'
			'        <source id="mammoth-skin-joints">\n'
			'          <Name_array id="mammoth-skin-joints-array" count="{c}">{names}</Name_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#mammoth-skin-joints-array" count="{c}" stride="1">\n'
			'              <param name="JOINT" type="name"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="mammoth-skin-bind_poses">\n'
			'          <float_array id="mammoth-skin-bind_poses-array" count="{c16}">{inv}</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#mammoth-skin-bind_poses-array" count="{c}" stride="16">\n'
			'              <param name="TRANSFORM" type="float4x4"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="mammoth-skin-weights">\n'
			'          <float_array id="mammoth-skin-weights-array" count="1">1</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#mammoth-skin-weights-array" count="1" stride="1">\n'
			'              <param name="WEIGHT" type="float"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <joints>\n'
			'          <input semantic="JOINT" source="#mammoth-skin-joints"/>\n'
			'          <input semantic="INV_BIND_MATRIX" source="#mammoth-skin-bind_poses"/>\n'
			'        </joints>\n'
			'        <vertex_weights count="{n}">\n'
			'          <input semantic="JOINT" source="#mammoth-skin-joints" offset="0"/>\n'
			'          <input semantic="WEIGHT" source="#mammoth-skin-weights" offset="1"/>\n'
			'          <vcount>{vcount}</vcount>\n'
			'          <v>{v}</v>\n'
			'        </vertex_weights>\n'
			'      </skin>\n'
			'    </controller>\n'
			'  </library_controllers>\n').format(g=geometry, c=count, c16=count * 16, names=" ".join(self.names),
				inv=fmt(inverse), n=n, vcount=" ".join(["1"] * n), v=" ".join("%d 0" % j for j in joints))

		def joint(nid, children=""):
			name = nid[len("MammothArmature_"):]
			return ('<node id="{i}" name="{n}" sid="{n}" type="JOINT">\n<matrix sid="transform">{m}</matrix>\n{c}</node>\n'
				.format(i=nid, n=name, m=fmt(rest[nid]), c=children))

		scene = (
			'<visual_scene id="Scene" name="Scene">\n'
			'<node id="MammothArmature" name="MammothArmature" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n' +
			joint(self.order[0], "".join(joint(nid) for nid in self.order[1:])) +
			'<node id="mammoth" name="mammoth" type="NODE">\n'
			'<matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>\n'
			'<instance_controller url="#mammoth-skin">\n'
			'<skeleton>#MammothArmature_track_root</skeleton>\n' + material + '\n'
			'</instance_controller>\n</node>\n</node>\n</visual_scene>')
		text = re.sub(r"<visual_scene .*?</visual_scene>", lambda m: scene, text, count=1, flags=re.S)
		text = text.replace("  <library_visual_scenes>", controller + "  <library_animations>\n  </library_animations>\n  <library_visual_scenes>", 1)
		return text

	# --------------------------------------------------------------- gravação
	def animations(self):
		return {
			"idle": [self.pose(0) for _ in range(2)],
			"move": [self.pose(i / MOVE_FRAMES) for i in range(MOVE_FRAMES + 1)],
		}

	def skeleton_xml(self):
		children = "".join('\t\t\t<bone name="%s"></bone>\n' % n for n in self.names[1:])
		targets = "".join('\t\t\t<bone name="%s"><target>%s</target></bone>\n' % (n, n) for n in self.names[1:])
		return ('<?xml version="1.0" encoding="utf-8"?>\n'
			'<!-- Mammoth com lagartas animadas (art/meshes/vehicle/mammoth_rigged.dae), gerado por\n'
			'     tools/animation/gen_mammoth_tracks.py. -->\n'
			'<skeletons>\n'
			'\t<standard_skeleton title="Mammoth" id="mammoth">\n'
			'\t\t<bone name="track_root">\n' + children + '\t\t</bone>\n'
			'\t</standard_skeleton>\n\n'
			'\t<skeleton title="Mammoth" target="mammoth">\n'
			'\t\t<identifier>\n\t\t\t<root>track_root</root>\n\t\t</identifier>\n'
			'\t\t<bone name="track_root"><target>track_root</target>\n' + targets + '\t\t</bone>\n'
			'\t</skeleton>\n'
			'</skeletons>\n')

	def write(self):
		for folder in (ANIM_DIR, os.path.dirname(SKELETON)):
			os.makedirs(folder, exist_ok=True)
		open(RIGGED, "w", encoding="utf-8").write(self.text.replace("  <library_animations>\n  </library_animations>\n", ""))
		print("gravado", os.path.relpath(RIGGED, MOD), "-", len(self.names), "ossos")
		for name, frames in self.animations().items():
			path = os.path.join(ANIM_DIR, name + ".dae")
			write_animation(self, path, name, np.arange(len(frames)) / FPS, frames)
			print("gravado", os.path.relpath(path, MOD), len(frames), "quadros")
		open(SKELETON, "w", encoding="utf-8").write(self.skeleton_xml())
		print("gravado", os.path.relpath(SKELETON, MOD))
		distance = CYCLE_PITCHES * self.profiles[0]["pitch"]
		print("  %d rodas, %s sapatas por lagarta; ciclo de %.2f m -> speed=\"%d\" no actor" % (
			len(self.wheels), "/".join(str(p["count"]) for p in self.profiles), distance, round(100 / distance)))

	# --------------------------------------------------------------- conferir
	def preview(self, folder):
		from PIL import Image, ImageDraw
		os.makedirs(folder, exist_ok=True)
		frames = self.animations()["move"]
		picks = [0, MOVE_FRAMES // 3, 2 * MOVE_FRAMES // 3]
		W, H, S = 1100, 330, 46
		sheet = Image.new("RGB", (W, H * len(picks)), (24, 24, 28))
		d = ImageDraw.Draw(sheet)
		rest = self.rest()
		inv = {nid: np.linalg.inv(rest[nid] if nid == self.order[0] else rest[self.order[0]] @ rest[nid]) for nid in self.order}
		colors = np.full((len(self.positions), 3), 150)
		colors[self.joints > 0] = (220, 180, 60)
		colors[self.joints > len(self.wheels)] = (230, 90, 70)
		for row, fi in enumerate(picks):
			world = {nid: (frames[fi][nid] if nid == self.order[0] else frames[fi][self.order[0]] @ frames[fi][nid]) for nid in self.order}
			skin = np.array([world[self.order[j]] @ inv[self.order[j]] for j in range(len(self.order))])
			p = np.einsum("nij,nj->ni", skin[self.joints], np.c_[self.positions, np.ones(len(self.positions))])[:, :3]
			tri = p[self.triangles]
			order = np.argsort(tri[:, :, 0].mean(axis=1))   # vista de +X: o mais longe primeiro
			for t in order:
				q = tri[t]
				color = colors[self.triangles[t, 0]]
				d.polygon([(W / 2 + v[1] * S, H * (row + 0.85) - v[2] * S) for v in q], fill=tuple(int(c) for c in color))
			d.text((6, row * H + 4), "move, quadro %d de %d (vista do lado +X; frente = esquerda)" % (fi, MOVE_FRAMES), fill=(230, 230, 230))
		sheet.save(os.path.join(folder, "mammoth_move.png"))
		print("prévia:", os.path.join(folder, "mammoth_move.png"))


def main():
	tracks = Tracks()
	tracks.write()
	if "--preview" in sys.argv:
		tracks.preview(sys.argv[sys.argv.index("--preview") + 1])


if __name__ == "__main__":
	main()

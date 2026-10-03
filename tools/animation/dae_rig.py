"""Leitura/escrita mínima de animações COLLADA (exportadas do Blender) do
esqueleto bípede do 0 A.D.: árvore de juntas, canais de matriz por osso,
cinemática direta e pele (para conferir as poses sem abrir o jogo)."""
import re
import xml.etree.ElementTree as ET
import numpy as np

NS = "{http://www.collada.org/2005/11/COLLADASchema}"


def mat(text):
	return np.array(text.split(), float).reshape(4, 4)


class Rig:
	def __init__(self, path):
		self.path = path
		self.text = open(path, encoding="utf-8").read()
		root = ET.fromstring(self.text)
		self.root = root
		scene = root.find(NS + "library_visual_scenes/" + NS + "visual_scene")
		self.joints = {}   # id -> dict(name, parent, local)
		self.order = []
		self.armature = None

		def walk(node, parent):
			nid = node.get("id")
			m = node.find(NS + "matrix")
			if node.get("type") == "JOINT" and m is not None:
				self.joints[nid] = {"name": node.get("name"), "sid": node.get("sid"), "parent": parent, "local": mat(m.text)}
				self.order.append(nid)
				parent = nid
			for child in node.findall(NS + "node"):
				walk(child, parent)

		for node in scene.findall(NS + "node"):
			if node.find(NS + "node") is not None:
				self.armature = node
				walk(node, None)
		self.by_name = {j["name"]: nid for nid, j in self.joints.items()}

		# Canais de matriz: id da junta -> (tempos, matrizes[n,4,4])
		self.channels = {}
		for anim in root.iter(NS + "animation"):
			ch = anim.find(NS + "channel")
			if ch is None or not ch.get("target").endswith("/transform"):
				continue
			target = ch.get("target").split("/")[0]
			arrays = [a for a in anim.iter(NS + "float_array")]
			if len(arrays) < 2:
				continue
			times = np.array(arrays[0].text.split(), float)
			out = np.array(arrays[1].text.split(), float)
			if out.size != times.size * 16:
				continue
			self.channels[target] = (times, out.reshape(-1, 4, 4))

	def rest_locals(self):
		return {nid: j["local"].copy() for nid, j in self.joints.items()}

	def frame_locals(self, index):
		"""Matrizes locais do quadro `index` da animação do arquivo."""
		loc = self.rest_locals()
		for nid, (times, mats) in self.channels.items():
			if nid in loc:
				loc[nid] = mats[min(index, len(mats) - 1)].copy()
		return loc

	def world(self, locals_):
		w = {}
		for nid in self.order:
			p = self.joints[nid]["parent"]
			w[nid] = locals_[nid] if p is None else w[p] @ locals_[nid]
		return w

	def n(self, name):
		return self.by_name[name]

	# Pele -----------------------------------------------------------------
	def skin(self):
		root = self.root
		ctrl = root.find(NS + "library_controllers/" + NS + "controller/" + NS + "skin")
		geom_id = ctrl.get("source")[1:]
		bsm = mat(ctrl.find(NS + "bind_shape_matrix").text)
		names = inv = weights = None
		for src in ctrl.findall(NS + "source"):
			na = src.find(NS + "Name_array")
			fa = src.find(NS + "float_array")
			if na is not None:
				names = na.text.split()
			elif fa is not None:
				stride = int(src.find(NS + "technique_common/" + NS + "accessor").get("stride"))
				arr = np.array(fa.text.split(), float)
				if stride == 16:
					inv = arr.reshape(-1, 4, 4)
				else:
					weights = arr
		vw = ctrl.find(NS + "vertex_weights")
		vcount = np.array(vw.find(NS + "vcount").text.split(), int)
		v = np.array(vw.find(NS + "v").text.split(), int).reshape(-1, 2)
		geom = [g for g in root.iter(NS + "geometry") if g.get("id") == geom_id][0]
		pos = np.array(geom.find(NS + "mesh/" + NS + "source/" + NS + "float_array").text.split(), float).reshape(-1, 3)
		pos = (np.c_[pos, np.ones(len(pos))] @ bsm.T)
		sid_to_id = {j["sid"]: nid for nid, j in self.joints.items()}
		return {"pos": pos, "names": [sid_to_id.get(s) for s in names], "inv": inv, "weights": weights, "vcount": vcount, "v": v}

	def skinned(self, skin, world):
		out = np.zeros((len(skin["pos"]), 3))
		k = 0
		mats = [world[n] @ skin["inv"][i] if n in world else np.eye(4) for i, n in enumerate(skin["names"])]
		for vi, c in enumerate(skin["vcount"]):
			p = skin["pos"][vi]
			acc = np.zeros(4)
			for j, wi in skin["v"][k:k + c]:
				acc += skin["weights"][wi] * (mats[j] @ p)
			k += c
			out[vi] = acc[:3]
		return out


def fmt(a):
	return " ".join("%.7g" % x for x in np.asarray(a).ravel())


def write_animation(rig, out_path, name, times, frames):
	"""Grava um .dae igual ao modelo, trocando só a library_animations por
	um canal de matriz por junta. `frames` é uma lista de dicts id->local."""
	n = len(times)
	blocks = []
	for nid in rig.order:
		base = "%s_%s_pose_matrix" % (nid, name)
		data = np.array([f[nid] for f in frames])
		blocks.append(
			'      <animation id="{b}" name="Armature_Base">\n'
			'        <source id="{b}-input">\n'
			'          <float_array id="{b}-input-array" count="{n}">{t}</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#{b}-input-array" count="{n}" stride="1">\n'
			'              <param name="TIME" type="float"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="{b}-output">\n'
			'          <float_array id="{b}-output-array" count="{n16}">{o}</float_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#{b}-output-array" count="{n}" stride="16">\n'
			'              <param name="TRANSFORM" type="float4x4"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <source id="{b}-interpolation">\n'
			'          <Name_array id="{b}-interpolation-array" count="{n}">{i}</Name_array>\n'
			'          <technique_common>\n'
			'            <accessor source="#{b}-interpolation-array" count="{n}" stride="1">\n'
			'              <param name="INTERPOLATION" type="name"/>\n'
			'            </accessor>\n'
			'          </technique_common>\n'
			'        </source>\n'
			'        <sampler id="{b}-sampler">\n'
			'          <input semantic="INPUT" source="#{b}-input"/>\n'
			'          <input semantic="OUTPUT" source="#{b}-output"/>\n'
			'          <input semantic="INTERPOLATION" source="#{b}-interpolation"/>\n'
			'        </sampler>\n'
			'        <channel source="#{b}-sampler" target="{nid}/transform"/>\n'
			'      </animation>\n'.format(b=base, n=n, n16=n * 16, t=fmt(times), o=fmt(data),
				i=" ".join(["LINEAR"] * n), nid=nid))
	lib = '<library_animations>\n    <animation id="action_container-Armature_Base" name="Armature_Base">\n' + \
		"".join(blocks) + "    </animation>\n  </library_animations>"
	text = re.sub(r"<library_animations>.*?</library_animations>", lambda m: lib, rig.text, count=1, flags=re.S)
	open(out_path, "w", encoding="utf-8").write(text)

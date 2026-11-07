"""Exo Walker da Legião de Ares (refs/exo/exo walker 3d model.zip, OBJ do
Tripo, malha única sem esqueleto).

  - Malha reduzida (FACES) e posta com 6,5 m x SCALE de altura (com a antena), frente
    em -Y (como vem no arquivo).
  - Textura: a do Tripo (um mapa UV) repintada com as cores de
    structural/ares_struct.png (tools/imported/structures_texture.py: o
    amarelo vira o vermelho da facção, o cinza vira grafite); normal e spec
    (rugosidade/metal) do Tripo.
  - Esqueleto novo: exo_root > pelvis > torso > ombros/braços; pelvis >
    coxas > canelas > pés (no arquivo, todos com prefixo exo_). Juntas medidas pela silhueta do modelo (fatias de
    altura). Pesos: cada vértice é dividido entre os dois ossos mais próximos
    da sua região (perna do lado dele, braço do lado dele ou tronco), pelo
    inverso da distância ao segmento do osso.
  - Animações (IK nos pés, que também giram no tornozelo): idle (respira,
    passa o peso, tronco vigia, braços com os pistões), walk (rolagem do pé,
    pélvis e tronco giram, braços opostos às pernas com cotovelo atrasado,
    tranco a cada pisada), attack (firma as pernas e dispara um braço de cada
    vez, com coice), death (golpe, joelho cede, tomba, braços caem soltos).
  - SCALE: tamanho final (1.3 = 30% maior que os 6,5 m medidos).

Gera art/meshes/skeletal/ares_exo_walker.dae, art/skeletons/ares_exo_walker.xml,
art/animation/units/ares_exo_walker/*.dae e
art/textures/skins/skeletal/ares/exo_walker*.png.
Uso (na pasta do mod):  blender -b -P tools/imported/import_ares_exo.py
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
import structures_texture as st  # noqa: E402

NAME = "ares_exo_walker"
ZIP = os.path.join(bc.MOD, "refs", "exo", "exo walker 3d model.zip")
# Escala: o modelo foi medido com 6,5 m; SCALE aumenta tudo (malha, juntas,
# passada e deslocamentos das animações).
SCALE = 1.3
HEIGHT = 6.5 * SCALE
FACES = 16000
TEX = os.path.join(bc.MOD, "art", "textures", "skins", "skeletal", "ares")
WALK_FRAMES = 44
STRIDE = 1.7 * SCALE
LIFT = 0.7 * SCALE
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

# Juntas (metros, depois de normalizar; frente em -Y). O modelo é um pouco
# assimétrico: a perna esquerda (do robô, x < 0) fica mais perto do centro.
CX = 0.1 * SCALE
J0 = {
	"pelvis": (CX, -0.1, 1.75), "chest": (CX, -0.1, 2.5), "neck": (CX, -0.1, 4.3),
	"hip_l": (-0.9, -0.25, 1.75), "knee_l": (-0.9, -0.45, 1.05), "ankle_l": (-0.95, -0.5, 0.45), "toe_l": (-0.95, -1.1, 0.1),
	"hip_r": (1.15, 0.05, 1.75), "knee_r": (1.15, -0.1, 1.05), "ankle_r": (1.15, 0.15, 0.45), "toe_r": (1.15, -0.45, 0.1),
	"shoulder_l": (-1.45, -0.1, 3.9), "elbow_l": (-1.7, -0.2, 3.0), "hand_l": (-1.85, -0.35, 1.95),
	"shoulder_r": (1.55, -0.1, 3.9), "elbow_r": (1.8, -0.2, 3.0), "hand_r": (1.95, -0.35, 1.95),
}
J = {k: tuple(c * SCALE for c in v) for k, v in J0.items()}


def m(x, y, z):
	"""Deslocamento medido no modelo de 6,5 m, já na escala final."""
	return (x * SCALE, y * SCALE, z * SCALE)
BONES = [
	# nome, pai, cabeça, cauda
	("exo_root", None, (CX, 0, 0), (CX, 0, 0.6 * SCALE)),
	("pelvis", "exo_root", J["pelvis"], J["chest"]),
	("torso", "pelvis", J["chest"], J["neck"]),
	("upperarm_l", "torso", J["shoulder_l"], J["elbow_l"]),
	("forearm_l", "upperarm_l", J["elbow_l"], J["hand_l"]),
	("upperarm_r", "torso", J["shoulder_r"], J["elbow_r"]),
	("forearm_r", "upperarm_r", J["elbow_r"], J["hand_r"]),
	("thigh_l", "pelvis", J["hip_l"], J["knee_l"]),
	("shin_l", "thigh_l", J["knee_l"], J["ankle_l"]),
	("foot_l", "shin_l", J["ankle_l"], J["toe_l"]),
	("thigh_r", "pelvis", J["hip_r"], J["knee_r"]),
	("shin_r", "thigh_r", J["knee_r"], J["ankle_r"]),
	("foot_r", "shin_r", J["ankle_r"], J["toe_r"]),
]


def extract():
	out = tempfile.mkdtemp(prefix="mw_exo_")
	with zipfile.ZipFile(ZIP) as z:
		z.extractall(out)
	return out


def find(folder, suffix):
	return glob.glob(os.path.join(folder, "*" + suffix + ".JPEG"))[0]


def textures(folder):
	"""Cor repintada com o estilo da Ares; normal e spec do Tripo."""
	os.makedirs(TEX, exist_ok=True)
	style_img = bpy.data.images.load(os.path.join(st.TEX, "ares_struct.png"))
	style = bc.pixels(style_img)[..., :3] * 255
	style_ramps, style_luma = st.ramps(style, st.painted(style), "red")
	src_img = bpy.data.images.load(find(folder, "_basecolor"))
	src = bc.pixels(src_img)[..., :3] * 255
	out = st.restyle(src, style_ramps, style_luma, "red", 95, src_accent="any") / 255
	bc.save_png(out, os.path.join(TEX, "exo_walker.png"))
	nrm = bpy.data.images.load(find(folder, "_normal"))
	bc.save_png(bc.pixels(nrm)[..., :3], os.path.join(TEX, "exo_walker_norm.png"))
	rough = bc.pixels(bpy.data.images.load(find(folder, "_roughness")))[..., :1]
	metal = bc.pixels(bpy.data.images.load(find(folder, "_metallic")))[..., :1]
	spec = np.clip((1 - rough) * 0.55 + metal * 0.25, 0, 1)
	bc.save_png(np.repeat(spec, 3, axis=2), os.path.join(TEX, "exo_walker_spec.png"))


def segment_distance(p, a, b):
	ab = b - a
	t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
	return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def cut_bridges(mesh, dom, z):
	"""O Tripo fundiu a ponta dos braços às coxas (e o lado de dentro dos
	braços ao tronco) com faces que ligam os dois; quando o braço se mexe elas
	esticam até o joelho. Cada uma dessas faces fica inteira de um lado só (o
	da maioria dos seus vértices; empate: braço): os vértices do outro lado
	são duplicados só para ela (bmesh face_vert_separate) e a cópia ganha os
	pesos de um vértice do lado escolhido. Nenhuma face some; a ligação vira
	uma emenda que abre quando o braço se afasta.
	Devolve [(índice do vértice novo, vértice de onde copiar os pesos)]."""
	import bmesh
	part = np.array(["arm" if d.startswith(("upperarm", "forearm")) else
		"leg" if d.startswith(("thigh", "shin", "foot")) else "body" for d in dom])
	# Abaixo do ombro, braço e corpo não devem estar ligados.
	shoulder = J0["shoulder_l"][2] - 0.35
	bm = bmesh.new()
	bm.from_mesh(mesh.data)
	bm.verts.ensure_lookup_table()
	n0 = len(bm.verts)
	bridges = []
	for f in bm.faces:
		idx = [v.index for v in f.verts]
		kinds = [part[i] for i in idx]
		if "arm" in kinds and ("leg" in kinds or ("body" in kinds and z[idx].min() < shoulder)):
			arm_n = kinds.count("arm")
			side = "arm" if arm_n * 2 >= len(kinds) else max(set(kinds) - {"arm"}, key=kinds.count)
			bridges.append((f, side))
	copies = []
	for f, side in bridges:
		verts = list(f.verts)
		src = next(v.index for v in verts if v.index < n0 and part[v.index] == side)
		for v in verts:
			if v.index < n0 and part[v.index] != side:
				# Se o vértice só estava nesta face, não há o que separar:
				# ele mesmo passa a usar os pesos do lado escolhido.
				new = bmesh.utils.face_vert_separate(f, v)
				if new is not v:
					bm.verts.index_update()
				copies.append((new.index, src))
	bm.to_mesh(mesh.data)
	bm.free()
	print("faces de ligação separadas:", len(bridges), "vértices duplicados:", len(copies))
	return copies


def skin(mesh):
	"""Pesos por região, entre os dois ossos mais próximos (inverso da
	distância ao segmento do osso, à sexta)."""
	co = np.array([v.co[:] for v in mesh.data.vertices])
	seg = {n: (np.array(h, float), np.array(t, float)) for n, _, h, t in BONES}
	names = [n for n, *_ in BONES if n != "exo_root"]
	dist = np.stack([segment_distance(co, *seg[n]) for n in names], axis=1)
	x, z = co[:, 0], co[:, 2] / SCALE
	left = x < CX
	allowed = np.zeros_like(dist, bool)
	col = {n: i for i, n in enumerate(names)}

	def allow(mask, bones):
		for b in bones:
			allowed[mask, col[b]] = True

	legs = z < 1.65
	upper = z > 1.55
	arms = (np.abs(x - CX) > 1.2 * SCALE) & (z > 1.6) & (z < 4.2)
	pads = (np.abs(x - CX) > 1.2 * SCALE) & (z >= 4.2)
	# Faixa entre o tronco e o braço: fica com o osso mais próximo.
	inner = (np.abs(x - CX) > 0.95 * SCALE) & (np.abs(x - CX) <= 1.2 * SCALE) & (z > 1.6) & (z < 3.6)
	body = ~legs & ~arms & ~pads
	for side, m in (("l", left), ("r", ~left)):
		allow(legs & m, ["thigh_" + side, "shin_" + side, "foot_" + side])
		allow(legs & m & upper, ["pelvis"])
		allow(arms & m, ["upperarm_" + side, "forearm_" + side])
		allow(arms & m & (z > 3.6), ["torso"])
		allow(pads & m, ["upperarm_" + side, "torso"])
		allow(inner & m, ["upperarm_" + side, "forearm_" + side])
	allow(body, ["pelvis", "torso"])
	w = np.where(allowed, 1.0 / (dist ** 6 + 1e-6), 0.0)
	top = np.argsort(-w, axis=1)[:, :2]
	copies = cut_bridges(mesh, np.array(names)[top[:, 0]], z)
	groups = {n: mesh.vertex_groups.new(name=n) for n in names}
	source = {i: i for i in range(len(co))}
	source.update(dict(copies))
	for i, src_i in source.items():
		a, b = top[src_i]
		wa, wb = w[src_i, a], w[src_i, b]
		s = wa + wb
		groups[names[a]].add([i], wa / s, "REPLACE")
		if wb / s > 0.05:
			groups[names[b]].add([i], wb / s, "REPLACE")


src = extract()
bc.reset()
bc.import_file(glob.glob(os.path.join(src, "*.obj"))[0])
mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
bc.keep_only([mesh])
mesh.name = mesh.data.name = NAME
bc.clean_mesh(mesh, merge=1e-6)
bc.decimate(mesh, FACES)
bc.normalize([mesh], HEIGHT, axis="z")
bc.fix_normals(mesh, angle=40)
for extra in [u.name for u in mesh.data.uv_layers][1:]:
	mesh.data.uv_layers.remove(mesh.data.uv_layers[extra])
textures(src)

arm = bc.new_armature(NAME, [(n, p, h, t, True) for n, p, h, t in BONES])
hand_r, hand_l = Vector(J["hand_r"]), Vector(J["hand_l"])
fwd = Vector(m(0, -0.6, 0))
bc.add_bones(arm, [
	("prop_muzzle_l", "forearm_l", hand_l + fwd, hand_l + fwd + Vector(m(0, 0, 0.3)), False),
	("prop_muzzle_r", "forearm_r", hand_r + fwd, hand_r + fwd + Vector(m(0, 0, 0.3)), False),
	("prop_projectile", "forearm_r", hand_r + fwd, hand_r + fwd + Vector(m(0, 0, 0.3)), False),
])
skin(mesh)
bc.parent_to(mesh, arm)

helpers = bc.ik_targets(arm, [("foot_l", "shin_l", 2), ("foot_r", "shin_r", 2)])
rest = bc.rest_matrices(arm)
L = bc.local_pose
CONTROLS = ["exo_root", "pelvis", "torso", "upperarm_l", "upperarm_r", "forearm_l", "forearm_r"] + helpers
TAU = 2 * math.pi


def smooth(x):
	x = min(1.0, max(0.0, x))
	return x * x * (3 - 2 * x)


def foot(side, move=(0, 0, 0), pitch=0.0, yaw=0.0):
	"""Alvo da IK do pé: deslocamento (m, já na escala) e giro do pé em torno
	do tornozelo (pitch > 0 = ponta para baixo/calcanhar sobe; yaw em Z)."""
	return {"ik_foot_" + side: bc.world_pose(rest, "ik_foot_" + side, move=move, rot=[(X, pitch), (Z, yaw)])}


def planted(**moves):
	v = {}
	for s in "lr":
		v.update(foot(s, *moves.get(s, ((0, 0, 0),))))
	return v


def arm_pose(side, swing=0.0, fore=0.0, out=0.0, twist=0.0):
	"""Braço de um lado: swing < 0 = para a frente (graus em X), fore = dobra
	do cotovelo (> 0 = antebraço para a frente), out > 0 = abre para fora."""
	sign = 1 if side == "l" else -1
	return {"upperarm_" + side: L(rest, "upperarm_" + side, rot=[(X, swing), (Y, sign * out), (Z, sign * twist)]),
		"forearm_" + side: L(rest, "forearm_" + side, rot=[(X, -fore)])}


def walk_pitch(p):
	"""Rolagem do pé na passada (p = fase do pé, 0..0.5 apoio): calcanhar
	toca com a ponta para cima, pé chapado no meio, calcanhar sobe antes de
	sair do chão e a ponta volta a subir no fim do voo."""
	if p < 0.5:
		s = p / 0.5
		return -10 * (1 - smooth(s / 0.18)) + 20 * smooth((s - 0.72) / 0.28)
	s = (p - 0.5) / 0.5
	return 20 * (1 - smooth(s / 0.45)) - 10 * smooth((s - 0.55) / 0.45)


def idle(t):
	"""Parado: respira (sobe e desce), passa o peso de uma perna para a outra,
	o tronco vigia para os lados e os braços balançam com os pistões."""
	w = math.sin(TAU * t)
	v = planted()
	v["exo_root"] = L(rest, "exo_root", move=m(0.06 * w, 0, -0.08 + 0.04 * math.sin(2 * TAU * t)))
	v["pelvis"] = L(rest, "pelvis", rot=[(Y, -2.0 * w)])
	v["torso"] = L(rest, "torso", rot=[(X, 1.5 * math.sin(2 * TAU * t + 0.6)), (Z, 7 * math.sin(TAU * t + 0.9)), (Y, 1.5 * w)])
	for side, ph in (("l", 0.0), ("r", 0.35)):
		k = math.sin(TAU * t + ph * TAU)
		v.update(arm_pose(side, swing=-4 + 2.5 * k, fore=8 + 4 * math.sin(2 * TAU * t + ph * TAU), out=3 + 1.5 * k))
	return v


def walk(t):
	"""Passo pesado: rolagem do pé (calcanhar, chapado, ponta), pélvis afunda
	no apoio e gira com a perna da frente, tronco gira ao contrário, braços
	balançam opostos às pernas com o cotovelo atrasado e um tranco a cada
	pisada."""
	v = {}
	for s, ph in (("l", 0.0), ("r", 0.5)):
		dy, dz = bc.walk_foot(t, ph, STRIDE, LIFT)
		p = (t + ph) % 1.0
		# No voo o pé passa um pouco para fora (não raspa na outra perna).
		dx = (0.12 * SCALE * math.sin(math.pi * (p - 0.5) / 0.5)) * (-1 if s == "l" else 1) if p >= 0.5 else 0
		v.update(foot(s, (dx, dy, dz), walk_pitch(p), yaw=0))
	# Pisada em t = 0 (pé esquerdo) e 0.5 (direito): o corpo afunda logo depois.
	bob = math.cos(2 * TAU * (t - 0.02))
	impact = sum(math.exp(-((t - c) % 1.0) * 18) for c in (0.02, 0.52))
	sway = math.sin(TAU * t + 0.3)
	v["exo_root"] = L(rest, "exo_root", move=(-0.14 * SCALE * sway, 0, -0.34 * SCALE - 0.16 * SCALE * bob - 0.05 * SCALE * impact))
	yaw = 6 * math.cos(TAU * t)
	v["pelvis"] = L(rest, "pelvis", rot=[(Z, -yaw), (Y, 3 * sway), (X, -2)])
	v["torso"] = L(rest, "torso", rot=[(X, -5 + 2.5 * impact), (Z, 1.6 * yaw), (Y, -2 * sway)])
	c = math.cos(TAU * t)
	for side, sign in (("l", 1), ("r", -1)):
		swing = sign * 8 * c
		# Cotovelo dobra mais quando o braço vem à frente, com atraso.
		lag = sign * math.cos(TAU * t - 0.9)
		v.update(arm_pose(side, swing=-4 + swing + 2 * impact, fore=10 + 7 * (0.5 - 0.5 * lag), out=2 + impact,
			twist=-sign * 2 * c))
	return v


def attack(t):
	"""Firma as pernas (afunda, pé direito recua), mira com os dois braços e
	dispara: braço esquerdo em 0.35, direito em 0.5, cada um com coice no
	ombro e no cotovelo; o tronco recua a cada tiro e volta."""
	aim = smooth(t / 0.28) * (1 - smooth((t - 0.8) / 0.2) * 0.35)
	brace = smooth(t / 0.25) * (1 - smooth((t - 0.75) / 0.25))
	kick = {s: (0.0 if t < c else math.exp(-(t - c) * 11) * (1 - math.exp(-(t - c) * 80))) for s, c in (("l", 0.35), ("r", 0.5))}
	both = kick["l"] + kick["r"]
	v = {}
	v.update(foot("l", m(-0.05 * brace, -0.1 * brace, 0), -3 * brace))
	v.update(foot("r", m(0.08 * brace, 0.35 * brace, 0), 6 * brace, yaw=-8 * brace))
	v["exo_root"] = L(rest, "exo_root", move=m(0, 0.12 * both, -0.22 * brace - 0.06 * both))
	v["pelvis"] = L(rest, "pelvis", rot=[(Z, 6 * brace), (X, 3 * brace)])
	v["torso"] = L(rest, "torso", rot=[(X, -4 * aim + 6 * both), (Z, -4 * brace + 3 * (kick["l"] - kick["r"]))])
	for side, sign in (("l", 1), ("r", -1)):
		k = kick[side]
		v.update(arm_pose(side, swing=-30 * aim + 12 * k, fore=55 * aim - 18 * k, out=-4 * aim + 2 * k, twist=sign * 4 * aim))
	return v


def death(t):
	"""Leva o golpe (tronco joga para trás), o joelho esquerdo cede, cai de
	joelhos e tomba para a frente; os braços perdem força e caem."""
	hit = math.sin(math.pi * min(1.0, t / 0.22)) if t < 0.22 else 0.0
	e = smooth((t - 0.12) / 0.45)
	f = smooth((t - 0.5) / 0.42) ** 1.6
	limp = smooth((t - 0.15) / 0.5)
	v = {}
	v.update(foot("l", m(0.1 * e, -0.15 * e, 0), -35 * e + 20 * f))
	v.update(foot("r", m(-0.15 * e, 0.45 * e, 0), 25 * e, yaw=10 * e))
	v["exo_root"] = L(rest, "exo_root", move=m(-0.1 * e, 0.2 * hit - 1.0 * f, -1.0 * e - 0.65 * f), rot=[(X, -6 * hit + 52 * f), (Y, -7 * e)])
	v["pelvis"] = L(rest, "pelvis", rot=[(Y, -5 * e), (Z, 6 * e)])
	v["torso"] = L(rest, "torso", rot=[(X, -12 * hit + 20 * e), (Z, 10 * e - 6 * f), (Y, 6 * e)])
	for side, sign, d in (("l", 1, 0.0), ("r", -1, 0.08)):
		flop = math.sin(TAU * 1.5 * max(0.0, t - 0.6 - d)) * math.exp(-max(0.0, t - 0.6 - d) * 6) if t > 0.6 + d else 0.0
		v.update(arm_pose(side, swing=-6 * (1 - limp) + 25 * hit * sign * 0.4 - 30 * f + 10 * flop,
			fore=10 * (1 - limp) + 4 * limp + 15 * flop, out=6 + 14 * limp))
	return v


actions = {
	"idle": bc.make_action(arm, "idle", 60, idle, CONTROLS),
	"walk": bc.make_action(arm, "walk", WALK_FRAMES, walk, CONTROLS),
	"attack": bc.make_action(arm, "attack", 30, attack, CONTROLS),
	"death": bc.make_action(arm, "death", 50, death, CONTROLS),
}
bc.clear_constraints(arm)
bc.remove_bones(arm, helpers)
# Prefixo exo_ em todos os ossos: o conversor do jogo escolhe o esqueleto
# pelo nome da raiz de cada esqueleto conhecido, e o do XV8 tem raiz "pelvis"
# (com braços e pernas de mesmo nome). O Blender renomeia junto os grupos de
# vértices.
# O Blender só corrige os canais da ação ativa ao renomear; as guardadas
# (actions) ficariam com os nomes antigos e o jogo só moveria a raiz.
renamed = {}
for bone in arm.data.bones:
	if not bone.name.startswith(("exo_", "prop_")):
		renamed[bone.name] = "exo_" + bone.name
		bone.name = renamed[bone.name]
for act in actions.values():
	for fc in act.fcurves:
		for old, new in renamed.items():
			key = 'pose.bones["%s"]' % old
			if fc.data_path.startswith(key):
				fc.data_path = fc.data_path.replace(key, 'pose.bones["%s"]' % new)
	for g in act.groups:
		if g.name in renamed:
			g.name = renamed[g.name]
print("vértices sem peso:", bc.limit_weights(mesh))
bc.skeleton_xml(arm, NAME, "Ares Exo Walker", "Exo Walker da Ares (tools/imported/import_ares_exo.py)")
bc.export_mesh(mesh, arm, "skeletal/%s.dae" % NAME)
for n, act in actions.items():
	bc.export_action(arm, act, "units/%s/%s.dae" % (NAME, n), mesh)
print("EXO tris", bc.triangle_count(mesh), 'speed="%d"' % round(100 / (STRIDE / 0.5)))

if os.environ.get("MW_PREVIEW"):
	out = os.environ["MW_PREVIEW"]
	mat = bpy.data.materials.new("prev")
	mat.use_nodes = True
	node = mat.node_tree.nodes.new("ShaderNodeTexImage")
	node.image = bpy.data.images.load(os.path.join(TEX, "exo_walker.png"))
	mat.node_tree.links.new(node.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
	mesh.data.materials.clear()
	mesh.data.materials.append(mat)
	bc.render_frames([mesh], os.path.join(out, NAME + "_rest.png"), views=("front", "side", "persp"), res=360)
	bc.render_frames([mesh], os.path.join(out, NAME + "_walk.png"), arm, actions["walk"], frames=(1, 12, 23, 34), views=("side", "persp"), res=320)
	bc.render_frames([mesh], os.path.join(out, NAME + "_attack.png"), arm, actions["attack"], frames=(1, 12, 31), views=("side", "persp"), res=320)
	bc.render_frames([mesh], os.path.join(out, NAME + "_death.png"), arm, actions["death"], frames=(1, 26, 51), views=("side", "persp"), res=320)

if os.environ.get("MW_WALK_SHEET"):
	# Folha grande só do andar, para conferir pernas e braços quadro a quadro.
	os.environ["MW_SHADING"] = "SINGLE"
	act = os.environ.get("MW_SHEET_ACT", "walk")
	frames = (1, 6, 12, 17, 23, 28, 34, 39) if act == "walk" else (1, 11, 16, 22)
	bc.render_frames([mesh], os.environ["MW_WALK_SHEET"], arm, actions[act], frames=frames,
		views=("side", "front", "persp"), res=520)

if os.environ.get("MW_WALK_DEBUG"):
	# Erro entre o pé pedido (walk_foot) e o pé que a IK conseguiu, por quadro.
	arm.animation_data.action = actions["walk"]
	for f in range(1, WALK_FRAMES + 2, 4):
		bpy.context.scene.frame_set(f)
		t = (f - 1) / WALK_FRAMES
		row = []
		for s, ph in (("l", 0.0), ("r", 0.5)):
			dy, dz = bc.walk_foot(t, ph, STRIDE, LIFT)
			want = Vector(J["ankle_" + s]) + Vector((0, dy, dz))
			got = arm.pose.bones["exo_foot_" + s].head
			hand = arm.pose.bones["exo_forearm_" + s].tail
			row.append("%s err=%.2f got=(%.2f %.2f %.2f) hand=(%.2f %.2f %.2f)" % (s, (got - want).length, *got, *hand))
		print("WD f%02d" % f, " | ".join(row))

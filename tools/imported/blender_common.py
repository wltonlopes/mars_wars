"""Funções comuns para trazer modelos de terceiros (os .zip na raiz do mod)
para o 0 A.D. pelo Blender: importar, limpar, orientar (frente para -Y, chão
em z=0), juntar numa malha só, assar uma textura única (o 0 A.D. aceita um
material por malha), montar o esqueleto, animar com IK e exportar COLLADA.

Roda dentro do Blender (bpy); os scripts import_*.py usam este módulo.
"""
import math
import os
import shutil
import subprocess
import tempfile
import zipfile

import bpy
import bmesh
from mathutils import Matrix, Vector

MOD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
FPS = 30


# Arquivos ------------------------------------------------------------------

def extract(zip_name, inner=None):
	"""Extrai o zip (e, se `inner` for um .zip/.rar dentro dele, também esse)
	para uma pasta temporária; devolve a pasta."""
	out = tempfile.mkdtemp(prefix="mw_import_")
	with zipfile.ZipFile(os.path.join(MOD, zip_name)) as z:
		z.extractall(out)
	if inner:
		path = os.path.join(out, inner)
		dest = os.path.join(out, "inner")
		os.makedirs(dest)
		if path.endswith(".zip"):
			with zipfile.ZipFile(path) as z:
				z.extractall(dest)
		else:
			# .rar: o libarchive do sistema lê RAR5 (bsdtar não vem no Ubuntu).
			subprocess.check_call(["python3", "-I", os.path.join(os.path.dirname(__file__), "unrar.py"), path, dest])
	return out


def reset():
	bpy.ops.wm.read_factory_settings(use_empty=True)
	bpy.context.scene.render.fps = FPS


def import_file(path):
	ext = os.path.splitext(path)[1].lower()
	if ext == ".fbx":
		bpy.ops.import_scene.fbx(filepath=path)
	elif ext in (".glb", ".gltf"):
		bpy.ops.import_scene.gltf(filepath=path)
	elif ext == ".dae":
		bpy.ops.wm.collada_import(filepath=path)
	elif ext == ".obj":
		bpy.ops.wm.obj_import(filepath=path)
	else:
		raise ValueError(path)


def keep_only(objects):
	keep = set(objects)
	for o in list(bpy.data.objects):
		if o not in keep:
			bpy.data.objects.remove(o, do_unlink=True)


def select(objects, active=None):
	if bpy.context.object and bpy.context.object.mode != "OBJECT":
		bpy.ops.object.mode_set(mode="OBJECT")
	vl = bpy.context.view_layer
	for o in objects:
		if o.name not in vl.objects:
			bpy.context.scene.collection.objects.link(o)
		o.hide_viewport = False
		o.hide_set(False)
		o.hide_select = False
	for o in bpy.context.view_layer.objects:
		o.select_set(o in objects)
	vl.objects.active = active or (objects[0] if objects else None)
	# Objetos de arquivos antigos podem vir marcados em modo pose/edição.
	if vl.objects.active and vl.objects.active.mode != "OBJECT":
		bpy.ops.object.mode_set(mode="OBJECT")


# Orientação e escala ------------------------------------------------------

def world_bounds(objects):
	dg = bpy.context.evaluated_depsgraph_get()
	lo = Vector((1e9, 1e9, 1e9))
	hi = -lo
	for o in objects:
		if o.type != "MESH":
			continue
		ev = o.evaluated_get(dg)
		me = ev.to_mesh()
		for v in me.vertices:
			p = ev.matrix_world @ v.co
			lo = Vector(map(min, lo, p))
			hi = Vector(map(max, hi, p))
		ev.to_mesh_clear()
	return lo, hi


def apply_all_transforms(objects):
	"""Aplica posição/rotação/escala em toda a hierarquia, pais primeiro."""
	for o in sorted(objects, key=lambda o: len(list(iter_parents(o)))):
		select([o])
		bpy.ops.object.transform_apply(location=True, rotation=True, scale=True, properties=False)


def iter_parents(o):
	while o.parent:
		o = o.parent
		yield o


def normalize(objects, size, axis="z", rotate_z=0.0, center=True):
	"""Gira em torno de Z (graus), escala para que a medida em `axis` seja
	`size`, centraliza em XY e põe a base em z=0; aplica as transformações."""
	tops = [o for o in objects if o.parent is None]
	rot = Matrix.Rotation(math.radians(rotate_z), 4, "Z")
	for o in tops:
		o.matrix_world = rot @ o.matrix_world
	bpy.context.view_layer.update()
	lo, hi = world_bounds(objects)
	k = size / (hi - lo)["xyz".index(axis)]
	for o in tops:
		o.matrix_world = Matrix.Scale(k, 4) @ o.matrix_world
	bpy.context.view_layer.update()
	lo, hi = world_bounds(objects)
	off = Vector(((lo.x + hi.x) / 2 if center else 0, (lo.y + hi.y) / 2 if center else 0, lo.z))
	for o in tops:
		o.matrix_world = Matrix.Translation(-off) @ o.matrix_world
	bpy.context.view_layer.update()
	apply_all_transforms(objects)
	return k


def join(meshes, name):
	select(meshes)
	bpy.ops.object.join()
	o = bpy.context.view_layer.objects.active
	o.name = o.data.name = name
	return o


def clean_mesh(o, merge=0.0):
	"""Tira faces degeneradas e (opcional) junta vértices duplicados."""
	bm = bmesh.new()
	bm.from_mesh(o.data)
	if merge:
		bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
	bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
	loose = [v for v in bm.verts if not v.link_faces]
	bmesh.ops.delete(bm, geom=loose, context="VERTS")
	bm.to_mesh(o.data)
	bm.free()


def fix_normals(o, angle=35.0):
	"""Normais do zero: faces para fora (por região), sem normais
	personalizadas (as do SketchUp vêm invertidas) e suavização por ângulo."""
	bm = bmesh.new()
	bm.from_mesh(o.data)
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	bm.to_mesh(o.data)
	bm.free()
	select([o])
	if o.data.has_custom_normals:
		bpy.ops.mesh.customdata_custom_splitnormals_clear()
	bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))


def decimate(o, faces):
	n = len(o.data.polygons)
	if n <= faces:
		return
	m = o.modifiers.new("dec", "DECIMATE")
	m.ratio = faces / n
	m.use_collapse_triangulate = True
	select([o])
	while o.modifiers[0] != m:
		bpy.ops.object.modifier_move_up(modifier=m.name)
	bpy.ops.object.modifier_apply(modifier=m.name)


def triangle_count(o):
	return sum(len(p.vertices) - 2 for p in o.data.polygons)


# Textura única ------------------------------------------------------------

def _ensure_cycles():
	sc = bpy.context.scene
	sc.render.engine = "CYCLES"
	sc.cycles.device = "CPU"
	sc.cycles.samples = 16
	sc.render.bake.margin = 6
	sc.render.bake.use_clear = True


def atlas_uv(o, margin=0.004, reuse=False):
	"""Com reuse, assa sobre o mapa UV que a malha já tem. Senão cria o mapa UV 'atlas' (sem sobreposição) e o deixa ativo para o
	assamento; os materiais continuam lendo o mapa UV original."""
	me = o.data
	if reuse:
		me.uv_layers.active.name = "atlas"
		return me.uv_layers.active
	if not me.uv_layers:
		me.uv_layers.new(name="orig")
	render = me.uv_layers.active_render if hasattr(me.uv_layers, "active_render") else None
	for uv in me.uv_layers:
		if uv.active_render:
			render = uv
	uv = me.uv_layers.new(name="atlas")
	me.uv_layers.active = uv
	if render:
		render.active_render = True
	select([o])
	bpy.ops.object.mode_set(mode="EDIT")
	bpy.ops.mesh.select_all(action="SELECT")
	bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.6, scale_to_bounds=True)
	bpy.ops.uv.pack_islands(margin=margin, rotate=True)
	bpy.ops.object.mode_set(mode="OBJECT")
	return uv


def ensure_nodes(mat):
	"""Materiais antigos (sem nós) viram Principled com a mesma cor."""
	if mat.use_nodes and mat.node_tree:
		return mat.node_tree
	rgba = tuple(mat.diffuse_color)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = rgba
	return mat.node_tree


def _bake_target(o, img):
	for slot in o.material_slots:
		mat = slot.material
		if mat is None:
			continue
		ensure_nodes(mat)
		nodes = mat.node_tree.nodes
		# Metal some do passe de cor difusa: assa tudo como dielétrico.
		for bsdf in [x for x in nodes if x.type == "BSDF_PRINCIPLED"]:
			sock = bsdf.inputs["Metallic"]
			for l in list(sock.links):
				mat.node_tree.links.remove(l)
			sock.default_value = 0.0
		n = nodes.get("__bake__") or nodes.new("ShaderNodeTexImage")
		n.name = "__bake__"
		n.image = img
		for x in nodes:
			x.select = False
		n.select = True
		nodes.active = n


def bake(o, kind, size, name):
	"""kind: DIFFUSE (cor sem luz), NORMAL (tangente, já com os normal maps
	dos materiais), AO, ROUGHNESS."""
	_ensure_cycles()
	if not o.material_slots or all(s.material is None for s in o.material_slots):
		mat = bpy.data.materials.new("plain")
		mat.use_nodes = True
		o.data.materials.append(mat)
	img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=(kind == "NORMAL"))
	if kind == "NORMAL":
		img.colorspace_settings.name = "Non-Color"
	_bake_target(o, img)
	select([o])
	bk = bpy.context.scene.render.bake
	if kind == "DIFFUSE":
		bk.use_pass_direct = bk.use_pass_indirect = False
		bk.use_pass_color = True
		bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
	elif kind == "AO":
		bpy.context.scene.cycles.samples = 64
		bpy.ops.object.bake(type="AO")
		bpy.context.scene.cycles.samples = 16
	else:
		bpy.ops.object.bake(type=kind)
	return img


def pixels(img):
	import numpy as np
	a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
	img.pixels.foreach_get(a)
	return a.reshape(img.size[1], img.size[0], 4)


def save_png(arr, path, alpha=None):
	"""arr: HxWx3 em 0..1 (linear da imagem do Blender, como foi assada)."""
	import numpy as np
	h, w = arr.shape[:2]
	img = bpy.data.images.new("out", w, h, alpha=True)
	out = np.ones((h, w, 4), np.float32)
	out[..., :3] = np.clip(arr[..., :3], 0, 1)
	if alpha is not None:
		out[..., 3] = alpha
	img.pixels.foreach_set(out.ravel())
	img.filepath_raw = path
	img.file_format = "PNG"
	os.makedirs(os.path.dirname(path), exist_ok=True)
	img.save()
	bpy.data.images.remove(img)


def bake_textures(o, base, size=1024, normal=True, ao=True, color_fn=None, reuse_uv=False):
	"""Assa cor (escurecida pelo AO), normal map e um spec simples para a
	malha `o` e grava art/textures/skins/<base>.png, _norm.png e _spec.png.
	Ao final a malha fica só com o mapa UV 'atlas' e um material."""
	import numpy as np
	atlas_uv(o, reuse=reuse_uv)
	col = pixels(bake(o, "DIFFUSE", size, "col"))[..., :3].copy()
	if color_fn:
		col = color_fn(col)
	if ao:
		occ = pixels(bake(o, "AO", size, "ao"))[..., :1]
		col = col * (0.45 + 0.55 * occ)
	files = {}
	path = os.path.join(MOD, "art", "textures", "skins", base + ".png")
	save_png(col, path)
	files["baseTex"] = base + ".png"
	if normal:
		nor = pixels(bake(o, "NORMAL", size, "nor"))[..., :3]
		save_png(nor, os.path.join(MOD, "art", "textures", "skins", base + "_norm.png"))
		files["normTex"] = base + "_norm.png"
	lum = col.mean(axis=2, keepdims=True)
	spec = np.repeat(np.clip(0.08 + lum * 0.55, 0, 1), 3, axis=2)
	save_png(spec, os.path.join(MOD, "art", "textures", "skins", base + "_spec.png"))
	files["specTex"] = base + "_spec.png"
	# Só o atlas e um material: é o que o 0 A.D. lê.
	me = o.data
	# Remove pelo nome: referências antigas ficam inválidas a cada remoção.
	for name in [u.name for u in me.uv_layers if u.name != "atlas"]:
		me.uv_layers.remove(me.uv_layers[name])
	me.uv_layers["atlas"].active = me.uv_layers["atlas"].active_render = True
	me.materials.clear()
	me.polygons.foreach_set("material_index", [0] * len(me.polygons))
	mat = bpy.data.materials.new(base.split("/")[-1])
	mat.use_nodes = True
	tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
	tex.image = bpy.data.images.load(path)
	mat.node_tree.links.new(tex.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
	me.materials.append(mat)
	for slot in o.material_slots:
		slot.link = "DATA"
	return files


def set_flat_material(objects, rgb, rough=0.6, metal=0.0):
	mat = bpy.data.materials.new("flat_%02x%02x%02x" % tuple(int(c * 255) for c in rgb))
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes["Principled BSDF"]
	bsdf.inputs["Base Color"].default_value = (*rgb, 1)
	bsdf.inputs["Roughness"].default_value = rough
	bsdf.inputs["Metallic"].default_value = metal
	for o in objects:
		o.data.materials.clear()
		o.data.materials.append(mat)


# Esqueleto ----------------------------------------------------------------

def new_armature(name, bones):
	"""bones: lista de (nome, pai, cabeça, cauda, deforma)."""
	arm = bpy.data.armatures.new(name)
	ob = bpy.data.objects.new(name, arm)
	bpy.context.scene.collection.objects.link(ob)
	select([ob])
	bpy.ops.object.mode_set(mode="EDIT")
	for bname, parent, head, tail, deform in bones:
		eb = arm.edit_bones.new(bname)
		eb.head, eb.tail = Vector(head), Vector(tail)
		eb.use_deform = deform
		if parent:
			eb.parent = arm.edit_bones[parent]
	bpy.ops.object.mode_set(mode="OBJECT")
	return ob


def add_bones(ob, bones):
	select([ob])
	bpy.ops.object.mode_set(mode="EDIT")
	for bname, parent, head, tail, deform in bones:
		eb = ob.data.edit_bones.new(bname)
		eb.head, eb.tail = Vector(head), Vector(tail)
		eb.use_deform = deform
		if parent:
			eb.parent = ob.data.edit_bones[parent]
	bpy.ops.object.mode_set(mode="OBJECT")


def remove_bones(ob, names):
	select([ob])
	bpy.ops.object.mode_set(mode="EDIT")
	for n in names:
		eb = ob.data.edit_bones.get(n)
		if eb:
			ob.data.edit_bones.remove(eb)
	bpy.ops.object.mode_set(mode="OBJECT")


def rename_bones(ob, mapping, mesh=None):
	for old, new in mapping.items():
		b = ob.data.bones.get(old)
		if b:
			b.name = new  # o Blender renomeia os grupos de vértices junto
	if ob.animation_data:
		ob.animation_data_clear()


def bind_rigid(mesh, arm, part_bone):
	"""Pele rígida: cada vértice segue o osso do pedaço (`part_bone`:
	função vértice-índice -> nome do osso)."""
	groups = {}
	for v in mesh.data.vertices:
		b = part_bone(v.index)
		if b not in groups:
			groups[b] = mesh.vertex_groups.get(b) or mesh.vertex_groups.new(name=b)
		groups[b].add([v.index], 1.0, "REPLACE")
	parent_to(mesh, arm)


def parent_to(mesh, arm):
	mw = mesh.matrix_world.copy()
	mesh.parent = arm
	mesh.matrix_parent_inverse = arm.matrix_world.inverted()
	mesh.matrix_world = mw
	for m in [m for m in mesh.modifiers if m.type == "ARMATURE"]:
		mesh.modifiers.remove(m)
	m = mesh.modifiers.new("Armature", "ARMATURE")
	m.object = arm


def limit_weights(mesh, limit=4):
	"""O 0 A.D. usa até 4 ossos por vértice; normaliza o resto."""
	select([mesh])
	bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
	bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=limit)
	bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
	bpy.ops.object.mode_set(mode="OBJECT")
	# Vértices sem peso nenhum quebram a pele no jogo: vão para o osso raiz.
	arm = mesh.modifiers["Armature"].object
	root = arm.data.bones[0].name
	g = mesh.vertex_groups.get(root) or mesh.vertex_groups.new(name=root)
	deform = {b.name for b in arm.data.bones if b.use_deform}
	ids = {vg.index for vg in mesh.vertex_groups if vg.name in deform}
	lone = [v.index for v in mesh.data.vertices if not any(x.group in ids and x.weight > 0 for x in v.groups)]
	if lone:
		g.add(lone, 1.0, "REPLACE")
	return len(lone)


def skeleton_xml(ob, sid, title, comment):
	"""Grava art/skeletons/<sid>.xml no formato do jogo (padrão = o próprio)."""
	def tree(bone, depth, target):
		pad = "\t" * depth
		inner = "<target>%s</target>" % bone.name if target else ""
		kids = "".join(tree(c, depth + 1, target) for c in bone.children)
		if kids:
			return '%s<bone name="%s">%s\n%s%s</bone>\n' % (pad, bone.name, inner, kids, pad)
		return '%s<bone name="%s">%s</bone>\n' % (pad, bone.name, inner)
	roots = [b for b in ob.data.bones if b.parent is None]
	assert len(roots) == 1, [b.name for b in roots]
	root = roots[0]
	text = ('<?xml version="1.0" encoding="utf-8"?>\n<!-- %s -->\n<skeletons>\n'
		'\t<standard_skeleton title="%s" id="%s">\n%s\t</standard_skeleton>\n\n'
		'\t<skeleton title="%s" target="%s">\n\t\t<identifier>\n\t\t\t<root>%s</root>\n\t\t</identifier>\n%s\t</skeleton>\n</skeletons>\n') % (
		comment, title, sid, tree(root, 2, False), title, sid, root.name, tree(root, 2, True))
	with open(os.path.join(MOD, "art", "skeletons", sid + ".xml"), "w", encoding="utf-8") as f:
		f.write(text)


# Animação -----------------------------------------------------------------

class Anim:
	"""Anima ossos-controle quadro a quadro: `pose(f, t)` recebe o quadro e a
	fase 0..1 e devolve {osso: Matrix (espaço da armadura) ou
	('rot', Matrix 3x3 local) }. Depois assa o resultado visual (com IK) numa
	ação nova só com os ossos que deformam/props."""

	def __init__(self, arm, name, frames, pose, loop=True):
		self.arm, self.name, self.frames, self.pose, self.loop = arm, name, frames, pose, loop


def key_pose(arm, frame, values):
	"""values: {osso: ('world', Matrix4) | ('local', Matrix4)} - local é em
	relação ao repouso do osso (como pose_bone.matrix_basis)."""
	sc = bpy.context.scene
	sc.frame_set(frame)
	order = [b.name for b in arm.data.bones]  # pais vêm antes dos filhos
	for name in order:
		if name not in values:
			continue
		kind, m = values[name]
		pb = arm.pose.bones[name]
		if kind == "local":
			pb.matrix_basis = m
		else:
			bpy.context.view_layer.update()
			pb.matrix = m
		pb.keyframe_insert("location", frame=frame)
		pb.keyframe_insert("rotation_quaternion", frame=frame)
		pb.keyframe_insert("scale", frame=frame)


def make_action(arm, name, frames, pose_fn, controls):
	"""Cria a ação `name` de 1..frames+1 (último = primeiro nos laços).
	pose_fn(t) -> values para key_pose; `controls` são todos os ossos que
	recebem chave (os não citados num quadro voltam ao repouso)."""
	sc = bpy.context.scene
	for pb in arm.pose.bones:
		pb.rotation_mode = "QUATERNION"
	arm.animation_data_create()
	src = bpy.data.actions.new(name + "_src")
	arm.animation_data.action = src
	for f in range(frames + 1):
		for pb in arm.pose.bones:
			pb.matrix_basis = Matrix()
		vals = {c: ("local", Matrix()) for c in controls}
		vals.update(pose_fn(f / frames))
		key_pose(arm, f + 1, vals)
	sc.frame_start, sc.frame_end = 1, frames + 1
	select([arm])
	bpy.ops.object.mode_set(mode="POSE")
	bpy.ops.pose.select_all(action="SELECT")
	bpy.ops.nla.bake(frame_start=1, frame_end=frames + 1, only_selected=False, visual_keying=True,
		clear_constraints=False, use_current_action=False, bake_types={"POSE"})
	bpy.ops.object.mode_set(mode="OBJECT")
	act = arm.animation_data.action
	act.name = name
	act.use_fake_user = True
	bpy.data.actions.remove(src)
	arm.animation_data.action = None
	return act


def rest_matrices(arm):
	return {b.name: b.matrix_local.copy() for b in arm.data.bones}


def local_pose(rest, name, rot=(), move=(0, 0, 0)):
	"""Pose local de um osso: rotações (eixo no espaço da armadura, graus,
	aplicadas em ordem) em torno da cabeça e deslocamento no espaço da
	armadura (relativos ao pai, como se o pai estivesse em repouso)."""
	r3 = rest[name].to_3x3()
	m = Matrix()
	for axis, deg in rot:
		m = Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ m
	basis = r3.inverted().to_4x4() @ m @ r3.to_4x4()
	basis.translation = r3.inverted() @ Vector(move)
	return ("local", basis)


def world_pose(rest, name, move=(0, 0, 0), rot=()):
	"""Pose no espaço da armadura: repouso deslocado/girado (para alvos de IK
	sem pai)."""
	m = Matrix()
	for axis, deg in rot:
		m = Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ m
	r = rest[name]
	out = Matrix.Translation(r.translation) @ m @ Matrix.Translation(-r.translation) @ r
	out.translation += Vector(move)
	return ("world", out)


def ik_targets(arm, pairs):
	"""pairs: [(osso_do_pé, osso_da_IK, cadeia)]: cria alvos 'ik_<pé>' com a
	orientação do pé, IK no osso indicado e cópia de rotação no pé."""
	select([arm])
	bpy.ops.object.mode_set(mode="EDIT")
	for foot, _, _ in pairs:
		f = arm.data.edit_bones[foot]
		t = arm.data.edit_bones.new("ik_" + foot)
		t.head, t.tail, t.roll = f.head.copy(), f.tail.copy(), f.roll
		t.use_deform = False
	bpy.ops.object.mode_set(mode="OBJECT")
	for foot, bone, chain in pairs:
		ik(arm, bone, "ik_" + foot, chain)
		c = arm.pose.bones[foot].constraints.new("COPY_ROTATION")
		c.target, c.subtarget = arm, "ik_" + foot
	return ["ik_" + f for f, _, _ in pairs]


def ik(arm, bone, target, chain, pole=None, pole_angle=0.0):
	c = arm.pose.bones[bone].constraints.new("IK")
	c.target = arm
	c.subtarget = target
	c.chain_count = chain
	if pole:
		c.pole_target = arm
		c.pole_subtarget = pole
		c.pole_angle = pole_angle
	return c


def clear_constraints(arm):
	for pb in arm.pose.bones:
		for c in list(pb.constraints):
			pb.constraints.remove(c)


def walk_foot(t, phase, stride, lift, duty=0.5):
	"""Posição do pé (dy, dz) relativa ao repouso num ciclo de passada com a
	frente em -Y: apoio (pé vai de -stride/2 a +stride/2 no chão) e voo."""
	p = (t + phase) % 1.0
	if p < duty:
		s = p / duty
		return -stride / 2 + stride * s, 0.0
	s = (p - duty) / (1 - duty)
	ease = 0.5 - 0.5 * math.cos(math.pi * s)
	return stride / 2 - stride * ease, lift * math.sin(math.pi * s)


# Exportação ---------------------------------------------------------------

def _export(path, objects, animations):
	select(objects)
	os.makedirs(os.path.dirname(path), exist_ok=True)
	bpy.ops.wm.collada_export(
		filepath=path, check_existing=False, selected=True, include_children=False,
		include_armatures=True, include_shapekeys=False, deform_bones_only=False,
		include_animations=animations, include_all_actions=False,
		export_animation_type_selection="sample", sampling_rate=1,
		keep_smooth_curves=False, keep_keyframes=False, keep_flat_curves=True,
		apply_modifiers=False, triangulate=True, use_object_instantiation=False,
		use_blender_profile=False, sort_by_name=False, open_sim=False,
		limit_precision=False, keep_bind_info=False,
		active_uv_only=True, use_texture_copies=False, export_global_forward_selection="Y",
		export_global_up_selection="Z", apply_global_orientation=False)


def triangulate(o):
	bm = bmesh.new()
	bm.from_mesh(o.data)
	bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
	# Arestas soltas viram <lines> e o conversor só aceita triângulos.
	bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")
	bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
	bm.to_mesh(o.data)
	bm.free()


def export_mesh(mesh, arm, rel):
	"""rel: caminho em art/meshes/ (ex.: vehicle/spider_tank.dae)."""
	triangulate(mesh)
	if arm.animation_data:
		arm.animation_data.action = None
	for pb in arm.pose.bones:
		pb.matrix_basis = Matrix()
	_export(os.path.join(MOD, "art", "meshes", rel), [mesh, arm], False)


def export_action(arm, act, rel, mesh):
	"""rel: caminho em art/animation/. O conversor do jogo só acha o
	esqueleto se houver a malha com pele no arquivo."""
	arm.animation_data_create()
	arm.animation_data.action = act
	sc = bpy.context.scene
	sc.frame_start, sc.frame_end = int(act.frame_range[0]), int(act.frame_range[1])
	_export(os.path.join(MOD, "art", "animation", rel), [arm, mesh], True)
	arm.animation_data.action = None
	for pb in arm.pose.bones:
		pb.matrix_basis = Matrix()


# Conferência visual -------------------------------------------------------

def render_frames(objects, out_png, arm=None, act=None, frames=(1,), views=("front", "side", "top"), res=320):
	"""Grava uma folha de miniaturas (workbench) para conferir orientação e
	poses: linhas = quadros, colunas = vistas."""
	import numpy as np
	sc = bpy.context.scene
	sc.render.engine = "BLENDER_WORKBENCH"
	sc.display.shading.light = os.environ.get("MW_LIGHT", "STUDIO")
	sc.display.shading.color_type = os.environ.get("MW_SHADING", "TEXTURE")
	sc.render.resolution_x = sc.render.resolution_y = res
	lo, hi = world_bounds([o for o in objects if o.type == "MESH"])
	c = (lo + hi) / 2
	r = (hi - lo).length * 0.75
	cam_data = bpy.data.cameras.new("cam")
	cam_data.type = "ORTHO"
	cam_data.ortho_scale = r * 2
	cam = bpy.data.objects.new("cam", cam_data)
	sc.collection.objects.link(cam)
	sc.camera = cam
	dirs = {"front": Vector((0, -1, 0.35)), "side": Vector((1, 0, 0.2)), "top": Vector((0.001, -0.001, 1)),
		"persp": Vector((0.8, -1, 0.6)), "back": Vector((0, 1, 0.3)), "rear": Vector((-0.8, 1, 0.6)),
		"below": Vector((0.3, -0.3, -1))}
	if arm is not None and act is not None:
		arm.animation_data_create()
		arm.animation_data.action = act
	rows = []
	tmp = tempfile.mkdtemp()
	for f in frames:
		sc.frame_set(f)
		row = []
		for v in views:
			d = dirs[v].normalized()
			cam.location = c + d * r * 3
			cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
			cam_data.clip_end = r * 10
			p = os.path.join(tmp, "f.png")
			sc.render.filepath = p
			bpy.ops.render.render(write_still=True)
			im = bpy.data.images.load(p)
			row.append(pixels(im)[..., :3].copy())
			bpy.data.images.remove(im)
		rows.append(np.concatenate(row, axis=1))
	save_png(np.concatenate(rows[::-1], axis=0), out_png)
	bpy.data.objects.remove(cam)
	shutil.rmtree(tmp, ignore_errors=True)
	if arm is not None and arm.animation_data:
		arm.animation_data.action = None

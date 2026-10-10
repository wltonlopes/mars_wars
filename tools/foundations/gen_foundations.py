#!/usr/bin/env python3
"""
Fundações (canteiros de obra) das estruturas do mod, no estilo do 0 A.D.:
um actor por tamanho, em tiles de 4 m (fndn_mars_<L>x<P>), reaproveitado por
todas as estruturas que cabem nele.

Cada fundação tem:
  - o piso da obra (sempre visível): laje de concreto, vigas de aço em I no
    contorno, formas metálicas com faixas de alerta, esperas de vergalhão e
    pilhas de vigas e caixotes (duas variações sorteadas);
  - a variante "scaffold" (o jogo a liga quando os construtores começam):
    andaimes de tubo com pranchas e travamentos em volta da obra e, nas obras
    grandes, uma grua.

Gera:
  art/textures/skins/structural/mars_construction.png    atlas de materiais
  art/meshes/structural/mars/found_<L>x<P>_<n>.dae       piso da obra
  art/meshes/props/mars/scaf_<L>x<P>.dae                 andaimes
  art/actors/props/structures/construction/mars_scaf_<L>x<P>.xml
  art/actors/structures/mars/fndn_mars_<L>x<P>.xml        a fundação

e põe <FoundationActor> nas estruturas do mcc e do mla (as demais facções
herdam), escolhendo o tamanho pela obstrução de cada uma. As estruturas com
modelo próprio dos Piratas recebem a delas pelo gerador de facções.

Uso (na pasta do mod):  python3 tools/foundations/gen_foundations.py [--preview pasta]
Precisa de numpy e Pillow.
"""
import math
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

MOD = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC_ZIP = "/snap/0ad/745/binaries/data/mods/public/public.zip"
TILE = 4.0

TEXTURE = "structural/mars_construction.png"
MESH_DIR = "art/meshes/structural/mars"
SCAF_MESH_DIR = "art/meshes/props/mars"
SCAF_ACTOR_DIR = "art/actors/props/structures/construction"
ACTOR_DIR = "art/actors/structures/mars"

# Estruturas do mcc e do mla que recebem fundação (as facções derivadas herdam).
STRUCTURES = ["aero", "barracks", "civil_centre", "farmstead", "field", "forge", "house",
	"sentry_tower", "air_defense_tower", "silos", "stable", "storehouse"]
# Tamanhos extras (L x P em tiles) para estruturas com modelo próprio (Piratas).
EXTRA_SIZES = [(3, 8), (3, 11), (4, 11), (4, 7)]

# ----------------------------------------------------------------- textura
# Atlas 4x4: cada material ocupa uma célula; as faces usam a célula inteira.
CELLS = {"concrete": 0, "steel": 1, "tube": 2, "deck": 3, "hazard": 4, "form": 5, "crate": 6,
	"rebar": 7, "dirt": 8, "rust": 9, "cable": 10, "yellow": 11}
GRID = 4
TEX_SIZE = 512


def make_texture(path):
	rng = np.random.default_rng(7)
	cell = TEX_SIZE // GRID
	img = Image.new("RGB", (TEX_SIZE, TEX_SIZE))

	def noise(base, amount, blur=1.2):
		a = rng.normal(0, amount, (cell, cell, 1)) + np.array(base, float)
		tile = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
		return tile

	def put(name, tile):
		i = CELLS[name]
		img.paste(tile, ((i % GRID) * cell, (i // GRID) * cell))

	put("concrete", noise((150, 146, 140), 14))
	put("steel", noise((70, 74, 80), 8))
	put("tube", noise((176, 180, 186), 7))
	put("rust", noise((128, 72, 44), 16))
	put("cable", noise((40, 40, 42), 4))
	put("yellow", noise((214, 168, 32), 10))
	put("dirt", noise((150, 96, 62), 18, 2))
	put("rebar", noise((96, 60, 40), 10))

	deck = noise((120, 118, 112), 9)
	d = ImageDraw.Draw(deck)
	for y in range(0, cell, cell // 6):
		d.line([(0, y), (cell, y)], fill=(70, 68, 64), width=2)
	for x in range(0, cell, 10):
		d.line([(x, 0), (x, cell)], fill=(95, 93, 88), width=1)
	put("deck", deck)

	hazard = Image.new("RGB", (cell, cell), (30, 30, 30))
	d = ImageDraw.Draw(hazard)
	for x in range(-cell, 2 * cell, 32):
		d.polygon([(x, cell), (x + 16, cell), (x + 16 + cell, 0), (x + cell, 0)], fill=(222, 176, 30))
	put("hazard", hazard)

	form = noise((176, 98, 46), 10)
	d = ImageDraw.Draw(form)
	for y in (6, cell // 2, cell - 8):
		d.line([(0, y), (cell, y)], fill=(110, 58, 26), width=3)
	for x in range(8, cell, 24):
		for y in (14, cell // 2 + 8, cell - 20):
			d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(90, 50, 24))
	put("form", form)

	crate = noise((86, 98, 62), 7)
	d = ImageDraw.Draw(crate)
	d.rectangle([3, 3, cell - 4, cell - 4], outline=(56, 64, 40), width=6)
	d.line([(6, 6), (cell - 7, cell - 7)], fill=(60, 70, 44), width=6)
	put("crate", crate)

	os.makedirs(os.path.dirname(path), exist_ok=True)
	img.save(path)


def cell_uv(name):
	i = CELLS[name]
	u0, v0 = (i % GRID) / GRID, (i // GRID) / GRID
	pad = 0.004
	# V cresce para cima no COLLADA; a imagem cresce para baixo.
	return u0 + pad, 1 - (v0 + 1 / GRID) + pad, u0 + 1 / GRID - pad, 1 - v0 - pad


# ------------------------------------------------------------------- malha
class Builder:
	"""Acumula caixas orientadas (posições, normais, UVs, triângulos)."""

	def __init__(self):
		self.pos, self.nor, self.uv, self.tri = [], [], [], []

	def box(self, center, size, material, rotation=None):
		R = np.eye(3) if rotation is None else rotation
		c = np.array(center, float)
		h = np.array(size, float) / 2
		u0, v0, u1, v1 = cell_uv(material)
		faces = [((0, 0, 1), (1, 0, 0)), ((0, 0, -1), (1, 0, 0)), ((1, 0, 0), (0, 1, 0)),
			((-1, 0, 0), (0, 1, 0)), ((0, 1, 0), (1, 0, 0)), ((0, -1, 0), (1, 0, 0))]
		for normal, tangent in faces:
			n = np.array(normal, float)
			t = np.array(tangent, float)
			b = np.cross(n, t)
			corners = [n * h + s * t * h + r * b * h for s, r in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
			base = len(self.pos)
			for k, corner in enumerate(corners):
				self.pos.append(R @ corner + c)
				self.nor.append(R @ n)
				self.uv.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1))[k])
			self.tri += [(base, base + 1, base + 2), (base, base + 2, base + 3)]

	def beam(self, a, b, thickness, material, up=(0, 0, 1)):
		"""Caixa entre os pontos a e b (tubo, travessa, diagonal)."""
		a, b = np.array(a, float), np.array(b, float)
		axis = b - a
		length = np.linalg.norm(axis)
		x = axis / length
		u = np.array(up, float)
		if abs(np.dot(u, x)) > 0.95:
			u = np.array([1.0, 0, 0]) if abs(x[0]) < 0.9 else np.array([0, 1.0, 0])
		y = np.cross(u, x)
		y /= np.linalg.norm(y)
		z = np.cross(x, y)
		self.box((a + b) / 2, (length, thickness, thickness), material, np.column_stack([x, y, z]))

	def i_beam(self, a, b, height, width, material):
		"""Viga em I deitada entre a e b (duas abas e a alma)."""
		a, b = np.array(a, float), np.array(b, float)
		x = (b - a) / np.linalg.norm(b - a)
		y = np.cross([0, 0, 1], x)
		R = np.column_stack([x, y, [0, 0, 1]])
		length = np.linalg.norm(b - a)
		mid = (a + b) / 2
		flange = height * 0.18
		self.box(mid + [0, 0, flange / 2], (length, width, flange), material, R)
		self.box(mid + [0, 0, height - flange / 2], (length, width, flange), material, R)
		self.box(mid + [0, 0, height / 2], (length, width * 0.2, height), material, R)

	def write(self, path, name):
		pos, nor, uv = np.array(self.pos), np.array(self.nor), np.array(self.uv)
		tri = np.array(self.tri)
		fmt = lambda a: " ".join("%.4g" % v for v in np.asarray(a).ravel())
		p = np.repeat(tri.ravel(), 3)
		os.makedirs(os.path.dirname(path), exist_ok=True)
		open(path, "w", encoding="utf-8").write("""<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>tools/foundations/gen_foundations.py</authoring_tool></contributor>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_geometries>
    <geometry id="{n}-mesh" name="{n}">
      <mesh>
        <source id="{n}-positions">
          <float_array id="{n}-positions-array" count="{pc}">{p}</float_array>
          <technique_common><accessor source="#{n}-positions-array" count="{vc}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>
        </source>
        <source id="{n}-normals">
          <float_array id="{n}-normals-array" count="{pc}">{nr}</float_array>
          <technique_common><accessor source="#{n}-normals-array" count="{vc}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>
        </source>
        <source id="{n}-map-0">
          <float_array id="{n}-map-0-array" count="{uc}">{uv}</float_array>
          <technique_common><accessor source="#{n}-map-0-array" count="{vc}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common>
        </source>
        <vertices id="{n}-vertices"><input semantic="POSITION" source="#{n}-positions"/></vertices>
        <triangles count="{tc}">
          <input semantic="VERTEX" source="#{n}-vertices" offset="0"/>
          <input semantic="NORMAL" source="#{n}-normals" offset="1"/>
          <input semantic="TEXCOORD" source="#{n}-map-0" offset="2" set="0"/>
          <p>{idx}</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="{n}" name="{n}" type="NODE">
        <matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
        <instance_geometry url="#{n}-mesh" name="{n}"/>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
""".format(n=name, pc=pos.size, vc=len(pos), uc=uv.size, tc=len(tri), p=fmt(pos), nr=fmt(nor), uv=fmt(uv),
			idx=" ".join(map(str, p))))
		return len(tri)


def rot_z(angle):
	c, s = math.cos(angle), math.sin(angle)
	return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def edges(W, D, inset):
	"""Os quatro lados do retângulo (centrado na origem), recuados `inset`:
	(início, fim, normal para fora)."""
	x, y = W / 2 - inset, D / 2 - inset
	return [((-x, -y), (x, -y), (0, -1)), ((x, -y), (x, y), (1, 0)),
		((x, y), (-x, y), (0, 1)), ((-x, y), (-x, -y), (-1, 0))]


# ---------------------------------------------------------- piso da obra
def build_ground(W, D, variant):
	rng = np.random.default_rng(int(W * 100 + D * 10 + variant))
	g = Builder()
	# Laje e terra batida em volta.
	g.box((0, 0, 0.02), (W + 0.6, D + 0.6, 0.04), "dirt")
	g.box((0, 0, 0.1), (W - 0.6, D - 0.6, 0.14), "concrete")

	for (ax, ay), (bx, by), (nx, ny) in edges(W, D, 0.25):
		a, b = np.array([ax, ay, 0.0]), np.array([bx, by, 0.0])
		length = np.linalg.norm(b - a)
		direction = (b - a) / length
		# Viga em I deitada ao longo de todo o lado.
		g.i_beam(a, b, 0.32, 0.28, "steel")
		# Formas metálicas em trechos, com faixa de alerta por cima.
		inner = np.array([-nx, -ny, 0.0]) * 0.55
		s = 0.6
		while s + 2.2 < length - 0.6:
			if rng.random() < 0.7:
				p0 = a + direction * s + inner
				p1 = a + direction * (s + 2.2) + inner
				mid = (p0 + p1) / 2
				R = np.column_stack([direction, np.cross([0, 0, 1], direction), [0, 0, 1]])
				g.box(mid + [0, 0, 0.45], (2.2, 0.06, 0.7), "form", R)
				g.box(mid + [0, 0, 0.84], (2.2, 0.08, 0.08), "hazard", R)
			s += 2.6
		# Esperas de vergalhão a cada 1,5 m, um pouco para dentro.
		s = 1.0
		while s < length - 1.0:
			p = a + direction * s + inner * 2.2
			g.box(p + [0, 0, 0.75], (0.06, 0.06, 1.3), "rebar")
			s += 1.5

	# Pilhas de material nos cantos (a variação muda quais cantos).
	corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
	rng.shuffle(corners)
	for k, (sx, sy) in enumerate(corners[:2 if min(W, D) < 14 else 3]):
		cx, cy = sx * (W / 2 - 2.2), sy * (D / 2 - 2.2)
		if k % 2 == 0:
			# Vigas empilhadas.
			length = min(4.0, W * 0.3)
			for layer in range(3):
				for j in range(3 - layer):
					off = (j - (2 - layer) / 2) * 0.36
					a = np.array([cx - length / 2, cy + off, 0.16 + layer * 0.3])
					g.i_beam(a, a + [length, 0, 0], 0.28, 0.26, "steel" if layer < 2 else "rust")
		else:
			# Caixotes.
			for j in range(3):
				size = rng.uniform(0.8, 1.2)
				g.box((cx + (j % 2) * 1.2 - 0.6, cy + (j // 2) * 1.2 - 0.6, 0.16 + size / 2), (size, size, size), "crate",
					rot_z(rng.uniform(-0.3, 0.3)))
	return g


# --------------------------------------------------------------- andaimes
def build_scaffold(W, D):
	s = Builder()
	height = float(np.clip(4 + 0.13 * min(W, D), 5, 10))
	levels = [z for z in np.arange(2.0, height + 0.01, 2.0)]
	tube = 0.09

	for (ax, ay), (bx, by), (nx, ny) in edges(W, D, -0.4):
		a, b = np.array([ax, ay, 0.0]), np.array([bx, by, 0.0])
		length = np.linalg.norm(b - a)
		direction = (b - a) / length
		out = np.array([nx, ny, 0.0])
		bays = max(1, int(round(length / 2.2)))
		step = length / bays
		for i in range(bays + 1):
			p = a + direction * (i * step)
			for depth in (0.0, 1.0):
				base = p + out * depth
				s.beam(base, base + [0, 0, height + 1.0 * (depth == 0)], tube, "tube")
			for z in levels[::2] if bays > 8 else levels:
				s.beam(p + [0, 0, z], p + out + [0, 0, z], tube, "tube")
		for z in levels:
			for depth in (0.0, 1.0):
				s.beam(a + out * depth + [0, 0, z], b + out * depth + [0, 0, z], tube, "tube")
			# Prancha e rodapé com faixa de alerta.
			R = np.column_stack([direction, np.cross([0, 0, 1], direction), [0, 0, 1]])
			mid = (a + b) / 2 + out * 0.5 + [0, 0, z + 0.05]
			s.box(mid, (length, 0.9, 0.05), "deck", R)
		# Guarda-corpo no topo e diagonais na face de fora, um vão sim, outro não.
		top = levels[-1] + 1.0
		s.beam(a + out + [0, 0, top], b + out + [0, 0, top], tube, "yellow")
		for i in range(0, bays, 2):
			p0 = a + direction * (i * step) + out
			p1 = a + direction * ((i + 1) * step) + out
			s.beam(p0 + [0, 0, 0.2], p1 + [0, 0, levels[-1]], tube * 0.8, "tube")

	# Grua nas obras grandes: torre treliçada num canto, lança sobre a obra.
	if min(W, D) >= 28:
		cx, cy = -W / 2 - 3.5, -D / 2 - 3.5
		mast = height * 2.2
		half = 0.8
		for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
			s.beam((cx + dx * half, cy + dy * half, 0), (cx + dx * half, cy + dy * half, mast), 0.16, "yellow")
		for z in np.arange(1.5, mast, 3.0):
			for (dx0, dy0), (dx1, dy1) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
				s.beam((cx + dx0 * half, cy + dy0 * half, z), (cx + dx1 * half, cy + dy1 * half, z + 1.5), 0.08, "yellow")
		reach = min(W, D) * 0.8
		angle = math.atan2(D, W)
		tip = np.array([cx + math.cos(angle) * reach, cy + math.sin(angle) * reach, mast + 0.5])
		back = np.array([cx - math.cos(angle) * reach * 0.3, cy - math.sin(angle) * reach * 0.3, mast + 0.5])
		s.beam(back, tip, 0.5, "yellow")
		s.box(back + [0, 0, -0.6], (2.0, 2.0, 1.2), "concrete", rot_z(angle))
		s.box((cx, cy, mast + 1.2), (1.6, 1.6, 1.4), "steel")
		hook_top = tip - (tip - back) * 0.3
		hook = hook_top.copy()
		hook[2] = height + 1.5
		s.beam(hook_top, hook, 0.04, "cable")
		s.box(hook - [0, 0, 0.3], (0.4, 0.4, 0.6), "steel")
	return s


# ----------------------------------------------------------------- actors
FOUNDATION_ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- Canteiro de obra {L}x{P} tiles ({w:g} x {d:g} m), gerado por
     tools/foundations/gen_foundations.py. O piso fica visível o tempo todo;
     a variante "scaffold" (andaimes) entra quando os construtores começam. -->
<actor version="1">
  <castshadow/>
  <group>
    <variant frequency="1" name="Base">
      <props>
        <prop actor="particle/construction_dust.xml" attachpoint="root"/>
      </props>
      <textures>
        <texture file="{tex}" name="baseTex"/>
      </textures>
    </variant>
  </group>
  <group>
{variants}  </group>
  <group>
    <variant frequency="1" name="Idle"/>
    <variant name="scaffold">
      <props>
        <prop actor="props/structures/construction/mars_scaf_{L}x{P}.xml" attachpoint="root"/>
        <prop actor="particle/construction_dust.xml" attachpoint="root"/>
      </props>
    </variant>
  </group>
  <material>default.xml</material>
</actor>
"""

SCAFFOLD_ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- Andaimes do canteiro {L}x{P} tiles, gerado por tools/foundations/gen_foundations.py. -->
<actor version="1">
  <castshadow/>
  <group>
    <variant name="Base">
      <mesh>props/mars/scaf_{L}x{P}.dae</mesh>
      <textures>
        <texture file="{tex}" name="baseTex"/>
      </textures>
    </variant>
  </group>
  <material>default.xml</material>
</actor>
"""


def write_size(L, P):
	W, D = L * TILE, P * TILE
	triangles = 0
	variants = ""
	for v in (1, 2):
		name = "found_%dx%d_%d" % (L, P, v)
		triangles += build_ground(W, D, v).write(os.path.join(MOD, MESH_DIR, name + ".dae"), name)
		variants += ('    <variant frequency="1" name="obra %dx%d %d">\n      <mesh>structural/mars/%s.dae</mesh>\n'
			'    </variant>\n') % (L, P, v, name)
	scaffold = "scaf_%dx%d" % (L, P)
	triangles += build_scaffold(W, D).write(os.path.join(MOD, SCAF_MESH_DIR, scaffold + ".dae"), scaffold)
	os.makedirs(os.path.join(MOD, ACTOR_DIR), exist_ok=True)
	os.makedirs(os.path.join(MOD, SCAF_ACTOR_DIR), exist_ok=True)
	open(os.path.join(MOD, ACTOR_DIR, "fndn_mars_%dx%d.xml" % (L, P)), "w", encoding="utf-8").write(
		FOUNDATION_ACTOR.format(L=L, P=P, w=W, d=D, tex=TEXTURE, variants=variants))
	open(os.path.join(MOD, SCAF_ACTOR_DIR, "mars_scaf_%dx%d.xml" % (L, P)), "w", encoding="utf-8").write(
		SCAFFOLD_ACTOR.format(L=L, P=P, tex=TEXTURE))
	return triangles


# --------------------------------------------------------------- templates
ZIP = zipfile.ZipFile(PUBLIC_ZIP)
ZIP_NAMES = set(ZIP.namelist())


def template(name):
	rel = "simulation/templates/" + name + ".xml"
	path = os.path.join(MOD, rel)
	data = open(path, "rb").read() if os.path.exists(path) else (ZIP.read(rel) if rel in ZIP_NAMES else None)
	return ET.fromstring(data) if data is not None else None


def resolve(name, path):
	while name:
		t = template(name)
		if t is None:
			return None
		e = t.find(path)
		if e is not None:
			return e
		name = (t.get("parent") or "").split("|")[-1] or None
	return None


def tiles_for(name):
	"""Tamanho da fundação (tiles) que cobre a obstrução da estrutura."""
	static = resolve(name, "Obstruction/Static")
	w, d = float(static.get("width")) + 1, float(static.get("depth")) + 1
	return max(2, math.ceil(w / TILE - 0.1)), max(2, math.ceil(d / TILE - 0.1))


def set_foundation(rel, actor):
	path = os.path.join(MOD, rel)
	text = open(path, encoding="utf-8").read()
	line = "<FoundationActor>%s</FoundationActor>" % actor
	if "<FoundationActor>" in text:
		text = re.sub(r"<FoundationActor>[^<]*</FoundationActor>", line, text, count=1)
	elif re.search(r"<VisualActor>\s*\n(\s*)<Actor>[^<]*</Actor>\n", text):
		text = re.sub(r"(<VisualActor>\s*\n(\s*)<Actor>[^<]*</Actor>\n)", lambda m: m.group(1) + m.group(2) + line + "\n", text, count=1)
	else:
		i = text.rindex("</Entity>")
		text = text[:i] + "  <VisualActor>\n    " + line + "\n  </VisualActor>\n" + text[i:]
	open(path, "w", encoding="utf-8").write(text)


def main():
	make_texture(os.path.join(MOD, "art/textures/skins", TEXTURE))

	sizes = {}
	for civ in ("mcc", "mla"):
		for structure in STRUCTURES:
			name = "structures/%s/%s" % (civ, structure)
			if template(name) is not None:
				sizes[name] = tiles_for(name)
	needed = sorted(set(sizes.values()) | set(EXTRA_SIZES))
	for L, P in needed:
		print("fndn_mars_%dx%d: %d triângulos" % (L, P, write_size(L, P)))
	for name, (L, P) in sorted(sizes.items()):
		set_foundation("simulation/templates/%s.xml" % name, "structures/mars/fndn_mars_%dx%d.xml" % (L, P))
		print("  %-36s fndn_mars_%dx%d" % (name, L, P))

	if "--preview" in sys.argv:
		preview(sys.argv[sys.argv.index("--preview") + 1], [(4, 4), (6, 10), (10, 12)])


def preview(folder, picks):
	"""Vista 3/4 de alguns tamanhos (piso + andaimes), coloridas pelo atlas."""
	os.makedirs(folder, exist_ok=True)
	tex = np.asarray(Image.open(os.path.join(MOD, "art/textures/skins", TEXTURE)).convert("RGB"), float)
	W, H = 640, 480
	sheet = Image.new("RGB", (W * len(picks), H), (24, 24, 28))
	d = ImageDraw.Draw(sheet)
	light = np.array([0.4, -0.5, 0.8]) / np.linalg.norm([0.4, -0.5, 0.8])
	for col, (L, P) in enumerate(picks):
		parts = [build_ground(L * TILE, P * TILE, 1), build_scaffold(L * TILE, P * TILE)]
		pos = np.vstack([np.array(b.pos) for b in parts])
		uv = np.vstack([np.array(b.uv) for b in parts])
		tri, base = [], 0
		for b in parts:
			tri.append(np.array(b.tri) + base)
			base += len(b.pos)
		tri = np.vstack(tri)
		yaw, pitch = math.radians(35), math.radians(30)
		Rz = np.array([[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]])
		Rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
		V = Rx @ Rz
		v = pos @ V.T
		scale = 0.8 * min(W, H) / max(np.ptp(v[:, 0]), np.ptp(v[:, 2]))
		cx, cz = v[:, 0].mean(), v[:, 2].mean()
		t = v[tri]
		n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
		n /= np.linalg.norm(n, axis=1)[:, None] + 1e-9
		shade = 0.35 + 0.65 * np.abs(n @ (V @ light))
		for i in np.argsort(-t[:, :, 1].mean(axis=1)):
			u = uv[tri[i]].mean(axis=0)
			color = tex[int((1 - u[1]) * (TEX_SIZE - 1)), int(u[0] * (TEX_SIZE - 1))] * shade[i]
			d.polygon([(col * W + W / 2 + (q[0] - cx) * scale, H / 2 - (q[2] - cz) * scale) for q in t[i]],
				fill=tuple(int(c) for c in color))
		d.text((col * W + 6, 6), "fndn_mars_%dx%d" % (L, P), fill=(230, 230, 230))
	sheet.save(os.path.join(folder, "foundations.png"))
	print("prévia:", os.path.join(folder, "foundations.png"))


if __name__ == "__main__":
	main()

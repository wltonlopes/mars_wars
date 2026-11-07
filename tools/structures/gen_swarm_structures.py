#!/usr/bin/env python3
"""
Estruturas do Enxame (Mars 2150 - Structures Atlas Swarm): cúpulas
biomecânicas com nervuras, agulhas e espinhos, cabos e tentáculos orgânicos,
placas metálicas corroídas e fendas com brilho laranja.

Tudo é gerado por código (malhas COLLADA, atlas de textura, actors):

  art/textures/skins/structural/swarm_hive.png         atlas de cor (alfa = cor do jogador)
  art/textures/skins/structural/swarm_hive_norm.png    relevo
  art/textures/skins/structural/swarm_hive_spec.png    brilho
  art/textures/skins/structural/swarm_hive_glow.png    partes que brilham
  art/meshes/structural/swarm_hive/<nome>.dae          estrutura
  art/meshes/structural/swarm_hive/<nome>_glow.dae     fendas/veias acesas
  art/actors/structures/swarm_hive/<nome>.xml          actor (com o brilho e o decalque como props)
  art/actors/structures/swarm_hive/<nome>_decal.xml    "creep" orgânico no chão (decalque)
  art/textures/skins/props/swarm_creep*.png            textura do decalque (cor/alfa, relevo, brilho)

O chão em volta não é mais uma laje sólida: é um decalque, que acompanha o
relevo do terreno (uma caixa plana flutua ou afunda em declives). Sob cada
prédio fica só uma base com saia enterrada, para ele não flutuar.

Cada modelo tem o tamanho da obstrução que a estrutura já tem no jogo (a frente
é -Y, como nos outros modelos do mod). O gerador de facções passa a usar estes
actors pelas substituições em tools/factions/actor_overrides.json.

Uso (na pasta do mod):  python3 tools/structures/gen_swarm_structures.py [--preview pasta]
Precisa de numpy, scipy e Pillow.
"""
import importlib.util
import json
import math
import os
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

MOD = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX = "structural/swarm_hive"
MESH_DIR = "art/meshes/structural/swarm_hive"
ACTOR_DIR = "art/actors/structures/swarm_hive"

# Estrutura do Enxame -> (modelo, largura X, profundidade Y, altura) em metros.
STRUCTURES = {
	"civil_centre": ("hive_core", 31.0, 31.0, 24.0),
	"barracks": ("spawn_chamber", 21.0, 37.5, 14.0),
	"stable": ("unit_nest", 39.5, 32.0, 12.0),
	"storehouse": ("resource_nexus", 14.5, 21.0, 13.0),
	"house": ("power_node", 16.5, 20.0, 15.0),
	"farmstead": ("biosphere", 42.5, 40.5, 14.0),
	"field": ("infestation_node", 42.5, 40.5, 7.0),
	"forge": ("evolution_chamber", 40.0, 46.5, 24.0),
	"sentry_tower": ("defense_spire", 13.5, 13.5, 17.0),
}

# ===================================================================== textura
SIZE = 2048
GRID = 4
CELL = SIZE // GRID
CELLS = {"rust": 0, "plate": 1, "organic": 2, "cable": 3, "rib": 4, "concrete": 5, "dirt": 6, "player": 7,
	"hazard": 8, "grate": 9, "spike": 10, "dark": 11}
GLOW_CELLS = {"orange": 0, "red": 1}


def noise(shape, scale, rng):
	"""Ruído suave (soma de oitavas) em [0, 1]."""
	out = np.zeros(shape)
	amp, total = 1.0, 0.0
	for octave in range(5):
		s = max(1, int(scale / 2 ** octave))
		small = rng.random((shape[0] // s + 2, shape[1] // s + 2))
		big = ndimage.zoom(small, s, order=1)[:shape[0], :shape[1]]
		out += big * amp
		total += amp
		amp *= 0.5
	out /= total
	return (out - out.min()) / (np.ptp(out) + 1e-9)


def veins(rng, count, width, size=CELL):
	"""Máscara de veias orgânicas (caminhadas aleatórias que se ramificam)."""
	img = Image.new("L", (size, size), 0)
	d = ImageDraw.Draw(img)
	for _ in range(count):
		x, y = rng.uniform(0, size), rng.uniform(0, size)
		angle = rng.uniform(0, 2 * math.pi)
		w = width * rng.uniform(0.6, 1.4)
		for _ in range(rng.integers(20, 60)):
			nx, ny = x + math.cos(angle) * 9, y + math.sin(angle) * 9
			d.line([(x, y), (nx, ny)], fill=255, width=max(1, int(w)))
			x, y = nx % size, ny % size
			angle += rng.normal(0, 0.45)
			w *= 0.985
			if rng.random() < 0.05:
				bx, by, ba = x, y, angle + rng.choice([-1, 1]) * 0.9
				for _ in range(rng.integers(5, 15)):
					nbx, nby = bx + math.cos(ba) * 7, by + math.sin(ba) * 7
					d.line([(bx, by), (nbx, nby)], fill=200, width=max(1, int(w * 0.6)))
					bx, by = nbx % size, nby % size
					ba += rng.normal(0, 0.5)
	return np.asarray(img.filter(ImageFilter.GaussianBlur(1.2)), float) / 255


def make_cell(name, rng):
	"""(rgb float [0,255], altura [0,1], brilho especular [0,1], alfa [0,1])."""
	n = noise((CELL, CELL), 64, rng)
	fine = noise((CELL, CELL), 8, rng)
	h = 0.5 * n + 0.5 * fine
	alpha = np.ones((CELL, CELL))
	yy, xx = np.mgrid[0:CELL, 0:CELL] / CELL

	def rusty(base, rust_amount):
		rust = np.clip((noise((CELL, CELL), 48, rng) - (1 - rust_amount)) * 4, 0, 1)[..., None]
		col = np.array(base, float) * (0.75 + 0.5 * fine[..., None])
		rust_col = np.array([120, 52, 28], float) * (0.6 + 0.8 * fine[..., None])
		return col * (1 - rust) + rust_col * rust, rust[..., 0]

	if name == "rust":
		rgb, rust = rusty((62, 58, 56), 0.45)
		spec = 0.55 - 0.4 * rust
	elif name == "plate":
		rgb, rust = rusty((70, 68, 66), 0.3)
		grid = ((xx * 4) % 1 < 0.015) | ((yy * 3) % 1 < 0.015)
		rgb[grid] *= 0.35
		h = h * 0.4 + 0.6 * (~grid)
		for gx in np.arange(0.06, 1, 0.25):
			for gy in np.arange(0.07, 1, 0.333):
				r = ((xx - gx) ** 2 + (yy - gy) ** 2) < 0.00012
				rgb[r] = (110, 104, 98)
				h[r] = 1.0
		spec = 0.6 - 0.4 * rust
	elif name == "organic":
		v = veins(rng, 26, 7)
		base = np.array([58, 16, 18], float) * (0.6 + 0.6 * n[..., None])
		rgb = base * (1 - v[..., None]) + np.array([150, 28, 24], float) * v[..., None]
		h = 0.4 * n + 0.6 * v
		spec = 0.45 + 0.4 * v
	elif name == "cable":
		ribs = 0.5 + 0.5 * np.cos(yy * 2 * math.pi * 24)
		rgb = np.array([30, 28, 30], float) * (0.6 + 0.6 * ribs[..., None]) * (0.8 + 0.4 * fine[..., None])
		rgb[..., 0] += 22 * (noise((CELL, CELL), 64, rng) > 0.7)
		h = ribs
		spec = 0.4 + 0.4 * ribs
	elif name == "rib":
		ridges = 0.5 + 0.5 * np.cos(xx * 2 * math.pi * 6)
		rgb, rust = rusty((48, 46, 46), 0.35)
		rgb *= (0.7 + 0.5 * ridges[..., None])
		h = ridges
		spec = 0.6 - 0.3 * rust
	elif name == "concrete":
		rgb = np.array([108, 92, 80], float) * (0.7 + 0.5 * h[..., None])
		cracks = veins(rng, 10, 2) > 0.4
		rgb[cracks] *= 0.45
		h = h * 0.6 + 0.4 * (~cracks)
		spec = 0.08 + 0 * h
	elif name == "dirt":
		rgb = np.array([110, 60, 38], float) * (0.6 + 0.6 * h[..., None])
		spec = 0.03 + 0 * h
	elif name == "player":
		rgb = np.array([90, 88, 86], float) * (0.8 + 0.3 * fine[..., None])
		alpha = 0.25 + 0.2 * fine
		spec = 0.5 + 0 * h
	elif name == "hazard":
		stripes = ((xx + yy) * 6) % 1 < 0.5
		rgb, rust = rusty((58, 56, 54), 0.5)
		rgb[stripes] = rgb[stripes] * 0.4 + np.array([150, 120, 40]) * 0.6
		spec = 0.4 + 0 * h
	elif name == "grate":
		slots = (yy * 10) % 1 < 0.55
		rgb, rust = rusty((60, 58, 56), 0.25)
		rgb[slots] *= 0.25
		h = (~slots) * 1.0
		spec = 0.5 - 0.3 * slots
	elif name == "spike":
		rgb, rust = rusty((42, 40, 40), 0.25)
		tip = yy[..., None]
		rgb = rgb * (1 - tip) + np.array([96, 40, 26], float) * tip * (0.7 + 0.6 * fine[..., None])
		spec = 0.65 - 0.3 * yy
	else:  # dark
		rgb = np.array([26, 24, 24], float) * (0.7 + 0.6 * fine[..., None])
		spec = 0.3 + 0 * h
	return np.clip(rgb, 0, 255), h, np.clip(spec, 0, 1), np.clip(alpha, 0, 1)


def make_textures():
	rng = np.random.default_rng(2150)
	color = np.zeros((SIZE, SIZE, 4))
	height = np.zeros((SIZE, SIZE))
	spec = np.zeros((SIZE, SIZE))
	for name, index in CELLS.items():
		rgb, h, s, a = make_cell(name, rng)
		y0, x0 = (index // GRID) * CELL, (index % GRID) * CELL
		color[y0:y0 + CELL, x0:x0 + CELL, :3] = rgb
		color[y0:y0 + CELL, x0:x0 + CELL, 3] = a * 255
		height[y0:y0 + CELL, x0:x0 + CELL] = h
		spec[y0:y0 + CELL, x0:x0 + CELL] = s
	out = os.path.join(MOD, "art/textures/skins", TEX)
	os.makedirs(os.path.dirname(out), exist_ok=True)
	Image.fromarray(color.astype(np.uint8), "RGBA").save(out + ".png")

	gy, gx = np.gradient(ndimage.gaussian_filter(height, 1.0))
	normal = np.dstack([-gx * 10, gy * 10, np.ones_like(height)])
	normal /= np.linalg.norm(normal, axis=2)[..., None]
	Image.fromarray(((normal * 0.5 + 0.5) * 255).astype(np.uint8), "RGB").save(out + "_norm.png")
	s = (spec * 255).astype(np.uint8)
	Image.fromarray(np.dstack([s, s, s]), "RGB").save(out + "_spec.png")

	# Brilho: laranja (fendas) e vermelho (veias), com um núcleo mais claro.
	glow = np.zeros((256, 512, 4))
	yy, xx = np.mgrid[0:256, 0:256] / 256
	core = np.exp(-((yy - 0.5) * 3.2) ** 2)[..., None]
	flicker = noise((256, 256), 16, rng)[..., None]
	glow[:, :256, :3] = np.array([255, 120, 30]) * (0.55 + 0.45 * core) * (0.8 + 0.3 * flicker) + 60 * core ** 4
	glow[:, 256:, :3] = np.array([230, 30, 24]) * (0.55 + 0.45 * core) * (0.8 + 0.3 * flicker) + 40 * core ** 4
	glow[..., 3] = 255
	Image.fromarray(np.clip(glow, 0, 255).astype(np.uint8), "RGBA").save(out + "_glow.png")
	Image.new("RGBA", (8, 8), (0, 0, 0, 0)).save(out + "_glow_spec.png")


def make_creep():
	"""Decalque de "creep" do Enxame: carne orgânica escura com veias saindo do
	centro, terra queimada em volta e borda irregular que some no terreno."""
	rng = np.random.default_rng(66)
	N = 1024
	yy, xx = (np.mgrid[0:N, 0:N] - N / 2) / (N / 2)
	r = np.hypot(xx, yy)
	angle = np.arctan2(yy, xx)
	edge_noise = noise((N, N), 128, rng)
	fine = noise((N, N), 12, rng)
	# Borda irregular: raio efetivo perturbado pelo ruído e pelo ângulo.
	radius = 0.82 + 0.12 * (edge_noise - 0.5) * 2 + 0.05 * np.sin(angle * 7 + 2 * edge_noise)
	alpha = np.clip((radius - r) / 0.22, 0, 1) ** 1.3
	creep = np.clip((radius * 0.82 - r) / 0.25 + (fine - 0.5) * 0.8, 0, 1)

	# Veias radiais (caminhadas a partir do centro).
	img = Image.new("L", (N, N), 0)
	d = ImageDraw.Draw(img)
	for k in range(46):
		a = 2 * math.pi * k / 46 + rng.uniform(-0.1, 0.1)
		x, y, w = N / 2, N / 2, rng.uniform(5, 10)
		for _ in range(70):
			nx, ny = x + math.cos(a) * 7, y + math.sin(a) * 7
			d.line([(x, y), (nx, ny)], fill=255, width=max(1, int(w)))
			x, y = nx, ny
			a += rng.normal(0, 0.18)
			w *= 0.975
			if rng.random() < 0.04:
				bx, by, ba = x, y, a + rng.choice([-1, 1]) * 0.8
				for _ in range(12):
					nbx, nby = bx + math.cos(ba) * 6, by + math.sin(ba) * 6
					d.line([(bx, by), (nbx, nby)], fill=190, width=max(1, int(w * 0.5)))
					bx, by, ba = nbx, nby, ba + rng.normal(0, 0.3)
	vein = np.asarray(img.filter(ImageFilter.GaussianBlur(1.5)), float) / 255 * np.clip(1.2 - r, 0, 1)

	dirt = np.array([92, 52, 34], float) * (0.6 + 0.6 * fine[..., None])
	flesh = np.array([46, 14, 20], float) * (0.6 + 0.7 * fine[..., None])
	vein_col = np.array([150, 30, 26], float)
	rgb = dirt * (1 - creep[..., None]) + flesh * creep[..., None]
	rgb = rgb * (1 - vein[..., None]) + vein_col * vein[..., None]
	out = os.path.join(MOD, "art/textures/skins/props/swarm_creep")
	os.makedirs(os.path.dirname(out), exist_ok=True)
	rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
	Image.fromarray(rgba, "RGBA").save(out + ".png")

	height = 0.35 * fine + 0.25 * creep + 0.6 * vein
	gy, gx = np.gradient(ndimage.gaussian_filter(height, 1.2))
	normal = np.dstack([-gx * 14, gy * 14, np.ones_like(height)])
	normal /= np.linalg.norm(normal, axis=2)[..., None]
	Image.fromarray(((normal * 0.5 + 0.5) * 255).astype(np.uint8), "RGB").save(out + "_norm.png")
	# Brilho: as veias e a carne parecem úmidas; a terra é fosca.
	spec = np.clip(0.05 + 0.25 * creep + 0.55 * vein, 0, 1)
	sp = (spec * 255).astype(np.uint8)
	Image.fromarray(np.dstack([sp, sp, sp]), "RGB").save(out + "_spec.png")


def cell_uv(name, glow=False):
	if glow:
		i = GLOW_CELLS[name]
		return i / 2 + 0.01, 0.01, (i + 1) / 2 - 0.01, 0.99
	i = CELLS[name]
	u0, v0 = (i % GRID) / GRID, (i // GRID) / GRID
	pad = 0.004
	return u0 + pad, 1 - (v0 + 1 / GRID) + pad, u0 + 1 / GRID - pad, 1 - v0 - pad


# ======================================================================= malha
def frame_from(direction):
	d = np.array(direction, float)
	d /= np.linalg.norm(d)
	up = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
	a = np.cross(up, d)
	a /= np.linalg.norm(a)
	b = np.cross(d, a)
	return a, b, d


class Mesh:
	def __init__(self, glow=False):
		self.pos, self.nor, self.uv, self.tri = [], [], [], []
		self.glow = glow
		self.props = {}

	def _grid(self, points, material, smooth=True, closed_u=True, v_repeat=1.0):
		"""points[i][j]: anel i, posição j. UV: j -> u, i -> v (na célula)."""
		u0, v0, u1, v1 = cell_uv(material, self.glow)
		rows, cols = len(points), len(points[0])
		base = len(self.pos)
		P = np.array(points, float)
		N = np.zeros_like(P)
		for i in range(rows - 1):
			for j in range(cols - 1):
				n = np.cross(P[i + 1, j] - P[i, j], P[i, j + 1] - P[i, j])
				for a, b in ((i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)):
					N[a, b] += n
		N /= np.linalg.norm(N, axis=2)[..., None] + 1e-12
		for i in range(rows):
			for j in range(cols):
				self.pos.append(P[i, j])
				self.nor.append(N[i, j])
				fu = j / (cols - 1)
				fv = (i / (rows - 1) * v_repeat) % 1.0001
				self.uv.append((u0 + (u1 - u0) * fu, v0 + (v1 - v0) * min(1, fv)))
		for i in range(rows - 1):
			for j in range(cols - 1):
				a = base + i * cols + j
				self.tri += [(a, a + 1, a + cols + 1), (a, a + cols + 1, a + cols)]

	def lathe(self, center, profile, material, segments=24, scale=(1.0, 1.0), sectors=4, ribs=0.0, phase=0.0):
		"""Superfície de revolução. profile: [(raio, altura)] de baixo para cima.
		Dividida em `sectors` faixas (cada uma usa a célula inteira, para a
		textura não esticar demais). ribs: nervuras (fração do raio)."""
		cx, cy, cz = center
		per = max(2, segments // sectors)
		for s in range(sectors):
			rings = []
			for r, z in profile:
				ring = []
				for k in range(per + 1):
					a = phase + 2 * math.pi * (s * per + k) / (per * sectors)
					rr = r * (1 + ribs * max(0, math.cos(a * segments / 2)) ** 8)
					ring.append((cx + math.cos(a) * rr * scale[0], cy + math.sin(a) * rr * scale[1], cz + z))
				rings.append(ring)
			self._grid(rings, material)

	def tube(self, path, radius, material, segments=8, taper=None):
		"""Tubo ao longo de `path` (pontos 3D). taper: raio final relativo."""
		path = [np.array(p, float) for p in path]
		rings = []
		n = len(path)
		prev_a = None
		for i, p in enumerate(path):
			d = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)])
			a, b, d = frame_from(d)
			if prev_a is not None:
				# Transporte paralelo para o tubo não torcer.
				a = prev_a - np.dot(prev_a, d) * d
				a /= np.linalg.norm(a) + 1e-12
				b = np.cross(d, a)
			prev_a = a
			r = radius * (1 + ((taper if taper is not None else 1) - 1) * i / (n - 1))
			ring = [p + (a * math.cos(2 * math.pi * k / segments) + b * math.sin(2 * math.pi * k / segments)) * max(r, 0.005)
				for k in range(segments + 1)]
			rings.append(ring)
		self._grid(rings, material)

	def spike(self, base, direction, length, radius, material="spike", segments=7, bend=0.0):
		base = np.array(base, float)
		a, b, d = frame_from(direction)
		path = [base + d * length * t + a * bend * length * t * t for t in np.linspace(0, 1, 6)]
		self.tube(path, radius, material, segments, taper=0.02)

	def box(self, center, size, material, rotation=0.0, tilt=0.0):
		c = np.array(center, float)
		h = np.array(size, float) / 2
		cz, sz = math.cos(rotation), math.sin(rotation)
		ct, st = math.cos(tilt), math.sin(tilt)
		R = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]) @ np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]])
		u0, v0, u1, v1 = cell_uv(material, self.glow)
		for normal, tangent in (((0, 0, 1), (1, 0, 0)), ((0, 0, -1), (1, 0, 0)), ((1, 0, 0), (0, 1, 0)),
				((-1, 0, 0), (0, 1, 0)), ((0, 1, 0), (1, 0, 0)), ((0, -1, 0), (1, 0, 0))):
			nrm, t = np.array(normal, float), np.array(tangent, float)
			bt = np.cross(nrm, t)
			base = len(self.pos)
			for k, (s, r) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
				self.pos.append(R @ (nrm * h + s * t * h + r * bt * h) + c)
				self.nor.append(R @ nrm)
				self.uv.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1))[k])
			self.tri += [(base, base + 1, base + 2), (base, base + 2, base + 3)]

	def write(self, path, name):
		pos, nor, uv = np.array(self.pos), np.array(self.nor), np.array(self.uv)
		tri = np.array(self.tri)
		fmt = lambda a: " ".join("%.4g" % v for v in np.asarray(a).ravel())
		props = "".join('        <node id="prop_{k}" name="prop_{k}" type="NODE"><matrix sid="transform">'
			'1 0 0 {x:.3f} 0 1 0 {y:.3f} 0 0 1 {z:.3f} 0 0 0 1</matrix></node>\n'.format(k=k, x=v[0], y=v[1], z=v[2])
			for k, v in self.props.items())
		os.makedirs(os.path.dirname(path), exist_ok=True)
		open(path, "w", encoding="utf-8").write("""<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>tools/structures/gen_swarm_structures.py</authoring_tool></contributor>
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
{props}      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
""".format(n=name, pc=pos.size, vc=len(pos), uc=uv.size, tc=len(tri), p=fmt(pos), nr=fmt(nor), uv=fmt(uv),
			idx=" ".join(map(str, np.repeat(tri.ravel(), 3))), props=props))
		return len(tri)


# ===================================================== peças reaproveitáveis
def dome(m, g, center, radius, height, material="plate", ribs=True, scale=(1, 1), slits=8, rib_count=12):
	"""Cúpula com nervuras, anel da base e fendas acesas no pé."""
	profile = [(radius * math.cos(t), height * math.sin(t)) for t in np.linspace(0, math.pi / 2 * 0.97, 13)]
	m.lathe(center, profile, material, segments=48, scale=scale, sectors=6)
	cx, cy, cz = center
	# Placas de blindagem em duas fileiras, entre as nervuras.
	if ribs:
		for row, e in enumerate((0.32, 0.72)):
			count = rib_count if row == 0 else max(4, rib_count // 2)
			for k in range(count):
				a = 2 * math.pi * (k + 0.5) / count
				rx, ry = math.cos(a) * radius * scale[0], math.sin(a) * radius * scale[1]
				px = cx + rx * math.cos(e) * 1.015
				py = cy + ry * math.cos(e) * 1.015
				pz = cz + height * math.sin(e)
				# Inclinação da superfície da cúpula naquele ponto.
				tilt = math.atan2(radius * math.cos(e), height * math.sin(e) + 1e-6)
				w = 2 * math.pi * radius * math.cos(e) / count * 0.55
				m.box((px, py, pz), (w, 0.16, radius * 0.22), "plate" if row else "rust",
					rotation=math.atan2(py - cy, px - cx) - math.pi / 2, tilt=math.pi / 2 - tilt)
	if ribs:
		for k in range(rib_count):
			a = 2 * math.pi * k / rib_count
			path = [(cx + math.cos(a) * radius * 1.03 * math.cos(t) * scale[0], cy + math.sin(a) * radius * 1.03 * math.cos(t) * scale[1],
				cz + height * 1.02 * math.sin(t)) for t in np.linspace(0, math.pi / 2 * 0.92, 8)]
			m.tube(path, radius * 0.045, "rib", 6)
	m.lathe((cx, cy, cz), [(radius * 1.08, 0), (radius * 1.08, radius * 0.12), (radius * 1.0, radius * 0.16)], "rust",
		segments=32, scale=scale, sectors=4)
	for k in range(slits):
		a = 2 * math.pi * (k + 0.5) / slits
		g.box((cx + math.cos(a) * radius * 1.0 * scale[0], cy + math.sin(a) * radius * 1.0 * scale[1], cz + radius * 0.25),
			(radius * 0.3, 0.12, radius * 0.08), "orange", rotation=a + math.pi / 2)
		# Respiro (grade) logo abaixo de cada fenda.
		m.box((cx + math.cos(a) * radius * 1.07 * scale[0], cy + math.sin(a) * radius * 1.07 * scale[1], cz + radius * 0.07),
			(radius * 0.22, 0.2, radius * 0.1), "grate", rotation=a + math.pi / 2)


def spire(m, g, base, height, radius, rng, glow_vein=True, material="rib"):
	"""Agulha: torre afunilada com anéis e uma veia acesa subindo."""
	bx, by, bz = base
	profile = [(radius, 0), (radius * 0.9, height * 0.15), (radius * 0.55, height * 0.45), (radius * 0.35, height * 0.75),
		(radius * 0.08, height)]
	m.lathe(base, profile, material, segments=10, sectors=2)
	for t in (0.18, 0.42, 0.66):
		r = np.interp(t * height, [p[1] for p in profile], [p[0] for p in profile])
		m.lathe((bx, by, bz + t * height), [(r * 1.25, 0), (r * 1.25, height * 0.03)], "rust", segments=10, sectors=2)
	if glow_vein:
		a = rng.uniform(0, 2 * math.pi)
		for t0 in (0.05, 0.3):
			r = np.interp((t0 + 0.12) * height, [p[1] for p in profile], [p[0] for p in profile])
			g.box((bx + math.cos(a) * r * 0.98, by + math.sin(a) * r * 0.98, bz + (t0 + 0.12) * height),
				(0.12, 0.12, height * 0.18), "orange", rotation=a)


def tentacle(m, start, end, rng, radius=0.35, sag=2.0, material="cable", segments=7):
	"""Cabo/tentáculo arqueado entre dois pontos, com ondulação."""
	start, end = np.array(start, float), np.array(end, float)
	side = np.cross(end - start, [0, 0, 1.0])
	side /= np.linalg.norm(side) + 1e-9
	wave = rng.uniform(-1, 1)
	path = [start + (end - start) * t + np.array([0, 0, sag * math.sin(math.pi * t)]) + side * wave * math.sin(2 * math.pi * t)
		for t in np.linspace(0, 1, 12)]
	m.tube(path, radius, material, segments, taper=0.55)


def roots(m, center, radius, count, rng, reach=1.6, height=1.5, thickness=0.35, material="organic"):
	"""Raízes/cabos saindo da base e se espalhando pelo chão."""
	cx, cy, cz = center
	for k in range(count):
		a = 2 * math.pi * k / count + rng.uniform(-0.2, 0.2)
		start = (cx + math.cos(a) * radius * 0.9, cy + math.sin(a) * radius * 0.9, cz + height)
		end = (cx + math.cos(a) * radius * reach, cy + math.sin(a) * radius * reach, -0.3)
		tentacle(m, start, end, rng, thickness, sag=height * 0.4, material=material)


def ground(m, W, D, material="concrete", size=0.42):
	"""Base octogonal sob o prédio, com saia enterrada (o terreno pode ser
	inclinado) e borda de metal. O chão em volta é o decalque."""
	r = W * size
	scale = (1.0, D / W)
	m.lathe((0, 0, 0), [(r, -1.6), (r, 0.22), (r * 0.97, 0.36)], material, segments=8, sectors=8, scale=scale, phase=math.pi / 8)
	m.lathe((0, 0, 0), [(r * 1.02, 0.1), (r * 1.02, 0.3), (r * 0.99, 0.36)], "rust", segments=8, sectors=8, scale=scale, phase=math.pi / 8)


def ramp(m, g, front_y, width, length, height, material="plate"):
	"""Rampa de entrada na frente (-Y) com faixas de alerta e luzes."""
	angle = math.atan2(height, length)
	m.box((0, front_y - length / 2 * math.cos(angle), height / 2), (width, length / math.cos(angle), 0.4), material, tilt=-angle)
	for x in (-width / 2, width / 2):
		m.box((x, front_y - length / 2, height / 2), (0.4, length, height + 0.4), "hazard")
		g.box((x, front_y - length + 0.3, 0.6), (0.45, 0.45, 0.2), "orange")


def build_glow_ring(g, center, radius, height, count=10, material="orange"):
	cx, cy, cz = center
	for k in range(count):
		a = 2 * math.pi * k / count
		g.box((cx + math.cos(a) * radius, cy + math.sin(a) * radius, cz + height), (0.5, 0.5, 0.15), material, rotation=a)


# ================================================================= estruturas
def hive_core(m, g, W, D, H, rng):
	ground(m, W, D)
	R = min(W, D) * 0.33
	dome(m, g, (0, 0, 0.3), R, H * 0.42, ribs=True, rib_count=14, slits=10)
	m.lathe((0, 0, 0.3 + H * 0.38), [(R * 0.45, 0), (R * 0.42, H * 0.12), (R * 0.2, H * 0.16)], "rust", segments=16, sectors=2)
	spire(m, g, (0, 0, H * 0.45), H * 0.55, R * 0.18, rng)
	for k in range(6):
		a = 2 * math.pi * k / 6 + 0.3
		r = R * 0.55
		spire(m, g, (math.cos(a) * r, math.sin(a) * r, H * 0.25), H * rng.uniform(0.35, 0.55), R * 0.09, rng)
	# Contrafortes e espinhos curvos em volta.
	for k in range(8):
		a = 2 * math.pi * k / 8
		x, y = math.cos(a) * R * 1.05, math.sin(a) * R * 1.05
		m.box((x, y, R * 0.25), (R * 0.12, R * 0.5, R * 0.55), "rib", rotation=a + math.pi / 2)
		m.spike((x, y, R * 0.5), (math.cos(a) * 0.4, math.sin(a) * 0.4, 1), H * 0.35, R * 0.07, bend=-0.25)
	roots(m, (0, 0, 0), R, 12, rng, reach=1.45, height=R * 0.3, thickness=R * 0.05)
	ramp(m, g, -R * 1.02, R * 0.5, R * 0.45, R * 0.25)
	build_glow_ring(g, (0, 0, 0), R * 0.48, H * 0.47, 8)


def spawn_chamber(m, g, W, D, H, rng):
	ground(m, W, D)
	R = W * 0.42
	scale = (1.0, D * 0.42 / R)
	dome(m, g, (0, 0, 0.3), R, H * 0.72, scale=scale, rib_count=12, slits=10)
	m.lathe((0, D * 0.12, H * 0.6), [(R * 0.32, 0), (R * 0.3, H * 0.25), (R * 0.4, H * 0.3), (R * 0.1, H * 0.42)], "plate", segments=12, sectors=2)
	for sx in (-1, 1):
		spire(m, g, (sx * R * 0.55, D * 0.25, H * 0.35), H * 0.6, R * 0.08, rng)
		m.lathe((sx * R * 0.75, -D * 0.22, 0.3), [(R * 0.22, 0), (R * 0.2, H * 0.3), (R * 0.05, H * 0.45)], "rust", segments=10, sectors=2)
	ramp(m, g, -D * 0.4, W * 0.32, D * 0.12, H * 0.2)
	roots(m, (0, 0, 0), R, 10, rng, reach=1.25, height=H * 0.15, thickness=0.3)
	g.box((0, -D * 0.42, H * 0.25), (W * 0.22, 0.15, H * 0.18), "orange")


def unit_nest(m, g, W, D, H, rng):
	ground(m, W, D)
	R = W * 0.4
	scale = (1.0, D * 0.4 / R)
	dome(m, g, (0, 0, 0.3), R, H * 0.85, material="rust", scale=scale, rib_count=10, slits=6)
	# Tubos orgânicos cobrindo a cúpula.
	for k in range(26):
		a0 = rng.uniform(0, 2 * math.pi)
		a1 = a0 + rng.uniform(0.6, 1.6) * rng.choice([-1, 1])
		path = []
		for t in np.linspace(0, 1, 10):
			a = a0 + (a1 - a0) * t
			e = math.pi / 2 * (0.15 + 0.75 * math.sin(math.pi * t))
			path.append((math.cos(a) * R * 1.04 * math.cos(e) * scale[0], math.sin(a) * R * 1.04 * math.cos(e) * scale[1],
				0.3 + H * 0.87 * math.sin(e)))
		m.tube(path, rng.uniform(0.25, 0.5), "organic", 6, taper=0.6)
	# Boca da garagem na frente, com interior aceso.
	m.lathe((0, -D * 0.38, 0.3), [(W * 0.16, 0), (W * 0.16, H * 0.35), (W * 0.08, H * 0.55)], "dark", segments=12, sectors=2,
		scale=(1, 0.5))
	g.box((0, -D * 0.4, H * 0.2), (W * 0.2, 0.15, H * 0.3), "red")
	ramp(m, g, -D * 0.45, W * 0.3, D * 0.1, H * 0.12)


def resource_nexus(m, g, W, D, H, rng):
	ground(m, W, D)
	R = min(W, D) * 0.32
	m.lathe((0, 0, 0.3), [(R, 0), (R * 0.95, H * 0.2), (R * 0.6, H * 0.35), (R * 0.45, H * 0.6), (R * 0.15, H * 0.75)], "plate",
		segments=16, sectors=4, ribs=0.08)
	for k in range(5):
		a = 2 * math.pi * k / 5
		m.spike((math.cos(a) * R * 0.4, math.sin(a) * R * 0.4, H * 0.55), (math.cos(a) * 0.3, math.sin(a) * 0.3, 1), H * 0.45,
			R * 0.1, bend=-0.3)
	for sy in (-1, 1):
		dome(m, g, (W * 0.25 * sy, D * 0.3 * sy, 0.3), R * 0.45, H * 0.3, rib_count=8, slits=4)
	for k in range(4):
		a = 2 * math.pi * k / 4 + 0.6
		tentacle(m, (math.cos(a) * R * 0.8, math.sin(a) * R * 0.8, H * 0.3), (math.cos(a) * W * 0.48, math.sin(a) * D * 0.45, 0.2),
			rng, 0.3, sag=1.5)
	build_glow_ring(g, (0, 0, 0.3), R * 0.62, H * 0.36, 6)
	ramp(m, g, -D * 0.3, W * 0.3, D * 0.15, H * 0.12)


def power_node(m, g, W, D, H, rng):
	ground(m, W, D)
	R = min(W, D) * 0.3
	m.lathe((0, 0, 0.3), [(R, 0), (R * 0.7, H * 0.15), (R * 0.35, H * 0.3)], "rib", segments=12, sectors=4, ribs=0.15)
	spire(m, g, (0, 0, H * 0.2), H * 0.8, R * 0.32, rng)
	# Núcleo de energia aceso dentro da agulha.
	for t in (0.32, 0.45, 0.58):
		g.box((0, -R * 0.25 * (1 - t), H * t), (R * 0.2, 0.15, H * 0.1), "orange")
	for k in range(6):
		a = 2 * math.pi * k / 6
		m.box((math.cos(a) * R * 0.85, math.sin(a) * R * 0.85, H * 0.12), (R * 0.15, R * 0.5, H * 0.24), "rust", rotation=a + math.pi / 2,
			tilt=0.25)
	roots(m, (0, 0, 0), R * 0.8, 9, rng, reach=2.2, height=H * 0.08, thickness=0.28)


def biosphere(m, g, W, D, H, rng):
	ground(m, W, D)
	pods = [(0, 0, 0.36), (-0.3, -0.25, 0.26), (0.3, -0.22, 0.27), (-0.28, 0.27, 0.25), (0.3, 0.28, 0.24)]
	for fx, fy, fr in pods:
		r = min(W, D) * fr * 0.62
		dome(m, g, (fx * W, fy * D, 0.3), r, r * 0.95, material="plate", rib_count=10, slits=4)
	for k in range(4):
		x, y = pods[k + 1][0] * W, pods[k + 1][1] * D
		tentacle(m, (x * 0.6, y * 0.6, H * 0.45), (0, 0, H * 0.75), rng, 0.35, sag=2)
		m.spike((x, y, min(W, D) * pods[k + 1][2] * 0.6), (0, 0, 1), H * 0.4, 0.35)
	spire(m, g, (0, 0, H * 0.55), H * 0.6, min(W, D) * 0.03, rng)


def infestation_node(m, g, W, D, H, rng):
	ground(m, W, D, "organic", size=0.16)
	R = min(W, D) * 0.12
	m.lathe((0, 0, 0.3), [(R, 0), (R * 1.15, H * 0.3), (R * 0.9, H * 0.6), (R * 0.3, H * 0.85), (R * 0.05, H)], "organic",
		segments=16, sectors=4, ribs=0.12)
	for k in range(5):
		a = 2 * math.pi * k / 5
		m.spike((math.cos(a) * R * 0.5, math.sin(a) * R * 0.5, H * 0.7), (math.cos(a), math.sin(a), 1.2), H * 0.7, R * 0.12, bend=-0.4)
	# Tentáculos rasteiros pelo campo inteiro.
	for k in range(18):
		a = 2 * math.pi * k / 18 + rng.uniform(-0.1, 0.1)
		reach = rng.uniform(0.75, 0.95)
		end = (math.cos(a) * W * 0.5 * reach, math.sin(a) * D * 0.5 * reach, 0.35)
		tentacle(m, (math.cos(a) * R, math.sin(a) * R, H * 0.2), end, rng, rng.uniform(0.3, 0.55), sag=0.6, material="organic")
	for k in range(12):
		x, y = rng.uniform(-0.4, 0.4) * W, rng.uniform(-0.4, 0.4) * D
		if math.hypot(x, y) < R * 2:
			continue
		g.box((x, y, 0.4), (rng.uniform(0.6, 1.4), rng.uniform(0.6, 1.4), 0.08), "red", rotation=rng.uniform(0, math.pi))
	build_glow_ring(g, (0, 0, 0.3), R * 1.1, H * 0.3, 8, "red")


def evolution_chamber(m, g, W, D, H, rng):
	ground(m, W, D)
	m.box((0, 0, 1.0), (W * 0.8, D * 0.75, 1.6), "plate")
	m.box((0, -D * 0.38, 1.0), (W * 0.82, 0.4, 1.7), "hazard")
	for sx, h in ((-1, 1.0), (1, 0.8)):
		x = sx * W * 0.2
		m.lathe((x, D * 0.12, 1.8), [(W * 0.12, 0), (W * 0.11, H * 0.35), (W * 0.13, H * 0.4), (W * 0.08, H * 0.6), (W * 0.06, H * 0.75 * h),
			(W * 0.01, H * h)], "plate", segments=14, sectors=4, ribs=0.1)
		for t in (0.2, 0.45):
			build_glow_ring(g, (x, D * 0.12, 1.8), W * 0.115, H * t * h, 8)
		spire(m, g, (x, D * 0.12, H * 0.7 * h), H * 0.35 * h, W * 0.03, rng)
	dome(m, g, (0, -D * 0.12, 1.8), W * 0.2, H * 0.22, rib_count=10, slits=6)
	for sx in (-1, 1):
		m.lathe((sx * W * 0.32, -D * 0.25, 1.8), [(W * 0.07, 0), (W * 0.06, H * 0.2), (W * 0.02, H * 0.3)], "rust", segments=10, sectors=2)
	for k in range(6):
		a = 2 * math.pi * k / 6 + 0.4
		tentacle(m, (math.cos(a) * W * 0.25, math.sin(a) * D * 0.2, 2.0), (math.cos(a) * W * 0.47, math.sin(a) * D * 0.46, 0.2), rng, 0.4, 1.5)
	ramp(m, g, -D * 0.38, W * 0.25, D * 0.08, 1.8)


def defense_spire(m, g, W, D, H, rng):
	ground(m, W, D)
	R = min(W, D) * 0.3
	m.lathe((0, 0, 0.3), [(R, 0), (R * 0.8, H * 0.12), (R * 0.4, H * 0.3), (R * 0.32, H * 0.65), (R * 0.42, H * 0.72)], "rib",
		segments=14, sectors=4, ribs=0.12)
	for t in (0.35, 0.5):
		g.box((0, -R * 0.33, H * t), (R * 0.15, 0.12, H * 0.1), "orange")
	# Cabeça do canhão.
	m.lathe((0, 0, H * 0.72), [(R * 0.5, 0), (R * 0.62, R * 0.2), (R * 0.58, R * 0.45), (R * 0.38, R * 0.62), (R * 0.1, R * 0.7)],
		"plate", segments=16, sectors=4, scale=(1.0, 1.25))
	m.lathe((0, 0, H * 0.72 + R * 0.18), [(R * 0.66, 0), (R * 0.66, R * 0.06)], "hazard", segments=16, sectors=4, scale=(1.0, 1.25))
	for sx in (-1, 1):
		g.box((sx * R * 0.6, -R * 0.2, H * 0.72 + R * 0.35), (0.12, R * 0.5, 0.18), "orange")
	m.tube([(0, -R * 0.4, H * 0.8), (0, -R * 1.7, H * 0.83)], R * 0.13, "dark", 8)
	m.tube([(0, -R * 1.6, H * 0.83), (0, -R * 1.85, H * 0.835)], R * 0.18, "rust", 8)
	m.props["projectile"] = (0, -R * 1.9, H * 0.835)
	for k in range(6):
		a = 2 * math.pi * k / 6
		m.spike((math.cos(a) * R * 0.8, math.sin(a) * R * 0.8, H * 0.08), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1), H * 0.28, R * 0.1, bend=-0.3)
	roots(m, (0, 0, 0), R, 8, rng, reach=1.6, height=H * 0.06, thickness=0.25)


BUILDERS = {"hive_core": hive_core, "spawn_chamber": spawn_chamber, "unit_nest": unit_nest, "resource_nexus": resource_nexus,
	"power_node": power_node, "biosphere": biosphere, "infestation_node": infestation_node,
	"evolution_chamber": evolution_chamber, "defense_spire": defense_spire}


# ===================================================================== actors
ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- {title} do Enxame ({w:g} x {d:g} m), gerado por tools/structures/gen_swarm_structures.py
     a partir do atlas de referência Mars 2150 - Swarm. O brilho (fendas e veias
     acesas) é um prop com material de brilho próprio. -->
<actor version="1">
  <castshadow/>
  <group>
    <variant frequency="1" name="Base">
      <mesh>structural/swarm_hive/{name}.dae</mesh>
      <props>
        <prop actor="structures/swarm_hive/{name}_glow.xml" attachpoint="root"/>
        <prop actor="structures/swarm_hive/{name}_decal.xml" attachpoint="root"/>
{extra}      </props>
      <textures>
        <texture file="{tex}.png" name="baseTex"/>
        <texture file="{tex}_norm.png" name="normTex"/>
        <texture file="{tex}_spec.png" name="specTex"/>
      </textures>
    </variant>
  </group>
  <group>
    <variant frequency="100" name="Idle"/>
    <variant name="death">
      <props>
        <prop actor="particle/destruction_smoke_large.xml" attachpoint="root"/>
        <prop actor="particle/destruction_dust_large.xml" attachpoint="root"/>
        <prop actor="particle/destruction_dust_large_gray.xml" attachpoint="root"/>
      </props>
    </variant>
  </group>
  <material>player_trans_norm_spec.xml</material>
</actor>
"""

DECAL_ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- Creep orgânico no chão em volta de {name} (gen_swarm_structures.py).
     Decalque: acompanha o relevo do terreno. -->
<actor version="1">
  <group>
    <variant frequency="1" name="Base">
      <decal angle="0" depth="{d:g}" offsetx="0" offsetz="0" width="{w:g}"/>
      <textures>
        <texture file="props/swarm_creep.png" name="baseTex"/>
        <texture file="props/swarm_creep_norm.png" name="normTex"/>
        <texture file="props/swarm_creep_spec.png" name="specTex"/>
      </textures>
    </variant>
  </group>
  <material>terrain_norm_spec.xml</material>
</actor>
"""

GLOW_ACTOR = """<?xml version="1.0" encoding="utf-8"?>
<!-- Partes acesas de {name} (gen_swarm_structures.py): material de brilho com
     specTex de alfa 0, para a cor não sofrer sombreamento. -->
<actor version="1">
  <group>
    <variant name="Base">
      <mesh>structural/swarm_hive/{name}_glow.dae</mesh>
      <textures>
        <texture file="{tex}_glow.png" name="baseTex"/>
        <texture file="default_norm.png" name="normTex"/>
        <texture file="{tex}_glow_spec.png" name="specTex"/>
      </textures>
    </variant>
  </group>
  <material>basic_glow_norm_spec.xml</material>
</actor>
"""


def write_structure(name, W, D, H):
	# Semente fixa por modelo: rodar de novo gera exatamente o mesmo resultado.
	rng = np.random.default_rng(zlib.crc32(name.encode()))
	m, g = Mesh(), Mesh(glow=True)
	BUILDERS[name](m, g, W, D, H, rng)
	tris = m.write(os.path.join(MOD, MESH_DIR, name + ".dae"), name)
	tris += g.write(os.path.join(MOD, MESH_DIR, name + "_glow.dae"), name + "_glow")
	os.makedirs(os.path.join(MOD, ACTOR_DIR), exist_ok=True)
	extra = ""
	if "projectile" in m.props:
		extra = '        <prop actor="props/units/weapons/ammo/tracer_cannon.xml" attachpoint="projectile"/>\n'
	title = name.replace("_", " ").title()
	open(os.path.join(MOD, ACTOR_DIR, name + ".xml"), "w", encoding="utf-8").write(
		ACTOR.format(title=title, w=W, d=D, name=name, tex=TEX, extra=extra))
	open(os.path.join(MOD, ACTOR_DIR, name + "_glow.xml"), "w", encoding="utf-8").write(GLOW_ACTOR.format(name=name, tex=TEX))
	# Decalque um pouco maior que a estrutura, para o creep se espalhar em volta.
	open(os.path.join(MOD, ACTOR_DIR, name + "_decal.xml"), "w", encoding="utf-8").write(DECAL_ACTOR.format(
		name=name, w=round(min(W * 1.4, W + 16), 1), d=round(min(D * 1.4, D + 16), 1)))
	return tris, m, g


def use_in_faction():
	"""Liga os actors às estruturas do Enxame pelo gerador de facções."""
	sys.dont_write_bytecode = True
	argv, sys.argv = sys.argv, ["gen_factions"]
	spec = importlib.util.spec_from_file_location("gen_factions", os.path.join(MOD, "tools/factions/gen_factions.py"))
	factions = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(factions)
	sys.argv = argv
	for structure, (name, *_) in STRUCTURES.items():
		factions.ACTOR_OVERRIDES["structures/swarm/" + structure] = "structures/swarm_hive/%s.xml" % name
	wanted = {"simulation/templates/structures/swarm/%s.xml" % s for s in STRUCTURES}
	write = factions.write_bytes
	kept = []

	def only_templates(rel, data, body=None, actor_path=None):
		if rel in wanted:
			if not write(rel, data, body, actor_path):
				kept.append(rel)
		return True

	factions.write_bytes = only_templates
	factions.generate("swarm", factions.FACTIONS["swarm"])
	json.dump(factions.MANIFEST, open(factions.MANIFEST_PATH, "w", encoding="utf-8"), indent="\t", sort_keys=True)
	json.dump(factions.ACTOR_OVERRIDES, open(factions.OVERRIDES_PATH, "w", encoding="utf-8"), indent="\t", sort_keys=True, ensure_ascii=False)
	# Templates editados à mão: só a linha do actor.
	import re
	for rel in kept:
		structure = os.path.basename(rel)[:-4]
		actor = "structures/swarm_hive/%s.xml" % STRUCTURES[structure][0]
		path = os.path.join(MOD, rel)
		text = open(path, encoding="utf-8").read()
		text = re.sub(r"(<VisualActor>\s*<Actor>)[^<]*(</Actor>)", lambda m: m.group(1) + actor + m.group(2), text, count=1)
		open(path, "w", encoding="utf-8").write(text)
		print("  (editado à mão) só o actor trocado em", rel)


def preview(folder, meshes):
	os.makedirs(folder, exist_ok=True)
	tex = np.asarray(Image.open(os.path.join(MOD, "art/textures/skins", TEX + ".png")).convert("RGB"), float)
	glow = np.asarray(Image.open(os.path.join(MOD, "art/textures/skins", TEX + "_glow.png")).convert("RGB"), float)
	W, H = 420, 380
	cols = 3
	rows = math.ceil(len(meshes) / cols)
	sheet = Image.new("RGB", (W * cols, H * rows), (22, 20, 20))
	d = ImageDraw.Draw(sheet)
	light = np.array([0.3, -0.6, 0.75]) / np.linalg.norm([0.3, -0.6, 0.75])
	yaw, pitch = math.radians(-35), math.radians(28)
	V = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]]) @ \
		np.array([[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]])
	for k, (name, m, g) in enumerate(meshes):
		ox, oy = (k % cols) * W, (k // cols) * H
		polys = []
		allpos = np.vstack([np.array(m.pos), np.array(g.pos)])
		v_all = allpos @ V.T
		sc = 0.85 * min(W, H) / max(np.ptp(v_all[:, 0]), np.ptp(v_all[:, 2]))
		cx, cz = (v_all[:, 0].max() + v_all[:, 0].min()) / 2, (v_all[:, 2].max() + v_all[:, 2].min()) / 2
		for mesh, image, lit in ((m, tex, True), (g, glow, False)):
			if not mesh.tri:
				continue
			P = np.array(mesh.pos) @ V.T
			UV = np.array(mesh.uv)
			for t in mesh.tri:
				q = P[list(t)]
				n = np.cross(q[1] - q[0], q[2] - q[0])
				n /= np.linalg.norm(n) + 1e-9
				u = UV[list(t)].mean(axis=0)
				c = image[int((1 - u[1]) * (image.shape[0] - 1)), int(u[0] * (image.shape[1] - 1))]
				shade = 0.35 + 0.75 * abs(n @ (V @ light)) if lit else 1.0
				polys.append((q[:, 1].mean() - (0 if lit else 0.05), [(ox + W / 2 + (p[0] - cx) * sc, oy + H / 2 - (p[2] - cz) * sc) for p in q],
					tuple(int(min(255, x * shade)) for x in c)))
		for _, poly, color in sorted(polys, key=lambda x: -x[0]):
			d.polygon(poly, fill=color)
		d.text((ox + 6, oy + 6), name, fill=(240, 140, 60))
	sheet.save(os.path.join(folder, "swarm_structures.png"))
	print("prévia:", os.path.join(folder, "swarm_structures.png"))


def main():
	make_textures()
	make_creep()
	meshes = []
	for structure, (name, W, D, H) in STRUCTURES.items():
		tris, m, g = write_structure(name, W, D, H)
		meshes.append((name, m, g))
		print("%-20s %-18s %5.1f x %5.1f x %4.1f m  %6d triângulos" % (structure, name, W, D, H, tris))
	use_in_faction()
	if "--preview" in sys.argv:
		preview(sys.argv[sys.argv.index("--preview") + 1], meshes)


if __name__ == "__main__":
	main()

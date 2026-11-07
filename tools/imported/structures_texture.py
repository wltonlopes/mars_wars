#!/usr/bin/env python3
"""Atlas das estruturas importadas de cada facção, no estilo do atlas da
facção (ares_struct.png, coa_struct.png; o Enxame mantém as cores dos
modelos).

Junta as texturas dos modelos de ref/ (Tripo, 1024 cada, já casadas com o
mapa UV de cada modelo) num atlas só, uma fatia por estrutura, e as repinta
com as cores do atlas da facção: o brilho é casado com o histograma dele
(sem o fundo preto) e a cor sai de duas rampas medidas nele (cinzas/brancos
por brilho e a cor de destaque da facção por brilho), conforme o pixel é
cinza ou colorido. O desenho continua o do modelo, então tudo segue o mapa
UV original, sem costuras.

Gera art/textures/skins/structural/<civ>_structures.png, _norm.png, _spec.png.
A posição de cada fatia (FACTIONS[civ]["slots"]) é a mesma usada por
import_structures.py.
Uso (na pasta do mod):  python3 tools/imported/structures_texture.py [civ ...]
Precisa de numpy e Pillow.
"""
import io
import os
import sys
import zipfile

import numpy as np

MOD = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TEX = os.path.join(MOD, "art", "textures", "skins", "structural")

# civ -> atlas de estilo (None: mantém as cores do modelo), pasta dos zips,
# cor de destaque ("red": R >= B, "blue": B > R), brilho máximo do destaque
# (0..255; acima disso a cor lava) e as fatias (estrutura, zip), 4 colunas
# x 2 linhas.
FACTIONS = {
	"ares": dict(style="ares_struct.png", folder="ref", accent="red", accent_max=95, slots=[
		("cc_citadel", "red+sci-fi+base+3d+model.zip"),
		("barracks_war_hall", "red+sci-fi+fortress+3d+model.zip"),
		("lab_research", "red+sci-fi+base+3d+model(1).zip"),
		("vehicle_garage", "futuristic+vehicle+3d+model.zip"),
		("helipad", "battle+arena+3d+model.zip"),
		("reactor", "sci-fi+factory+3d+model.zip"),
		("planetary_fortress", "sci-fi+fortress+3d+model(1).zip"),
	]),
	"coa": dict(style="coa_struct.png", folder="ref/coa", accent="blue", accent_max=120, slots=[
		("cc_command_tower", "military+base+tower+3d+model.zip"),
		("barracks_garrison", "sci-fi+military+barracks+3d+model.zip"),
		("lab_space", "space+laboratory+3d+model.zip"),
		("vehicle_garage", "vehicular+garage+3d+model.zip"),
		("helipad", "helicopter+landing+pad+3d+model.zip"),
		("reactor", "energy+reactor+3d+model.zip"),
		("fortress", "futuristic+fortress+3d+model.zip"),
	]),
	# Os modelos do Enxame já vêm na paleta da facção (roxo, osso, biomassa
	# verde); o swarm_hive.png é um atlas de materiais, não de estilo.
	"swarm": dict(style=None, folder="ref/swarm", accent=None, accent_max=None, slots=[
		("spawn_barracks", "purple+barracks+3d+model.zip"),
		("gene_laboratory", "futuristic+laboratory+3d+model.zip"),
		("vehicle_garage", "futuristic+vehicle+garage+3d+model.zip"),
		("landing_pad", "futuristic+landing+pad+3d+model.zip"),
		("reactor", "energy+reactor+3d+model.zip"),
		("fortress", "fantasy+fortress+3d+model.zip"),
	]),
}
COLS, ROWS, CELL = 4, 2, 1024
# Cada textura entra reduzida em INNER px no meio da fatia; a borda é
# preenchida esticando as bordas (não vaza a fatia vizinha nos mipmaps).
INNER = 1000
PAD = (CELL - INNER) // 2
LUMA = np.array([0.299, 0.587, 0.114], np.float32)
BINS = 32


def slot_rect(index):
	"""(x0, y0) do canto de cima da fatia, em px, e o tamanho útil."""
	return (index % COLS) * CELL + PAD, (index // COLS) * CELL + PAD, INNER


def uv_transform(index):
	"""UV do modelo (0..1, v para cima) -> UV no atlas: (escala_u, escala_v, desl_u, desl_v)."""
	x0, y0, size = slot_rect(index)
	W, H = COLS * CELL, ROWS * CELL
	return size / W, size / H, x0 / W, 1 - (y0 + size) / H


def read(folder, zip_name, suffix):
	from PIL import Image
	with zipfile.ZipFile(os.path.join(MOD, folder, zip_name)) as z:
		name = [n for n in z.namelist() if n.endswith(suffix + ".JPEG")][0]
		return Image.open(io.BytesIO(z.read(name))).convert("RGB")


def painted(a):
	"""Pixels pintados (fora do fundo preto do atlas)."""
	return a.max(axis=2) > 10


def chroma(a, accent):
	"""Quanto o pixel é "colorido" (0..1) do lado da cor de destaque."""
	mx, mn = a.max(axis=2), a.min(axis=2)
	sat = (mx - mn) / np.maximum(mx, 1)
	if accent == "any":
		side = np.ones(a.shape[:2], bool)
	else:
		side = a[..., 0] >= a[..., 2] if accent == "red" else a[..., 2] > a[..., 0]
	return np.clip((sat - 0.18) / 0.3, 0, 1) * side


def ramps(style, mask, accent):
	"""Cor média do atlas da facção por faixa de brilho: cinzas e destaque."""
	a = style.astype(np.float32)
	luma = a @ LUMA
	k = chroma(a, accent)
	out = {}
	for key, sel in (("gray", (k < 0.2) & mask), ("accent", (k > 0.7) & mask)):
		ramp = np.zeros((BINS, 3), np.float32)
		idx = np.minimum((luma[sel] / 256 * BINS).astype(int), BINS - 1)
		cols = a[sel]
		have = []
		for b in range(BINS):
			m = idx == b
			if m.sum() > 50:
				ramp[b] = cols[m].mean(axis=0)
				have.append(b)
		for c in range(3):  # faixas vazias: interpola entre as vizinhas
			ramp[:, c] = np.interp(np.arange(BINS), have, ramp[have, c])
		out[key] = ramp
	return out, np.sort(luma[mask])


def restyle(src, style_ramps, style_luma, accent, accent_max, src_accent=None):
	"""Brilho casado com o do atlas da facção; cor tirada das rampas dele.
	src_accent: como achar as áreas coloridas na origem (padrão: accent)."""
	a = src.astype(np.float32)
	luma = a @ LUMA
	order = np.sort(luma.ravel())
	q = np.searchsorted(order, luma.ravel()) / order.size
	new_luma = np.interp(q, np.linspace(0, 1, style_luma.size), style_luma).reshape(luma.shape)
	pos = new_luma / 256 * BINS - 0.5
	gray = np.stack([np.interp(pos, np.arange(BINS), style_ramps["gray"][:, c]) for c in range(3)], -1)
	pos_acc = np.minimum(pos, accent_max / 256 * BINS)
	acc = np.stack([np.interp(pos_acc, np.arange(BINS), style_ramps["accent"][:, c]) for c in range(3)], -1)
	k = chroma(a, src_accent or accent)[..., None]
	return np.clip(gray * (1 - k) + acc * k, 0, 255)


def place(atlas, index, img):
	from PIL import Image
	x0, y0, size = slot_rect(index)
	tile = img.resize((size, size), Image.LANCZOS)
	padded = np.pad(np.asarray(tile), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
	X, Y = x0 - PAD, y0 - PAD
	atlas[Y:Y + CELL, X:X + CELL] = padded


def build(civ):
	from PIL import Image, ImageFilter
	cfg = FACTIONS[civ]
	if cfg["style"]:
		style = np.asarray(Image.open(os.path.join(TEX, cfg["style"])).convert("RGB"))
		style_ramps, style_luma = ramps(style, painted(style), cfg["accent"])
	W, H = COLS * CELL, ROWS * CELL
	base = np.zeros((H, W, 3), np.uint8)
	norm = np.full((H, W, 3), (128, 128, 255), np.uint8)
	spec = np.zeros((H, W, 3), np.uint8)
	for i, (name, zip_name) in enumerate(cfg["slots"]):
		col = np.asarray(read(cfg["folder"], zip_name, "_basecolor"))
		if cfg["style"]:
			col = restyle(col, style_ramps, style_luma, cfg["accent"], cfg["accent_max"]).astype(np.uint8)
		# Um pouco de nitidez, como os painéis dos atlas das facções.
		img = Image.fromarray(col).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
		place(base, i, img)
		place(norm, i, read(cfg["folder"], zip_name, "_normal"))
		rough = np.asarray(read(cfg["folder"], zip_name, "_roughness"), np.float32)[..., 0] / 255
		metal = np.asarray(read(cfg["folder"], zip_name, "_metallic"), np.float32)[..., 0] / 255
		s = np.clip((1 - rough) * 0.55 + metal * 0.25, 0, 1) * 255
		place(spec, i, Image.fromarray(np.repeat(s[..., None], 3, axis=2).astype(np.uint8)))
		print("%s fatia %d: %s" % (civ, i, name))
	for suffix, arr in (("", base), ("_norm", norm), ("_spec", spec)):
		Image.fromarray(arr).save(os.path.join(TEX, "%s_structures%s.png" % (civ, suffix)), optimize=True)


if __name__ == "__main__":
	for civ in sys.argv[1:] or list(FACTIONS):
		build(civ)

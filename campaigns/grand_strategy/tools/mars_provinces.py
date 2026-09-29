"""Gera as províncias de Marte da campanha grand_strategy (mars_wars) a partir
da imagem de regiões coloridas (mars_regions_source.png): segmenta, alinha ao
campaign_map.png (4096x2048) e exporta provinces.geojson + máscaras PNG.

Uso: python3 mars_provinces.py   (precisa de numpy, opencv-python e Pillow)
Ajustes: PROVINCES (nome e posição do número de cada região na imagem) e
LANDMARKS (pontos iguais nas duas imagens, para o alinhamento)."""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

MOD = "/home/welton/snap/0ad/743/.local/share/0ad/mods/mars_wars"
TOOLS = os.path.dirname(os.path.abspath(__file__))
# Arquivos intermediários (.npy, prévias) ficam fora do mod.
SCRATCH = os.path.join(__import__("tempfile").gettempdir(), "mars_provinces")
os.makedirs(SCRATCH, exist_ok=True)
SOURCE = os.path.join(TOOLS, "mars_regions_source.png")
BASE = MOD + "/art/textures/ui/campaigns/grand_strategy/art/campaign_map.png"
W, H = 4096, 2048

# Número, nome, posição do número na imagem de origem (1536x1024).
PROVINCES = [
    (1, "North Polar Ice Cap", (780, 48)),
    (2, "Arcadia Planitia", (158, 90)),
    (3, "Acidalia Planitia", (418, 108)),
    (4, "Acidalia Terra", (643, 160)),
    (5, "Utopia Planitia", (952, 162)),
    (6, "Vastitas Borealis", (1218, 120)),
    (7, "Elysium Nordis", (1414, 99)),
    (8, "Olympus Mons", (110, 239)),
    (9, "Tharsis Montes", (313, 301)),
    (10, "Tempe Terra", (502, 264)),
    (11, "Lunae Planum", (690, 310)),
    (12, "Arabia Terra", (875, 286)),
    (13, "Syrtis Major", (1030, 344)),
    (14, "Isidis Planitia", (1170, 292)),
    (15, "Elysium Planitia", (1340, 270)),
    (16, "Elysium Mons", (1473, 298)),
    (17, "Pavonis Mons", (145, 409)),
    (18, "Arsia Mons", (336, 444)),
    (19, "Valles Marineris", (652, 443)),
    (20, "Sinai Planum", (930, 451)),
    (21, "Tyrrhena Terra", (1115, 477)),
    (22, "Hesperia Planum", (1263, 452)),
    (23, "Terra Cimmeria", (1422, 459)),
    (24, "Amazonis Planitia", (153, 575)),
    (25, "Daedalia Planum", (376, 583)),
    (26, "Argyre Planitia", (547, 579)),
    (27, "Terra Sabaea", (744, 596)),
    (28, "Noachis Terra", (938, 588)),
    (29, "Hellas Planitia", (1165, 618)),
    (30, "Terra Sirenum", (1413, 609)),
    (31, "Eridania Planitia", (164, 724)),
    (32, "Promethei Terra", (387, 725)),
    (33, "Aonia Terra", (633, 733)),
    (34, "Solis Planum", (845, 721)),
    (35, "Thaumasia Planum", (1067, 749)),
    (36, "Terra Australis", (1383, 743)),
    (37, "Sirenum Planitia", (111, 870)),
    (38, "Australe Terra", (358, 852)),
    (39, "South Polar Ice Cap", (780, 905)),
    (40, "Argyre Terra Australis", (1310, 875)),
]

# Pontos correspondentes (origem 1536x1024 -> campaign_map em 1536x768).
LANDMARKS = [
    ((213, 265), (200, 213)),    # Olympus Mons
    ((1140, 628), (1140, 520)),  # Hellas
    ((1482, 266), (1338, 222)),  # Elysium Mons
    ((1040, 213), (1040, 172)),  # cratera de Utopia
    ((780, 65), (770, 55)),      # calota norte
    ((780, 930), (765, 695)),    # calota sul
    ((240, 461), (236, 392)),    # Arsia Mons
    ((400, 425), (330, 350)),    # oeste de Valles Marineris
    ((860, 540), (700, 418)),    # leste de Valles Marineris
]
# Moldura: o conteúdo da imagem de origem vai até as bordas da base.
FRAME = [((16, 18), (0, 0)), ((768, 14), (768, 0)), ((1518, 18), (1536, 0)),
         ((12, 512), (0, 384)), ((1522, 512), (1536, 384)),
         ((16, 1008), (0, 768)), ((768, 1010), (768, 768)), ((1518, 1008), (1536, 768))]


def slug(name):
    return name.lower().replace(" ", "_")


def segment():
    img = cv2.imread(SOURCE)
    smooth = cv2.pyrMeanShiftFiltering(img, 12, 24)
    gray = cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB).astype(np.float32)
    grad = np.zeros(gray.shape, np.float32)
    for c in range(3):
        gx = cv2.Sobel(lab[..., c], cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(lab[..., c], cv2.CV_32F, 0, 1, ksize=3)
        grad += np.sqrt(gx * gx + gy * gy)
    # As linhas brancas entre regiões também são borda.
    white = ((smooth.min(axis=2) > 200)).astype(np.float32) * 400
    grad += white
    grad = np.clip(grad / grad.max() * 255, 0, 255).astype(np.uint8)
    grad3 = cv2.cvtColor(grad, cv2.COLOR_GRAY2BGR)

    markers = np.zeros(gray.shape, np.int32)
    for number, name, (x, y) in PROVINCES:
        # O número e o nome são brancos: a semente é um disco em volta deles.
        cv2.circle(markers, (x, y), 9, number, -1)
    # Fundo escuro fora do mapa.
    outside = 41
    markers[:4, :] = outside
    markers[-4:, :] = outside
    markers[:, :4] = outside
    markers[:, -4:] = outside
    labels = cv2.watershed(grad3, markers)

    # Pixels de borda (-1) e fundo: vizinho mais próximo entre as províncias.
    known = (labels >= 1) & (labels <= 40)
    dist, idx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5,
                                                labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(known)
    lookup = np.zeros(idx.max() + 1, np.int32)
    lookup[idx[known]] = labels[known]
    filled = lookup[idx]
    return filled, img


def tps_fit(src, dst):
    """Thin-plate spline que leva dst -> src (mapeamento inverso para amostrar)."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    n = len(dst)

    def U(r):
        with np.errstate(divide="ignore", invalid="ignore"):
            v = r * r * np.log(r * r)
        return np.nan_to_num(v)

    K = U(np.linalg.norm(dst[:, None] - dst[None], axis=2))
    P = np.hstack([np.ones((n, 1)), dst])
    L = np.zeros((n + 3, n + 3))
    L[:n, :n] = K + np.eye(n) * 1e-3
    L[:n, n:] = P
    L[n:, :n] = P.T
    Y = np.vstack([src, np.zeros((3, 2))])
    params = np.linalg.solve(L, Y)

    def apply(pts):
        r = np.linalg.norm(pts[:, None] - dst[None], axis=2)
        return U(r) @ params[:n] + np.hstack([np.ones((len(pts), 1)), pts]) @ params[n:]

    return apply


def warp_labels(labels):
    pairs = LANDMARKS + FRAME
    src = [p[0] for p in pairs]
    dst = [(p[1][0] * W / 1536, p[1][1] * H / 768) for p in pairs]
    inverse = tps_fit(src, dst)
    # Amostra numa grade reduzida e interpola o mapeamento (TPS é suave).
    step = 16
    gx, gy = np.meshgrid(np.arange(0, W + step, step), np.arange(0, H + step, step))
    grid = inverse(np.stack([gx.ravel(), gy.ravel()], 1).astype(float))
    mapx = cv2.resize(grid[:, 0].reshape(gx.shape).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    mapy = cv2.resize(grid[:, 1].reshape(gy.shape).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    warped = cv2.remap(labels.astype(np.float32), mapx, mapy, cv2.INTER_NEAREST, borderMode=cv2.BORDER_REPLICATE)
    return warped.astype(np.int32), inverse


def clean(labels):
    """Cada província fica com um único pedaço (o maior); o resto vai para o vizinho."""
    out = labels.copy()
    for number in range(1, 41):
        mask = (labels == number).astype(np.uint8)
        count, comp, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        if count <= 2:
            continue
        keep = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        out[(comp > 0) & (comp != keep)] = 0
    known = out > 0
    _, idx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5,
                                             labelType=cv2.DIST_LABEL_PIXEL)
    lookup = np.zeros(idx.max() + 1, np.int32)
    lookup[idx[known]] = out[known]
    return lookup[idx]


def preview(labels, path_out, base_path=None, scale=4):
    rng = np.random.default_rng(1)
    colors = rng.integers(40, 255, (42, 3)).astype(np.uint8)
    color = colors[labels]
    if base_path:
        base = np.asarray(Image.open(base_path).convert("RGB").resize((labels.shape[1], labels.shape[0])))
        color = (0.55 * base + 0.45 * color).astype(np.uint8)
    edges = np.zeros(labels.shape, bool)
    edges[:-1] |= labels[:-1] != labels[1:]
    edges[:, :-1] |= labels[:, :-1] != labels[:, 1:]
    color[edges] = 255
    im = Image.fromarray(color).resize((labels.shape[1] // scale, labels.shape[0] // scale), Image.NEAREST)
    im.save(path_out)


# ------------------------------------------------------------------ exportação

def kind(name):
    for key in ("Polar", "Mons", "Montes", "Planitia", "Planum", "Terra", "Valles", "Major", "Borealis", "Nordis", "Australis"):
        if key in name:
            return key
    return "Terra"


TERRAIN = {"Polar": "polar_ice", "Mons": "volcano", "Montes": "volcano", "Planitia": "plains", "Planum": "plateau",
           "Terra": "highlands", "Valles": "canyon", "Major": "highlands", "Borealis": "plains", "Nordis": "plains",
           "Australis": "highlands"}
POPULATION = {"Polar": "low", "Mons": "low", "Montes": "medium", "Planitia": "high", "Planum": "medium",
              "Terra": "medium", "Valles": "high", "Major": "medium", "Borealis": "low", "Nordis": "low",
              "Australis": "low"}


def pow2(n):
    return 1 << max(8, math.ceil(math.log2(max(1, n))))


def export(labels):
    out_dir = MOD + "/art/textures/ui/campaigns/grand_strategy/provinces"
    os.makedirs(out_dir, exist_ok=True)

    # Vizinhos: fronteira comum com pelo menos 12 pixels.
    pairs = {}
    for a, b in ((labels[:, :-1], labels[:, 1:]), (labels[:-1, :], labels[1:, :])):
        diff = a != b
        for x, y in zip(a[diff], b[diff]):
            key = (min(x, y), max(x, y))
            pairs[key] = pairs.get(key, 0) + 1
    links = {n: set() for n in range(1, 41)}
    for (x, y), count in pairs.items():
        if count >= 12 and 1 <= x <= 40 and 1 <= y <= 40:
            links[x].add(y)
            links[y].add(x)

    features = []
    for number, name, _ in PROVINCES:
        code = slug(name)
        mask = (labels == number).astype(np.uint8)
        ys, xs = np.nonzero(mask)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        w, h = x1 - x0 + 1, y1 - y0 + 1

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        contour = max(contours, key=cv2.contourArea)
        poly = cv2.approxPolyDP(contour, 1.0, True)[:, 0, :]
        ring = [[float(px), float(-py)] for px, py in poly]
        ring.append(ring[0])

        # Ponto mais "de dentro" da província (para cidade/herói).
        dist = cv2.distanceTransform(np.pad(mask, 1), cv2.DIST_L2, 5)[1:-1, 1:-1]
        cy, cx = np.unravel_index(np.argmax(dist), dist.shape)

        mw, mh = pow2(w), pow2(h)
        png = np.zeros((mh, mw, 4), np.uint8)
        png[:h, :w][mask[y0:y1 + 1, x0:x1 + 1] > 0] = (255, 255, 255, 255)
        Image.fromarray(png, "RGBA").save(f"{out_dir}/{code}.png", optimize=True)

        k = kind(name)
        features.append({
            "type": "Feature",
            "properties": {
                "code": code,
                "name": name,
                "number": number,
                "capital": None,
                "culture": None,
                "civs": ["mcc", "mla"],
                "provinceType": "land",
                "terrain": TERRAIN[k],
                "mapTypes": ["mars"],
                "resources": None,
                "religion": None,
                "population": POPULATION[k],
                "centerpoint": [int(cx), int(cy)],
                "position": {"x": x0, "y": y0},
                "bbox": {"w": w, "h": h},
                "maskSize": [mw, mh],
                "links": sorted(slug(PROVINCES[n - 1][1]) for n in links[number])
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]}
        })

    geo = {
        "type": "FeatureCollection",
        "name": "provinces",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::3857"}},
        "features": features
    }
    with open(MOD + "/campaigns/grand_strategy/data/provinces.geojson", "w", encoding="utf-8") as f:
        json.dump(geo, f, ensure_ascii=False, indent=1)
    return features


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    src_labels, img = segment()
    np.save(os.path.join(SCRATCH, "src_labels.npy"), src_labels)
    preview(src_labels, os.path.join(SCRATCH, "seg_src.png"), SOURCE, scale=1)
    warped, _ = warp_labels(src_labels)
    warped = clean(warped)
    np.save(os.path.join(SCRATCH, "labels_4096.npy"), warped)
    preview(warped, os.path.join(SCRATCH, "seg_base.png"), BASE, scale=4)
    print("areas", {n: int((warped == n).sum()) for n in range(1, 41)})
    if stage == "all":
        export(warped)

#!/usr/bin/env python3
"""
Gera a arte do soldado lança-chamas (Mars Wars):

  - malhas procedurais (COLLADA, Z para cima, frente da arma em -Y como os fuzis):
      art/meshes/props/weapons/flamethrower.dae   arma (cano, protetor de calor, bocal)
      art/meshes/props/armor/flame_tank.dae       mochila com dois tanques de combustível
      art/meshes/props/flame_anchor.dae           âncora invisível para actors de partículas
  - textura art/textures/skins/props/weapons/flamethrower.png
    (alpha 0 na faixa dos tanques = cor do jogador, material player_trans)
  - partículas do jato (uma por comprimento, para o componente LaserBeam),
    da chama-piloto e do impacto, com os actors correspondentes.

Uso: python3 tools/flamethrower/gen_flamethrower.py   (na raiz do mod)
"""
import math
import os
import random

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def write(rel, text):
	path = os.path.join(ROOT, rel)
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, "w", encoding="utf-8") as f:
		f.write(text)


# ---------------------------------------------------------------- malhas

class Mesh:
	def __init__(self):
		self.pos = []
		self.nrm = []
		self.uv = []
		self.tris = []  # (p, n, t) x3

	def _v(self, p, n, t):
		self.pos.append(p)
		self.nrm.append(n)
		self.uv.append(t)
		return len(self.pos) - 1

	def quad(self, a, b, c, d, n, uvs):
		ia = self._v(a, n, uvs[0]); ib = self._v(b, n, uvs[1])
		ic = self._v(c, n, uvs[2]); id_ = self._v(d, n, uvs[3])
		self.tris += [(ia, ib, ic), (ia, ic, id_)]

	def box(self, x0, x1, y0, y1, z0, z1, region):
		u0, v0, u1, v1 = region
		uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
		P = lambda x, y, z: (x, y, z)
		self.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), (0, 0, 1), uv)
		self.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0), (0, 0, -1), uv)
		self.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), (0, -1, 0), uv)
		self.quad(P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), (0, 1, 0), uv)
		self.quad(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), (-1, 0, 0), uv)
		self.quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), (1, 0, 0), uv)

	def cylinder(self, axis, center, r, a0, a1, region, seg=12, vmap=None):
		"""Cilindro com tampas ao longo de 'axis' ('y' ou 'z'), de a0 até a1."""
		u0, v0, u1, v1 = region
		cx, cy, cz = center

		def point(ang, a, rad):
			c, s = math.cos(ang) * rad, math.sin(ang) * rad
			if axis == "y":
				return (cx + c, a, cz + s), (math.cos(ang), 0, math.sin(ang))
			return (cx + c, cy + s, a), (math.cos(ang), math.sin(ang), 0)

		def vcoord(a):
			if vmap:
				return vmap(a)
			return v0 + (v1 - v0) * (a - a0) / (a1 - a0)

		for i in range(seg):
			t0, t1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
			(p00, n0), (p01, _) = point(t0, a0, r), point(t0, a1, r)
			(p10, n1), (p11, _) = point(t1, a0, r), point(t1, a1, r)
			uA = u0 + (u1 - u0) * i / seg
			uB = u0 + (u1 - u0) * (i + 1) / seg
			n = tuple((n0[k] + n1[k]) / 2 for k in range(3))
			self.quad(p00, p10, p11, p01, n, [(uA, vcoord(a0)), (uB, vcoord(a0)), (uB, vcoord(a1)), (uA, vcoord(a1))])
		# tampas
		for a, sign in ((a0, -1), (a1, 1)):
			cap_n = (0, sign, 0) if axis == "y" else (0, 0, sign)
			c = (cx, a, cz) if axis == "y" else (cx, cy, a)
			ic = self._v(c, cap_n, ((u0 + u1) / 2, (v0 + v1) / 2))
			ring = []
			for i in range(seg):
				p, _ = point(2 * math.pi * i / seg, a, r)
				ring.append(self._v(p, cap_n, (u0 + (u1 - u0) * (0.5 + 0.5 * math.cos(2 * math.pi * i / seg)),
					v0 + (v1 - v0) * (0.5 + 0.5 * math.sin(2 * math.pi * i / seg)))))
			for i in range(seg):
				j = (i + 1) % seg
				self.tris.append((ic, ring[i], ring[j]) if sign > 0 else (ic, ring[j], ring[i]))


def collada(mesh, name, props=(), texture="flamethrower.png"):
	f = lambda vals: " ".join("%.5f" % v for v in vals)
	pos = f([c for p in mesh.pos for c in p])
	nrm = f([c for n in mesh.nrm for c in n])
	uv = f([c for t in mesh.uv for c in t])
	idx = " ".join("%d %d %d" % (i, i, i) for tri in mesh.tris for i in tri)
	nv = len(mesh.pos)
	prop_nodes = "".join(
		'\n        <node id="prop_%s" name="prop_%s" type="NODE">'
		'<matrix sid="transform">1 0 0 %.5f 0 1 0 %.5f 0 0 1 %.5f 0 0 0 1</matrix></node>' % (pn, pn, x, y, z)
		for pn, (x, y, z) in props)
	return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por tools/flamethrower/gen_flamethrower.py -->
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_images><image id="tex" name="tex"><init_from>{texture}</init_from></image></library_images>
  <library_effects>
    <effect id="mat-effect"><profile_COMMON>
      <newparam sid="tex-surface"><surface type="2D"><init_from>tex</init_from></surface></newparam>
      <newparam sid="tex-sampler"><sampler2D><source>tex-surface</source></sampler2D></newparam>
      <technique sid="common"><lambert><diffuse><texture texture="tex-sampler" texcoord="UVMap"/></diffuse></lambert></technique>
    </profile_COMMON></effect>
  </library_effects>
  <library_materials><material id="mat" name="mat"><instance_effect url="#mat-effect"/></material></library_materials>
  <library_geometries>
    <geometry id="{name}-mesh" name="{name}">
      <mesh>
        <source id="{name}-pos"><float_array id="{name}-pos-array" count="{nv * 3}">{pos}</float_array>
          <technique_common><accessor source="#{name}-pos-array" count="{nv}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
        <source id="{name}-nrm"><float_array id="{name}-nrm-array" count="{nv * 3}">{nrm}</float_array>
          <technique_common><accessor source="#{name}-nrm-array" count="{nv}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
        <source id="{name}-uv"><float_array id="{name}-uv-array" count="{nv * 2}">{uv}</float_array>
          <technique_common><accessor source="#{name}-uv-array" count="{nv}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
        <vertices id="{name}-vtx"><input semantic="POSITION" source="#{name}-pos"/></vertices>
        <triangles material="mat" count="{len(mesh.tris)}">
          <input semantic="VERTEX" source="#{name}-vtx" offset="0"/>
          <input semantic="NORMAL" source="#{name}-nrm" offset="1"/>
          <input semantic="TEXCOORD" source="#{name}-uv" offset="2" set="0"/>
          <p>{idx}</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="{name}" name="{name}" type="NODE">
        <matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
        <instance_geometry url="#{name}-mesh" name="{name}">
          <bind_material><technique_common><instance_material symbol="mat" target="#mat"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material>
        </instance_geometry>{prop_nodes}
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
"""


# Regiões do atlas (u0, v0, u1, v1).
GUNMETAL = (0.02, 0.02, 0.48, 0.48)
STEEL = (0.52, 0.02, 0.98, 0.48)
TANK = (0.02, 0.52, 0.98, 0.98)
DARK = (0.30, 0.30, 0.32, 0.32)
COPPER = (0.80, 0.30, 0.82, 0.32)

BARREL_Z = 0.30
MUZZLE_Y = -2.02


def make_gun():
	m = Mesh()
	m.box(-0.07, 0.07, -0.55, 0.35, 0.14, 0.40, GUNMETAL)        # corpo
	m.box(-0.05, 0.05, 0.35, 0.78, 0.08, 0.32, GUNMETAL)         # coronha
	m.box(-0.04, 0.04, 0.05, 0.20, -0.18, 0.14, DARK)            # punho
	m.box(-0.035, 0.035, -0.80, -0.68, 0.02, 0.26, DARK)         # empunhadura frontal
	m.cylinder("y", (0, 0, BARREL_Z), 0.055, -1.88, -0.55, STEEL)          # cano
	m.cylinder("y", (0, 0, BARREL_Z), 0.080, -1.55, -0.70, GUNMETAL, 14)  # protetor de calor
	m.cylinder("y", (0, 0, BARREL_Z), 0.090, -2.00, -1.86, DARK, 14)      # bocal
	m.cylinder("y", (0, 0, 0.13), 0.050, -1.25, -0.58, COPPER, 10)        # ignitor
	m.cylinder("y", (0, 0, 0.18), 0.035, 0.35, 0.62, DARK, 8)             # conector da mangueira
	shoot = (0.0, MUZZLE_Y, BARREL_Z)
	return collada(m, "flamethrower", [("shoot", shoot), ("projectile", shoot)])


def make_tank():
	m = Mesh()
	band = lambda z0, z1: (lambda a: TANK[1] + (TANK[3] - TANK[1]) * (a - z0) / (z1 - z0))
	for x in (-0.19, 0.19):
		m.cylinder("z", (x, 0.20, 0), 0.16, -0.55, 0.60, TANK, 14, band(-0.55, 0.60))
		m.cylinder("z", (x, 0.20, 0), 0.11, 0.60, 0.68, STEEL, 12)     # cúpula
		m.cylinder("z", (x, 0.20, 0), 0.04, 0.68, 0.78, DARK, 8)       # válvula
	m.cylinder("z", (0, 0.36, 0), 0.07, -0.40, 0.45, STEEL, 10)        # cilindro de pressão
	m.box(-0.38, 0.38, 0.00, 0.07, 0.34, 0.42, DARK)                    # alças
	m.box(-0.38, 0.38, 0.00, 0.07, -0.46, -0.38, DARK)
	m.cylinder("y", (0.19, 0, -0.50), 0.035, -0.25, 0.10, DARK, 8)     # saída da mangueira
	return collada(m, "flame_tank")


def make_anchor():
	m = Mesh()
	m.tris.append((m._v((0, 0, -5), (0, 0, 1), (0, 0)), m._v((0.001, 0, -5), (0, 0, 1), (1, 0)),
		m._v((0, 0.001, -5), (0, 0, 1), (0, 1))))
	return collada(m, "flame_anchor")


def make_texture():
	random.seed(11)
	S = 256
	im = Image.new("RGBA", (S, S), (0, 0, 0, 255))
	px = im.load()
	# Imagem com origem no topo: v (OpenGL, de baixo) -> linha S-1-y.
	for y in range(S):
		v = 1 - (y + 0.5) / S
		for x in range(S):
			u = (x + 0.5) / S
			n = random.randint(-10, 10)
			if v >= 0.5:
				# tanques: vermelho industrial; faixa com cor do jogador (alpha 0)
				# e faixa de perigo amarela/preta.
				t = (v - 0.52) / 0.46
				if 0.70 <= t <= 0.80:
					c = (200, 200, 200, 0)
				elif 0.60 <= t < 0.68:
					stripe = int((u * 40 + t * 40)) % 2
					c = (230, 180, 30, 255) if stripe else (25, 25, 25, 255)
				else:
					shade = 1.0 - 0.25 * abs(math.sin(u * math.pi * 2))
					c = (int((150 + n) * shade), int((35 + n // 2) * shade), int((28 + n // 2) * shade), 255)
			elif u < 0.5:
				g = 52 + n
				c = (g, g + 2, g + 6, 255)
			else:
				g = 110 + n
				c = (g, g, g + 4, 255)
			px[x, y] = c
	d = ImageDraw.Draw(im)
	# cobre do ignitor e cinza-escuro de detalhes
	d.rectangle([int(0.78 * S), int(0.66 * S), int(0.84 * S), int(0.72 * S)], fill=(170, 95, 45, 255))
	d.rectangle([int(0.28 * S), int(0.66 * S), int(0.34 * S), int(0.72 * S)], fill=(30, 30, 32, 255))
	path = os.path.join(ROOT, "art/textures/skins/props/weapons/flamethrower.png")
	os.makedirs(os.path.dirname(path), exist_ok=True)
	im.save(path)


# ---------------------------------------------------------------- partículas

JET_STEP = 2
JET_MAX = 24
JET_LIFE = 0.36


def jet_particles(length, core):
	speed = length / JET_LIFE
	spread = speed * (0.05 if core else 0.11)
	size0, size1 = (0.25, 0.5 + length * 0.05) if core else (0.35, 0.9 + length * 0.11)
	growth = (size1 - size0) / JET_LIFE
	color = ('<uniform name="color.r" min="1.0" max="1.0"/>\n    <uniform name="color.g" min="0.75" max="0.9"/>\n'
		'    <uniform name="color.b" min="0.35" max="0.5"/>') if core else \
		('<uniform name="color.r" min="0.95" max="1.0"/>\n    <uniform name="color.g" min="0.38" max="0.55"/>\n'
		'    <uniform name="color.b" min="0.05" max="0.12"/>')
	return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Jato de chamas de {length} m ({"núcleo" if core else "chama externa"}), gerado.
     Espaço local: o jato sai do bocal (z=0) pelo eixo -Z (a entidade é
     girada para o alvo pelo componente LaserBeam). -->
<particles>
    <texture>art/textures/particles/{"flame_radiant" if core else "flame"}.png</texture>
    <blend mode="add"/>
    <use_local_space/>

    <constant name="emissionrate" value="{110 if core else 150}.0"/>
    <uniform name="lifetime" min="{JET_LIFE * 0.85:.3f}" max="{JET_LIFE * 1.1:.3f}"/>

    <uniform name="position.x" min="-0.05" max="0.05"/>
    <uniform name="position.y" min="-0.05" max="0.05"/>
    <constant name="position.z" value="0.0"/>

    <uniform name="velocity.x" min="{-spread:.2f}" max="{spread:.2f}"/>
    <uniform name="velocity.y" min="{-spread * 0.6:.2f}" max="{spread * 1.2:.2f}"/>
    <uniform name="velocity.z" min="{-speed * 1.05:.2f}" max="{-speed * 0.92:.2f}"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.angle" min="-4.0" max="4.0"/>

    <uniform name="size" min="{size0 * 0.8:.2f}" max="{size0 * 1.2:.2f}"/>
    <constant name="size.growthRate" value="{growth:.2f}"/>

    {color}
</particles>
"""


PARTICLES = {
	"flame_pilot.xml": """<?xml version="1.0" encoding="utf-8"?>
<!-- Chama-piloto no bocal do lança-chamas enquanto ataca. -->
<particles>
    <texture>art/textures/particles/flame.png</texture>
    <blend mode="add"/>
    <constant name="emissionrate" value="40.0"/>
    <uniform name="lifetime" min="0.10" max="0.20"/>
    <uniform name="position.x" min="-0.03" max="0.03"/>
    <uniform name="position.y" min="-0.03" max="0.03"/>
    <uniform name="position.z" min="-0.03" max="0.03"/>
    <uniform name="velocity.x" min="-0.2" max="0.2"/>
    <uniform name="velocity.y" min="0.2" max="0.8"/>
    <uniform name="velocity.z" min="-0.2" max="0.2"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="size" min="0.20" max="0.35"/>
    <uniform name="color.r" min="0.9" max="1.0"/>
    <uniform name="color.g" min="0.5" max="0.7"/>
    <uniform name="color.b" min="0.2" max="0.3"/>
</particles>
""",
	"flame_impact_fire.xml": """<?xml version="1.0" encoding="utf-8"?>
<!-- Fogo no ponto atingido pelo lança-chamas (combustível espirrado em chamas). -->
<particles>
    <texture>art/textures/particles/flame.png</texture>
    <blend mode="add"/>
    <constant name="emissionrate" value="45.0"/>
    <uniform name="lifetime" min="0.45" max="0.9"/>
    <uniform name="position.x" min="-1.4" max="1.4"/>
    <uniform name="position.y" min="0.0" max="0.4"/>
    <uniform name="position.z" min="-1.4" max="1.4"/>
    <uniform name="velocity.x" min="-0.4" max="0.4"/>
    <uniform name="velocity.y" min="1.2" max="3.2"/>
    <uniform name="velocity.z" min="-0.4" max="0.4"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.angle" min="-2.0" max="2.0"/>
    <uniform name="size" min="0.9" max="1.6"/>
    <constant name="size.growthRate" value="-0.6"/>
    <uniform name="color.r" min="0.95" max="1.0"/>
    <uniform name="color.g" min="0.4" max="0.6"/>
    <uniform name="color.b" min="0.08" max="0.15"/>
</particles>
""",
	"flame_impact_smoke.xml": """<?xml version="1.0" encoding="utf-8"?>
<!-- Fumaça escura do combustível queimando. -->
<particles>
    <texture>art/textures/particles/smoke_128a.png</texture>
    <blend mode="over"/>
    <constant name="emissionrate" value="8.0"/>
    <uniform name="lifetime" min="1.6" max="2.6"/>
    <uniform name="position.x" min="-1.0" max="1.0"/>
    <uniform name="position.y" min="1.0" max="1.8"/>
    <uniform name="position.z" min="-1.0" max="1.0"/>
    <uniform name="velocity.x" min="-0.4" max="0.4"/>
    <uniform name="velocity.y" min="1.0" max="2.0"/>
    <uniform name="velocity.z" min="-0.4" max="0.4"/>
    <uniform name="angle" min="-3.14" max="3.14"/>
    <uniform name="velocity.angle" min="-0.5" max="0.5"/>
    <uniform name="size" min="1.4" max="2.2"/>
    <constant name="size.growthRate" value="1.4"/>
    <uniform name="color.r" min="0.16" max="0.22"/>
    <uniform name="color.g" min="0.13" max="0.18"/>
    <uniform name="color.b" min="0.12" max="0.16"/>
</particles>
""",
}


def particle_actor(particle_file):
	return f"""<?xml version="1.0" encoding="utf-8"?>
<actor version="1">
  <group>
    <variant name="Base">
      <particles file="{particle_file}"/>
    </variant>
  </group>
  <material>basic_trans.xml</material>
</actor>
"""


def anchor_actor(props, comment):
	prop_xml = "\n".join('        <prop actor="%s" attachpoint="root"/>' % p for p in props)
	return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- {comment} (gerado por tools/flamethrower/gen_flamethrower.py) -->
<actor version="1">
  <group>
    <variant name="Base">
      <mesh>props/flame_anchor.dae</mesh>
      <props>
{prop_xml}
      </props>
      <textures>
        <texture file="props/weapons/flamethrower.png" name="baseTex"/>
      </textures>
    </variant>
  </group>
  <material>basic_trans.xml</material>
</actor>
"""


def main():
	write("art/meshes/props/weapons/flamethrower.dae", make_gun())
	write("art/meshes/props/armor/flame_tank.dae", make_tank())
	write("art/meshes/props/flame_anchor.dae", make_anchor())
	make_texture()

	for name, text in PARTICLES.items():
		write("art/particles/flamethrower/" + name, text)
		write("art/actors/particle/flamethrower/" + name, particle_actor("flamethrower/" + name))

	for length in range(JET_STEP, JET_MAX + 1, JET_STEP):
		tag = "%03d" % length
		write("art/particles/flamethrower/jet_%s.xml" % tag, jet_particles(length, False))
		write("art/particles/flamethrower/jet_core_%s.xml" % tag, jet_particles(length, True))
		write("art/actors/particle/flamethrower/jet_%s.xml" % tag, particle_actor("flamethrower/jet_%s.xml" % tag))
		write("art/actors/particle/flamethrower/jet_core_%s.xml" % tag, particle_actor("flamethrower/jet_core_%s.xml" % tag))
		write("art/actors/props/units/weapons/flame_jet/jet_%s.xml" % tag, anchor_actor(
			["particle/flamethrower/jet_%s.xml" % tag, "particle/flamethrower/jet_core_%s.xml" % tag],
			"Jato de chamas de %d m" % length))

	write("art/actors/props/units/weapons/flame_jet/impact.xml", anchor_actor(
		["particle/flamethrower/flame_impact_fire.xml", "particle/flamethrower/flame_impact_smoke.xml"],
		"Impacto do lança-chamas"))
	print("ok")


if __name__ == "__main__":
	main()

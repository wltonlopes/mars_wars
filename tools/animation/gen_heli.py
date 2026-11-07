#!/usr/bin/env python3
"""Helicóptero do mcc (art/meshes/vehicle/heli_01.dae).

  - Rotores girando: o rotor principal (pás + cabeça, no alto) gira em torno
    do eixo vertical e o rotor de cauda (fenestron: cubo + pás dentro do anel)
    em torno do eixo X. Os dois giram também na animação parada, porque o
    helicóptero paira no ar sem ordens.
  - Metralhadora de queixo: malha própria, pendurada a partir da origem (o
    ponto de fixação), com os canos para a frente (-Y); vira a torreta
    units/mcc/helicopter_turret.

  - Foguetes: acha os casulos de foguetes (as peças sob as asas, no lugar
    dos pontos prop_weapons_* do modelo) e põe neles os pontos de encaixe
    projectile (de onde o foguete sai), rocket_l/rocket_r (bocas) e
    backblast_l/backblast_r (traseiras, para o sopro do disparo).

Gera:
  art/meshes/vehicle/heli_01_rigged.dae, art/skeletons/heli_01.xml
  art/animation/vehicle/heli_01/idle.dae          rotores em uma volta
  art/animation/vehicle/heli_01/attack.dae        disparo: recuo do nariz,
                                                  rotores girando
  art/particles/heli_rocket_*.xml + actors        clarão, fumaça e sopro
  art/meshes/vehicle/heli_01_turret.dae
  art/actors/vehicle/mcc/heli_01_turret.xml
e troca a malha em art/actors/vehicle/mcc/heli_01.xml.

heli_01.dae não é alterada: ao reexportar do Blender, rode de novo.
Uso (na pasta do mod):  python3 tools/animation/gen_heli.py
"""
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "foundations"))
from dae_rig import write_animation  # noqa: E402
from gen_wheels import MOD, Vehicle  # noqa: E402
import gen_foundations  # noqa: E402

ACTOR = "art/actors/vehicle/mcc/heli_01.xml"
TURRET_MESH = "art/meshes/vehicle/heli_01_turret.dae"
TURRET_ACTOR = "art/actors/vehicle/mcc/heli_01_turret.xml"
# Escala do helicóptero e de tudo ligado a ele (metralhadora, pontos de
# encaixe, efeitos), em relação ao modelo heli_01.dae. A posição da torreta e
# a altura de disparo no template (units/mcc/helicopter.xml) acompanham.
SCALE = 0.9
FRAMES = 12
ATTACK_FRAMES = 30
FPS = 30.0
# Recuo do disparo: nariz para cima (graus) e para trás (metros).
RECOIL_DEGREES = 3.0
RECOIL_PUSH = 0.35 * SCALE


def rotation(axis, angle):
	c, s = np.cos(angle), np.sin(angle)
	if axis == "z":
		return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)
	return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


class Helicopter(Vehicle):
	BONE = "rotor"

	def bake(self):
		"""Transformação do Blender e a escala SCALE (os pontos de encaixe, filhos
		do objeto, também são escalados)."""
		super().bake()
		self.pos *= SCALE
		self.mesh_matrix = np.diag([SCALE, SCALE, SCALE, 1.0]) @ self.mesh_matrix

	def find_wheels(self):
		part = self.parts()
		labels = np.unique(part)
		boxes = {l: (self.pos[part == l].min(axis=0), self.pos[part == l].max(axis=0)) for l in labels}
		top = self.pos[:, 2].max()

		# Rotor principal: peças no alto (acima das asas) ligadas à cabeça do rotor,
		# que é a peça alta mais perto do eixo central.
		high = [l for l in labels if boxes[l][0][2] > 0.65 * top]
		head = min(high, key=lambda l: abs(boxes[l][0][0] + boxes[l][1][0]) + np.ptp([boxes[l][0][1], boxes[l][1][1]]))
		hub = (boxes[head][0] + boxes[head][1]) / 2
		main = [l for l in high if np.min(np.hypot(self.pos[part == l][:, 0] - hub[0], self.pos[part == l][:, 1] - hub[1])) < 1.5]
		blades_z = np.mean([(boxes[l][0][2] + boxes[l][1][2]) / 2 for l in main if l != head] or [hub[2]])
		main_center = np.array([0.0, hub[1], blades_z])

		# Rotor de cauda: peças finas no plano central, na cauda, abaixo da
		# deriva (o anel do fenestron é mais largo e fica de fora).
		tail_y = self.pos[:, 1].max()
		tail = [l for l in labels if max(abs(boxes[l][0][0]), abs(boxes[l][1][0])) <= 0.7 and boxes[l][0][1] > tail_y - 6.5
			and boxes[l][1][2] < 0.68 * top]
		lo = np.min([boxes[l][0] for l in tail], axis=0)
		hi = np.max([boxes[l][1] for l in tail], axis=0)
		tail_center = np.array([0.0, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2])

		self.part = part
		self.wheels = [
			# Pás: 4 no principal, 6 na cauda; o ciclo dá uma e duas voltas.
			{"labels": main, "center": main_center, "radius": 1.0, "axis": "z", "turn": 2 * np.pi},
			{"labels": tail, "center": tail_center, "radius": 1.0, "axis": "x", "turn": 4 * np.pi},
		]
		self.joint_of_vertex = np.zeros(len(self.pos), int)
		for j, rotor in enumerate(self.wheels, 1):
			self.joint_of_vertex[np.isin(part, rotor["labels"])] = j
		self.cycle = 1.0
		print("rotor principal: %d peças, eixo em (y %.2f, z %.2f); cauda: %d peças, eixo em (y %.2f, z %.2f)" % (
			len(main), main_center[1], main_center[2], len(tail), tail_center[1], tail_center[2]))

	def find_props(self):
		"""Pontos do modelo e, nos casulos de foguetes, os de disparo."""
		super().find_props()
		weapons = [m[:3, 3] for name, m in self.props if name.startswith("prop_weapons")]
		pods = []
		for point in weapons:
			best = None
			for label in np.unique(self.part):
				v = self.pos[self.part == label]
				lo, hi = v.min(axis=0), v.max(axis=0)
				# O casulo: peça comprida em Y que contém o ponto em X e Z.
				if lo[0] - 0.3 <= point[0] <= hi[0] + 0.3 and lo[2] - 0.3 <= point[2] <= hi[2] + 0.3 \
						and np.ptp(v[:, 1]) > 2 * np.ptp(v[:, 0]):
					if best is None or np.ptp(v[:, 1]) > np.ptp(best[:, 1]):
						best = v
			if best is not None:
				pods.append(best)
		if len(pods) != 2:
			sys.exit("esperava 2 casulos de foguetes junto a prop_weapons_*, achei %d" % len(pods))
		pods.sort(key=lambda v: v[:, 0].mean())
		for side, v in zip("lr", pods):
			lo, hi = v.min(axis=0), v.max(axis=0)
			x, z = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
			for name, y in (("rocket_" + side, lo[1] - 0.2), ("backblast_" + side, hi[1] + 0.3)):
				m = np.eye(4)
				m[:3, 3] = (x, y, z)
				self.props.append(("prop_" + name, m))
			if side == "r":
				m = np.eye(4)
				m[:3, 3] = (x, lo[1] + 0.4, z)
				self.props.append(("prop_projectile", m))
		self.pods = pods
		print("casulos de foguetes em x = %s, altura %.2f m" % (
			", ".join("%.2f" % v[:, 0].mean() for v in pods), np.mean([v[:, 2].mean() for v in pods])))

	def pose(self, cycle, recoil=0.0):
		"""Rotores girados `cycle` voltas do ciclo; `recoil` (0..1) levanta o
		nariz e empurra o helicóptero um pouco para trás, como no disparo."""
		out = self.rest()
		for nid, rotor in zip(self.order[1:], self.wheels):
			out[nid][:3, :3] = rotation(rotor["axis"], cycle * rotor["turn"])
		if recoil:
			root = np.eye(4)
			# Nariz para cima = rotação negativa em X (a frente é -Y).
			root[:3, :3] = rotation("x", -np.radians(RECOIL_DEGREES) * recoil)
			root[1, 3] = RECOIL_PUSH * recoil
			out[self.order[0]] = root
		return out

	def write(self):
		anim_dir = os.path.join(MOD, "art", "animation", "vehicle", self.name)
		os.makedirs(anim_dir, exist_ok=True)
		open(os.path.join(MOD, "art", "meshes", "vehicle", self.name + "_rigged.dae"), "w", encoding="utf-8").write(
			self.rigged.replace("  <library_animations>\n  </library_animations>\n", ""))
		self.text = self.rigged
		poses = [self.pose(i / FRAMES) for i in range(FRAMES + 1)]
		write_animation(self, os.path.join(anim_dir, "idle.dae"), "idle", np.arange(len(poses)) / FPS, poses)
		# Disparo (1 s): o recuo sobe rápido e volta devagar; os rotores
		# mantêm o mesmo ritmo da animação parada.
		poses = []
		for i in range(ATTACK_FRAMES + 1):
			t = i / ATTACK_FRAMES
			recoil = t / 0.12 if t < 0.12 else np.exp(-(t - 0.12) * 6)
			poses.append(self.pose(i / FRAMES, recoil))
		write_animation(self, os.path.join(anim_dir, "attack.dae"), "attack", np.arange(len(poses)) / FPS, poses)
		open(os.path.join(MOD, "art", "skeletons", self.name + ".xml"), "w", encoding="utf-8").write(self.skeleton_xml())
		print("gravado %s_rigged.dae (%d ossos) e a animação dos rotores" % (self.name, len(self.names)))


def write_turret():
	"""Metralhadora de queixo: suporte, corpo esférico e dois canos para a frente."""
	b = gen_foundations.Builder()
	b.box((0, 0, -0.2), (0.5, 0.5, 0.4), "steel")
	b.box((0, 0, -0.85), (1.3, 1.4, 0.9), "steel")
	b.box((0, -0.55, -0.85), (1.0, 0.5, 0.7), "tube")
	for x in (-0.22, 0.22):
		b.beam((x, -0.7, -0.9), (x, -2.8, -0.9), 0.14, "steel")
		b.beam((x, -2.55, -0.9), (x, -2.85, -0.9), 0.2, "cable")
	b.box((0.8, 0.1, -0.8), (0.35, 0.8, 0.5), "crate")
	b.pos = [p * SCALE for p in b.pos]
	b.write(os.path.join(MOD, TURRET_MESH), "heli_01_turret", {"projectile": tuple(SCALE * v for v in (0, -2.9, -0.9))})
	open(os.path.join(MOD, TURRET_ACTOR), "w", encoding="utf-8").write("""<?xml version="1.0" encoding="utf-8"?>
<!-- Metralhadora de queixo do helicóptero (torreta units/mcc/helicopter_turret),
     gerada por tools/animation/gen_heli.py: pendurada a partir da origem. -->
<actor version="1">
  <castshadow/>
  <group>
    <variant name="Base">
      <mesh>vehicle/heli_01_turret.dae</mesh>
      <props>
        <!-- Boca dos canos: daqui saem os traçantes. -->
        <prop actor="props/units/weapons/ammo/tracer_heavy.xml" attachpoint="projectile"/>
      </props>
      <textures>
        <texture file="%s" name="baseTex"/>
      </textures>
    </variant>
  </group>
  <group>
    <variant frequency="1" name="Idle"/>
    <variant name="attack_ranged">
      <props>
        <prop actor="particle/heli_rocket_flash.xml" attachpoint="projectile"/>
      </props>
    </variant>
  </group>
  <material>default.xml</material>
</actor>
""" % gen_foundations.TEXTURE)
	print("gravado", TURRET_MESH, "e", TURRET_ACTOR)


def update_actor():
	path = os.path.join(MOD, ACTOR)
	text = open(path, encoding="utf-8").read()
	block = ('{i}<!-- rotores: gen_heli.py -->\n'
		'{i}<mesh>vehicle/heli_01_rigged.dae</mesh>\n'
		'{i}<animations>\n'
		'{i}\t<!-- Idle: os rotores giram sempre no mesmo ritmo; andando, o\n'
		'{i}\t     jogo usa a mesma animação. -->\n'
		'{i}\t<animation file="vehicle/heli_01/idle.dae" name="Idle" speed="100"/>\n'
		'{i}\t<!-- Disparo: o foguete sai em event (fração da animação) e outro\n'
		'{i}\t     aparece no casulo em load. -->\n'
		'{i}\t<animation event="0.1" load="0.7" file="vehicle/heli_01/attack.dae" name="attack_ranged" speed="100"/>\n'
		'{i}</animations>\n'
		'{i}<props>\n'
		'{i}\t<!-- Foguete pronto no casulo direito (ponto de onde ele sai). -->\n'
		'{i}\t<prop actor="props/units/weapons/rocket_shoot.xml" attachpoint="projectile"/>\n'
		'{i}</props>')
	# Na primeira vez troca a linha da malha; nas seguintes, o bloco já gravado
	# (malha, animações e o <props> do foguete logo depois delas).
	text, count = re.subn(r"([ \t]*)(?:<!-- rotores: gen_heli.py -->.*?</animations>(?:\s*<props>\s*<!-- Foguete pronto.*?</props>)*"
		r"|<mesh>vehicle/heli_01\.dae</mesh>)",
		lambda m: block.format(i=m.group(1)), text, count=1, flags=re.S)
	if not count:
		sys.exit(ACTOR + " não usa vehicle/heli_01.dae")
	# Efeitos do disparo: grupo de variantes escolhido pela animação.
	effects = """  <!-- disparo: gen_heli.py -->
  <group>
    <variant frequency="1" name="Idle"/>
    <variant name="attack_ranged">
      <props>
        <prop actor="particle/heli_rocket_flash.xml" attachpoint="rocket_l"/>
        <prop actor="particle/heli_rocket_flash.xml" attachpoint="rocket_r"/>
        <prop actor="particle/heli_rocket_smoke.xml" attachpoint="rocket_l"/>
        <prop actor="particle/heli_rocket_smoke.xml" attachpoint="rocket_r"/>
        <prop actor="particle/heli_rocket_backblast.xml" attachpoint="backblast_l"/>
        <prop actor="particle/heli_rocket_backblast.xml" attachpoint="backblast_r"/>
      </props>
    </variant>
  </group>
"""
	text = re.sub(r"  <!-- disparo: gen_heli.py -->\n.*?</group>\n", "", text, flags=re.S)
	text = text.replace("  <material>", effects + "  <material>", 1)
	open(path, "w", encoding="utf-8").write(text)
	print("actor:", ACTOR)


PARTICLES = {
	"flash": ("Clarão na boca do casulo ao disparar o foguete.", "flame_radiant.png", "add", """    <start_full/>

    <constant name="emissionrate" value="40.0"/>
    <uniform name="lifetime" min="0.08" max="0.18"/>
    <uniform name="angle" min="-3.14" max="3.14"/>

    <uniform name="size" min="1.8" max="2.88"/>
    <constant name="size.growthRate" value="8.0"/>

    <constant name="color.r" value="1.0"/>
    <constant name="color.g" value="0.82"/>
    <constant name="color.b" value="0.45"/>
"""),
	"smoke": ("Fumaça que fica na boca do casulo depois do disparo.", "smoke_256a.png", "over", """    <constant name="emissionrate" value="22.0"/>
    <uniform name="lifetime" min="1.0" max="1.8"/>
    <uniform name="angle" min="-3.14" max="3.14"/>

    <uniform name="velocity.x" min="-0.8" max="0.8"/>
    <uniform name="velocity.y" min="-0.4" max="0.6"/>
    <uniform name="velocity.z" min="-0.8" max="0.8"/>
    <uniform name="velocity.angle" min="-0.4" max="0.4"/>

    <uniform name="size" min="1.08" max="1.62"/>
    <constant name="size.growthRate" value="2.2"/>

    <uniform name="color.r" min="0.6" max="0.72"/>
    <uniform name="color.g" min="0.58" max="0.7"/>
    <uniform name="color.b" min="0.55" max="0.66"/>
"""),
	"backblast": ("Sopro do foguete saindo pela traseira do casulo: fogo curto e poeira.", "flame.png", "add", """    <start_full/>

    <constant name="emissionrate" value="70.0"/>
    <uniform name="lifetime" min="0.12" max="0.3"/>
    <uniform name="angle" min="-3.14" max="3.14"/>

    <uniform name="velocity.x" min="-2.0" max="2.0"/>
    <uniform name="velocity.y" min="-2.0" max="1.0"/>
    <uniform name="velocity.z" min="-2.0" max="2.0"/>

    <uniform name="size" min="0.9" max="1.62"/>
    <constant name="size.growthRate" value="4.0"/>

    <constant name="color.r" value="1.0"/>
    <uniform name="color.g" min="0.55" max="0.75"/>
    <constant name="color.b" value="0.25"/>
"""),
}


def write_particles():
	for name, (comment, texture, blend, body) in PARTICLES.items():
		open(os.path.join(MOD, "art", "particles", "heli_rocket_%s.xml" % name), "w", encoding="utf-8").write(
			'<?xml version="1.0" encoding="utf-8"?>\n<!-- %s (gen_heli.py) -->\n<particles>\n'
			'    <texture>art/textures/particles/%s</texture>\n    <blend mode="%s"/>\n%s</particles>\n' % (comment, texture, blend, body))
		open(os.path.join(MOD, "art", "actors", "particle", "heli_rocket_%s.xml" % name), "w", encoding="utf-8").write(
			'<?xml version="1.0" encoding="utf-8"?>\n<actor version="1">\n  <group>\n    <variant name="Base">\n'
			'      <particles file="heli_rocket_%s.xml"/>\n    </variant>\n  </group>\n'
			'  <material>basic_trans.xml</material>\n</actor>\n' % name)


def main():
	Helicopter("heli_01").write()
	write_particles()
	write_turret()
	update_actor()


if __name__ == "__main__":
	main()

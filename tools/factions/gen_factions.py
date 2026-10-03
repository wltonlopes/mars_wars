"""
Gera as facções Legião de Ares (ares), Piratas das Dunas (pira), Coalizão
Terrestre (coa) e O Enxame (swarm) a partir das facções mcc e mla.

Versão base: reaproveita modelos existentes com texturas retintas na cor de
cada facção. Para regenerar depois de mudar algo aqui:
    python3 tools/factions/gen_factions.py      (na pasta do mod)

Edições feitas à mão são preservadas:
  - Actor próprio: se um template gerado passar a apontar para um actor seu
    (ex.: <Actor>vehicle/pira/cc.xml</Actor> em structures/pira/civil_centre),
    o gerador mantém esse actor e o anota em tools/factions/actor_overrides.json
    (pode editar esse arquivo direto: "template": "actor").
  - Qualquer outro arquivo gerado que você alterar (template, civ .json,
    actor, textura) não é sobrescrito; o gerador avisa quais foram mantidos.
    O controle fica em tools/factions/generated_manifest.json.
  - --force regrava tudo (os actors de actor_overrides.json continuam valendo).

Gera:
  art/textures/skins/factions/<civ>/...   texturas retintas
  art/actors/factions/<civ>/...           actors apontando para elas
  simulation/templates/structures/<civ>/  estruturas
  simulation/templates/units/<civ>/       unidades
  simulation/templates/special/players/<civ>.xml
  simulation/data/civs/<civ>.json
"""
import hashlib
import io
import json
import os
import re
import sys
import zipfile

from PIL import Image
import numpy as np

MOD = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC_ZIP = "/snap/0ad/743/binaries/data/mods/public/public.zip"
ZIP = zipfile.ZipFile(PUBLIC_ZIP)
ZIP_NAMES = set(ZIP.namelist())

# ------------------------------------------------------------ cores

# Gradiente (escuro -> claro) aplicado sobre a luminância de cada textura e
# misturado com a cor original. Alfa (cor do jogador) é preservado.
TINTS = {
	"ares": ([(10, 6, 6), (85, 18, 16), (170, 52, 40), (225, 170, 150)], 0.7),
	"pira": ([(18, 12, 8), (95, 66, 38), (180, 138, 88), (240, 222, 190)], 0.65),
	"coa": ([(14, 18, 26), (70, 92, 125), (175, 192, 215), (248, 250, 252)], 0.62),
	"swarm": ([(10, 4, 14), (70, 26, 92), (150, 78, 175), (228, 196, 238)], 0.72),
}


def read_file(rel):
	"""Arquivo do mod ou do jogo base (public.zip)."""
	path = os.path.join(MOD, rel)
	if os.path.exists(path):
		return open(path, "rb").read()
	if rel in ZIP_NAMES:
		return ZIP.read(rel)
	return None


# ------------------------------------------------------------ gravação protegida

FORCE = "--force" in sys.argv
MANIFEST_PATH = os.path.join(MOD, "tools/factions/generated_manifest.json")
OVERRIDES_PATH = os.path.join(MOD, "tools/factions/actor_overrides.json")
TEMPLATES_DIR = "simulation/templates/"


def load_json(path, default):
	try:
		return json.load(open(path, encoding="utf-8"))
	except (OSError, ValueError):
		return default


# rel -> {"hash": conteúdo gravado, "body": template sem o VisualActor, "actor": actor gravado}
MANIFEST = load_json(MANIFEST_PATH, {})
# "structures/pira/civil_centre" -> "vehicle/pira/cc.xml"
ACTOR_OVERRIDES = load_json(OVERRIDES_PATH, {})
KEPT = []
LEARNED = []


def sha(data):
	return hashlib.sha1(data).hexdigest()


def template_actor(text):
	m = re.search(r"<VisualActor>.*?<Actor>([^<]*)</Actor>", text, re.S)
	return m.group(1).strip() if m else None


def without_visual_actor(text):
	return re.sub(r"[ \t]*<VisualActor>.*?</VisualActor>[ \t]*\n?", "", text, flags=re.S)


def with_actor(text, actor_path):
	"""Template com o actor trocado (ou acrescentado antes de </Entity>)."""
	block = "  <VisualActor>\n    <Actor>" + actor_path + "</Actor>\n  </VisualActor>\n"
	if template_actor(text) is not None:
		return re.sub(r"(<VisualActor>.*?<Actor>)[^<]*(</Actor>)", lambda m: m.group(1) + actor_path + m.group(2), text, count=1, flags=re.S)
	i = text.rindex("</Entity>")
	return text[:i] + block + text[i:]


def write_bytes(rel, data, body=None, actor_path=None):
	"""Grava um arquivo gerado, sem passar por cima de edições feitas à mão."""
	path = os.path.join(MOD, rel)
	entry = MANIFEST.get(rel)
	if os.path.exists(path) and entry and not FORCE:
		disk = open(path, "rb").read()
		if sha(disk) != entry["hash"] and disk != data:
			# Só o actor mudou? Então já foi tratado como override e pode regravar.
			only_actor = body is not None and entry.get("body") == sha(without_visual_actor(disk.decode("utf-8", "replace")).encode("utf-8"))
			if not only_actor:
				KEPT.append(rel)
				return False
	os.makedirs(os.path.dirname(path), exist_ok=True)
	open(path, "wb").write(data)
	MANIFEST[rel] = {"hash": sha(data)}
	if body is not None:
		MANIFEST[rel]["body"] = sha(body.encode("utf-8"))
		MANIFEST[rel]["actor"] = actor_path
	return True


def save_image(rel, img):
	buf = io.BytesIO()
	img.save(buf, format="PNG")
	write_bytes(rel, buf.getvalue())


def finish():
	json.dump(MANIFEST, open(MANIFEST_PATH, "w", encoding="utf-8"), indent="\t", sort_keys=True)
	json.dump(ACTOR_OVERRIDES, open(OVERRIDES_PATH, "w", encoding="utf-8"), indent="\t", sort_keys=True, ensure_ascii=False)
	if ACTOR_OVERRIDES:
		print("Actors próprios mantidos (tools/factions/actor_overrides.json):")
		for template in sorted(ACTOR_OVERRIDES):
			print("  " + template + " -> " + ACTOR_OVERRIDES[template] + ("   (novo)" if template in LEARNED else ""))
	if KEPT:
		print("Arquivos editados à mão, NÃO sobrescritos (use --force para regravar):")
		for rel in KEPT:
			print("  " + rel)


def tint_image(data, civ):
	stops, strength = TINTS[civ]
	img = Image.open(io.BytesIO(data))
	img.load()
	has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
	rgba = img.convert("RGBA")
	arr = np.asarray(rgba).astype(np.float32)
	rgb = arr[..., :3]
	lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255.0
	stops = np.array(stops, dtype=np.float32)
	pos = lum * (len(stops) - 1)
	i0 = np.clip(np.floor(pos).astype(int), 0, len(stops) - 2)
	t = (pos - i0)[..., None]
	grad = stops[i0] * (1 - t) + stops[i0 + 1] * t
	out = rgb * (1 - strength) + grad * strength
	arr[..., :3] = np.clip(out, 0, 255)
	result = Image.fromarray(arr.astype(np.uint8), "RGBA")
	return result if has_alpha else result.convert("RGB")


TEXTURE_CACHE = {}


def tinted_texture(tex, civ):
	"""tex relativo a art/textures/skins; devolve o caminho novo (ou o original)."""
	key = (tex, civ)
	if key in TEXTURE_CACHE:
		return TEXTURE_CACHE[key]
	data = read_file("art/textures/skins/" + tex)
	if data is None:
		# No jogo base muitas texturas só existem já convertidas.
		data = read_file("art/textures/skins/" + tex + ".cached.dds")
	new = tex
	if data is not None:
		try:
			img = tint_image(data, civ)
			new = "factions/" + civ + "/" + os.path.splitext(tex)[0] + ".png"
			save_image("art/textures/skins/" + new, img)
		except Exception as error:  # DDS que o PIL não lê: mantém a original
			print("  (sem retinta) " + tex + ": " + str(error))
			new = tex
	TEXTURE_CACHE[key] = new
	return new


ACTOR_CACHE = {}
# Props com textura própria que também mudam de cor.
RECURSE_PROPS = ("props/units/helmets/", "props/units/armor/", "props/structures/")


def tinted_actor(actor, civ):
	"""actor relativo a art/actors; devolve o caminho do actor retinto."""
	key = (actor, civ)
	if key in ACTOR_CACHE:
		return ACTOR_CACHE[key]
	data = read_file("art/actors/" + actor)
	if data is None:
		print("  ! actor não encontrado: " + actor)
		ACTOR_CACHE[key] = actor
		return actor
	text = data.decode("utf-8-sig")
	new = "factions/" + civ + "/" + actor
	ACTOR_CACHE[key] = new

	def sub_texture(m):
		return m.group(1) + tinted_texture(m.group(2), civ) + m.group(3)

	text = re.sub(r'(<texture\s+file=")([^"]+)("\s+name="baseTex")', sub_texture, text)

	def sub_prop(m):
		prop = m.group(2)
		if prop.startswith(RECURSE_PROPS):
			prop = tinted_actor(prop, civ)
		return m.group(1) + prop + m.group(3)

	text = re.sub(r'(<prop\s+actor=")([^"]+)(")', sub_prop, text)
	write_bytes("art/actors/" + new, text.encode("utf-8"))
	return new


# ------------------------------------------------------------ templates

def write(rel, text):
	if not (rel.startswith(TEMPLATES_DIR) and "</Entity>" in text):
		write_bytes(rel, text.encode("utf-8"))
		return

	# Template: o actor escolhido à mão é do usuário (modelos 3D próprios).
	key = rel[len(TEMPLATES_DIR):-len(".xml")]
	path = os.path.join(MOD, rel)
	entry = MANIFEST.get(rel)
	if entry and os.path.exists(path):
		disk_actor = template_actor(open(path, encoding="utf-8").read())
		if disk_actor and disk_actor != entry.get("actor") and ACTOR_OVERRIDES.get(key) != disk_actor:
			ACTOR_OVERRIDES[key] = disk_actor
			LEARNED.append(key)
	body = without_visual_actor(text)
	if key in ACTOR_OVERRIDES:
		text = with_actor(text, ACTOR_OVERRIDES[key])
	write_bytes(rel, text.encode("utf-8"), body, template_actor(text))


def entity(parent, body):
	return '<?xml version="1.0" encoding="utf-8"?>\n<!-- Gerado por tools/factions/gen_factions.py -->\n' + \
		'<Entity parent="' + parent + '">\n' + body + '</Entity>\n'


def esc(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") if text else text


def identity(civ, generic, specific=None, icon=None, tooltip=None, classes=None, visible=None, extra=""):
	generic, specific, tooltip = esc(generic), esc(specific), esc(tooltip)
	out = "  <Identity>\n    <Civ>" + civ + "</Civ>\n    <GenericName>" + generic + "</GenericName>\n"
	if specific:
		out += "    <SpecificName>" + specific + "</SpecificName>\n"
	if icon:
		out += "    <Icon>" + icon + "</Icon>\n"
	if tooltip:
		out += "    <Tooltip>" + tooltip + "</Tooltip>\n"
	if classes:
		out += '    <Classes datatype="tokens">' + classes + "</Classes>\n"
	if visible:
		out += '    <VisibleClasses datatype="tokens">' + visible + "</VisibleClasses>\n"
	out += extra + "  </Identity>\n"
	return out


def cost(food=0, water=0, materials=0, energy=0, time=None, pop=None):
	out = "  <Cost>\n"
	if pop is not None:
		out += "    <Population>" + str(pop) + "</Population>\n"
	if time is not None:
		out += "    <BuildTime>" + str(time) + "</BuildTime>\n"
	out += "    <Resources>\n"
	for tag, value in (("food", food), ("metal", water), ("stone", materials), ("wood", energy)):
		out += "      <" + tag + ">" + str(value) + "</" + tag + ">\n"
	out += "    </Resources>\n  </Cost>\n"
	return out


def actor(path):
	return "  <VisualActor>\n    <Actor>" + path + "</Actor>\n  </VisualActor>\n"


def trainer(entities):
	if not entities:
		return ""
	return '  <Trainer>\n    <Entities datatype="tokens" replace="">\n' + \
		"".join("      " + e + "\n" for e in entities) + "    </Entities>\n  </Trainer>\n"


def auras(names):
	return '  <Auras datatype="tokens">' + " ".join(names) + "</Auras>\n"


def health(value):
	return "  <Health>\n    <Max>" + str(value) + "</Max>\n  </Health>\n"


def speed(walk):
	return "  <UnitMotion>\n    <WalkSpeed>" + str(walk) + "</WalkSpeed>\n  </UnitMotion>\n"


def vision(value):
	return "  <Vision>\n    <Range>" + str(value) + "</Range>\n  </Vision>\n"


# ------------------------------------------------------------ facções

STRUCTURE_ACTORS = {
	"mla": {
		"civil_centre": "structures/mla/civic_center.xml", "house": "structures/mla/house.xml",
		"barracks": "structures/mla/bunker.xml", "stable": "structures/mla/stable.xml",
		"storehouse": "structures/mla/storehouse.xml", "farmstead": "structures/mla/greenhouse.xml",
		"field": "structures/mla/greenhouse.xml", "forge": "structures/mla/lab.xml",
		"sentry_tower": "structures/mla/auto_defense_tower.xml", "silos": "structures/mla/silos.xml",
		"aero": "structures/mla/aeroport.xml", "air_defense_tower": "structures/mla/air_defense_tower.xml"},
	"mcc": {
		"civil_centre": "structures/mcc/civic_center.xml", "house": "structures/mcc/house.xml",
		"barracks": "structures/mcc/bunker.xml", "stable": "structures/mcc/stable.xml",
		"storehouse": "structures/mcc/storehouse.xml", "farmstead": "structures/mcc/greenhouse.xml",
		"field": "structures/mcc/greenhouse.xml", "forge": "structures/mcc/lab.xml",
		"sentry_tower": "structures/mcc/auto_defense_tower.xml", "silos": "structures/mcc/silos.xml",
		"aero": "structures/mcc/aeroport.xml", "air_defense_tower": "structures/mcc/air_defense_tower.xml"},
}

FACTIONS = {
	"ares": {
		"base": "mla",
		"name": "Legion of Ares",
		"history": "Born inside the MLA itself, the Legion of Ares believes political independence is not enough: Mars must become a militarised, disciplined, hierarchical and self-sufficient nation. Anyone from outside Mars - the MCC, the Coalition, foreigners, Earth organisations - is a potential threat. \"Only the strong will inherit Mars.\"",
		"structures": {
			"civil_centre": ("Legion Citadel", ["worker", "battalion_legion", "battalion_shock"]),
			"house": ("Barracks Block", []),
			"barracks": ("War Hall", ["battalion_legion", "battalion_shock", "exo_trooper"]),
			"stable": ("Armoury", ["vehicle_assault", "vehicle_tank"]),
			"storehouse": ("Depot", []), "farmstead": ("Hydroponics", []), "field": ("Hydroponic Field", []),
			"forge": ("Forge of Ares", []), "sentry_tower": ("Bastion", []), "silos": ("Fortified Silo", []),
		},
		"units": {
			"worker": dict(kind="worker", parent="units/mla/worker", actor="units/mla/worker.xml",
				name="Legion Labourer", cost=cost(food=50, time=10)),
			"legionary": dict(parent="units/mla/rifleman", actor="units/mla/rifle_assalt_champion.xml",
				name="Legionary", specific="Ares Line Infantry", icon="units/squad_rifle.png",
				tooltip="Heavy infantry. Short range, thick armour, deadly up close."),
			"shock_trooper": dict(parent="units/mla/smg_soldier", actor="units/mla/rifle_assalt_guerrilla.xml",
				name="Shock Trooper", icon="units/squad_assalt.png",
				tooltip="Assault infantry for charges and close combat."),
			"exo_trooper": dict(parent="units/mcc/heavy_rifleman", actor="units/mcc/heavy_rifle_assault.xml",
				name="Exo-Legionary", specific="Exoskeleton Trooper", icon="units/squad_machine_gun.png",
				tooltip="Exoskeleton heavy gunner. Very slow and very hard to dislodge.",
				extra=health(320) + speed(6.5) + cost(food=60, water=80, materials=60, time=24)),
			"vehicle_assault": dict(parent="units/mla/vehicle_medium", actor="vehicle/mla/coyote.xml",
				name="Assault Carrier", icon="units/armored.png",
				tooltip="Armoured assault vehicle that rushes troops into the fight.",
				extra=cost(water=150, materials=120, energy=60, time=30)),
			"vehicle_tank": dict(parent="units/mcc/vehicle_heavy", actor="vehicle/mcc/mammoth.xml",
				name="Ares Battle Tank", icon="units/armored.png",
				tooltip="Main battle tank of the Legion: thick armour, heavy cannon.",
				extra=cost(water=250, materials=220, energy=120, time=45)),
		},
		"battalions": {
			"battalion_legion": ("assault", "legionary", 4, "Legion Cohort", "units/squad_rifle.png",
				cost(food=120, water=100, materials=40, time=30)),
			"battalion_shock": ("assault", "shock_trooper", 4, "Shock Cohort", "units/squad_assalt.png",
				cost(food=110, water=90, time=26)),
		},
		"start": ["battalion_legion"],
	},
	"pira": {
		"base": "mla",
		"name": "Dune Pirates",
		"history": "A people without a homeland: smugglers, raiders, ex-soldiers, traders, deserters, explorers, criminals and nomadic communities who cross Mars constantly. They have no great cities, no central government and no heavy industry - their base is a caravan. \"Mars belongs to no one.\"",
		"structures": {
			"civil_centre": ("Caravan Hub", ["worker", "battalion_raiders", "scout"]),
			"house": ("Tent Camp", []),
			"barracks": ("Hideout", ["battalion_raiders", "rifleman", "scout", "bm_lmg"]),
			"stable": ("Chop Shop", ["vehicle_buggy", "vehicle_technical", "drone_kamikaze", "bm_laser_tank"]),
			"storehouse": ("Scrap Yard", []), "farmstead": ("Water Still", []), "field": ("Moisture Farm", []),
			"forge": ("Black Market", ["bm_vtol"]), "sentry_tower": ("Lookout", []),
		},
		# Poder especial do centro cívico: tempestade de areia (no lugar do míssil nuclear do mla).
		"structure_extra": {
			"civil_centre": "  <AirSupportProvider replace=\"\">\n    <sandstorm>\n      <Cooldown>240</Cooldown>\n" +
				"      <Template>special/sandstorm_strike</Template>\n    </sandstorm>\n  </AirSupportProvider>\n",
		},
		"units": {
			"worker": dict(kind="worker", parent="units/mla/worker", actor="units/mla/worker.xml",
				name="Scavenger", cost=cost(food=45, time=8)),
			"raider": dict(parent="units/mla/smg_soldier", actor="units/mla/rifle_assalt_guerrilla.xml",
				name="Raider", icon="units/squad_assalt.png", tooltip="Fast raider with a submachine gun."),
			"rifleman": dict(parent="units/pirates_mars_rifleman", actor="units/mcc/rifle_assalt_pmc_b.xml",
				name="Dune Rifleman", icon="units/squad_rifle.png",
				tooltip="Cheap rifleman who hits and runs.", extra=cost(food=40, water=30, time=10)),
			"scout": dict(parent="units/mla/sniper_oper", actor="units/mla/rifle_assalt_champion_snipe_p.xml",
				name="Dune Scout", specific="Sharpshooter Scout", icon="units/squad_recon.png",
				tooltip="Long sight and a long rifle: finds the enemy and picks targets for ambushes.",
				extra=vision(120) + cost(food=50, water=60, time=14)),
			"vehicle_buggy": dict(parent="units/mla/vehicle_light", actor="vehicle/mla/kutu.xml",
				name="Dune Buggy", icon="units/armored.png", tooltip="Very fast light vehicle for raids.",
				extra=cost(water=80, materials=60, time=15)),
			"vehicle_technical": dict(parent="units/mla/vehicle_medium", actor="vehicle/mla/coyote.xml",
				name="Technical", icon="units/armored.png", tooltip="Pickup with a mounted gun.",
				extra=cost(water=120, materials=90, energy=30, time=22)),
			"drone_kamikaze": dict(parent="units/mla/drone_kamikaze", actor="vehicle/mla/drone_kamikaze.xml",
				name="Scrap Drone", icon="units/drone.png", tooltip="Improvised kamikaze drone.",
				extra=cost(water=40, energy=40, time=12)),
		},
		# Mercado Negro: tropas de outras facções, mais caras e com a cor original.
		"black_market": {
			"bm_lmg": ("units/mcc/battalion_infantry_lmg", "Black Market: MCC Machine-Gun Squad", 1.5),
			"bm_laser_tank": ("units/mcc/vehicle_special", "Black Market: Laser Vehicle", 1.5),
			"bm_vtol": ("units/mcc/aero_01", "Black Market: Stolen VTOL", 1.6),
		},
		"battalions": {
			"battalion_raiders": ("skirmisher", "raider", 4, "Raider Band", "units/squad_assalt.png",
				cost(food=90, water=70, time=18)),
		},
		"start": ["battalion_raiders"],
	},
	"coa": {
		"base": "mcc",
		"name": "Earth Coalition",
		"history": "After years of controversy around the MCC, Earth's great powers voted for an international intervention. Forces from the United States, China, India, Brazil, Russia, the European Union, Nigeria and others arrived to \"stabilise\" Mars - but who gave Earth the right to decide the planet's future? \"Mars must be stabilised.\"",
		"structures": {
			"civil_centre": ("Coalition Command", ["worker", "battalion_rifle", "officer"]),
			"house": ("Habitat Module", []),
			"barracks": ("Garrison", ["battalion_rifle", "battalion_rangers", "officer"]),
			"stable": ("Motor Pool", ["vehicle_ifv", "vehicle_mbt", "vehicle_titan_packed"]),
			"aero": ("Airbase", ["aero_01", "aero_02", "drone_recon"]),
			"storehouse": ("Logistics Depot", []), "farmstead": ("Supply Dome", []), "field": ("Supply Field", []),
			"forge": ("Research Centre", []), "sentry_tower": ("Watch Post", []), "silos": ("Missile Silo", []),
			"air_defense_tower": ("Air Defence", []),
		},
		"structure_auras": {"civil_centre": ["factions/coa_hq"]},
		"units": {
			"worker": dict(kind="worker", parent="units/mcc/worker", actor="units/mcc/worker.xml",
				name="Engineer", cost=cost(food=50, time=10)),
			"soldier": dict(parent="units/mcc/rifleman", actor="units/mcc/rifle_assalt.xml",
				name="Coalition Rifleman", icon="units/squad_rifle.png",
				tooltip="Well equipped soldier. Loses accuracy without a nearby officer or command."),
			"ranger": dict(parent="units/mcc/light_rifleman", actor="units/mcc/rifle_assalt_pmc_b.xml",
				name="Ranger", specific="Special Forces", icon="units/squad_stealth.png",
				tooltip="Special forces scout: long sight to feed the information network.",
				extra=vision(110)),
			"officer": dict(parent="units/mcc/rifleman", actor="units/mcc/rifle_assalt_champion.xml",
				name="Officer", specific="Field Officer", icon="units/battalion_leader.png",
				tooltip="Chain of command: units around the officer keep their accuracy, fire faster and see further.",
				extra=auras(["factions/coa_command"]) + cost(food=100, water=100, energy=50, time=30)),
			"vehicle_ifv": dict(parent="units/mcc/vehicle_special", actor="vehicle/mcc/cavelion.xml",
				name="Coalition IFV", icon="units/armored.png", tooltip="Infantry fighting vehicle.",
				extra=cost(water=220, materials=180, energy=120, time=40)),
			"vehicle_mbt": dict(parent="units/mcc/vehicle_heavy", actor="vehicle/mcc/mammoth.xml",
				name="Coalition MBT", icon="units/armored.png", tooltip="Main battle tank.",
				extra=cost(water=300, materials=260, energy=150, time=55)),
			"aero_01": dict(parent="units/mcc/aero_01", actor="structures/mcc/aero_01.xml",
				name="Coalition Gunship", icon="units/vtol.png", tooltip="Attack VTOL.",
				extra=cost(water=200, materials=150, energy=200, time=45)),
			"aero_02": dict(parent="units/mcc/aero_02", actor="structures/mcc/aero_02.xml",
				name="Coalition Strike VTOL", icon="units/vtol.png", tooltip="Strike VTOL.",
				extra=cost(water=200, materials=150, energy=200, time=45)),
			"drone_recon": dict(parent="units/mla/drone_kamikaze", actor="vehicle/mla/drone_kamikaze.xml",
				name="Recon Drone", icon="units/drone.png",
				tooltip="Drone with a wide sensor range for the information network.",
				extra=vision(130) + cost(water=60, energy=80, time=15)),
		},
		"battalions": {
			"battalion_rifle": ("assault", "soldier", 4, "Coalition Rifle Squad", "units/squad_rifle.png",
				cost(food=110, water=110, energy=30, time=32)),
			"battalion_rangers": ("skirmisher", "ranger", 3, "Ranger Team", "units/squad_stealth.png",
				cost(food=100, water=120, energy=60, time=34)),
		},
		"start": ["battalion_rifle", "officer"],
	},
	"swarm": {
		"base": "mla",
		"name": "The Swarm",
		"history": "A cult that claims telepathic contact with ancient alien sovereigns, masters of genetic manipulation who left the material world. Its followers rebuild their bodies with genetics, biotechnology and neural symbiosis; the masses lose their individuality and act as a partial hive mind, guided by Conductors, Hierophants and Prophets. \"We did not find them. We were found.\"",
		"structures": {
			"civil_centre": ("Hive", ["worker", "battalion_mass", "conductor"]),
			"house": ("Nest", []),
			"barracks": ("Spawning Chamber", ["battalion_mass", "servant", "abomination", "conductor", "hierophant", "prophet"]),
			"stable": ("Incubator", ["scout", "stalker", "spitter", "brute", "synapse", "oracle", "behemoth"]),
			"storehouse": ("Digestion Pit", []), "farmstead": ("Biomass Vat", []), "field": ("Biomass Bed", []),
			"forge": ("Gene Temple", []), "sentry_tower": ("Spine Tower", []),
		},
		"units": {
			"worker": dict(kind="worker", parent="units/mla/worker", actor="units/mla/worker.xml",
				name="Drone Thrall", cost=cost(food=40, time=8), classes="SwarmMass"),
			"thrall": dict(parent="units/mla/rifleman", actor="units/mla/rifle_assalt.xml",
				name="Thrall", specific="Mass", icon="units/squad_rifle.png", classes="SwarmMass",
				tooltip="Part of the Mass: weak alone, strong near Conductors, Hierophants and the Prophet."),
			"servant": dict(parent="units/mla/grenadier", actor="units/mla/grenadier.xml",
				name="Servant", specific="Acid Thrower", icon="units/squad_anti-armor.png", classes="SwarmMass",
				tooltip="Specialised servant that throws acid bombs."),
			"abomination": dict(parent="units/mcc/heavy_rifleman", actor="units/mcc/heavy_rifle_assault.xml",
				name="Abomination", icon="units/squad_machine_gun.png", classes="Creature",
				tooltip="A human turned into a biological weapon.",
				extra=health(420) + cost(food=120, water=80, time=26)),
			"conductor": dict(parent="units/mla/snipe_sup", actor="units/mla/rifle_assalt_champion.xml",
				name="Conductor", specific="Command Node", icon="units/battalion_leader.png",
				tooltip="Cohesion: the Mass and creatures around it fight in coordination. Kill it to fragment the hive mind.",
				extra=auras(["factions/swarm_conductor"]) + cost(food=120, water=80, time=24)),
			"hierophant": dict(parent="units/mla/snipe_sup", actor="units/mcc/rifle_assalt_champion_hell_angels.xml",
				name="Hierophant", icon="units/battalion_leader.png",
				tooltip="An intelligent, individual leader with a stronger and wider Cohesion aura.",
				extra=auras(["factions/swarm_hierophant"]) + health(380) + cost(food=200, water=150, energy=80, time=40)),
			"prophet": dict(parent="units/mla/commander", actor="units/mcc/rifle_assalt_champion_hell_angels.xml",
				name="Prophet", specific="Voice of the Sovereigns", icon="units/battalion_leader.png",
				tooltip="Supreme leader of the cult (hero). Huge Cohesion aura.",
				extra=auras(["factions/swarm_prophet"]) + health(700)),
		},
		# Criaturas: modelos de animais do jogo base, retintos.
		"creatures": {
			"scout": dict(actor="fauna/fox_red.xml", name="Scout", tooltip="Dog-sized scouting creature.",
				hp=90, walk=15, dmg=5, rep=1000, vision=100, cost=cost(food=40, time=8, pop=1)),
			"stalker": dict(actor="fauna/tiger.xml", name="Stalker", tooltip="Predator bred for the hunt.",
				hp=220, walk=12, dmg=16, rep=1000, cost=cost(food=90, water=30, time=16, pop=1)),
			"brute": dict(actor="fauna/bear_brown.xml", name="Brute", tooltip="Heavy combat creature.",
				hp=480, walk=8.5, dmg=26, rep=1500, crush=8, cost=cost(food=150, water=60, time=24, pop=2)),
			"synapse": dict(actor="fauna/rhino.xml", name="Synapse",
				tooltip="Neural node that coordinates the creatures around it.",
				hp=400, walk=8, dmg=12, rep=1500, auras=["factions/swarm_synapse"],
				cost=cost(food=160, water=100, energy=60, time=30, pop=2)),
			"oracle": dict(actor="fauna/arctic_wolf.xml", name="Oracle", tooltip="Sensory creature with an enormous field of view.",
				hp=120, walk=13, dmg=4, rep=1200, vision=150, cost=cost(food=60, water=40, time=12, pop=1)),
			"spitter": dict(actor="fauna/crocodile.xml", name="Spitter", tooltip="Creature that spits acid from a distance.",
				hp=200, walk=7.5, ranged=dict(dmg=14, range=35, rep=2500, splash=6),
				cost=cost(food=100, water=60, time=18, pop=1)),
			"behemoth": dict(actor="fauna/elephant_african_bush.xml", name="Acid Behemoth",
				tooltip="Tank-sized monster that spits great amounts of acid.",
				hp=1400, walk=6, ranged=dict(dmg=40, range=45, rep=4000, splash=14), big=True,
				cost=cost(food=300, water=200, energy=100, time=50, pop=5)),
		},
		"battalions": {
			"battalion_mass": ("assault", "thrall", 5, "Mass Swarm", "units/squad_rifle.png",
				cost(food=80, water=40, time=20)),
		},
		"start": ["battalion_mass", "conductor"],
	},
}


def make_worker(civ, faction):
	structures = sorted(faction["structures"])
	return "  <Builder>\n    <Entities datatype=\"tokens\" replace=\"\">\n" + \
		"".join("      structures/{civ}/" + s + "\n" for s in structures if s not in ("field", "house")) + \
		"      structures/{civ}/field\n    </Entities>\n  </Builder>\n"


def generate(civ, faction):
	print("== " + civ)
	base = faction["base"]
	unit_names = set(faction["units"]) | set(faction.get("battalions", {})) | \
		set(faction.get("creatures", {})) | set(faction.get("black_market", {}))

	# Estruturas
	for structure, (name, trains) in faction["structures"].items():
		for t in trains:
			assert t in unit_names, civ + ": " + t
		body = identity(civ, name)
		body += actor(tinted_actor(STRUCTURE_ACTORS[base][structure], civ))
		body += trainer(["units/{civ}/" + t for t in trains])
		if structure == "barracks" and base == "mla":
			# Túnel de reforço (do mla) com os batalhões da facção.
			bats = [b for b in faction.get("battalions", {})]
			body += "  <AirSupportProvider>\n    <tunnel>\n      <Battalion datatype=\"tokens\" replace=\"\">" + \
				" ".join("units/" + civ + "/" + b for b in bats) + "</Battalion>\n    </tunnel>\n  </AirSupportProvider>\n"
		if structure == "barracks" and base == "mcc":
			bats = [b for b in faction.get("battalions", {})]
			body += "  <AirSupportProvider>\n    <drop_pod>\n      <Battalion datatype=\"tokens\" replace=\"\">" + \
				" ".join("units/" + civ + "/" + b for b in bats) + "</Battalion>\n    </drop_pod>\n  </AirSupportProvider>\n"
		body += faction.get("structure_extra", {}).get(structure, "")
		if structure in faction.get("structure_auras", {}):
			body += auras(faction["structure_auras"][structure])
		write("simulation/templates/structures/" + civ + "/" + structure + ".xml",
			entity("structures/" + base + "/" + structure, body))

	# Zona de desdobramento (modo batalha)
	write("simulation/templates/structures/" + civ + "/battle_deploy_point.xml",
		entity("template_battle_deploy_point",
			"  <Identity>\n    <Civ>" + civ + "</Civ>\n  </Identity>\n" +
			actor("structures/battle/deploy_point_" + civ + ".xml")))

	# Unidades
	for unit, u in faction["units"].items():
		body = identity(civ, u["name"], u.get("specific"), u.get("icon"), u.get("tooltip"), u.get("classes"))
		body += actor(tinted_actor(u["actor"], civ))
		if u.get("kind") == "worker":
			body = identity(civ, u["name"], None, "units/worker.png", None, u.get("classes"))
			body += actor(tinted_actor(u["actor"], civ))
			body += make_worker(civ, faction) + u["cost"]
		body += u.get("extra", "")
		write("simulation/templates/units/" + civ + "/" + unit + ".xml", entity(u["parent"], body))

	# Criaturas (Enxame)
	for unit, c in faction.get("creatures", {}).items():
		classes = "Creature Organic"
		if "ranged" in c:
			parent = "units/mla/grenadier"
			r = c["ranged"]
			attack = ("  <Attack>\n    <Ranged>\n      <AttackName>Acid</AttackName>\n      <Damage>\n"
				"        <Fire>" + str(r["dmg"]) + "</Fire>\n        <Crush>" + str(r["dmg"] // 2) + "</Crush>\n"
				"      </Damage>\n      <MaxRange>" + str(r["range"]) + "</MaxRange>\n"
				"      <RepeatTime>" + str(r["rep"]) + "</RepeatTime>\n      <Splash>\n        <Damage>\n"
				"          <Fire>" + str(r["dmg"] // 2) + "</Fire>\n        </Damage>\n"
				"        <Range>" + str(r["splash"]) + "</Range>\n      </Splash>\n    </Ranged>\n"
				"    <RangedSecondary disable=\"\"/>\n  </Attack>\n  <Ammo disable=\"\"/>\n")
		else:
			parent = "template_unit_champion_infantry_swordsman"
			attack = ("  <Attack>\n    <Melee>\n      <AttackName>Claws</AttackName>\n      <Damage>\n"
				"        <Hack>" + str(c["dmg"]) + "</Hack>\n        <Pierce>0</Pierce>\n"
				"        <Crush>" + str(c.get("crush", 0)) + "</Crush>\n      </Damage>\n"
				"      <MaxRange>4</MaxRange>\n      <RepeatTime>" + str(c["rep"]) + "</RepeatTime>\n"
				"    </Melee>\n  </Attack>\n")
		body = identity(civ, c["name"], None, "units/swarm_drone_kamikaze.png", c["tooltip"], classes, "Creature")
		body += actor(tinted_actor(c["actor"], civ)) + attack + health(c["hp"]) + speed(c["walk"]) + c["cost"]
		if "vision" in c:
			body += vision(c["vision"])
		if c.get("auras"):
			body += auras(c["auras"])
		if c.get("big"):
			body += "  <Footprint>\n    <Circle radius=\"4.0\"/>\n    <Height>6.0</Height>\n  </Footprint>\n"
		write("simulation/templates/units/" + civ + "/" + unit + ".xml", entity(parent, body))

	# Mercado Negro (Piratas)
	for unit, (parent, name, factor) in faction.get("black_market", {}).items():
		body = identity(civ, name, None, None, "Bought on the black market: an outside faction's unit at a higher price.")
		body += "  <Cost>\n    <BuildTime>40</BuildTime>\n    <Resources>\n      <food>" + str(int(120 * factor)) + \
			"</food>\n      <metal>" + str(int(150 * factor)) + "</metal>\n      <wood>" + str(int(80 * factor)) + \
			"</wood>\n    </Resources>\n  </Cost>\n"
		write("simulation/templates/units/" + civ + "/" + unit + ".xml", entity(parent, body))

	# Batalhões: líder + membros
	for bat, (profile, soldier, count, name, icon, bat_cost) in faction.get("battalions", {}).items():
		member = "battalion_member_" + soldier
		write("simulation/templates/units/" + civ + "/" + member + ".xml",
			entity("battalion_member|units/" + civ + "/" + soldier,
				"  <Identity>\n    <GenericName>" + name + " Member</GenericName>\n"
				"    <SelectionGroupName>units/" + civ + "/" + bat + "</SelectionGroupName>\n"
				"    <Icon>" + icon + "</Icon>\n  </Identity>\n"))
		body = ("  <BattalionLeader>\n    <MemberTemplates>units/" + civ + "/" + member + ":" + str(count) +
			"</MemberTemplates>\n    <MemberRoles>units/" + civ + "/" + member + ":" + str(count) +
			":front</MemberRoles>\n  </BattalionLeader>\n")
		body += '  <Trainer>\n    <Entities datatype="tokens" replace="">units/' + civ + "/" + member + "</Entities>\n  </Trainer>\n"
		body += "  <Identity>\n    <GenericName>" + name + "</GenericName>\n    <SelectionGroupName/>\n    <Icon>" + icon + "</Icon>\n  </Identity>\n"
		body += bat_cost
		write("simulation/templates/units/" + civ + "/" + bat + ".xml",
			entity("battalion_profile_" + profile + "|units/" + civ + "/" + soldier, body))

	# Catafalco (exigido por algumas telas do jogo)
	write("simulation/templates/units/" + civ + "/catafalque.xml",
		entity("units/" + base + "/catafalque", "  <Identity>\n    <Civ>" + civ + "</Civ>\n  </Identity>\n"))

	# Jogador e civilização
	write("simulation/templates/special/players/" + civ + ".xml",
		'<?xml version="1.0" encoding="utf-8"?>\n<Entity parent="template_player_mars">\n  <Identity>\n'
		"    <Civ>" + civ + "</Civ>\n    <GenericName>" + faction["name"] + "</GenericName>\n"
		"    <History>" + faction["history"].replace("&", "&amp;").replace("<", "&lt;") + "</History>\n"
		"    <Icon>emblems/emblem_" + civ + ".png</Icon>\n  </Identity>\n</Entity>\n")
	base_civ = json.loads(open(os.path.join(MOD, "simulation/data/civs/" + base + ".json"), encoding="utf-8-sig").read())
	start = [{"Template": "structures/" + civ + "/civil_centre"}, {"Template": "units/" + civ + "/worker", "Count": 3}]
	start += [{"Template": "units/" + civ + "/" + s, "Count": 2 if s.startswith("battalion") else 1} for s in faction["start"]]
	civ_json = {
		"Code": civ,
		"Culture": "Mars",
		"Music": base_civ.get("Music", []),
		"CivBonuses": [],
		"TeamBonuses": [],
		"WallSets": base_civ.get("WallSets", []),
		"StartEntities": start,
		"AINames": [faction["name"] + " I", faction["name"] + " II", faction["name"] + " III"],
		"SkirmishReplacements": {
			"skirmish/units/default_support_civilian": "units/" + civ + "/worker",
			"skirmish/units/default_infantry_ranged_b": "units/" + civ + "/" + faction["start"][0]
		},
		"SelectableInGameSetup": True
	}
	write("simulation/data/civs/" + civ + ".json", json.dumps(civ_json, indent="\t", ensure_ascii=False) + "\n")


def make_deploy_art(civ):
	"""Bandeira e círculo da zona de desdobramento com o emblema da facção."""
	from PIL import ImageDraw
	import math
	stops, _ = TINTS[civ]
	accent = stops[2]
	emblem = Image.open(os.path.join(MOD, "art/textures/ui/session/portraits/emblems/emblem_" + civ + ".png")).convert("RGBA")
	S = 1024
	C = S / 2
	im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
	d = ImageDraw.Draw(im)
	d.ellipse([C - 470, C - 470, C + 470, C + 470], fill=(38, 34, 32, 150))
	d.ellipse([C - 470, C - 470, C + 470, C + 470], outline=(70, 62, 56, 235), width=46)
	for i in range(0, 48, 2):
		d.arc([C - 470, C - 470, C + 470, C + 470], i * 7.5, i * 7.5 + 7.5, fill=accent + (235,), width=18)
	d.ellipse([C - 395, C - 395, C + 395, C + 395], outline=accent + (210,), width=6)
	for k in range(4):
		a = math.radians(k * 90)
		d.line([C + math.cos(a) * 300, C + math.sin(a) * 300, C + math.cos(a) * 390, C + math.sin(a) * 390],
			fill=(235, 235, 225, 200), width=10)
	im.alpha_composite(emblem.resize((520, 520), Image.LANCZOS), (int(C - 260), int(C - 260)))
	arr = np.asarray(im).astype(float)
	yy, xx = np.mgrid[0:S, 0:S]
	arr[..., 3] *= np.clip((500 - np.sqrt((xx - C) ** 2 + (yy - C) ** 2)) / 30, 0, 1)
	save_image("art/textures/skins/props/deploy_zone_" + civ + ".png",
		Image.fromarray(arr.clip(0, 255).astype("uint8"), "RGBA"))
	# Bandeira: o estandarte do mla retinto.
	banner = tint_image(open(os.path.join(MOD, "art/textures/skins/props/banner_mla.png"), "rb").read(), civ)
	save_image("art/textures/skins/props/banner_" + civ + ".png", banner)

	write("art/actors/props/structures/decals/deploy_zone_" + civ + ".xml",
		'<?xml version="1.0" encoding="utf-8"?>\n<actor version="1">\n  <group>\n    <variant>\n'
		'      <decal angle="0" depth="26" offsetx="0" offsetz="0" width="26"/>\n      <textures>\n'
		'        <texture file="props/deploy_zone_' + civ + '.png" name="baseTex"/>\n'
		'        <texture file="props/deploy_zone_norm.png" name="normTex"/>\n'
		'        <texture file="null_black.dds" name="specTex"/>\n      </textures>\n    </variant>\n'
		'  </group>\n  <material>terrain_norm_spec.xml</material>\n</actor>\n')
	write("art/actors/structures/battle/deploy_point_" + civ + ".xml",
		'<?xml version="1.0" encoding="utf-8"?>\n<actor version="1">\n  <castshadow/>\n  <group>\n'
		'    <variant file="others/waypoints/base.xml" frequency="1" name="Base">\n      <props>\n'
		'        <prop actor="props/structures/decals/deploy_zone_' + civ + '.xml" attachpoint="root"/>\n'
		'      </props>\n      <textures>\n        <texture file="props/banner_' + civ + '.png" name="baseTex"/>\n'
		'      </textures>\n    </variant>\n  </group>\n  <material>basic_trans_norm_spec.xml</material>\n</actor>\n')
	# Círculo de fundo da facção na interface da partida (como mcc e mla).
	bkg = os.path.join(MOD, "art/textures/ui/session/icons/bkg/")
	src = np.asarray(Image.open(bkg + "background_circle_mla.png").convert("RGBA")).astype(float)
	lum = (0.299 * src[..., 0] + 0.587 * src[..., 1] + 0.114 * src[..., 2]) / 255
	out = src.copy()
	for i in range(3):
		out[..., i] = np.clip(lum * stops[2][i] * 1.6, 0, 255)
	save_image("art/textures/ui/session/icons/bkg/background_circle_" + civ + ".png",
		Image.fromarray(out.astype("uint8"), "RGBA"))


def update_battle_catalog():
	"""Coloca as facções novas no catálogo do modo batalha."""
	path = os.path.join(MOD, "simulation/data/battle_mode/army_catalog.json")
	catalog = json.load(open(path, encoding="utf-8"))
	entries = {
		"ares": [("battalion_legion", "infantry", 120), ("battalion_shock", "infantry", 110), ("exo_trooper", "infantry", 90),
			("vehicle_assault", "armor", 170), ("vehicle_tank", "armor", 230)],
		"pira": [("battalion_raiders", "infantry", 80), ("scout", "infantry", 50), ("vehicle_buggy", "armor", 100),
			("vehicle_technical", "armor", 140), ("drone_kamikaze", "air", 50), ("bm_laser_tank", "armor", 300)],
		"coa": [("battalion_rifle", "infantry", 130), ("battalion_rangers", "infantry", 150), ("officer", "infantry", 90),
			("vehicle_ifv", "armor", 260), ("vehicle_mbt", "armor", 280), ("aero_01", "air", 190), ("drone_recon", "air", 70)],
		"swarm": [("battalion_mass", "infantry", 60), ("conductor", "infantry", 70), ("stalker", "infantry", 60),
			("brute", "infantry", 110), ("spitter", "infantry", 80), ("synapse", "infantry", 120), ("behemoth", "armor", 280)],
	}
	# Só acrescenta o que falta: custos e limites ajustados à mão são mantidos.
	changed = False
	for civ, units in entries.items():
		current = catalog["Civs"].setdefault(civ, [])
		have = {entry["Template"] for entry in current}
		for u, cat, c in units:
			template = "units/" + civ + "/" + u
			if FORCE or template not in have:
				current[:] = [entry for entry in current if entry["Template"] != template]
				current.append({"Template": template, "Category": cat, "Cost": c, "Max": 10})
				changed = True
	if changed:
		open(path, "w", encoding="utf-8").write(json.dumps(catalog, indent="\t", ensure_ascii=False) + "\n")


if __name__ == "__main__":
	for civ, faction in FACTIONS.items():
		generate(civ, faction)
		make_deploy_art(civ)
	update_battle_catalog()
	finish()
	print("pronto")

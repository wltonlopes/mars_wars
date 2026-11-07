function Sound() {}

Sound.prototype.Schema =
	"<a:help>Lists the sound groups associated with this unit.</a:help>" +
	"<a:example>" +
		"<SoundGroups>" +
			"<walk>actor/human/movement/walk.xml</walk>" +
			"<run>actor/human/movement/walk.xml</run>" +
			"<attack_melee>attack/weapon/sword.xml</attack_melee>" +
			"<death>actor/human/death/death.xml</death>" +
		"</SoundGroups>" +
	"</a:example>" +
	"<element name='SoundGroups'>" +
		"<zeroOrMore>" + /* TODO: make this more specific, like a list of specific elements */
			"<element>" +
				"<anyName/>" +
				"<text/>" +
			"</element>" +
		"</zeroOrMore>" +
	"</element>";

Sound.prototype.Init = function()
{
};

Sound.prototype.Serialize = null; // we have no dynamic state to save

/**
 * Mars Wars: devolve o caminho já com {lang} e {phenotype} substituídos
 * ({lang}: ver GetLang abaixo).
 * O motor (e partes do código) toca o resultado direto; sem a troca, ele
 * procurava arquivos como "actor/human/death/{phenotype}_death.xml".
 */
Sound.prototype.GetSoundGroup = function(name)
{
	const soundGroup = this.template.SoundGroups[name];
	if (!soundGroup)
		return "";

	const cmpIdentity = Engine.QueryInterface(this.entity, IID_Identity);
	if (!cmpIdentity)
		return soundGroup.indexOf("{") == -1 ? soundGroup : "";

	return soundGroup.replace(/\{lang\}/g, this.GetLang(cmpIdentity))
		.replace(/\{phenotype\}/g, cmpIdentity.GetPhenotype())
		.replace(/\{crew\}/g, this.GetCrew(cmpIdentity));
};

/**
 * Modern Wars: idioma de quem não tem Identity/Lang próprio (veículos,
 * aeronaves, navios): o da tripulação da civ, o mesmo da infantaria dela.
 */
Sound.prototype.CIV_LANGS = {
	"rfs": "portuguese portuguese spanish",
	"rpo": "chinese",
	"pmc": "english",
	"rup": "persian",
	"fes": "russian"
};

/**
 * Modern Wars: {crew} escolhe as falas da tripulação, com o som do veículo ao
 * fundo (audio/voice/<idioma>/vehicle/<crew>_*.xml, de
 * tools/voices/gen_vehicle_voices.py): heli, jet (aviões e drones), ship ou land.
 */
Sound.prototype.GetCrew = function(cmpIdentity)
{
	const classes = cmpIdentity.GetClassesList();
	if (classes.indexOf("Helicopter") != -1)
		return "heli";
	if (classes.indexOf("Aircraft") != -1)
		return "jet";
	if (classes.indexOf("Ship") != -1)
		return "ship";
	return "land";
};

/**
 * Modern Wars: Identity/Lang pode listar vários idiomas separados por espaço
 * (ex.: "portuguese portuguese spanish"). Cada entidade fala sempre o mesmo,
 * escolhido pelo seu número; repetir um idioma na lista aumenta a parcela
 * dele (no exemplo, dois terços falam português e um terço espanhol).
 */
Sound.prototype.GetLang = function(cmpIdentity)
{
	const own = cmpIdentity.template.Lang || this.CIV_LANGS[cmpIdentity.GetCiv()] || cmpIdentity.GetLang();
	const langs = own.split(/\s+/).filter(lang => lang);
	return langs.length > 1 ? langs[this.entity % langs.length] : langs[0] || "";
};

Sound.prototype.PlaySoundGroup = function(name)
{
	const soundName = this.GetSoundGroup(name);
	if (!soundName)
		return;
	const cmpSoundManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager);
	if (cmpSoundManager)
		cmpSoundManager.PlaySoundGroup(soundName, this.entity);
};

/** Tempo mínimo entre dois avisos de "sob ataque" da mesma unidade, em ms. */
Sound.prototype.ATTACKED_INTERVAL = 12000;

/**
 * Grupo "attacked" (opcional): tocado quando a unidade é atingida, no máximo
 * uma vez a cada ATTACKED_INTERVAL.
 */
Sound.prototype.OnAttacked = function(msg)
{
	if (!this.template.SoundGroups.attacked)
		return;
	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	if (this.lastAttacked !== undefined && now - this.lastAttacked < this.ATTACKED_INTERVAL)
		return;
	this.lastAttacked = now;
	this.PlaySoundGroup("attacked");
};

Engine.RegisterComponentType(IID_Sound, "Sound", Sound);

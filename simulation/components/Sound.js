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
 * Mars Wars: devolve o caminho já com {lang} e {phenotype} substituídos.
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

	return soundGroup.replace(/\{lang\}/g, cmpIdentity.GetLang())
		.replace(/\{phenotype\}/g, cmpIdentity.GetPhenotype());
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

Engine.RegisterComponentType(IID_Sound, "Sound", Sound);

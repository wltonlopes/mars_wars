/**
 * Resistência das aeronaves de apoio aéreo (Modern Wars): quantos acertos a
 * aeronave aguenta e os despistadores (flares) contra mísseis.
 *
 * Quando um interceptador da defesa aérea ou um míssil de caça a atinge
 * (AirSupportManager.ResolveInterception):
 *  1. se ainda tem flares, solta uma salva e, com chance FlareChance, o míssil
 *     segue o flare e erra (cada salva gasta um flare, acerte ou não);
 *  2. senão, ou se o flare falhou, o acerto conta: com Hits > 1 ela continua,
 *     avariada (fumaça), e só cai no último.
 * Sem este componente a aeronave cai no primeiro acerto (drones, mísseis).
 */
function AirEvasion() {}

AirEvasion.prototype.Schema =
	"<a:help>Hits an air support aircraft takes before going down, and its anti-missile flares.</a:help>" +
	"<element name='Hits' a:help='Hits needed to shoot it down.'><data type='positiveInteger'/></element>" +
	"<optional>" +
		"<element name='Flares' a:help='Flare salvos carried.'><data type='nonNegativeInteger'/></element>" +
	"</optional>" +
	"<optional>" +
		"<element name='FlareChance' a:help='Chance (0-1) that a flare salvo decoys the missile.'><ref name='nonNegativeDecimal'/></element>" +
	"</optional>";

AirEvasion.prototype.FLARE_ACTOR = "props/units/weapons/flares.xml";
AirEvasion.prototype.DAMAGE_ACTOR = "particle/destruction_smoke_small.xml";

AirEvasion.prototype.Init = function()
{
	this.hitsLeft = +this.template.Hits;
	this.flaresLeft = +(this.template.Flares || 0);
};

/** @return {boolean} Se uma salva de flares despistou o míssil (gasta um flare). */
AirEvasion.prototype.TryFlares = function()
{
	if (this.flaresLeft <= 0)
		return false;
	--this.flaresLeft;
	return randFloat(0, 1) < +(this.template.FlareChance || 0);
};

AirEvasion.prototype.HasFlares = function()
{
	return this.flaresLeft > 0;
};

/** @return {boolean} Se a aeronave ainda voa depois do acerto. */
AirEvasion.prototype.TakeHit = function()
{
	--this.hitsLeft;
	return this.hitsLeft > 0;
};

AirEvasion.prototype.GetHitsLeft = function()
{
	return this.hitsLeft;
};

Engine.RegisterComponentType(IID_AirEvasion, "AirEvasion", AirEvasion);

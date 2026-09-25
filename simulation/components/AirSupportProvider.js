/**
 * Colocado em estruturas capazes de solicitar apoio aéreo
 * (inicialmente o centro cívico da civ mcc).
 *
 * Controla disponibilidade e cooldown; a missão em si é
 * executada pelo AirSupportManager.
 */
function AirSupportProvider() {}

AirSupportProvider.prototype.Schema =
	"<a:help>Allows this structure to call strategic air support on a map position.</a:help>" +
	"<a:example>" +
		"<Cooldown>180</Cooldown>" +
		"<BomberTemplate>special/strategic_bomber</BomberTemplate>" +
		"<BombCount>8</BombCount>" +
		"<BombingLength>60</BombingLength>" +
	"</a:example>" +
	"<element name='Cooldown' a:help='Seconds, counted from the moment the strike is requested.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='BomberTemplate' a:help='Template of the aircraft that performs the strike.'>" +
		"<text/>" +
	"</element>" +
	"<element name='BombCount'>" +
		"<data type='positiveInteger'/>" +
	"</element>" +
	"<element name='BombingLength' a:help='Length in metres of the carpet of bombs, centred on the target.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>";

AirSupportProvider.prototype.Init = function()
{
	this.cooldownEnd = 0;
	this.missionId = 0;
};

AirSupportProvider.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

/**
 * @return {number} Tempo restante de cooldown, em milissegundos.
 */
AirSupportProvider.prototype.GetCooldown = function()
{
	return Math.max(0, this.cooldownEnd - this.GetTime());
};

AirSupportProvider.prototype.GetCooldownTotal = function()
{
	return ApplyValueModificationsToEntity("AirSupportProvider/Cooldown", +this.template.Cooldown, this.entity) * 1000;
};

AirSupportProvider.prototype.IsAvailable = function()
{
	return !this.missionId && this.GetCooldown() <= 0;
};

/**
 * @param {string} type - Tipo de apoio (por enquanto apenas "strategic_bomber").
 * @param {Object} target - { x, z } em coordenadas do mundo.
 * @return {boolean} Se a missão foi iniciada.
 */
AirSupportProvider.prototype.RequestSupport = function(type, target)
{
	if (type != "strategic_bomber" || !this.IsAvailable())
		return false;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return false;

	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpOwnership || cmpOwnership.GetOwner() <= 0)
		return false;

	const origin = cmpPosition.GetPosition2D();
	const cmpManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager);
	const missionId = cmpManager.RequestMission(this.entity, cmpOwnership.GetOwner(), type, target, {
		"template": this.template.BomberTemplate,
		"origin": { "x": origin.x, "z": origin.y },
		"bombCount": +this.template.BombCount,
		"bombingLength": +this.template.BombingLength
	});

	if (!missionId)
		return false;

	this.missionId = missionId;
	this.cooldownEnd = this.GetTime() + this.GetCooldownTotal();
	return true;
};

AirSupportProvider.prototype.MissionFinished = function(missionId)
{
	if (missionId == this.missionId)
		this.missionId = 0;
};

AirSupportProvider.prototype.GetStatus = function()
{
	return {
		"available": this.IsAvailable(),
		"missionActive": !!this.missionId,
		"cooldown": this.GetCooldown(),
		"cooldownTotal": this.GetCooldownTotal()
	};
};

Engine.RegisterComponentType(IID_AirSupportProvider, "AirSupportProvider", AirSupportProvider);

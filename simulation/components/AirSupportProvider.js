/**
 * Poderes especiais de uma estrutura: apoio aéreo e reforços.
 * Cada poder é um elemento filho com o nome do tipo e tem recarga própria:
 *   strategic_bomber - centro cívico mcc (drone bombardeiro)
 *   nuke             - centros cívicos mcc e mla (míssil nuclear vindo de fora do mapa)
 *   orbital_laser    - laboratório mcc (laser orbital em fases)
 *   icbm             - silos mla
 *   drop_pod         - quartel mcc (cápsula orbital com batalhão)
 *   tunnel           - quartel mla (túnel com batalhão)
 *
 * A missão em si é executada pelo AirSupportManager.
 */
function AirSupportProvider() {}

AirSupportProvider.prototype.TYPES = ["strategic_bomber", "nuke", "orbital_laser", "icbm", "drop_pod", "tunnel"];

AirSupportProvider.prototype.Schema =
	"<a:help>Special powers of this structure (air strikes and reinforcements). One child element per power, named after its type.</a:help>" +
	"<a:example>" +
		"<strategic_bomber>" +
			"<Cooldown>180</Cooldown>" +
			"<Template>units/mcc/drone_v_01</Template>" +
			"<BombCount>8</BombCount>" +
			"<BombingLength>60</BombingLength>" +
		"</strategic_bomber>" +
		"<nuke>" +
			"<Cooldown>300</Cooldown>" +
			"<Template>special/nuclear_missile</Template>" +
		"</nuke>" +
	"</a:example>" +
	"<oneOrMore>" +
		"<element>" +
			"<choice>" +
				AirSupportProvider.prototype.TYPES.map(type => "<name>" + type + "</name>").join("") +
			"</choice>" +
			"<interleave>" +
				"<element name='Cooldown' a:help='Seconds, counted from the moment the power is used.'>" +
					"<ref name='nonNegativeDecimal'/>" +
				"</element>" +
				"<element name='Template' a:help='Template of the aircraft (StrategicBomber), missile (IcbmMissile), orbital laser (OrbitalStrike) or delivery (ReinforcementDelivery).'>" +
					"<text/>" +
				"</element>" +
				"<optional>" +
					"<element name='BombCount' a:help='strategic_bomber only.'>" +
						"<data type='positiveInteger'/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='BombingLength' a:help='strategic_bomber only: length in metres of the carpet of bombs, centred on the target.'>" +
						"<ref name='nonNegativeDecimal'/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='Battalion' a:help='drop_pod/tunnel: battalion leader templates the player can choose from (the first is the default). Costs population like a trained battalion.'>" +
						"<optional><attribute name='datatype'><value>tokens</value></attribute></optional>" +
						"<text/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='MinDistanceFromEnemyStructures' a:help='Metres. The target must be at least this far from any enemy structure.'>" +
						"<ref name='nonNegativeDecimal'/>" +
					"</element>" +
				"</optional>" +
			"</interleave>" +
		"</element>" +
	"</oneOrMore>";

AirSupportProvider.prototype.Init = function()
{
	// Por tipo: { cooldownEnd, missionId }.
	this.powers = {};
	for (const type of this.GetTypes())
		this.powers[type] = { "cooldownEnd": 0, "missionId": 0 };
};

AirSupportProvider.prototype.GetTypes = function()
{
	return this.TYPES.filter(type => this.template[type]);
};

AirSupportProvider.prototype.HasType = function(type)
{
	return !!this.powers[type];
};

AirSupportProvider.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

/**
 * @return {number} Tempo restante de cooldown, em milissegundos.
 */
AirSupportProvider.prototype.GetCooldown = function(type)
{
	return Math.max(0, this.powers[type].cooldownEnd - this.GetTime());
};

AirSupportProvider.prototype.GetCooldownTotal = function(type)
{
	return ApplyValueModificationsToEntity("AirSupportProvider/" + type + "/Cooldown", +this.template[type].Cooldown, this.entity) * 1000;
};

AirSupportProvider.prototype.IsAvailable = function(type)
{
	return this.HasType(type) && !this.powers[type].missionId && this.GetCooldown(type) <= 0;
};

/**
 * Batalhões que um poder de reforço pode entregar (o primeiro é o padrão).
 */
AirSupportProvider.prototype.GetBattalionOptions = function(type)
{
	const battalion = this.template[type].Battalion;
	if (!battalion)
		return [];
	return String(battalion._string !== undefined ? battalion._string : battalion).trim().split(/\s+/);
};

/**
 * Batalhão pedido, se estiver na lista do poder; senão, o padrão.
 */
AirSupportProvider.prototype.ResolveBattalion = function(type, requested)
{
	const options = this.GetBattalionOptions(type);
	return options.indexOf(requested) != -1 ? requested : options[0] || "";
};

/**
 * @param {string} type - Um dos poderes desta estrutura.
 * @param {Object} target - { x, z } em coordenadas do mundo.
 * @param {string} [battalion] - Batalhão escolhido (drop_pod/tunnel).
 * @return {boolean} Se a missão foi iniciada.
 */
AirSupportProvider.prototype.RequestSupport = function(type, target, battalion)
{
	if (!this.IsAvailable(type))
		return false;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return false;

	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpOwnership || cmpOwnership.GetOwner() <= 0)
		return false;

	const owner = cmpOwnership.GetOwner();
	battalion = this.ResolveBattalion(type, battalion);
	const failure = this.CheckTarget(type, owner, target, battalion);
	if (failure)
	{
		this.NotifyFailure(owner, failure);
		return false;
	}

	const power = this.template[type];
	const origin = cmpPosition.GetPosition2D();
	const cmpManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager);
	const missionId = cmpManager.RequestMission(this.entity, owner, type, target, {
		"template": power.Template,
		"origin": { "x": origin.x, "z": origin.y },
		"bombCount": +(power.BombCount || 1),
		"bombingLength": +(power.BombingLength || 0),
		"battalion": battalion
	});

	if (!missionId)
		return false;

	this.powers[type].missionId = missionId;
	this.powers[type].cooldownEnd = this.GetTime() + this.GetCooldownTotal(type);
	return true;
};

/**
 * @return {string} Motivo pelo qual o alvo não pode ser usado, ou "" se pode.
 */
AirSupportProvider.prototype.CheckTarget = function(type, owner, target, battalion)
{
	if (!AirSupport.IsInsideMap(target, 4))
		return markForTranslation("The target is outside the map.");

	const power = this.template[type];
	if (!battalion)
		return "";

	if (!AirSupport.IsOnLand(target))
		return markForTranslation("Reinforcements can only be deployed on land.");

	const minDistance = +(power.MinDistanceFromEnemyStructures || 0);
	if (minDistance && this.GetEnemyStructuresNear(owner, target, minDistance).length)
		return markForTranslation("Too close to enemy buildings.");

	const cmpPlayer = QueryPlayerIDInterface(owner);
	if (cmpPlayer && cmpPlayer.GetPopulationCount() + AirSupport.GetBattalionPopCost(battalion) > cmpPlayer.GetPopulationLimit())
		return markForTranslation("Not enough population room for the battalion.");

	return "";
};

AirSupportProvider.prototype.GetEnemyStructuresNear = function(owner, target, range)
{
	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	const enemies = cmpDiplomacy ? cmpDiplomacy.GetEnemies().filter(player => player > 0) : [];
	if (!enemies.length)
		return [];

	return Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQueryAroundPos(
		new Vector2D(target.x, target.z), 0, range, enemies, IID_Identity, true
	).filter(ent => Engine.QueryInterface(ent, IID_Identity).HasClass("Structure"));
};

AirSupportProvider.prototype.GetPopCost = function(type)
{
	const battalion = this.ResolveBattalion(type);
	return battalion ? AirSupport.GetBattalionPopCost(battalion) : 0;
};

/**
 * Opções de batalhão para a GUI: template, nome, ícone e população.
 */
AirSupportProvider.prototype.GetBattalionChoices = function(type)
{
	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	return this.GetBattalionOptions(type).map(template => {
		const identity = (cmpTemplateManager.GetTemplate(template) || {}).Identity || {};
		return {
			"template": template,
			"name": identity.GenericName || template,
			"icon": identity.Icon || "",
			"popCost": AirSupport.GetBattalionPopCost(template)
		};
	});
};

AirSupportProvider.prototype.NotifyFailure = function(owner, message)
{
	Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).AddTimeNotification({
		"players": [owner],
		"message": message,
		"translateMessage": true
	}, 4000);
};

AirSupportProvider.prototype.MissionFinished = function(missionId)
{
	for (const type in this.powers)
		if (this.powers[type].missionId == missionId)
			this.powers[type].missionId = 0;
};

/**
 * @return {Object[]} Um status por poder, para a GUI.
 */
AirSupportProvider.prototype.GetStatus = function()
{
	return this.GetTypes().map(type => ({
		"type": type,
		"available": this.IsAvailable(type),
		"missionActive": !!this.powers[type].missionId,
		"cooldown": this.GetCooldown(type),
		"cooldownTotal": this.GetCooldownTotal(type),
		"popCost": this.GetPopCost(type),
		"battalions": this.GetBattalionChoices(type),
		"minDistanceFromEnemyStructures": +(this.template[type].MinDistanceFromEnemyStructures || 0)
	}));
};

Engine.RegisterComponentType(IID_AirSupportProvider, "AirSupportProvider", AirSupportProvider);

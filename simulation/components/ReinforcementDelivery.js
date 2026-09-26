/**
 * Entrega de um batalhão em qualquer ponto do mapa, criada pelo
 * AirSupportManager.
 *
 * Orbital: a cápsula cai do céu, freia perto do solo, causa dano em volta
 * do ponto de queda e libera o batalhão.
 * Tunnel: a saída do túnel é escavada no ponto (poeira visível para quem
 * tiver visão) e, após DeployTime, o batalhão sai por ela.
 *
 * Nos dois casos a cápsula/túnel continua no mapa por LingerTime segundos
 * e depois é removida, liberando o prédio para o cooldown.
 */
function ReinforcementDelivery() {}

ReinforcementDelivery.prototype.Schema =
	"<a:help>Delivers a battalion anywhere on the map, by orbital drop pod or by tunnel.</a:help>" +
	"<element name='Mode'>" +
		"<choice>" +
			"<value>orbital</value>" +
			"<value>tunnel</value>" +
		"</choice>" +
	"</element>" +
	"<element name='DeployTime' a:help='Seconds between arrival (landing / start of digging) and the battalion coming out.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='LingerTime' a:help='Seconds the pod / tunnel exit stays after unloading.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='ExitDistance' a:help='Metres from the centre where the battalion appears.'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Descent' a:help='orbital only.'>" +
			"<interleave>" +
				"<element name='StartHeight'><ref name='positiveDecimal'/></element>" +
				"<element name='FallSpeed' a:help='Metres per second.'><ref name='positiveDecimal'/></element>" +
				"<element name='BrakeHeight' a:help='Retro-rockets fire below this height.'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='BrakeSpeed'><ref name='positiveDecimal'/></element>" +
			"</interleave>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Impact' a:help='Damage around the landing / exit point.'>" +
			"<interleave>" +
				"<element name='Damage'>" +
					"<oneOrMore>" +
						"<element>" +
							"<anyName/>" +
							"<ref name='nonNegativeDecimal'/>" +
						"</element>" +
					"</oneOrMore>" +
				"</element>" +
				"<element name='Radius'><ref name='positiveDecimal'/></element>" +
				"<element name='FriendlyFire'><data type='boolean'/></element>" +
				"<optional>" +
					"<element name='ImpactActorName'><text/></element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactAnimationLifetime'><ref name='nonNegativeDecimal'/></element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactSound'><text/></element>" +
				"</optional>" +
			"</interleave>" +
		"</element>" +
	"</optional>";

ReinforcementDelivery.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.target = null;
	this.battalion = "";
	// "descending" -> "deploying" -> "lingering"
	this.state = "";
	this.height = 0;
	this.timer = 0;
};

ReinforcementDelivery.prototype.StartMission = function(missionId, provider, target, battalion)
{
	this.missionId = missionId;
	this.provider = provider;
	this.target = target;
	this.battalion = battalion;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	cmpPosition.JumpTo(target.x, target.z);

	if (this.template.Mode == "orbital")
	{
		this.state = "descending";
		this.height = +this.template.Descent.StartHeight;
		cmpPosition.SetHeightOffset(this.height);
	}
	else
		this.Arrive();
};

ReinforcementDelivery.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	if (this.state == "descending")
	{
		const descent = this.template.Descent;
		const speed = this.height > +descent.BrakeHeight ? +descent.FallSpeed : +descent.BrakeSpeed;
		this.height = Math.max(0, this.height - speed * msg.turnLength);
		Engine.QueryInterface(this.entity, IID_Position).SetHeightOffset(this.height);
		if (this.height <= 0)
			this.Arrive();
		return;
	}

	this.timer -= msg.turnLength;
	if (this.timer > 0)
		return;

	if (this.state == "deploying")
	{
		this.SpawnBattalion();
		this.state = "lingering";
		this.timer = +this.template.LingerTime;
	}
	else if (this.state == "lingering")
		this.FinishMission();
};

/**
 * Pouso da cápsula ou início da escavação do túnel.
 */
ReinforcementDelivery.prototype.Arrive = function()
{
	this.state = "deploying";
	this.timer = +this.template.DeployTime;

	const impact = this.template.Impact;
	if (!impact)
		return;

	const damage = {};
	for (const type in impact.Damage)
		damage[type] = +impact.Damage[type];

	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).BombImpact({
		"position": this.target,
		"attackData": { "Damage": damage },
		"attacker": this.provider,
		"attackerOwner": Engine.QueryInterface(this.entity, IID_Ownership).GetOwner(),
		"radius": +impact.Radius,
		"friendlyFire": impact.FriendlyFire == "true",
		"impactSound": impact.ImpactSound || "",
		"impactActor": impact.ImpactActorName || "",
		"impactActorLifetime": +(impact.ImpactAnimationLifetime || 0)
	});
};

ReinforcementDelivery.prototype.SpawnBattalion = function()
{
	const owner = Engine.QueryInterface(this.entity, IID_Ownership).GetOwner();
	if (!this.battalion || owner <= 0)
		return;

	const leader = Engine.AddEntity(this.battalion);
	const cmpPosition = leader != INVALID_ENTITY && Engine.QueryInterface(leader, IID_Position);
	if (!cmpPosition)
	{
		error("ReinforcementDelivery: could not create battalion '" + this.battalion + "'.");
		return;
	}

	// O batalhão sai do lado virado para o prédio que o chamou.
	let direction = { "x": 0, "z": -1 };
	const cmpProviderPosition = Engine.QueryInterface(this.provider, IID_Position);
	if (cmpProviderPosition && cmpProviderPosition.IsInWorld())
	{
		const home = cmpProviderPosition.GetPosition2D();
		direction = AirSupport.Normalize({ "x": home.x - this.target.x, "z": home.y - this.target.z });
	}
	const exit = AirSupport.Offset(this.target, direction, +(this.template.ExitDistance || 0));

	cmpPosition.JumpTo(exit.x, exit.z);
	cmpPosition.SetYRotation(Math.atan2(-direction.x, -direction.z));
	// Ao receber dono, o BattalionLeader cria os membros em volta do líder.
	Engine.QueryInterface(leader, IID_Ownership).SetOwner(owner);
};

/**
 * Se a cápsula/túnel for removido por outro motivo, libera o prédio.
 */
ReinforcementDelivery.prototype.OnDestroy = function()
{
	this.FinishMission();
};

ReinforcementDelivery.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_ReinforcementDelivery, "ReinforcementDelivery", ReinforcementDelivery);

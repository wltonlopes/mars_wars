/**
 * Laser orbital (laboratório mcc), criado pelo AirSupportManager.
 *
 * O feixe passa por fases em sequência (ex.: mira fina, força total,
 * enfraquecendo, sumindo). Cada fase mostra seu próprio actor por Duration
 * segundos e causa Damage × DamageMultiplier a cada TickInterval, com queda
 * de dano do centro até Radius. No fim, deixa uma marca no chão.
 */
function OrbitalStrike() {}

OrbitalStrike.prototype.Schema =
	"<a:help>Orbital laser: a beam that goes through phases on the target, damaging the area each tick.</a:help>" +
	"<element name='Phases' a:help='One child element per phase (any name), played by ascending Order (the engine does not keep the XML order).'>" +
		"<oneOrMore>" +
			"<element>" +
				"<anyName/>" +
				"<interleave>" +
					"<element name='Order'><data type='nonNegativeInteger'/></element>" +
					"<element name='Actor'><text/></element>" +
					"<element name='Duration' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
					"<element name='DamageMultiplier' a:help='Fraction of Damage dealt each tick of this phase.'><ref name='nonNegativeDecimal'/></element>" +
				"</interleave>" +
			"</element>" +
		"</oneOrMore>" +
	"</element>" +
	"<element name='Damage' a:help='Damage per tick at full power, at the centre.'>" +
		"<oneOrMore>" +
			"<element>" +
				"<anyName/>" +
				"<ref name='nonNegativeDecimal'/>" +
			"</element>" +
		"</oneOrMore>" +
	"</element>" +
	"<element name='Radius'><ref name='positiveDecimal'/></element>" +
	"<element name='TickInterval' a:help='Seconds between damage ticks.'><ref name='positiveDecimal'/></element>" +
	"<element name='FriendlyFire'><data type='boolean'/></element>" +
	"<optional>" +
		"<element name='LingerActor' a:help='Left on the ground after the beam ends.'><text/></element>" +
	"</optional>" +
	"<optional>" +
		"<element name='LingerTime' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
	"</optional>";

/** Sobreposição entre o actor de uma fase e o da seguinte, para não piscar. */
OrbitalStrike.prototype.PHASE_OVERLAP = 0.2;

OrbitalStrike.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.target = null;
	this.phase = -1;
	this.phaseTime = 0;
	this.tickTime = 0;
};

OrbitalStrike.prototype.GetPhases = function()
{
	return Object.keys(this.template.Phases).map(name => this.template.Phases[name])
		.sort((a, b) => +a.Order - +b.Order);
};

OrbitalStrike.prototype.StartMission = function(missionId, provider, target)
{
	this.missionId = missionId;
	this.provider = provider;
	this.target = target;

	Engine.QueryInterface(this.entity, IID_Position).JumpTo(target.x, target.z);
	this.StartPhase(0);
};

OrbitalStrike.prototype.StartPhase = function(index)
{
	const phases = this.GetPhases();
	this.phase = index;
	this.phaseTime = 0;
	if (index >= phases.length)
	{
		this.End();
		return;
	}

	const phase = phases[index];
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).SpawnEffect({
		"actor": phase.Actor,
		"position": this.target,
		"lifetime": +phase.Duration + (index < phases.length - 1 ? this.PHASE_OVERLAP : 0)
	});
};

OrbitalStrike.prototype.OnUpdate = function(msg)
{
	if (!this.missionId || this.phase < 0)
		return;

	const phase = this.GetPhases()[this.phase];
	this.phaseTime += msg.turnLength;
	this.tickTime += msg.turnLength;

	const interval = +this.template.TickInterval;
	while (this.tickTime >= interval)
	{
		this.tickTime -= interval;
		this.DealDamage(+phase.DamageMultiplier);
	}

	if (this.phaseTime >= +phase.Duration)
		this.StartPhase(this.phase + 1);
};

OrbitalStrike.prototype.DealDamage = function(multiplier)
{
	if (multiplier <= 0)
		return;

	const damage = {};
	for (const type in this.template.Damage)
		damage[type] = +this.template.Damage[type] * multiplier;

	AttackHelper.CauseDamageOverArea({
		"type": "Ranged",
		"attackData": { "Damage": damage },
		"attacker": this.provider,
		"attackerOwner": Engine.QueryInterface(this.entity, IID_Ownership).GetOwner(),
		"origin": new Vector2D(this.target.x, this.target.z),
		"radius": +this.template.Radius,
		"shape": "Circular",
		"friendlyFire": this.template.FriendlyFire == "true"
	});
};

OrbitalStrike.prototype.End = function()
{
	if (this.template.LingerActor)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).SpawnEffect({
			"actor": this.template.LingerActor,
			"position": this.target,
			"lifetime": +(this.template.LingerTime || 20)
		});

	this.FinishMission();
};

/**
 * Se o controlador for removido por outro motivo, libera o prédio.
 */
OrbitalStrike.prototype.OnDestroy = function()
{
	this.FinishMission();
};

OrbitalStrike.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_OrbitalStrike, "OrbitalStrike", OrbitalStrike);

/**
 * Foco de incêndio no chão (fragmentos do míssil de fósforo branco).
 *
 * A cada Interval causa Damage em área (com queda do centro até Radius) e
 * some depois de Duration segundos. O fogo e a fumaça são o próprio actor
 * da entidade.
 */
function BurningGround() {}

BurningGround.prototype.Schema =
	"<a:help>Burning patch of ground: damages the area around it for a while, then disappears.</a:help>" +
	"<element name='Duration' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
	"<element name='Interval' a:help='Milliseconds between damage ticks.'><data type='positiveInteger'/></element>" +
	"<element name='Damage' a:help='Damage per tick at the centre, e.g. Fire.'>" +
		"<oneOrMore>" +
			"<element>" +
				"<anyName/>" +
				"<ref name='nonNegativeDecimal'/>" +
			"</element>" +
		"</oneOrMore>" +
	"</element>" +
	"<element name='Radius'><ref name='positiveDecimal'/></element>" +
	"<element name='FriendlyFire'><data type='boolean'/></element>";

BurningGround.prototype.Init = function()
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	const interval = +this.template.Interval;
	this.burnTimer = cmpTimer.SetInterval(this.entity, IID_BurningGround, "Burn", interval, interval, null);
	this.endTimer = cmpTimer.SetTimeout(this.entity, IID_BurningGround, "Extinguish", this.template.Duration * 1000, null);
};

BurningGround.prototype.Burn = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpOwnership)
		return;

	const damage = {};
	for (const type in this.template.Damage)
		damage[type] = +this.template.Damage[type];

	AttackHelper.CauseDamageOverArea({
		"type": "Ranged",
		"attackData": { "Damage": damage },
		"attacker": this.entity,
		"attackerOwner": cmpOwnership.GetOwner(),
		"origin": cmpPosition.GetPosition2D(),
		"radius": +this.template.Radius,
		"shape": "Circular",
		"friendlyFire": this.template.FriendlyFire == "true"
	});
};

BurningGround.prototype.Extinguish = function()
{
	Engine.DestroyEntity(this.entity);
};

BurningGround.prototype.OnDestroy = function()
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	cmpTimer.CancelTimer(this.burnTimer);
	cmpTimer.CancelTimer(this.endTimer);
};

Engine.RegisterComponentType(IID_BurningGround, "BurningGround", BurningGround);

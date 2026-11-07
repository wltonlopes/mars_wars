/**
 * Atropelar / pisar: a cada intervalo, inimigos debaixo da entidade levam
 * dano e são empurrados para o lado.
 *
 * - Veículos terrestres (template_unit_vehicle_landvehicle): só em alta
 *   velocidade (MinSpeedRatio da velocidade de marcha, ou embalado: esteve
 *   rápido há menos de MOMENTUM_TIME e ainda anda) e só infantaria. O dano
 *   cresce com o tamanho do casco (raio do VehicleSeparation, se houver).
 * - Tripod (template_tripod): MinSpeedRatio 0, pisa em infantaria e veículos
 *   sob as pernas, andando ou atirando.
 *
 * O alcance (Radius) conta da borda da obstrução: o pathfinder faz o veículo
 * desviar da infantaria, e ele passa a alguns metros dela; com FrontOnly, só
 * quem está à frente do veículo (a investida) é atingido.
 *
 * Cada alvo só é atingido de novo depois de Cooldown ms (quem fica preso
 * debaixo não morre em um quadro).
 */
function Trample() {}

Trample.prototype.Schema =
	"<a:help>Damages and pushes enemies under the entity while it moves.</a:help>" +
	"<element name='Radius' a:help='Reach from the edge of the obstruction, in metres.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='FrontOnly' a:help='Only hits targets ahead of the entity.'>" +
			"<data type='boolean'/>" +
		"</element>" +
	"</optional>" +
	"<element name='MinSpeedRatio' a:help='Only tramples above this fraction of the walk speed (0: always).'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='Interval' a:help='Check interval, in milliseconds.'>" +
		"<data type='positiveInteger'/>" +
	"</element>" +
	"<element name='Cooldown' a:help='Milliseconds before the same target can be hit again.'>" +
		"<data type='positiveInteger'/>" +
	"</element>" +
	"<element name='Damage'>" +
		"<interleave>" +
			"<optional><element name='Hack'><ref name='nonNegativeDecimal'/></element></optional>" +
			"<optional><element name='Pierce'><ref name='nonNegativeDecimal'/></element></optional>" +
			"<optional><element name='Crush'><ref name='nonNegativeDecimal'/></element></optional>" +
		"</interleave>" +
	"</element>" +
	"<element name='Classes' a:help='Classes that can be trampled.'>" +
		"<attribute name='datatype'><value>tokens</value></attribute>" +
		"<text/>" +
	"</element>" +
	"<optional>" +
		"<element name='RestrictedClasses' a:help='Classes never trampled.'>" +
			"<attribute name='datatype'><value>tokens</value></attribute>" +
			"<text/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='ScaleWithHull' a:help='Multiply damage by VehicleSeparation radius / this value.'>" +
			"<ref name='positiveDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Knockback' a:help='Metres the target is pushed.'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>";

Trample.prototype.Init = function()
{
	this.lastHit = {};
};

Trample.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	if (!this.timer)
	{
		const interval = +this.template.Interval;
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			this.entity, IID_Trample, "Tick", interval + this.entity % 7 * 30, interval, null);
	}
};

Trample.prototype.StopTimer = function()
{
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

Trample.prototype.OnDestroy = function()
{
	this.StopTimer();
};

/** Embalo: quem esteve em alta velocidade há pouco e ainda anda atropela
 *  (o veículo freia um pouco para contornar quem está na frente). */
Trample.prototype.MOMENTUM_TIME = 1500;
Trample.prototype.MOMENTUM_MIN_RATIO = 0.25;

/** @return {boolean} Se está rápido o bastante para atropelar. */
Trample.prototype.IsFastEnough = function(now)
{
	const ratio = +this.template.MinSpeedRatio;
	if (ratio <= 0)
		return true;
	const cmpUnitMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	if (!cmpUnitMotion)
		return false;
	const speed = cmpUnitMotion.GetCurrentSpeed();
	const walk = cmpUnitMotion.GetWalkSpeed();
	if (speed > 0 && speed >= ratio * walk)
		this.lastFast = now;
	return this.lastFast !== undefined && now - this.lastFast <= this.MOMENTUM_TIME && speed >= this.MOMENTUM_MIN_RATIO * walk;
};

Trample.prototype.GetDamageMultiplier = function()
{
	if (!this.template.ScaleWithHull)
		return 1;
	const cmpSeparation = Engine.QueryInterface(this.entity, IID_VehicleSeparation);
	return cmpSeparation ? Math.max(0.5, cmpSeparation.GetRadius() / +this.template.ScaleWithHull) : 1;
};

Trample.prototype.Tick = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld() || cmpPosition.GetTurretParent() != INVALID_ENTITY)
		return;
	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	if (!this.IsFastEnough(now))
		return;
	const cmpDiplomacy = QueryOwnerInterface(this.entity, IID_Diplomacy);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpDiplomacy || !cmpOwnership)
		return;

	const radius = +this.template.Radius;
	const cmpObstructionManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ObstructionManager);
	const frontOnly = this.template.FrontOnly == "true";
	const angle = cmpPosition.GetRotation().y;
	const forward = new Vector2D(Math.sin(angle), Math.cos(angle));
	const here = cmpPosition.GetPosition2D();
	const targets = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQuery(
		this.entity, 0, radius + 12, cmpDiplomacy.GetEnemies(), IID_Resistance, false).filter(target => {
		if (cmpObstructionManager.DistanceToTarget(this.entity, target) > radius)
			return false;
		if (!frontOnly)
			return true;
		const cmpTargetPos = Engine.QueryInterface(target, IID_Position);
		if (!cmpTargetPos || !cmpTargetPos.IsInWorld())
			return false;
		const to = Vector2D.sub(cmpTargetPos.GetPosition2D(), here);
		return to.length() > 0 && to.dot(forward) / to.length() > 0.2;
	});
	if (!targets.length)
		return;

	const cooldown = +this.template.Cooldown;
	const classes = this.template.Classes._string;
	const restricted = this.template.RestrictedClasses ? this.template.RestrictedClasses._string : "";
	const damage = {};
	const multiplier = this.GetDamageMultiplier();
	for (const type in this.template.Damage)
		damage[type] = +this.template.Damage[type] * multiplier;
	const origin = cmpPosition.GetPosition2D();
	const knockback = +(this.template.Knockback || 0);

	for (const target of targets)
	{
		if (this.lastHit[target] && now - this.lastHit[target] < cooldown)
			continue;
		const cmpIdentity = Engine.QueryInterface(target, IID_Identity);
		if (!cmpIdentity)
			continue;
		const targetClasses = cmpIdentity.GetClassesList();
		if (!MatchesClassList(targetClasses, classes) || restricted && MatchesClassList(targetClasses, restricted))
			continue;
		const cmpTargetPosition = Engine.QueryInterface(target, IID_Position);
		if (!cmpTargetPosition || !cmpTargetPosition.IsInWorld() || cmpTargetPosition.GetTurretParent() != INVALID_ENTITY)
			continue;
		this.lastHit[target] = now;
		AttackHelper.HandleAttackEffects(target, {
			"type": "Melee",
			"attackData": { "Damage": damage },
			"attacker": this.entity,
			"attackerOwner": cmpOwnership.GetOwner(),
			"origin": origin,
			"Knockback": knockback ? { "distance": knockback, "chance": 100 } : undefined
		});
	}

	// Esquece alvos antigos.
	for (const id in this.lastHit)
		if (now - this.lastHit[id] > cooldown * 4)
			delete this.lastHit[id];
};

Engine.RegisterComponentType(IID_Trample, "Trample", Trample);

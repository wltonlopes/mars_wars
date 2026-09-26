/**
 * Drone kamikaze de enxame.
 *
 * Enquanto voa normalmente (UnitMotionFlying + UnitAI), o drone procura
 * inimigos visíveis dentro de DetectionRange. Ao encontrar um, escolhe o
 * alvo de forma coordenada com os outros drones do jogador (evitando
 * mandar drones demais para um alvo que já vai morrer), avisa o resto do
 * enxame e mergulha em linha reta, em alta velocidade, até o alvo.
 *
 * Durante o mergulho o UnitMotionFlying é suspenso (ver
 * ZZ_KamikazeUnitMotionFlying.js). O drone explode ao atingir o alvo, ao
 * tocar o chão, ou no ponto onde o alvo estava se ele sumir.
 */
function Kamikaze() {}

Kamikaze.prototype.Schema =
	"<a:help>Swarm kamikaze drone: detects enemies, coordinates targets with the swarm and dives into them.</a:help>" +
	"<optional>" +
		"<element name='DetectionRange' a:help='Metres. Enemies closer than this trigger a dive.'>" +
			"<ref name='positiveDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='DiveSpeed' a:help='Metres per second during the terminal dive.'>" +
			"<ref name='positiveDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='MaxDiveTime' a:help='Seconds. The drone detonates where it is after this.'>" +
			"<ref name='positiveDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='MaxDronesPerTarget' a:help='Upper limit of drones diving on the same target.'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='PreferredClasses' a:help='Target priority, most important first.'>" +
			"<attribute name='datatype'><value>tokens</value></attribute>" +
			"<text/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Warhead' a:help='Explosion. Without it, the Melee splash of the Attack component is used.'>" +
			"<interleave>" +
				"<element name='Damage'>" +
					"<oneOrMore>" +
						"<element>" +
							"<anyName/>" +
							"<ref name='nonNegativeDecimal'/>" +
						"</element>" +
					"</oneOrMore>" +
				"</element>" +
				"<element name='Radius'>" +
					"<ref name='positiveDecimal'/>" +
				"</element>" +
				"<element name='FriendlyFire'>" +
					"<data type='boolean'/>" +
				"</element>" +
				"<optional>" +
					"<element name='ImpactActorName'>" +
						"<text/>" +
					"</element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactSound'>" +
						"<text/>" +
					"</element>" +
				"</optional>" +
			"</interleave>" +
		"</element>" +
	"</optional>";

Kamikaze.prototype.SCAN_INTERVAL = 250;
/** Altura mínima sobre o solo para começar um mergulho (ainda decolando abaixo disso). */
Kamikaze.prototype.MIN_DIVE_ALTITUDE = 3;
/** Distância 3D em que o drone é considerado no alvo. */
Kamikaze.prototype.HIT_DISTANCE = 1.5;
/** Quanto do DetectionRange um drone alertado pelo enxame usa. */
Kamikaze.prototype.SWARM_ALERT_RANGE_FACTOR = 1.6;
/** Quantas vezes um drone pode trocar de alvo durante o mergulho. */
Kamikaze.prototype.MAX_RETARGETS = 2;

Kamikaze.prototype.Init = function()
{
	this.diving = false;
	this.detonated = false;
	this.diveTarget = INVALID_ENTITY;
	this.diveTargetPoint = null;
	this.diveTime = 0;
	this.retargets = 0;

	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
		this.entity, IID_Kamikaze, "Scan", this.SCAN_INTERVAL, this.SCAN_INTERVAL);
};

Kamikaze.prototype.IsDiving = function()
{
	return this.diving;
};

Kamikaze.prototype.GetDiveTarget = function()
{
	return this.diving ? this.diveTarget : INVALID_ENTITY;
};

Kamikaze.prototype.GetDetectionRange = function()
{
	return +(this.template.DetectionRange || 35);
};

Kamikaze.prototype.GetOwner = function()
{
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	return cmpOwnership ? cmpOwnership.GetOwner() : INVALID_PLAYER;
};

/**
 * Dano total da ogiva (sem resistências), usado para estimar quantos
 * drones um alvo precisa.
 */
Kamikaze.prototype.GetWarheadData = function()
{
	if (this.template.Warhead)
	{
		const damage = {};
		for (const type in this.template.Warhead.Damage)
			damage[type] = +this.template.Warhead.Damage[type];
		return {
			"attackData": { "Damage": damage },
			"radius": +this.template.Warhead.Radius,
			"shape": "Circular",
			"friendlyFire": this.template.Warhead.FriendlyFire == "true",
			"impactActor": this.template.Warhead.ImpactActorName || "",
			"impactSound": this.template.Warhead.ImpactSound || ""
		};
	}

	const cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
	const splash = cmpAttack && cmpAttack.GetSplashData("Melee");
	return splash && Object.assign({ "impactActor": "", "impactSound": "" }, splash);
};

Kamikaze.prototype.GetWarheadTotalDamage = function()
{
	const warhead = this.GetWarheadData();
	if (!warhead || !warhead.attackData.Damage)
		return 1;
	let total = 0;
	for (const type in warhead.attackData.Damage)
		total += warhead.attackData.Damage[type];
	return Math.max(1, total);
};

Kamikaze.prototype.GetAltitude = function(cmpPosition)
{
	const position = cmpPosition.GetPosition();
	return position.y - Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(position.x, position.z);
};

/**
 * Chamado pelo Timer. Procura um alvo e inicia o mergulho.
 * @param {number} rangeFactor - > 1 quando alertado por outro drone do enxame.
 */
Kamikaze.prototype.Scan = function(data, lateness, rangeFactor = 1)
{
	if (this.diving || this.detonated)
		return;

	const owner = this.GetOwner();
	if (owner <= 0)
		return;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld() || this.GetAltitude(cmpPosition) < this.MIN_DIVE_ALTITUDE)
		return;

	const target = this.ChooseTarget(owner, this.GetDetectionRange() * rangeFactor);
	if (target == INVALID_ENTITY)
		return;

	this.StartDive(target);
	this.AlertSwarm();
};

Kamikaze.prototype.GetEnemyPlayers = function(owner)
{
	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	return cmpDiplomacy ? cmpDiplomacy.GetEnemies().filter(player => player > 0) : [];
};

Kamikaze.prototype.IsValidTarget = function(target, owner)
{
	const cmpPosition = Engine.QueryInterface(target, IID_Position);
	const cmpHealth = Engine.QueryInterface(target, IID_Health);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpHealth || cmpHealth.GetHitpoints() <= 0)
		return false;

	if (Engine.QueryInterface(target, IID_Mirage))
		return false;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	return cmpRangeManager.GetLosVisibility(target, owner) == "visible";
};

/**
 * Quantos drones do mesmo jogador já estão mergulhando em cada alvo.
 */
Kamikaze.prototype.GetAssignedDrones = function(owner, range)
{
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const assigned = new Map();
	for (const drone of cmpRangeManager.ExecuteQuery(this.entity, 0, range, [owner], IID_Kamikaze, false))
	{
		const target = Engine.QueryInterface(drone, IID_Kamikaze).GetDiveTarget();
		if (target != INVALID_ENTITY)
			assigned.set(target, (assigned.get(target) || 0) + 1);
	}
	return assigned;
};

/**
 * Prioridade: alvo ordenado pelo jogador > classe preferida > proximidade.
 * Alvos que já recebem drones suficientes para morrer são evitados.
 */
Kamikaze.prototype.ChooseTarget = function(owner, range, ignoreStance = false)
{
	const players = this.GetEnemyPlayers(owner);
	if (!players.length)
		return INVALID_ENTITY;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const candidates = cmpRangeManager.ExecuteQuery(this.entity, 0, range, players, IID_Health, true)
		.filter(target => this.IsValidTarget(target, owner));

	const orderedTarget = this.GetOrderedTarget();
	const stance = Engine.QueryInterface(this.entity, IID_UnitAI)?.GetStanceName();
	if (orderedTarget != INVALID_ENTITY && candidates.indexOf(orderedTarget) != -1)
		return orderedTarget;
	if (stance == "passive" && !ignoreStance || !candidates.length)
		return INVALID_ENTITY;

	const classList = this.template.PreferredClasses;
	const preferred = classList ? (classList._string || classList).trim().split(/\s+/) : [];
	const maxPerTarget = +(this.template.MaxDronesPerTarget || 3);
	const warheadDamage = this.GetWarheadTotalDamage();
	const assigned = this.GetAssignedDrones(owner, range * 2);
	const myPosition = Engine.QueryInterface(this.entity, IID_Position).GetPosition2D();

	let best = INVALID_ENTITY;
	let bestScore = Infinity;
	for (const target of candidates)
	{
		const hitpoints = Engine.QueryInterface(target, IID_Health).GetHitpoints();
		const needed = Math.min(maxPerTarget, Math.ceil(hitpoints / warheadDamage));
		const already = assigned.get(target) || 0;

		const classes = Engine.QueryInterface(target, IID_Identity)?.GetClassesList() || [];
		let priority = preferred.findIndex(cls => classes.indexOf(cls) != -1);
		if (priority == -1)
			priority = preferred.length;

		const distance = myPosition.distanceTo(Engine.QueryInterface(target, IID_Position).GetPosition2D());
		// Cada nível de prioridade vale uma DetectionRange de distância;
		// alvos já "cobertos" ficam no fim da fila, mas ainda servem.
		const score = distance + priority * range + (already >= needed ? 10 * range : already * range * 0.25);
		if (score < bestScore)
		{
			bestScore = score;
			best = target;
		}
	}
	return best;
};

Kamikaze.prototype.GetOrderedTarget = function()
{
	const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	const order = cmpUnitAI && cmpUnitAI.order;
	return order && order.type == "Attack" && order.data && order.data.target || INVALID_ENTITY;
};

/**
 * Faz os outros drones do mesmo batalhão procurarem alvos na hora, com
 * alcance ampliado, para o enxame atacar junto.
 */
Kamikaze.prototype.AlertSwarm = function()
{
	let leader = this.entity;
	const cmpMember = Engine.QueryInterface(this.entity, IID_BattalionMember);
	if (cmpMember && cmpMember.GetLeader() != INVALID_ENTITY)
		leader = cmpMember.GetLeader();

	const cmpLeader = Engine.QueryInterface(leader, IID_BattalionLeader);
	if (!cmpLeader)
		return;

	for (const drone of cmpLeader.GetBattalionEntities())
	{
		const cmpKamikaze = drone != this.entity && Engine.QueryInterface(drone, IID_Kamikaze);
		if (cmpKamikaze)
			cmpKamikaze.Scan(undefined, 0, this.SWARM_ALERT_RANGE_FACTOR);
	}
};

Kamikaze.prototype.StartDive = function(target)
{
	this.diving = true;
	this.diveTarget = target;
	this.diveTime = 0;
	this.retargets = 0;
	this.UpdateDiveTargetPoint(0);

	// Daqui em diante o drone é guiado só por este componente.
	const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	if (cmpUnitAI)
	{
		cmpUnitAI.SwitchToStance("passive");
		cmpUnitAI.Stop(false);
	}
};

/**
 * Atualiza o ponto de impacto, antecipando o movimento do alvo.
 * Se o alvo sumiu, mantém o último ponto conhecido (o drone atinge o chão ali).
 */
Kamikaze.prototype.UpdateDiveTargetPoint = function(timeToImpact)
{
	const cmpTargetPosition = Engine.QueryInterface(this.diveTarget, IID_Position);
	const cmpTargetHealth = Engine.QueryInterface(this.diveTarget, IID_Health);
	if (!cmpTargetPosition || !cmpTargetPosition.IsInWorld() || !cmpTargetHealth || cmpTargetHealth.GetHitpoints() <= 0)
	{
		this.diveTarget = INVALID_ENTITY;
		return;
	}

	let point = cmpTargetPosition.GetPosition2D();
	const cmpTargetMotion = Engine.QueryInterface(this.diveTarget, IID_UnitMotion);
	if (cmpTargetMotion && timeToImpact > 0)
		point = cmpTargetMotion.EstimateFuturePosition(timeToImpact);

	this.diveTargetPoint = { "x": point.x, "y": cmpTargetPosition.GetPosition().y, "z": point.y };
};

Kamikaze.prototype.OnUpdate = function(msg)
{
	if (!this.diving || this.detonated)
		return;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return;

	const diveSpeed = +(this.template.DiveSpeed || 40);
	const position = cmpPosition.GetPosition();
	this.diveTime += msg.turnLength;

	if (this.diveTarget != INVALID_ENTITY)
	{
		const current = this.diveTargetPoint;
		const eta = Math.hypot(current.x - position.x, current.y - position.y, current.z - position.z) / diveSpeed;
		this.UpdateDiveTargetPoint(eta);
	}

	// Alvo destruído por outro drone durante o mergulho: tenta desviar
	// para outro inimigo próximo; sem nenhum, segue para o ponto e atinge o chão.
	if (this.diveTarget == INVALID_ENTITY && this.retargets < this.MAX_RETARGETS)
	{
		++this.retargets;
		const newTarget = this.ChooseTarget(this.GetOwner(), this.GetDetectionRange(), true);
		if (newTarget != INVALID_ENTITY)
		{
			this.diveTarget = newTarget;
			this.UpdateDiveTargetPoint(0);
		}
	}

	const target = this.diveTargetPoint;
	const dx = target.x - position.x;
	const dy = target.y - position.y;
	const dz = target.z - position.z;
	const distance = Math.hypot(dx, dy, dz);
	const step = diveSpeed * msg.turnLength;

	if (distance <= step + this.HIT_DISTANCE || this.diveTime >= +(this.template.MaxDiveTime || 6))
	{
		const impact = distance <= step + this.HIT_DISTANCE ? target : position;
		cmpPosition.MoveTo(impact.x, impact.z);
		this.Detonate(new Vector3D(impact.x, impact.y, impact.z));
		return;
	}

	const next = {
		"x": position.x + dx / distance * step,
		"y": position.y + dy / distance * step,
		"z": position.z + dz / distance * step
	};

	const ground = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(next.x, next.z);
	if (next.y <= ground + 0.5)
	{
		cmpPosition.MoveTo(next.x, next.z);
		this.Detonate(new Vector3D(next.x, ground, next.z));
		return;
	}

	cmpPosition.TurnTo(Math.atan2(dx, dz));
	cmpPosition.SetXZRotation(Math.atan2(dy, Math.hypot(dx, dz)), 0);
	cmpPosition.SetHeightFixed(next.y);
	cmpPosition.MoveTo(next.x, next.z);
};

Kamikaze.prototype.Detonate = function(position)
{
	if (this.detonated)
		return;
	this.detonated = true;

	const warhead = this.GetWarheadData();
	const owner = this.GetOwner();
	if (warhead && owner != INVALID_PLAYER)
	{
		if (warhead.impactSound)
			Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(warhead.impactSound, position);

		if (warhead.impactActor)
			this.SpawnEffect(warhead.impactActor, position);

		AttackHelper.CauseDamageOverArea({
			"type": "Melee",
			"attackData": warhead.attackData,
			"attacker": this.entity,
			"attackerOwner": owner,
			"origin": Vector2D.from3D(position),
			"radius": warhead.radius,
			"shape": warhead.shape,
			"direction": new Vector3D(0, 0, 1),
			"friendlyFire": warhead.friendlyFire,
			"Stun": warhead.Stun,
			"Knockback": warhead.Knockback,
			"isSplash": true
		});
	}

	Engine.DestroyEntity(this.entity);
};

Kamikaze.prototype.SpawnEffect = function(actor, position)
{
	const effect = Engine.AddEntity("actor|" + actor);
	const cmpPosition = effect != INVALID_ENTITY && Engine.QueryInterface(effect, IID_Position);
	if (!cmpPosition)
		return;

	cmpPosition.JumpTo(position.x, position.z);
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
		SYSTEM_ENTITY, IID_AirSupportManager, "RemoveEffect", 4000, effect);
};

Engine.RegisterComponentType(IID_Kamikaze, "Kamikaze", Kamikaze);

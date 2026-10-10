/**
 * Mina de proximidade (espalhada pelo míssil de fragmentação de Ares).
 *
 * Depois de ArmDelay segundos a mina fica armada e, a cada CheckInterval,
 * procura unidades inimigas no chão dentro de TriggerRadius. Ao encontrar
 * uma, explode: dano em área (com queda do centro até Radius) e, se houver,
 * empurrão. Sem ser acionada, some depois de Lifetime segundos.
 */
function ProximityMine() {}

ProximityMine.prototype.Schema =
	"<a:help>Proximity mine: arms itself, then explodes when an enemy ground unit comes close.</a:help>" +
	"<element name='ArmDelay' a:help='Seconds after landing before the mine can explode.'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='TriggerRadius' a:help='Metres. An enemy ground unit this close sets the mine off.'><ref name='positiveDecimal'/></element>" +
	"<element name='Lifetime' a:help='Seconds. The mine disarms and disappears after this.'><ref name='positiveDecimal'/></element>" +
	"<optional>" +
		"<element name='CheckInterval' a:help='Milliseconds between two checks for enemies.'><data type='positiveInteger'/></element>" +
	"</optional>" +
	"<element name='Damage' a:help='Damage at the centre of the blast, e.g. Crush, Pierce.'>" +
		"<oneOrMore>" +
			"<element>" +
				"<anyName/>" +
				"<ref name='nonNegativeDecimal'/>" +
			"</element>" +
		"</oneOrMore>" +
	"</element>" +
	"<element name='Radius' a:help='Blast radius, in metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='FriendlyFire'><data type='boolean'/></element>" +
	"<optional>" +
		"<element name='Knockback' a:help='Throws the units caught in the blast away from the mine.'>" +
			"<interleave>" +
				"<element name='Distance'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='Chance' a:help='Percentage.'><ref name='nonNegativeDecimal'/></element>" +
			"</interleave>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='ImpactActorName'><text/></element>" +
	"</optional>" +
	"<optional>" +
		"<element name='ImpactAnimationLifetime' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
	"</optional>" +
	"<optional>" +
		"<element name='ImpactSound' a:help='Sound group played by the explosion.'><text/></element>" +
	"</optional>";

/** Unidades acima desta altura (aeronaves, drones) não acionam a mina. */
ProximityMine.prototype.MAX_TRIGGER_HEIGHT = 4;

ProximityMine.prototype.Init = function()
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	const interval = +(this.template.CheckInterval || 500);
	this.checkTimer = cmpTimer.SetInterval(
		this.entity, IID_ProximityMine, "Check", this.template.ArmDelay * 1000, interval, null);
	this.expireTimer = cmpTimer.SetTimeout(
		this.entity, IID_ProximityMine, "Expire", this.template.Lifetime * 1000, null);
};

ProximityMine.prototype.GetOwner = function()
{
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	return cmpOwnership ? cmpOwnership.GetOwner() : INVALID_PLAYER;
};

ProximityMine.prototype.Check = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const owner = this.GetOwner();
	if (!cmpPosition || !cmpPosition.IsInWorld() || owner <= 0)
		return;

	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	const enemies = cmpDiplomacy ? cmpDiplomacy.GetEnemies().filter(player => player > 0) : [];
	if (!enemies.length)
		return;

	const nearby = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQueryAroundPos(
		cmpPosition.GetPosition2D(), 0, +this.template.TriggerRadius, enemies, IID_Health, true);
	if (nearby.some(ent => this.IsTrigger(ent)))
		this.Detonate();
};

/** Só unidades no chão acionam a mina (nem prédios, nem aeronaves). */
ProximityMine.prototype.IsTrigger = function(ent)
{
	const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
	if (!cmpIdentity || !cmpIdentity.HasClass("Unit"))
		return false;

	const cmpPosition = Engine.QueryInterface(ent, IID_Position);
	return !!cmpPosition && cmpPosition.IsInWorld() && cmpPosition.GetHeightOffset() <= this.MAX_TRIGGER_HEIGHT;
};

ProximityMine.prototype.Detonate = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return;
	const pos = cmpPosition.GetPosition2D();
	const position = { "x": pos.x, "z": pos.y };

	if (this.template.ImpactSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(
			this.template.ImpactSound, cmpPosition.GetPosition());

	if (this.template.ImpactActorName)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).SpawnEffect({
			"actor": this.template.ImpactActorName,
			"position": position,
			"lifetime": +(this.template.ImpactAnimationLifetime || 2)
		});

	const damage = {};
	for (const type in this.template.Damage)
		damage[type] = +this.template.Damage[type];

	const knockback = this.template.Knockback;
	AttackHelper.CauseDamageOverArea({
		"type": "Ranged",
		"attackData": { "Damage": damage },
		"attacker": this.entity,
		"attackerOwner": this.GetOwner(),
		"origin": pos,
		"radius": +this.template.Radius,
		"shape": "Circular",
		"friendlyFire": this.template.FriendlyFire == "true",
		"Knockback": knockback ? { "distance": +knockback.Distance, "chance": +knockback.Chance } : undefined,
		"isSplash": true
	});

	Engine.DestroyEntity(this.entity);
};

ProximityMine.prototype.Expire = function()
{
	Engine.DestroyEntity(this.entity);
};

ProximityMine.prototype.OnDestroy = function()
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	cmpTimer.CancelTimer(this.checkTimer);
	cmpTimer.CancelTimer(this.expireTimer);
};

Engine.RegisterComponentType(IID_ProximityMine, "ProximityMine", ProximityMine);

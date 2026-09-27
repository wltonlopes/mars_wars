/**
 * Redemoinho de areia marciano (evento de clima, criado pelo WeatherManager).
 *
 * Vagueia pelo mapa mudando de direção aos poucos, girando sem parar. Quem
 * estiver dentro do raio anda mais devagar e sofre um dano leve e contínuo
 * de areia; depois de Duration segundos o redemoinho se desfaz.
 */
function DustDevil() {}

DustDevil.prototype.Schema =
	"<a:help>Martian dust devil: wanders across the map, slowing and lightly damaging everything inside it.</a:help>" +
	"<element name='Duration' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
	"<element name='Speed' a:help='Metres per second.'><ref name='positiveDecimal'/></element>" +
	"<element name='Radius' a:help='Metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='SpinRate' a:help='Radians per second (the particles spin with the entity).'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='TickInterval' a:help='Seconds between damage ticks.'><ref name='positiveDecimal'/></element>" +
	"<element name='Damage' a:help='Damage per tick at the centre.'>" +
		"<oneOrMore><element><anyName/><ref name='nonNegativeDecimal'/></element></oneOrMore>" +
	"</element>" +
	"<element name='WalkSpeedMultiplier' a:help='Applied to units inside.'><ref name='positiveDecimal'/></element>" +
	"<optional><element name='Sound' a:help='Sound group played every SoundInterval seconds.'><text/></element></optional>" +
	"<optional><element name='SoundInterval'><ref name='positiveDecimal'/></element></optional>";

/** Margem da borda do mapa, em metros. */
DustDevil.prototype.MAP_MARGIN = 20;

/** A cada quantos segundos o redemoinho muda um pouco de direção. */
DustDevil.prototype.TURN_INTERVAL = 2;

DustDevil.prototype.Init = function()
{
	this.elapsed = 0;
	this.tickTime = 0;
	this.turnTime = 0;
	this.soundTime = 0;
	this.heading = randFloat(0, 2 * Math.PI);
	this.spin = 0;
	// Entidades com o modificador de lentidão.
	this.affected = [];
};

DustDevil.prototype.GetModifierId = function()
{
	return "weather/dust_devil/" + this.entity;
};

DustDevil.prototype.OnUpdate = function(msg)
{
	const dt = msg.turnLength;
	this.elapsed += dt;
	if (this.elapsed >= +this.template.Duration)
	{
		Engine.DestroyEntity(this.entity);
		return;
	}

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return;

	this.Move(cmpPosition, dt);

	this.spin = (this.spin + +this.template.SpinRate * dt) % (2 * Math.PI);
	cmpPosition.TurnTo(this.spin);

	this.tickTime += dt;
	const interval = +this.template.TickInterval;
	while (this.tickTime >= interval)
	{
		this.tickTime -= interval;
		this.Tick(cmpPosition.GetPosition2D());
	}

	if (this.template.Sound)
	{
		this.soundTime -= dt;
		if (this.soundTime <= 0)
		{
			this.soundTime = +(this.template.SoundInterval || 6);
			Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(this.template.Sound, cmpPosition.GetPosition());
		}
	}
};

/**
 * Anda na direção atual, que muda aos poucos; perto da borda, vira para o
 * centro do mapa.
 */
DustDevil.prototype.Move = function(cmpPosition, dt)
{
	this.turnTime += dt;
	if (this.turnTime >= this.TURN_INTERVAL)
	{
		this.turnTime = 0;
		this.heading += randFloat(-0.7, 0.7);
	}

	const pos = cmpPosition.GetPosition2D();
	const step = +this.template.Speed * dt;
	let next = { "x": pos.x + Math.sin(this.heading) * step, "z": pos.y + Math.cos(this.heading) * step };
	if (!AirSupport.IsInsideMap(next, this.MAP_MARGIN))
	{
		const half = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetMapSize() / 2;
		this.heading = Math.atan2(half - pos.x, half - pos.y);
		next = { "x": pos.x + Math.sin(this.heading) * step, "z": pos.y + Math.cos(this.heading) * step };
	}
	cmpPosition.MoveTo(next.x, next.z);
};

DustDevil.prototype.Tick = function(center)
{
	const radius = +this.template.Radius;
	const damage = {};
	for (const type in this.template.Damage)
		damage[type] = +this.template.Damage[type];

	AttackHelper.CauseDamageOverArea({
		"type": "Ranged",
		"attackData": { "Damage": damage },
		"attacker": this.entity,
		"attackerOwner": 0,
		"origin": center,
		"radius": radius,
		"shape": "Circular",
		"friendlyFire": true
	});

	this.affected = WeatherHelper.UpdateAreaModifiers(this.GetModifierId(), this.affected,
		WeatherHelper.GetUnitsInArea(center, radius), {
			"UnitMotion/WalkSpeed": [{ "affects": [], "multiply": +this.template.WalkSpeedMultiplier }]
		});
};

DustDevil.prototype.OnDestroy = function()
{
	WeatherHelper.UpdateAreaModifiers(this.GetModifierId(), this.affected, [], {});
	this.affected = [];
};

Engine.RegisterComponentType(IID_DustDevil, "DustDevil", DustDevil);

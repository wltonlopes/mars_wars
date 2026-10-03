/**
 * Tempestade de areia marciana com raios.
 *
 * Dois usos:
 *  - evento de clima (WeatherManager): entra por uma borda do mapa e
 *    atravessa até a borda oposta, e os raios atingem todos;
 *  - ataque especial (centro cívico dos piratas, AirSupportProvider tipo
 *    "sandstorm"): nasce no ponto escolhido e vai à deriva, se afastando
 *    do prédio, por MissionDuration segundos; os raios são do jogador que
 *    convocou (sem fogo amigo, se FriendlyFire for false).
 *
 * É formada por É formada por
 * várias nuvens (entidades CloudTemplate) que andam juntas. Dentro dela:
 *  - a visão diminui, as unidades andam mais devagar e os tiros espalham mais;
 *  - caem raios em pontos aleatórios (às vezes sobre uma unidade ou prédio),
 *    com clarão, trovão e dano em área.
 */
function Sandstorm() {}

Sandstorm.prototype.Schema =
	"<a:help>Martian sandstorm with lightning: crosses the map, reducing vision, speed and accuracy inside it, with random lightning strikes.</a:help>" +
	"<interleave>" +
	"<element name='Radius' a:help='Metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='Speed' a:help='Metres per second.'><ref name='positiveDecimal'/></element>" +
	"<element name='CloudTemplate' a:help='Visual cloud entity; one in the centre and CloudCount around it.'><text/></element>" +
	"<element name='CloudCount'><data type='nonNegativeInteger'/></element>" +
	"<element name='CloudRing' a:help='Distance of the outer clouds from the centre.'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='VisionMultiplier'><ref name='positiveDecimal'/></element>" +
	"<element name='WalkSpeedMultiplier'><ref name='positiveDecimal'/></element>" +
	"<element name='SpreadMultiplier' a:help='Ranged attack spread inside the storm.'><ref name='positiveDecimal'/></element>" +
	"<element name='Lightning'>" +
		"<interleave>" +
			"<element name='Templates' a:help='Bolt entities, one chosen at random per strike.'>" +
				"<optional><attribute name='datatype'><value>tokens</value></attribute></optional>" +
				"<text/>" +
			"</element>" +
			"<element name='MinInterval' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
			"<element name='MaxInterval' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
			"<element name='TargetChance' a:help='Chance (0..1) of striking an entity instead of a random point.'><ref name='nonNegativeDecimal'/></element>" +
			"<element name='Damage'><oneOrMore><element><anyName/><ref name='nonNegativeDecimal'/></element></oneOrMore></element>" +
			"<element name='Radius'><ref name='positiveDecimal'/></element>" +
			"<element name='ImpactActor'><text/></element>" +
			"<element name='ImpactActorLifetime' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
			"<optional><element name='Sound'><text/></element></optional>" +
		"</interleave>" +
	"</element>" +
	"<optional><element name='MissionDuration' a:help='Special attack only: seconds the summoned storm lasts.'><ref name='positiveDecimal'/></element></optional>" +
	"<optional><element name='FriendlyFire' a:help='Special attack only: whether the lightning hits the summoner and allies (natural storms hit everyone).'><data type='boolean'/></element></optional>" +
	"<optional><element name='WindSound'><text/></element></optional>" +
	"<optional><element name='WindSoundInterval'><ref name='positiveDecimal'/></element></optional>" +
	"</interleave>";

/** Segundos entre atualizações dos efeitos nas unidades. */
Sandstorm.prototype.EFFECT_INTERVAL = 1;

/** Duração dos dois clarões de cada raio (ms): acende, apaga, acende de novo. */
Sandstorm.prototype.BOLT_FLICKER = [[0, 110], [190, 420]];

Sandstorm.prototype.Init = function()
{
	this.path = null;
	this.travelled = 0;
	this.clouds = [];
	this.effectTime = 0;
	this.nextStrike = 0;
	this.windTime = 0;
	this.affected = [];
	this.finished = false;
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
};

Sandstorm.prototype.GetModifierId = function()
{
	return "weather/sandstorm/" + this.entity;
};

/**
 * @param {Object} path - AirSupport.CreateFlightPath: entra por uma borda e sai pela oposta.
 * @return {number} Duração em milissegundos.
 */
Sandstorm.prototype.Start = function(path)
{
	this.path = path;
	const heading = Math.atan2(path.direction.x, path.direction.z);
	Engine.QueryInterface(this.entity, IID_Position).JumpTo(path.entry.x, path.entry.z);

	// Nuvens: uma no centro e as outras em anel, todas viradas para onde a
	// tempestade vai (as partículas de vento sopram para a frente).
	const count = +this.template.CloudCount;
	const ring = +this.template.CloudRing;
	const offsets = [{ "x": 0, "z": 0 }];
	for (let i = 0; i < count; ++i)
	{
		const angle = 2 * Math.PI * i / count;
		offsets.push({ "x": Math.sin(angle) * ring, "z": Math.cos(angle) * ring });
	}
	for (const offset of offsets)
	{
		const cloud = Engine.AddEntity(this.template.CloudTemplate);
		const cmpCloudPosition = Engine.QueryInterface(cloud, IID_Position);
		cmpCloudPosition.JumpTo(path.entry.x + offset.x, path.entry.z + offset.z);
		cmpCloudPosition.SetYRotation(heading);
		this.clouds.push({ "entity": cloud, "offset": offset });
	}

	this.nextStrike = this.GetTime() + 3000;
	return path.length / +this.template.Speed * 1000;
};

/**
 * Ataque especial (AirSupportManager): a tempestade se forma em `target` e
 * vai à deriva na direção prédio -> alvo.
 * @return {number} Duração em milissegundos.
 */
Sandstorm.prototype.StartMission = function(missionId, provider, origin, target)
{
	this.missionId = missionId;
	this.provider = provider;
	const direction = AirSupport.Normalize({ "x": target.x - origin.x, "z": target.z - origin.z });
	const duration = +(this.template.MissionDuration || 40);
	return this.Start({
		"entry": target,
		"direction": direction,
		"length": +this.template.Speed * duration
	});
};

/** Dono do dano dos raios: quem convocou, ou gaia nas tempestades naturais. */
Sandstorm.prototype.GetAttackerOwner = function()
{
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	return cmpOwnership ? Math.max(0, cmpOwnership.GetOwner()) : 0;
};

Sandstorm.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

Sandstorm.prototype.GetCenter = function()
{
	return AirSupport.Offset(this.path.entry, this.path.direction, this.travelled);
};

Sandstorm.prototype.OnUpdate = function(msg)
{
	if (!this.path || this.finished)
		return;

	const dt = msg.turnLength;
	this.travelled += +this.template.Speed * dt;
	if (this.travelled >= this.path.length)
	{
		this.Finish();
		return;
	}

	const center = this.GetCenter();
	Engine.QueryInterface(this.entity, IID_Position).MoveTo(center.x, center.z);
	for (const cloud of this.clouds)
	{
		const cmpCloudPosition = Engine.QueryInterface(cloud.entity, IID_Position);
		if (cmpCloudPosition)
			cmpCloudPosition.MoveTo(center.x + cloud.offset.x, center.z + cloud.offset.z);
	}

	this.effectTime += dt;
	if (this.effectTime >= this.EFFECT_INTERVAL)
	{
		this.effectTime = 0;
		this.UpdateEffects(center);
	}

	if (this.GetTime() >= this.nextStrike)
	{
		const lightning = this.template.Lightning;
		this.nextStrike = this.GetTime() + randFloat(+lightning.MinInterval, +lightning.MaxInterval) * 1000;
		this.Strike(center);
	}

	if (this.template.WindSound)
	{
		this.windTime -= dt;
		if (this.windTime <= 0)
		{
			this.windTime = +(this.template.WindSoundInterval || 8);
			Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(
				this.template.WindSound, new Vector3D(center.x, 0, center.z));
		}
	}
};

/**
 * Menos visão, velocidade e precisão para quem está dentro (inclusive
 * prédios: visão e precisão das torres).
 */
Sandstorm.prototype.UpdateEffects = function(center)
{
	this.affected = WeatherHelper.UpdateAreaModifiers(this.GetModifierId(), this.affected,
		WeatherHelper.GetEntitiesInArea(new Vector2D(center.x, center.z), +this.template.Radius, IID_Vision), {
			"Vision/Range": [{ "affects": [], "multiply": +this.template.VisionMultiplier }],
			"UnitMotion/WalkSpeed": [{ "affects": [], "multiply": +this.template.WalkSpeedMultiplier }],
			"Attack/Ranged/Projectile/Spread": [{ "affects": [], "multiply": +this.template.SpreadMultiplier }]
		});
};

/**
 * Um raio: às vezes sobre uma entidade dentro da tempestade (prédios têm
 * preferência), senão num ponto aleatório.
 */
Sandstorm.prototype.Strike = function(center)
{
	const lightning = this.template.Lightning;
	const radius = +this.template.Radius;
	let point = null;

	const owner = this.GetAttackerOwner();
	const friendlyFire = !owner || this.template.FriendlyFire != "false";

	if (randBool(+lightning.TargetChance))
	{
		let targets = WeatherHelper.GetEntitiesInArea(new Vector2D(center.x, center.z), radius * 0.9, IID_Health);
		// Convocada sem fogo amigo: os raios procuram só inimigos.
		if (!friendlyFire)
		{
			const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
			targets = targets.filter(ent => {
				const targetOwner = Engine.QueryInterface(ent, IID_Ownership)?.GetOwner();
				return targetOwner !== undefined && cmpDiplomacy && cmpDiplomacy.IsEnemy(targetOwner);
			});
		}
		const structures = targets.filter(ent => Engine.QueryInterface(ent, IID_Identity)?.HasClass("Structure"));
		const pool = structures.length && randBool(0.6) ? structures : targets;
		if (pool.length)
		{
			const cmpTargetPosition = Engine.QueryInterface(pickRandom(pool), IID_Position);
			if (cmpTargetPosition && cmpTargetPosition.IsInWorld())
			{
				const pos = cmpTargetPosition.GetPosition2D();
				point = { "x": pos.x, "z": pos.y };
			}
		}
	}
	if (!point)
	{
		const angle = randFloat(0, 2 * Math.PI);
		const distance = radius * Math.sqrt(randFloat(0, 0.8));
		point = { "x": center.x + Math.sin(angle) * distance, "z": center.z + Math.cos(angle) * distance };
	}
	if (!AirSupport.IsInsideMap(point, 2))
		return;

	// O raio pisca duas vezes (mesma forma), como um raio de verdade.
	const bolt = pickRandom(String(lightning.Templates._string !== undefined ? lightning.Templates._string : lightning.Templates).trim().split(/\s+/));
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	for (const [show, hide] of this.BOLT_FLICKER)
	{
		const data = { "template": bolt, "position": point, "lifetime": (hide - show) / 1000 };
		if (show)
			cmpTimer.SetTimeout(SYSTEM_ENTITY, IID_WeatherManager, "SpawnTemplate", show, data);
		else
			Engine.QueryInterface(SYSTEM_ENTITY, IID_WeatherManager).SpawnTemplate(data);
	}

	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).SpawnEffect({
		"actor": lightning.ImpactActor,
		"position": point,
		"lifetime": +lightning.ImpactActorLifetime
	});

	if (lightning.Sound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(
			lightning.Sound, new Vector3D(point.x, 0, point.z));

	const damage = {};
	for (const type in lightning.Damage)
		damage[type] = +lightning.Damage[type];

	AttackHelper.CauseDamageOverArea({
		"type": "Ranged",
		"attackData": { "Damage": damage },
		"attacker": owner && Engine.QueryInterface(this.provider, IID_Position) ? this.provider : this.entity,
		"attackerOwner": owner,
		"origin": new Vector2D(point.x, point.z),
		"radius": +lightning.Radius,
		"shape": "Circular",
		"friendlyFire": friendlyFire
	});
};

Sandstorm.prototype.Finish = function()
{
	if (this.finished)
		return;
	this.finished = true;
	// A missão é encerrada pelo AirSupportManager, que remove esta entidade.
	if (!this.FinishMission())
		Engine.DestroyEntity(this.entity);
};

/**
 * Libera o prédio que convocou a tempestade (se for um ataque especial).
 * @return {boolean} Se havia uma missão.
 */
Sandstorm.prototype.FinishMission = function()
{
	if (!this.missionId)
		return false;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
	return true;
};

/**
 * Remove as nuvens (as partículas já emitidas terminam sozinhas) e os
 * efeitos nas unidades.
 */
Sandstorm.prototype.OnDestroy = function()
{
	for (const cloud of this.clouds)
		Engine.DestroyEntity(cloud.entity);
	this.clouds = [];

	WeatherHelper.UpdateAreaModifiers(this.GetModifierId(), this.affected, [], {});
	this.affected = [];

	this.FinishMission();
};

Engine.RegisterComponentType(IID_Sandstorm, "Sandstorm", Sandstorm);

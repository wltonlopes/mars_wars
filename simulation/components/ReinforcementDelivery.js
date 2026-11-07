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
 *
 * Paradrop: batalhões com a classe configurada (paraquedistas) não descem
 * na carga. Cada soldado salta com o próprio paraquedas, em fila ao longo da
 * rota do avião; o contêiner sai do mapa e só coordena a descida. Quando o
 * último pousa, o batalhão é criado e cada soldado ocupa o lugar onde o seu
 * paraquedista tocou o chão.
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
				"<element name='BrakeHeight' a:help='Retro-rockets fire below this height; the speed eases from FallSpeed down to BrakeSpeed at touchdown.'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='BrakeSpeed' a:help='Touchdown speed, metres per second.'><ref name='positiveDecimal'/></element>" +
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
					"<element name='DestroyGaia' a:help='Modern Wars: the blast also removes trees, bushes, rocks and mines (Gaia without Health) within Radius.'><data type='boolean'/></element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactActorName'><text/></element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactAnimationLifetime'><ref name='nonNegativeDecimal'/></element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactSound'><text/></element>" +
				"</optional>" +
				"<optional>" +
					"<element name='ImpactEffects' a:help='Modern Wars: staged effects, one child element per stage (any name), each spawning Actor after Delay seconds for Lifetime seconds (as in IcbmMissile/Warhead).'>" +
						"<oneOrMore>" +
							"<element>" +
								"<anyName/>" +
								"<interleave>" +
									"<element name='Actor'><text/></element>" +
									"<element name='Delay'><ref name='nonNegativeDecimal'/></element>" +
									"<element name='Lifetime'><ref name='positiveDecimal'/></element>" +
								"</interleave>" +
							"</element>" +
						"</oneOrMore>" +
					"</element>" +
				"</optional>" +
			"</interleave>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Paradrop' a:help='Modern Wars: battalions with this Identity class jump one soldier at a time, each on a parachute, instead of riding the cargo.'>" +
			"<interleave>" +
				"<element name='Class'><text/></element>" +
				"<element name='JumperFilter' a:help='Template filter (special/filter/NAME) that keeps only the visual components of a soldier.'><text/></element>" +
				"<element name='CanopyTemplate' a:help='Parachute that follows each jumper down.'><text/></element>" +
				"<element name='StartHeight'><ref name='positiveDecimal'/></element>" +
				"<element name='FallSpeed' a:help='Metres per second.'><ref name='positiveDecimal'/></element>" +
				"<element name='Spacing' a:help='Metres between jumpers along the flight line.'><ref name='nonNegativeDecimal'/></element>" +
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
	this.phase = "";
	// Paradrop: [{ jumper, canopy, x, z, angle, height }].
	this.jumpers = [];
};

/**
 * @param {Object} [options] - Missão avulsa (modo batalha): "standalone"
 *   (sem AirSupportManager; a cápsula se remove sozinha no fim), "rally"
 *   ({x, z}: para onde a unidade vai depois de sair) e "direction" ({x, z}:
 *   rumo do avião, para a fila dos paraquedistas).
 */
ReinforcementDelivery.prototype.StartMission = function(missionId, provider, target, battalion, options)
{
	this.missionId = missionId;
	this.provider = provider;
	this.target = target;
	this.battalion = battalion;
	this.standalone = !!(options && options.standalone);
	this.rally = options && options.rally;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	cmpPosition.JumpTo(target.x, target.z);

	if (this.IsParadrop())
		this.StartParadrop(options && options.direction);
	else if (this.template.Mode == "orbital")
	{
		this.state = "descending";
		this.height = +this.template.Descent.StartHeight;
		cmpPosition.SetHeightOffset(this.height);
		this.SetPhase("reentry");
	}
	else
		this.Arrive();
};

ReinforcementDelivery.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	if (this.state == "paradropping")
	{
		this.UpdateParadrop(msg.turnLength);
		return;
	}

	if (this.state == "descending")
	{
		const descent = this.template.Descent;
		const brakeHeight = +descent.BrakeHeight;
		const fallSpeed = +descent.FallSpeed;
		const brakeSpeed = +descent.BrakeSpeed;
		let speed = fallSpeed;
		if (this.height <= brakeHeight)
		{
			// Queima de frenagem: a velocidade cai suavemente da de queda até
			// a de pouso conforme a cápsula se aproxima do chão.
			const t = brakeHeight > 0 ? this.height / brakeHeight : 0;
			speed = brakeSpeed + (fallSpeed - brakeSpeed) * t * t;
			this.SetPhase("braking");
		}
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
 * Troca os efeitos visuais do actor (grupo "phase": reentry, braking, landed).
 * Actors sem esse grupo, como o do túnel, ignoram a troca.
 */
ReinforcementDelivery.prototype.SetPhase = function(phase)
{
	if (this.phase == phase)
		return;
	this.phase = phase;
	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SetVariant("phase", phase);
};

/**
 * Pouso da cápsula ou início da escavação do túnel.
 */
ReinforcementDelivery.prototype.Arrive = function()
{
	this.state = "deploying";
	this.SetPhase("landed");
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
		"destroyGaia": impact.DestroyGaia == "true",
		"friendlyFire": impact.FriendlyFire == "true",
		"impactSound": impact.ImpactSound || "",
		"impactActor": impact.ImpactActorName || "",
		"impactActorLifetime": +(impact.ImpactAnimationLifetime || 0),
		"impactEffects": Object.keys(impact.ImpactEffects || {}).map(stage => ({
			"actor": impact.ImpactEffects[stage].Actor,
			"delay": +impact.ImpactEffects[stage].Delay,
			"lifetime": +impact.ImpactEffects[stage].Lifetime
		}))
	});
};

/**
 * O batalhão pedido salta de paraquedas em vez de vir na carga?
 */
ReinforcementDelivery.prototype.IsParadrop = function()
{
	const paradrop = this.template.Paradrop;
	if (!paradrop || !this.battalion)
		return false;
	const template = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager).GetTemplate(this.battalion);
	return !!template && !!template.Identity && MatchesClassList(GetIdentityClasses(template.Identity), paradrop.Class);
};

/**
 * Um template por soldado, na ordem em que o BattalionLeader cria os
 * membros: o líder primeiro, depois cada MemberTemplates "template:n".
 */
ReinforcementDelivery.prototype.GetJumperTemplates = function()
{
	const templates = [this.battalion];
	const template = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager).GetTemplate(this.battalion);
	const members = template.BattalionLeader && template.BattalionLeader.MemberTemplates;
	for (const entry of String(members || "").split(/\s+/))
	{
		const parts = entry.split(":");
		if (parts.length == 2)
			for (let i = 0; i < +parts[1]; ++i)
				templates.push(parts[0]);
	}
	return templates;
};

/**
 * Cria os paraquedistas em fila ao longo do rumo do avião, centrada no alvo.
 * O primeiro da fila (o líder) saltou antes e já está mais baixo.
 */
ReinforcementDelivery.prototype.StartParadrop = function(direction)
{
	this.state = "paradropping";
	Engine.QueryInterface(this.entity, IID_Position).MoveOutOfWorld();

	const paradrop = this.template.Paradrop;
	const owner = Engine.QueryInterface(this.entity, IID_Ownership).GetOwner();
	const dir = direction ? AirSupport.Normalize(direction) : { "x": 0, "z": 1 };
	const side = { "x": dir.z, "z": -dir.x };
	const angle = Math.atan2(dir.x, dir.z);
	const templates = this.GetJumperTemplates();
	const spacing = +paradrop.Spacing;
	const first = -spacing * (templates.length - 1) / 2;

	for (let i = 0; i < templates.length; ++i)
	{
		const along = first + spacing * i;
		const lateral = randFloat(-1.5, 1.5);
		const jumper = {
			"jumper": Engine.AddLocalEntity(paradrop.JumperFilter + "|" + templates[i]),
			"canopy": Engine.AddLocalEntity(paradrop.CanopyTemplate),
			"x": this.target.x + dir.x * along + side.x * lateral,
			"z": this.target.z + dir.z * along + side.z * lateral,
			"angle": angle,
			"height": +paradrop.StartHeight + i * 2.5
		};
		for (const ent of [jumper.jumper, jumper.canopy])
		{
			const cmpPosition = ent != INVALID_ENTITY && Engine.QueryInterface(ent, IID_Position);
			if (!cmpPosition)
				continue;
			cmpPosition.JumpTo(jumper.x, jumper.z);
			cmpPosition.SetYRotation(angle);
			cmpPosition.SetHeightOffset(jumper.height);
			const cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
			if (cmpOwnership)
				cmpOwnership.SetOwner(owner);
		}
		this.jumpers.push(jumper);
	}
};

/**
 * Desce os paraquedistas; o velame some quando cada um toca o chão. Com
 * todos no chão, o batalhão de verdade toma o lugar deles.
 */
ReinforcementDelivery.prototype.UpdateParadrop = function(turnLength)
{
	const fallSpeed = +this.template.Paradrop.FallSpeed;
	let airborne = 0;
	for (const jumper of this.jumpers)
	{
		if (jumper.height <= 0)
			continue;
		// Freio de pouso nos últimos metros.
		const speed = jumper.height < 4 ? fallSpeed * 0.6 : fallSpeed;
		jumper.height = Math.max(0, jumper.height - speed * turnLength);
		for (const ent of [jumper.jumper, jumper.canopy])
		{
			const cmpPosition = Engine.QueryInterface(ent, IID_Position);
			if (cmpPosition)
				cmpPosition.SetHeightOffset(jumper.height);
		}
		if (jumper.height > 0)
			++airborne;
		else if (jumper.canopy != INVALID_ENTITY)
		{
			Engine.DestroyEntity(jumper.canopy);
			jumper.canopy = INVALID_ENTITY;
		}
	}
	if (airborne)
		return;

	const leader = this.SpawnBattalion(this.jumpers[0]);
	const cmpLeader = leader && Engine.QueryInterface(leader, IID_BattalionLeader);
	if (cmpLeader)
	{
		const members = cmpLeader.GetBattalionEntities().slice(1);
		for (let i = 0; i < members.length && i + 1 < this.jumpers.length; ++i)
		{
			const cmpPosition = Engine.QueryInterface(members[i], IID_Position);
			if (!cmpPosition)
				continue;
			cmpPosition.JumpTo(this.jumpers[i + 1].x, this.jumpers[i + 1].z);
			cmpPosition.SetYRotation(this.jumpers[i + 1].angle);
		}
	}
	this.RemoveJumpers();
	this.state = "lingering";
	this.timer = 0;
};

ReinforcementDelivery.prototype.RemoveJumpers = function()
{
	for (const jumper of this.jumpers)
		for (const ent of [jumper.jumper, jumper.canopy])
			if (ent != INVALID_ENTITY)
				Engine.DestroyEntity(ent);
	this.jumpers = [];
};

/**
 * @param {Object} [spot] - { x, z, angle }: onde o líder aparece (paradrop).
 *   Sem ele, o batalhão sai a ExitDistance do centro, do lado do prédio.
 * @return {number} O líder criado, ou INVALID_ENTITY.
 */
ReinforcementDelivery.prototype.SpawnBattalion = function(spot)
{
	const owner = Engine.QueryInterface(this.entity, IID_Ownership).GetOwner();
	if (!this.battalion || owner <= 0)
		return INVALID_ENTITY;

	const leader = Engine.AddEntity(this.battalion);
	const cmpPosition = leader != INVALID_ENTITY && Engine.QueryInterface(leader, IID_Position);
	if (!cmpPosition)
	{
		error("ReinforcementDelivery: could not create battalion '" + this.battalion + "'.");
		return INVALID_ENTITY;
	}

	// O batalhão sai do lado virado para o prédio que o chamou.
	let direction = { "x": 0, "z": -1 };
	const cmpProviderPosition = Engine.QueryInterface(this.provider, IID_Position);
	if (cmpProviderPosition && cmpProviderPosition.IsInWorld())
	{
		const home = cmpProviderPosition.GetPosition2D();
		direction = AirSupport.Normalize({ "x": home.x - this.target.x, "z": home.y - this.target.z });
	}
	const exit = spot || AirSupport.Offset(this.target, direction, +(this.template.ExitDistance || 0));

	cmpPosition.JumpTo(exit.x, exit.z);
	cmpPosition.SetYRotation(spot ? spot.angle : Math.atan2(-direction.x, -direction.z));
	// Ao receber dono, o BattalionLeader cria os membros em volta do líder.
	Engine.QueryInterface(leader, IID_Ownership).SetOwner(owner);

	if (this.rally)
		ProcessCommand(owner, {
			"type": "walk",
			"entities": [leader],
			"x": this.rally.x,
			"z": this.rally.z,
			"queued": false
		});
	return leader;
};

/**
 * Se a cápsula/túnel for removido por outro motivo, libera o prédio.
 */
ReinforcementDelivery.prototype.OnDestroy = function()
{
	this.RemoveJumpers();
	this.FinishMission();
};

ReinforcementDelivery.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	this.RemoveJumpers();
	if (this.standalone)
	{
		Engine.DestroyEntity(this.entity);
		return;
	}
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_ReinforcementDelivery, "ReinforcementDelivery", ReinforcementDelivery);

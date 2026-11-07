/**
 * Drone de reconhecimento temporário (Modern Wars): poder "recon_drone" do
 * AirSupportProvider, criado pelo AirSupportManager.
 *
 * Não usa UnitMotion/pathfinder. A rota tem três trechos:
 *   1. entra pela borda do mapa, em linha reta, já alinhado com a órbita;
 *   2. orbita o alvo em círculo (OrbitRadius) por Duration segundos;
 *   3. sai em linha reta até a borda, onde o AirSupportManager o remove.
 *
 * Quem dá a visão da área é o componente Vision do template: enquanto o
 * drone orbita, o dono enxerga tudo em volta do alvo.
 *
 * Defesa aérea (AirDefense): ao entrar no raio de uma defesa inimiga que
 * intercepte o tipo dele (MissionType: "recon_drone" por padrão), é abatido.
 * O avião de sensoriamento remoto usa "recon_aircraft", que só a defesa de
 * longo alcance intercepta: ele entra onde o drone seria derrubado.
 *
 * Patrulha de caças (poder "air_patrol", <Patrol>): a mesma rota, mas armada.
 * Enquanto orbita, a cada <Interval> ataca um alvo a até <Range> do centro da
 * órbita, nesta ordem: aeronave de apoio aéreo inimiga (bombardeiro,
 * cargueiro, drone ou avião de reconhecimento, outra patrulha), que é
 * abatida; aeronave ou helicóptero inimigo; tropa ou veículo no chão.
 * <Wingman> é um segundo caça, só visual, que voa em formação.
 *
 * Drone de ataque (poder "drone_strike"): a mesma patrulha com <GroundOnly>
 * (só alvos no chão) e <Shots> (os mísseis que leva): depois do último disparo
 * ele sai da órbita e vai embora, sem esperar o fim de <Duration>.
 */
function ReconDrone() {}

ReconDrone.prototype.Schema =
	"<a:help>Temporary reconnaissance drone: flies in, orbits the target for a while giving vision, and leaves.</a:help>" +
	"<a:example>" +
		"<Speed>30</Speed>" +
		"<FlightAltitude>60</FlightAltitude>" +
		"<OrbitRadius>35</OrbitRadius>" +
		"<Duration>60</Duration>" +
	"</a:example>" +
	"<element name='Speed' a:help='Metres per second.'><ref name='positiveDecimal'/></element>" +
	"<element name='FlightAltitude' a:help='Height above the terrain in metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='OrbitRadius' a:help='Radius of the circle flown around the target, in metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='Duration' a:help='Seconds spent orbiting the target.'><ref name='positiveDecimal'/></element>" +
	"<optional>" +
		"<element name='Patrol' a:help='Armed patrol: while orbiting, attacks enemy support aircraft, aircraft and ground units.'>" +
			"<interleave>" +
				"<element name='Range' a:help='Targets up to this far from the orbit centre, in metres.'><ref name='positiveDecimal'/></element>" +
				"<element name='Interval' a:help='Time between two shots, in milliseconds.'><data type='positiveInteger'/></element>" +
				"<element name='AirDamage' a:help='Pierce damage against aircraft units.'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='GroundDamage' a:help='Crush damage against the ground target.'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='GroundSplashDamage' a:help='Crush damage around the ground target.'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='GroundSplashRange' a:help='Radius of the splash, in metres.'><ref name='nonNegativeDecimal'/></element>" +
				"<element name='ProjectileActor'><text/></element>" +
				"<element name='ProjectileSpeed' a:help='Metres per second.'><ref name='positiveDecimal'/></element>" +
				"<element name='ImpactActor'><text/></element>" +
				"<optional><element name='LaunchSound'><text/></element></optional>" +
				"<optional><element name='ImpactSound'><text/></element></optional>" +
				"<optional><element name='GroundOnly' a:help='Only ground units: no support aircraft, no aircraft (attack drones).'><data type='boolean'/></element></optional>" +
				"<optional><element name='Shots' a:help='Leaves as soon as it has fired this many times (attack drones with a few missiles).'><data type='positiveInteger'/></element></optional>" +
			"</interleave>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Wingman' a:help='Template of a second, purely visual aircraft flying in formation.'><text/></element>" +
	"</optional>" +
	"<optional>" +
		"<element name='MissionType' a:help='Air support type this aircraft counts as for enemy air defense (AirDefense/Intercepts). Default: recon_drone. A high-flying sensor aircraft uses recon_aircraft, which fewer defenses can intercept.'>" +
			"<text/>" +
		"</element>" +
	"</optional>";

ReconDrone.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.route = null;
	// Distância percorrida desde a entrada, ao longo da rota inteira.
	this.travelled = 0;
	// { time (ms do jogo), airDefense } quando uma defesa já disparou.
	this.interception = null;
};

/**
 * @param {Object} target - { x, z } do centro da órbita.
 * @param {Object} direction - { x, z }: de onde o drone vem (do prédio para o alvo).
 * @return {number} Segundos até o drone chegar à órbita.
 */
ReconDrone.prototype.StartMission = function(missionId, provider, target, direction, margin)
{
	this.missionId = missionId;
	this.provider = provider;

	const radius = +this.template.OrbitRadius;
	const speed = +this.template.Speed;
	const dir = AirSupport.Normalize(direction);

	// Ponto da órbita (sentido anti-horário) cuja tangente é a direção de
	// chegada: o drone entra no círculo sem quebrar a rota.
	const startAngle = Math.atan2(-dir.x, dir.z);
	const orbitStart = { "x": target.x + radius * Math.cos(startAngle), "z": target.z + radius * Math.sin(startAngle) };
	const back = { "x": -dir.x, "z": -dir.z };
	const inbound = AirSupport.IsInsideMap(orbitStart, margin) ? AirSupport.DistanceToMapEdge(orbitStart, back, margin) : 0;
	const orbit = speed * +this.template.Duration;

	const endAngle = startAngle + orbit / radius;
	const orbitEnd = { "x": target.x + radius * Math.cos(endAngle), "z": target.z + radius * Math.sin(endAngle) };
	const exitDirection = { "x": -Math.sin(endAngle), "z": Math.cos(endAngle) };
	const outbound = AirSupport.IsInsideMap(orbitEnd, margin) ? AirSupport.DistanceToMapEdge(orbitEnd, exitDirection, margin) : 0;

	this.route = {
		"target": { "x": target.x, "z": target.z },
		"radius": radius,
		"entry": AirSupport.Offset(orbitStart, back, inbound),
		"direction": dir,
		"startAngle": startAngle,
		"orbitEnd": orbitEnd,
		"exitDirection": exitDirection,
		"inbound": inbound,
		"orbit": orbit,
		"length": inbound + orbit + outbound
	};

	this.Place(0);
	Engine.QueryInterface(this.entity, IID_Position).SetHeightOffset(+this.template.FlightAltitude);

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SelectAnimation("walk", false, 1);

	if (this.template.Wingman)
	{
		this.wingman = Engine.AddEntity(this.template.Wingman);
		const cmpWingOwnership = Engine.QueryInterface(this.wingman, IID_Ownership);
		if (cmpWingOwnership)
			cmpWingOwnership.SetOwner(this.GetOwner());
		this.PlaceWingman(0);
	}

	return inbound / speed;
};

/**
 * Posição e rumo `distance` metros depois da entrada.
 * @return {Object} { x, z, heading: { x, z } }
 */
ReconDrone.prototype.GetRoutePoint = function(distance)
{
	const route = this.route;
	distance = Math.max(0, Math.min(route.length, distance));
	if (distance <= route.inbound)
	{
		const point = AirSupport.Offset(route.entry, route.direction, distance);
		return { "x": point.x, "z": point.z, "heading": route.direction };
	}
	if (distance <= route.inbound + route.orbit)
	{
		const angle = route.startAngle + (distance - route.inbound) / route.radius;
		return {
			"x": route.target.x + route.radius * Math.cos(angle),
			"z": route.target.z + route.radius * Math.sin(angle),
			"heading": { "x": -Math.sin(angle), "z": Math.cos(angle) }
		};
	}
	const point = AirSupport.Offset(route.orbitEnd, route.exitDirection, distance - route.inbound - route.orbit);
	return { "x": point.x, "z": point.z, "heading": route.exitDirection };
};

ReconDrone.prototype.Place = function(distance)
{
	const point = this.GetRoutePoint(distance);
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (distance == 0)
		cmpPosition.JumpTo(point.x, point.z);
	else
		cmpPosition.MoveTo(point.x, point.z);
	cmpPosition.SetYRotation(Math.atan2(point.heading.x, point.heading.z));
	return point;
};

/** O ala voa um pouco atrás e ao lado do líder, na mesma rota. */
ReconDrone.prototype.WINGMAN_BEHIND = 16;
ReconDrone.prototype.WINGMAN_SIDE = 9;

ReconDrone.prototype.PlaceWingman = function(distance)
{
	const cmpPosition = this.wingman !== undefined && Engine.QueryInterface(this.wingman, IID_Position);
	if (!cmpPosition)
		return;
	const point = this.GetRoutePoint(distance - this.WINGMAN_BEHIND);
	const x = point.x + point.heading.z * this.WINGMAN_SIDE;
	const z = point.z - point.heading.x * this.WINGMAN_SIDE;
	if (distance == 0)
	{
		cmpPosition.JumpTo(x, z);
		cmpPosition.SetHeightOffset(+this.template.FlightAltitude - 3);
	}
	else
		cmpPosition.MoveTo(x, z);
	cmpPosition.SetYRotation(Math.atan2(point.heading.x, point.heading.z));
};

ReconDrone.prototype.RemoveWingman = function()
{
	if (this.wingman === undefined)
		return;
	Engine.DestroyEntity(this.wingman);
	delete this.wingman;
};

// ---------------------------------------------------------------- patrulha

/**
 * Um disparo da patrulha, se houver alvo a até Patrol/Range do centro da
 * órbita. Ordem: apoio aéreo inimigo, aeronaves, alvos no chão.
 */
ReconDrone.prototype.PatrolShot = function()
{
	const patrol = this.template.Patrol;
	const owner = this.GetOwner();
	const centre = this.route.target;
	const range = +patrol.Range;

	const groundOnly = patrol.GroundOnly == "true";
	const mission = !groundOnly && Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager)
		.GetEnemyAircraftMissions(owner, centre, range).find(m => m.vehicle != this.entity);
	if (mission)
	{
		this.FireAt(Engine.QueryInterface(mission.vehicle, IID_Position).GetPosition());
		this.CountShot();
		Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).MissionShotDownByFighters(mission.id, owner);
		return;
	}

	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	const enemies = cmpDiplomacy ? cmpDiplomacy.GetEnemies().filter(player => player > 0) : [];
	if (!enemies.length)
		return;
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	let air;
	let ground;
	for (const ent of cmpRangeManager.ExecuteQueryAroundPos(new Vector2D(centre.x, centre.z), 0, range, enemies, IID_Health, true))
	{
		const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIdentity || !cmpIdentity.HasClass("Unit"))
			continue;
		// Só o que o dono da patrulha enxerga (tropa camuflada escapa).
		if (cmpRangeManager.GetLosVisibility(ent, owner) != "visible")
			continue;
		if (cmpIdentity.HasClass("Aircraft"))
		{
			if (!groundOnly)
				air = air === undefined ? ent : air;
		}
		else if (ground === undefined || cmpIdentity.HasClass("Vehicle") && !Engine.QueryInterface(ground, IID_Identity).HasClass("Vehicle"))
			ground = ent;
	}

	const target = air !== undefined ? air : ground;
	if (target === undefined)
		return;
	const cmpTargetPosition = Engine.QueryInterface(target, IID_Position);
	if (!cmpTargetPosition || !cmpTargetPosition.IsInWorld())
		return;

	const position = cmpTargetPosition.GetPosition();
	const flightTime = this.FireAt(position);
	this.CountShot();
	const data = {
		"type": "Ranged",
		"attackData": { "Damage": air !== undefined ? { "Pierce": +patrol.AirDamage } : { "Crush": +patrol.GroundDamage } },
		"attacker": this.entity,
		"attackerOwner": owner,
		"target": target,
		"position": position,
		"direction": new Vector3D(0, -1, 0),
		"attackImpactSound": patrol.ImpactSound || "",
		"friendlyFire": false
	};
	if (air === undefined && +patrol.GroundSplashRange)
		data.splash = {
			"attackData": { "Damage": { "Crush": +patrol.GroundSplashDamage } },
			"friendlyFire": false,
			"radius": +patrol.GroundSplashRange,
			"shape": "Circular"
		};
	// Sem projectileId: o dano é aplicado direto no alvo (o projétil é só visual).
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(SYSTEM_ENTITY, IID_DelayedDamage, "Hit", flightTime * 1000, data);
};

/** Conta o disparo; com <Shots>, o último manda a aeronave embora. */
ReconDrone.prototype.CountShot = function()
{
	this.shotsFired = (this.shotsFired || 0) + 1;
	if (this.template.Patrol.Shots && this.shotsFired >= +this.template.Patrol.Shots)
		this.LeaveNow();
};

/**
 * Sai da órbita já: a rota passa a terminar no ponto atual da órbita e segue
 * reto, no rumo em que a aeronave está, até a borda do mapa.
 */
ReconDrone.prototype.LeaveNow = function()
{
	const route = this.route;
	if (!this.IsOnStation())
		return;
	const point = this.GetRoutePoint(this.travelled);
	route.orbit = this.travelled - route.inbound;
	route.orbitEnd = { "x": point.x, "z": point.z };
	route.exitDirection = point.heading;
	const margin = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).MAP_EDGE_MARGIN;
	route.length = this.travelled + (AirSupport.IsInsideMap(point, margin) ? AirSupport.DistanceToMapEdge(point, point.heading, margin) : 0);
};

/**
 * Projétil visual do caça até `position` (Vector3D). @return {number} Segundos de voo.
 */
ReconDrone.prototype.FireAt = function(position)
{
	const patrol = this.template.Patrol;
	const from = this.GetWorldPosition(this.travelled);
	const speed = +patrol.ProjectileSpeed;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_ProjectileManager).LaunchProjectileAtPoint(
		from, position, speed, 0, patrol.ProjectileActor, patrol.ImpactActor, 1.2);
	if (patrol.LaunchSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager)?.PlaySoundGroupAtPosition(patrol.LaunchSound, from);
	return from.distanceTo(position) / speed;
};

ReconDrone.prototype.GetWorldPosition = function(distance)
{
	const point = this.GetRoutePoint(distance);
	const ground = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(point.x, point.z);
	return new Vector3D(point.x, ground + +this.template.FlightAltitude, point.z);
};

ReconDrone.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

ReconDrone.prototype.GetOwner = function()
{
	return Engine.QueryInterface(this.entity, IID_Ownership).GetOwner();
};

/** Se o drone está orbitando o alvo (para o autoteste e para a GUI). */
ReconDrone.prototype.IsOnStation = function()
{
	return !!this.route && this.travelled >= this.route.inbound && this.travelled < this.route.inbound + this.route.orbit;
};

ReconDrone.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	this.travelled = Math.min(this.route.length, this.travelled + this.template.Speed * msg.turnLength);
	const point = this.Place(this.travelled);
	this.PlaceWingman(this.travelled);

	if (this.template.Patrol && this.IsOnStation())
	{
		this.sinceShot = (this.sinceShot || 0) + msg.turnLength * 1000;
		if (this.sinceShot >= +this.template.Patrol.Interval)
		{
			this.sinceShot = 0;
			this.PatrolShot();
			// A patrulha pode ter sido abatida no próprio disparo (duelo de caças).
			if (!this.missionId)
				return;
		}
	}

	if (this.interception)
	{
		if (this.GetTime() >= this.interception.time)
		{
			this.ShotDown();
			return;
		}
	}
	else
		this.CheckAirDefense(point);

	if (this.travelled >= this.route.length)
		this.FinishMission();
};

ReconDrone.prototype.CheckAirDefense = function(position)
{
	const airDefense = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FindAirDefense(
		this.template.MissionType || "recon_drone", this.GetOwner(), position);
	if (airDefense == INVALID_ENTITY)
		return;

	const speed = +this.template.Speed;
	const remaining = (this.route.length - this.travelled) / speed;
	const time = Engine.QueryInterface(airDefense, IID_AirDefense).Engage(
		t => this.GetWorldPosition(this.travelled + speed * t), remaining);

	this.interception = {
		"time": this.GetTime() + time * 1000,
		"airDefense": airDefense
	};
};

ReconDrone.prototype.ShotDown = function()
{
	const cmpAirDefense = Engine.QueryInterface(this.interception.airDefense, IID_AirDefense);
	// Errou, flares ou acerto que a aeronave aguenta: segue a missão, e a
	// torre (ou outra) pode disparar de novo quando recarregar.
	if (Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).ResolveInterception(this.missionId,
		cmpAirDefense ? cmpAirDefense.GetAccuracy() : 0.55, this.GetWorldPosition(this.travelled)) != "destroyed")
	{
		this.interception = null;
		return;
	}
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).MissionIntercepted(
		this.missionId, this.interception.airDefense, this.GetWorldPosition(this.travelled));
	this.FinishMission();
};

/**
 * Se o drone for removido por outro motivo, libera o prédio.
 */
ReconDrone.prototype.OnDestroy = function()
{
	this.FinishMission();
};

ReconDrone.prototype.FinishMission = function()
{
	this.RemoveWingman();
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_ReconDrone, "ReconDrone", ReconDrone);

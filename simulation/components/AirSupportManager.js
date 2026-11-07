/**
 * Gerenciador global (entidade do sistema) das missões de apoio aéreo.
 *
 * Cria o veículo (bombardeiro ou míssil), avisa o prédio quando a missão
 * termina e aplica o dano dos impactos. O dano fica aqui, e não no
 * veículo, para que bombas ainda caindo acertem mesmo depois que a
 * aeronave saiu do mapa.
 */
function AirSupportManager() {}

AirSupportManager.prototype.Schema =
	"<a:component type='system'/><empty/>";

/** Distância mantida da borda do mapa ao criar/remover a aeronave. */
AirSupportManager.prototype.MAP_EDGE_MARGIN = 8;

/** Avisos com contagem regressiva: [dono, demais jogadores e observadores]. */
AirSupportManager.prototype.LAUNCH_MESSAGES = {
	"icbm": [
		markForTranslation("Missile launched. Impact in %(time)s."),
		markForTranslation("Warning: enemy missile launch detected! Impact in %(time)s.")
	],
	"sandstorm": [
		markForTranslation("Sandstorm summoned. It dies down in %(time)s."),
		markForTranslation("Warning: the Dune Pirates summoned a sandstorm! It dies down in %(time)s.")
	],
	"hypersonic": [
		markForTranslation("Hypersonic missile launched. Impact in %(time)s."),
		markForTranslation("WARNING: Hypersonic missile incoming! Impact in %(time)s.")
	],
	"nuke": [
		markForTranslation("Nuclear strike inbound. Impact in %(time)s."),
		markForTranslation("WARNING: Nuclear missile incoming! Impact in %(time)s.")
	],
	"mine_missile": [
		markForTranslation("Fragmentation missile launched. Mines released in %(time)s."),
		markForTranslation("Warning: missile launch detected! Impact in %(time)s.")
	],
	"white_phosphorus": [
		markForTranslation("White phosphorus missile launched. Burst in %(time)s."),
		markForTranslation("WARNING: White phosphorus missile incoming! Burst in %(time)s.")
	],
	"orbital_saturation": [
		markForTranslation("Orbital saturation strike inbound. First impacts in %(time)s."),
		markForTranslation("WARNING: Orbital saturation strike detected! First impacts in %(time)s.")
	]
};

/** Avisos de interceptação: [dono do ataque, dono da defesa aérea]. */
AirSupportManager.prototype.INTERCEPT_MESSAGES = {
	"icbm": [
		markForTranslation("Your missile was shot down by enemy air defense."),
		markForTranslation("Air defense intercepted an enemy missile.")
	],
	"hypersonic": [
		markForTranslation("Your hypersonic missile was shot down by enemy air defense."),
		markForTranslation("Air defense intercepted an enemy hypersonic missile.")
	],
	"nuke": [
		markForTranslation("Your nuclear missile was shot down by enemy air defense."),
		markForTranslation("Air defense intercepted an enemy nuclear missile.")
	],
	"mine_missile": [
		markForTranslation("Your fragmentation missile was shot down by enemy air defense."),
		markForTranslation("Air defense intercepted an enemy missile.")
	],
	"white_phosphorus": [
		markForTranslation("Your white phosphorus missile was shot down by enemy air defense."),
		markForTranslation("Air defense intercepted an enemy white phosphorus missile.")
	],
	"vehicle_airdrop": [
		markForTranslation("Your transport aircraft was shot down by enemy air defense. The cargo is lost."),
		markForTranslation("Air defense shot down an enemy transport aircraft.")
	],
	"parachute_bomb": [
		markForTranslation("Your bomber aircraft was shot down by enemy air defense. The bomb is lost."),
		markForTranslation("Air defense shot down an enemy aircraft carrying a heavy bomb.")
	],
	"recon_drone": [
		markForTranslation("Your reconnaissance drone was shot down by enemy air defense."),
		markForTranslation("Air defense shot down an enemy reconnaissance drone.")
	],
	"recon_aircraft": [
		markForTranslation("Your remote sensing aircraft was shot down by enemy air defense."),
		markForTranslation("Air defense shot down an enemy remote sensing aircraft.")
	],
	"drone_strike": [
		markForTranslation("Your attack drone was shot down by enemy air defense."),
		markForTranslation("Air defense shot down an enemy attack drone.")
	],
	"air_patrol": [
		markForTranslation("Your fighter patrol was shot down by enemy air defense."),
		markForTranslation("Air defense shot down an enemy fighter patrol.")
	],
	"strategic_bomber": [
		markForTranslation("Your bomber was shot down by enemy air defense."),
		markForTranslation("Air defense shot down an enemy bomber.")
	]
};

/**
 * Raio da busca por torres de defesa aérea: maior que o alcance de
 * qualquer torre (o alcance real de cada uma é conferido depois).
 */
AirSupportManager.prototype.AIR_DEFENSE_SEARCH_RANGE = 400;

/** Componente que o template do veículo precisa ter, por tipo de missão. */
AirSupportManager.prototype.VEHICLE_INTERFACES = {
	"strategic_bomber": "IID_StrategicBomber",
	"icbm": "IID_IcbmMissile",
	"hypersonic": "IID_IcbmMissile",
	"nuke": "IID_IcbmMissile",
	"mine_missile": "IID_IcbmMissile",
	"white_phosphorus": "IID_IcbmMissile",
	"orbital_laser": "IID_OrbitalStrike",
	"orbital_saturation": "IID_OrbitalSaturation",
	"vehicle_airdrop": "IID_AirDropCarrier",
	"parachute_bomb": "IID_AirDropCarrier",
	"recon_drone": "IID_ReconDrone",
	"recon_aircraft": "IID_ReconDrone",
	"air_patrol": "IID_ReconDrone",
	"drone_strike": "IID_ReconDrone",
	"drop_pod": "IID_ReinforcementDelivery",
	"tunnel": "IID_ReinforcementDelivery",
	// Mars Wars: tempestade de areia dos Piratas (centro cívico).
	"sandstorm": "IID_Sandstorm"
};

AirSupportManager.prototype.Init = function()
{
	this.nextMissionId = 1;
	this.missions = {};
	// Destroços em queda: id -> estado (ver SpawnWreck).
	this.wrecks = {};
	this.nextWreckId = 1;
};

/**
 * @return {number} Id da missão, ou 0 em caso de falha.
 */
AirSupportManager.prototype.RequestMission = function(provider, owner, type, target, parameters)
{
	const iid = this.VEHICLE_INTERFACES[type];
	if (!iid)
		return 0;

	const entity = Engine.AddEntity(parameters.template);
	if (entity == INVALID_ENTITY)
		return 0;

	const cmpVehicle = Engine.QueryInterface(entity, global[iid]);
	const cmpOwnership = Engine.QueryInterface(entity, IID_Ownership);
	if (!cmpVehicle || !cmpOwnership)
	{
		error("AirSupportManager: template '" + parameters.template + "' needs " + iid.substr(4) + " and Ownership.");
		Engine.DestroyEntity(entity);
		return 0;
	}
	cmpOwnership.SetOwner(owner);

	const missionId = this.nextMissionId++;
	this.missions[missionId] = {
		"id": missionId,
		"provider": provider,
		"owner": owner,
		"type": type,
		"vehicle": entity
	};

	target = { "x": target.x, "z": target.z };
	if (type == "strategic_bomber")
	{
		// O bombardeiro vem da direção do prédio que pediu o ataque.
		const direction = {
			"x": target.x - parameters.origin.x,
			"z": target.z - parameters.origin.z
		};
		const path = AirSupport.CreateFlightPath(target, direction, this.MAP_EDGE_MARGIN);
		cmpVehicle.StartMission(missionId, provider, path, parameters);
	}
	else if (type == "vehicle_airdrop" || type == "parachute_bomb")
	{
		// A aeronave vem da direção do prédio que pediu a entrega.
		const direction = {
			"x": target.x - parameters.origin.x,
			"z": target.z - parameters.origin.z
		};
		const path = AirSupport.CreateFlightPath(target, direction, this.MAP_EDGE_MARGIN);
		cmpVehicle.StartMission(missionId, provider, path, target, parameters.battalion);
	}
	else if (type == "recon_drone" || type == "recon_aircraft" || type == "air_patrol" || type == "drone_strike")
	{
		// O drone vem da direção do prédio que pediu o reconhecimento.
		cmpVehicle.StartMission(missionId, provider, target, {
			"x": target.x - parameters.origin.x,
			"z": target.z - parameters.origin.z
		}, this.MAP_EDGE_MARGIN);
	}
	else if (type == "icbm" || type == "hypersonic" || type == "mine_missile" || type == "white_phosphorus")
	{
		const flightTime = cmpVehicle.StartMission(missionId, provider, parameters.origin, target);
		this.missions[missionId].notifications = this.NotifyLaunch(type, owner, flightTime);
	}
	else if (type == "nuke")
	{
		// Entra pela borda do mapa atrás do prédio que disparou, em relação ao alvo.
		const direction = {
			"x": target.x - parameters.origin.x,
			"z": target.z - parameters.origin.z
		};
		const path = AirSupport.CreateFlightPath(target, direction, this.MAP_EDGE_MARGIN);
		const flightTime = cmpVehicle.StartMission(missionId, provider, path.entry, target);
		this.missions[missionId].notifications = this.NotifyLaunch(type, owner, flightTime);
	}
	else if (type == "sandstorm")
	{
		const duration = cmpVehicle.StartMission(missionId, provider, parameters.origin, target);
		this.missions[missionId].notifications = this.NotifyLaunch(type, owner, duration);
	}
	else if (type == "orbital_laser")
		cmpVehicle.StartMission(missionId, provider, target);
	else if (type == "orbital_saturation")
	{
		const warningTime = cmpVehicle.StartMission(missionId, provider, target);
		this.missions[missionId].notifications = this.NotifyLaunch(type, owner, warningTime);
	}
	else
		cmpVehicle.StartMission(missionId, provider, target, parameters.battalion);

	return missionId;
};

/**
 * Aviso com contagem regressiva até o impacto: o dono recebe a confirmação,
 * todos os outros jogadores (e observadores, id -1) recebem o alerta.
 */
AirSupportManager.prototype.NotifyLaunch = function(type, owner, flightTime)
{
	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	const others = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNonGaiaPlayers().filter(p => p != owner);
	const [ownMessage, othersMessage] = this.LAUNCH_MESSAGES[type];

	return [
		cmpGuiInterface.AddTimeNotification({
			"players": [owner],
			"message": ownMessage,
			"translateMessage": true
		}, flightTime),
		cmpGuiInterface.AddTimeNotification({
			"players": others.concat([-1]),
			"message": othersMessage,
			"translateMessage": true
		}, flightTime)
	];
};

AirSupportManager.prototype.GetMissionType = function(missionId)
{
	const mission = this.missions[missionId];
	return mission ? mission.type : "";
};

/**
 * Torre de defesa aérea inimiga de `attacker` que cobre `position` ({x, z})
 * e abate missões do tipo `type`; a mais próxima, se houver várias.
 * @return {number} Entidade da torre, ou INVALID_ENTITY.
 */
AirSupportManager.prototype.FindAirDefense = function(type, attacker, position)
{
	const cmpDiplomacy = QueryPlayerIDInterface(attacker, IID_Diplomacy);
	const enemies = cmpDiplomacy ? cmpDiplomacy.GetEnemies().filter(player => player > 0) : [];
	if (!enemies.length)
		return INVALID_ENTITY;

	const candidates = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQueryAroundPos(
		new Vector2D(position.x, position.z), 0, this.AIR_DEFENSE_SEARCH_RANGE, enemies, IID_AirDefense, false);

	let best = INVALID_ENTITY;
	let bestDistance = Infinity;
	for (const ent of candidates)
	{
		const cmpAirDefense = Engine.QueryInterface(ent, IID_AirDefense);
		if (!cmpAirDefense.CanIntercept(type) || !cmpAirDefense.IsHostileTo(attacker) || !cmpAirDefense.IsReady())
			continue;
		const distance = cmpAirDefense.GetDistanceTo(position);
		if (distance <= cmpAirDefense.GetRange() && distance < bestDistance)
		{
			best = ent;
			bestDistance = distance;
		}
	}
	return best;
};

/** Chance de um míssil de caça (patrulha) acertar uma aeronave de apoio aéreo. */
AirSupportManager.prototype.FIGHTER_ACCURACY = 0.7;

/**
 * Um míssil (interceptador da defesa aérea ou de caça) chegou à aeronave ou
 * míssil da missão. A defesa é incerta:
 *  - "miss": errou (explode perto, sem efeito);
 *  - "flares": a aeronave soltou flares e o míssil seguiu o flare;
 *  - "damaged": acertou, mas a aeronave aguenta (AirEvasion/Hits) e segue;
 *  - "destroyed": abatida (quem chama encerra a missão).
 * @param {number} accuracy - Chance de o míssil acertar (0-1).
 * @param {Vector3D} position - Onde está o alvo.
 */
AirSupportManager.prototype.ResolveInterception = function(missionId, accuracy, position)
{
	const mission = this.missions[missionId];
	if (!mission)
		return "destroyed";
	const cmpEvasion = Engine.QueryInterface(mission.vehicle, IID_AirEvasion);
	const burst = (offset, actor, lifetime) => this.SpawnEffect({
		"actor": actor || "props/units/explosions/air_burst.xml",
		"position": { "x": position.x + offset, "z": position.z - offset },
		"height": position.y - Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(position.x, position.z),
		"lifetime": lifetime || 4
	});

	// Flares primeiro: a aeronave solta a salva ao ver o míssil chegando.
	if (cmpEvasion && cmpEvasion.HasFlares())
	{
		const decoyed = cmpEvasion.TryFlares();
		burst(0, cmpEvasion.FLARE_ACTOR, 3);
		if (decoyed)
		{
			burst(randFloat(8, 14));
			return "flares";
		}
	}
	if (randFloat(0, 1) >= accuracy)
	{
		burst(randFloat(6, 12));
		return "miss";
	}
	if (cmpEvasion && cmpEvasion.TakeHit())
	{
		burst(0);
		burst(0, cmpEvasion.DAMAGE_ACTOR, 6);
		Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).AddTimeNotification({
			"players": [mission.owner],
			"message": markForTranslation("Your aircraft was hit but is still flying."),
			"translateMessage": true
		}, 4000);
		return "damaged";
	}
	return "destroyed";
};

/**
 * A missão foi abatida pela defesa aérea: cancela a contagem regressiva e
 * avisa o atacante e o dono da torre. O veículo é removido por quem chama;
 * se for uma aeronave, um destroço cai no lugar dele.
 */
AirSupportManager.prototype.MissionIntercepted = function(missionId, airDefense, position)
{
	const mission = this.missions[missionId];
	if (!mission)
		return;

	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	for (const notification of mission.notifications || [])
		cmpGuiInterface.DeleteTimeNotification(notification);

	const cmpAirDefense = Engine.QueryInterface(airDefense, IID_AirDefense);
	if (cmpAirDefense)
		cmpAirDefense.PlayInterceptSound(position);

	if (this.AIRCRAFT_MISSIONS.indexOf(mission.type) != -1)
		this.SpawnWreck(mission.vehicle);

	const messages = this.INTERCEPT_MESSAGES[mission.type];
	if (!messages)
		return;

	cmpGuiInterface.AddTimeNotification({
		"players": [mission.owner],
		"message": messages[0],
		"translateMessage": true
	}, 6000);

	const defender = cmpAirDefense ? cmpAirDefense.GetOwner() : INVALID_PLAYER;
	if (defender > 0)
		cmpGuiInterface.AddTimeNotification({
			"players": [defender],
			"message": messages[1],
			"translateMessage": true
		}, 6000);
};

/** Missões que são aeronaves em voo: as que uma patrulha de caças pode abater. */
AirSupportManager.prototype.AIRCRAFT_MISSIONS = ["strategic_bomber", "vehicle_airdrop", "parachute_bomb", "recon_drone", "recon_aircraft", "air_patrol", "drone_strike"];

/**
 * Aeronaves de apoio aéreo dos inimigos de `player` a até `range` de
 * `position` ({x, z}): [{ id, vehicle, position: {x, z}, distance }], da mais
 * próxima à mais distante.
 */
AirSupportManager.prototype.GetEnemyAircraftMissions = function(player, position, range)
{
	const cmpDiplomacy = QueryPlayerIDInterface(player, IID_Diplomacy);
	const out = [];
	for (const id in this.missions)
	{
		const mission = this.missions[id];
		if (this.AIRCRAFT_MISSIONS.indexOf(mission.type) == -1 || !cmpDiplomacy || !cmpDiplomacy.IsEnemy(mission.owner))
			continue;
		const cmpPosition = Engine.QueryInterface(mission.vehicle, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			continue;
		const pos = cmpPosition.GetPosition2D();
		const distance = Math.euclidDistance2D(pos.x, pos.y, position.x, position.z);
		if (distance <= range)
			out.push({ "id": +id, "vehicle": mission.vehicle, "position": { "x": pos.x, "z": pos.y }, "distance": distance });
	}
	return out.sort((a, b) => a.distance - b.distance);
};

/**
 * Uma patrulha de caças de `shooter` abateu a aeronave da missão: avisa os
 * dois lados, mostra a explosão no ar e encerra a missão (a carga se perde).
 */
AirSupportManager.prototype.MissionShotDownByFighters = function(missionId, shooter)
{
	const mission = this.missions[missionId];
	if (!mission)
		return;

	const cmpTarget = Engine.QueryInterface(mission.vehicle, IID_Position);
	if (cmpTarget && cmpTarget.IsInWorld() &&
		this.ResolveInterception(missionId, this.FIGHTER_ACCURACY, cmpTarget.GetPosition()) != "destroyed")
		return;
	this.SpawnWreck(mission.vehicle);

	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	for (const notification of mission.notifications || [])
		cmpGuiInterface.DeleteTimeNotification(notification);

	const cmpPosition = Engine.QueryInterface(mission.vehicle, IID_Position);
	if (cmpPosition && cmpPosition.IsInWorld())
	{
		const pos = cmpPosition.GetPosition2D();
		this.SpawnEffect({
			"actor": "props/units/explosions/air_burst.xml",
			"position": { "x": pos.x, "z": pos.y },
			"height": cmpPosition.GetHeightOffset(),
			"lifetime": 4
		});
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager)?.PlaySoundGroupAtPosition(
			"attack/destruction/explode_debris.xml", cmpPosition.GetPosition());
	}

	cmpGuiInterface.AddTimeNotification({
		"players": [mission.owner],
		"message": markForTranslation("Your aircraft was shot down by enemy fighters."),
		"translateMessage": true
	}, 6000);
	cmpGuiInterface.AddTimeNotification({
		"players": [shooter],
		"message": markForTranslation("Your fighters shot down an enemy aircraft."),
		"translateMessage": true
	}, 6000);

	this.FinishMission(missionId);
};

// ------------------------------------------------------------- destroços
/** Queda: aceleração (m/s²), giro (graus/s) e inclinação máxima (graus). */
AirSupportManager.prototype.WRECK_GRAVITY = 16;
AirSupportManager.prototype.WRECK_SPIN = 110;
AirSupportManager.prototype.WRECK_ROLL = 70;
AirSupportManager.prototype.WRECK_STEP = 100;

/**
 * Aeronave abatida: um destroço com a mesma aparência cai girando e soltando
 * fumaça e fogo, seguindo um pouco para a frente, e explode ao bater no chão.
 * É só visual (o dano da missão acabou).
 */
AirSupportManager.prototype.SpawnWreck = function(vehicle)
{
	const cmpPosition = Engine.QueryInterface(vehicle, IID_Position);
	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const template = cmpTemplateManager.GetTemplate(cmpTemplateManager.GetCurrentTemplateName(vehicle) || "");
	const actor = template && template.VisualActor && template.VisualActor.Actor;
	if (!cmpPosition || !cmpPosition.IsInWorld() || !actor)
		return;

	const wreck = Engine.AddEntity("actor|" + actor);
	const cmpWreck = wreck != INVALID_ENTITY && Engine.QueryInterface(wreck, IID_Position);
	if (!cmpWreck)
		return;
	const pos = cmpPosition.GetPosition2D();
	const yaw = cmpPosition.GetRotation().y;
	const height = Math.max(8, cmpPosition.GetHeightOffset());
	cmpWreck.JumpTo(pos.x, pos.y);
	cmpWreck.SetHeightOffset(height);
	cmpWreck.SetYRotation(yaw);

	const trail = Engine.AddEntity("actor|particle/destruction_smoke_med.xml");
	const fire = Engine.AddEntity("actor|particle/flame_med.xml");
	for (const ent of [trail, fire])
	{
		const cmp = ent != INVALID_ENTITY && Engine.QueryInterface(ent, IID_Position);
		if (cmp)
		{
			cmp.JumpTo(pos.x, pos.y);
			cmp.SetHeightOffset(height);
		}
	}
	this.SpawnEffect({ "actor": "props/units/explosions/air_burst.xml", "position": { "x": pos.x, "z": pos.y }, "height": height, "lifetime": 4 });

	const id = this.nextWreckId++;
	this.wrecks[id] = {
		"entity": wreck, "trail": trail, "fire": fire,
		"x": pos.x, "z": pos.y, "height": height, "fall": 0,
		"yaw": yaw, "forward": 22, "roll": 0, "pitch": 0,
		"spin": randBool() ? 1 : -1
	};
	if (!this.wreckTimer)
		this.wreckTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			SYSTEM_ENTITY, IID_AirSupportManager, "UpdateWrecks", this.WRECK_STEP, this.WRECK_STEP, null);
};

AirSupportManager.prototype.UpdateWrecks = function()
{
	const dt = this.WRECK_STEP / 1000;
	for (const id in this.wrecks)
	{
		const w = this.wrecks[id];
		w.fall += this.WRECK_GRAVITY * dt;
		w.height -= w.fall * dt;
		w.forward *= 0.97;
		w.x += Math.sin(w.yaw) * w.forward * dt;
		w.z += Math.cos(w.yaw) * w.forward * dt;
		w.yaw += w.spin * this.WRECK_SPIN * Math.PI / 180 * dt;
		w.roll = Math.min(this.WRECK_ROLL, w.roll + 45 * dt);
		w.pitch = Math.min(35, w.pitch + 20 * dt);

		const ground = w.height <= 0.5;
		for (const ent of [w.entity, w.trail, w.fire])
		{
			const cmp = ent != INVALID_ENTITY && Engine.QueryInterface(ent, IID_Position);
			if (!cmp)
				continue;
			cmp.MoveTo(w.x, w.z);
			cmp.SetHeightOffset(Math.max(0, w.height));
			if (ent == w.entity)
			{
				cmp.SetYRotation(w.yaw);
				cmp.SetXZRotation(w.pitch * Math.PI / 180, w.spin * w.roll * Math.PI / 180);
			}
		}
		if (!ground)
			continue;

		// Impacto: explosão, som e fogo que ainda queima um pouco no chão.
		this.SpawnEffect({ "actor": "props/units/explosions/large_explosion.xml", "position": { "x": w.x, "z": w.z }, "lifetime": 4 });
		this.SpawnEffect({ "actor": "particle/flame_med.xml", "position": { "x": w.x, "z": w.z }, "lifetime": 10 });
		this.SpawnEffect({ "actor": "particle/destruction_smoke_med.xml", "position": { "x": w.x, "z": w.z }, "lifetime": 12 });
		const cmpSound = Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager);
		if (cmpSound)
			cmpSound.PlaySoundGroupAtPosition("attack/destruction/explode_debris.xml", new Vector3D(w.x, 0, w.z));
		for (const ent of [w.entity, w.trail, w.fire])
			if (ent != INVALID_ENTITY)
				Engine.DestroyEntity(ent);
		delete this.wrecks[id];
	}
	if (!Object.keys(this.wrecks).length && this.wreckTimer)
	{
		Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.wreckTimer);
		delete this.wreckTimer;
	}
};

AirSupportManager.prototype.FinishMission = function(missionId)
{
	const mission = this.missions[missionId];
	if (!mission)
		return;

	delete this.missions[missionId];

	if (mission.vehicle != INVALID_ENTITY)
		Engine.DestroyEntity(mission.vehicle);

	const cmpProvider = Engine.QueryInterface(mission.provider, IID_AirSupportProvider);
	if (cmpProvider)
		cmpProvider.MissionFinished(missionId);
};

/**
 * Explosão no solo: dano em área, som e, se houver, um actor de efeito
 * que é removido depois de `impactActorLifetime` segundos.
 * Chamado pelo Timer (bombas) ou diretamente (ICBM).
 */
AirSupportManager.prototype.BombImpact = function(data, lateness)
{
	if (data.impactSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(
			data.impactSound, new Vector3D(data.position.x, 0, data.position.z));

	if (data.impactActor)
		this.SpawnEffect({
			"actor": data.impactActor,
			"position": data.position,
			"height": data.height,
			"lifetime": data.impactActorLifetime || 5
		});

	// Efeitos em estágios (ex.: clarão, bola de fogo, coluna, cogumelo).
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	for (const effect of data.impactEffects || [])
	{
		const effectData = { "actor": effect.actor, "position": data.position, "lifetime": effect.lifetime };
		if (effect.delay > 0)
			cmpTimer.SetTimeout(SYSTEM_ENTITY, IID_AirSupportManager, "SpawnEffect", effect.delay * 1000, effectData);
		else
			this.SpawnEffect(effectData);
	}

	if (data.destroyGaia)
		this.DestroyGaia(data.position, data.radius);

	AttackHelper.CauseDamageOverArea({
		"type": "Ranged",
		"attackData": data.attackData,
		"attacker": data.attacker,
		"attackerOwner": data.attackerOwner,
		"origin": new Vector2D(data.position.x, data.position.z),
		"radius": data.radius,
		"shape": "Circular",
		"friendlyFire": data.friendlyFire
	});
};

/**
 * Arrasa a vegetação e as pedras no raio da explosão: entidades de Gaia sem
 * vida (árvores, arbustos, frutíferas, pedras e minas de metal, ruínas) e os
 * enfeites de mapa só de actor (capim, arbustos, rochas). Animais e prédios
 * de Gaia têm Health e ficam por conta do dano.
 */
AirSupportManager.prototype.DestroyGaia = function(position, radius)
{
	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const entities = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQueryAroundPos(
		new Vector2D(position.x, position.z), 0, radius, [0, INVALID_PLAYER], IID_Position, true);
	for (const ent of entities)
	{
		if (Engine.QueryInterface(ent, IID_Health))
			continue;
		const cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
		if (cmpOwnership && cmpOwnership.GetOwner() == 0)
		{
			if (Engine.QueryInterface(ent, IID_ResourceSupply))
				Engine.DestroyEntity(ent);
			continue;
		}
		// Enfeites sem dono: só flora e geologia, nunca os efeitos de
		// explosão (também "actor|...") que estão no mesmo lugar.
		if (this.GAIA_DECORATION.test(cmpTemplateManager.GetCurrentTemplateName(ent) || ""))
			Engine.DestroyEntity(ent);
	}
};

AirSupportManager.prototype.GAIA_DECORATION = /^actor\|(flora|geology|props\/flora)\//;

/**
 * Cria um actor de efeito no chão e o remove depois de `lifetime` segundos.
 * As partículas já emitidas continuam até o fim da própria vida.
 */
AirSupportManager.prototype.SpawnEffect = function(data)
{
	const effect = Engine.AddEntity("actor|" + data.actor);
	const cmpPosition = effect != INVALID_ENTITY && Engine.QueryInterface(effect, IID_Position);
	if (!cmpPosition)
		return;

	cmpPosition.JumpTo(data.position.x, data.position.z);
	if (data.height)
		cmpPosition.SetHeightOffset(data.height);
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
		SYSTEM_ENTITY, IID_AirSupportManager, "RemoveEffect", data.lifetime * 1000, effect);
};

/**
 * Submunição de um míssil de fragmentação que chegou ao solo (ex.: mina).
 * Chamado pelo Timer; `data`: template, owner, position {x, z}, rotation.
 */
AirSupportManager.prototype.SpawnSubmunition = function(data)
{
	const entity = Engine.AddEntity(data.template);
	if (entity == INVALID_ENTITY)
		return;

	const cmpPosition = Engine.QueryInterface(entity, IID_Position);
	if (!cmpPosition)
	{
		Engine.DestroyEntity(entity);
		return;
	}
	cmpPosition.JumpTo(data.position.x, data.position.z);
	cmpPosition.SetYRotation(data.rotation || 0);

	const cmpOwnership = Engine.QueryInterface(entity, IID_Ownership);
	if (cmpOwnership)
		cmpOwnership.SetOwner(data.owner);
};

AirSupportManager.prototype.RemoveEffect = function(entity)
{
	Engine.DestroyEntity(entity);
};

Engine.RegisterSystemComponentType(IID_AirSupportManager, "AirSupportManager", AirSupportManager);

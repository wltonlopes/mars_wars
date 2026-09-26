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
		markForTranslation("ICBM launched. Impact in %(time)s."),
		markForTranslation("Warning: ICBM launch detected! Impact in %(time)s.")
	],
	"nuke": [
		markForTranslation("Nuclear strike inbound. Impact in %(time)s."),
		markForTranslation("WARNING: Nuclear missile incoming! Impact in %(time)s.")
	]
};

/** Componente que o template do veículo precisa ter, por tipo de missão. */
AirSupportManager.prototype.VEHICLE_INTERFACES = {
	"strategic_bomber": "IID_StrategicBomber",
	"icbm": "IID_IcbmMissile",
	"nuke": "IID_IcbmMissile",
	"orbital_laser": "IID_OrbitalStrike",
	"drop_pod": "IID_ReinforcementDelivery",
	"tunnel": "IID_ReinforcementDelivery"
};

AirSupportManager.prototype.Init = function()
{
	this.nextMissionId = 1;
	this.missions = {};
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
	else if (type == "icbm")
	{
		const flightTime = cmpVehicle.StartMission(missionId, provider, parameters.origin, target);
		this.NotifyLaunch(type, owner, flightTime);
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
		this.NotifyLaunch(type, owner, flightTime);
	}
	else if (type == "orbital_laser")
		cmpVehicle.StartMission(missionId, provider, target);
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

	cmpGuiInterface.AddTimeNotification({
		"players": [owner],
		"message": ownMessage,
		"translateMessage": true
	}, flightTime);

	cmpGuiInterface.AddTimeNotification({
		"players": others.concat([-1]),
		"message": othersMessage,
		"translateMessage": true
	}, flightTime);
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
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
		SYSTEM_ENTITY, IID_AirSupportManager, "RemoveEffect", data.lifetime * 1000, effect);
};

AirSupportManager.prototype.RemoveEffect = function(entity)
{
	Engine.DestroyEntity(entity);
};

Engine.RegisterSystemComponentType(IID_AirSupportManager, "AirSupportManager", AirSupportManager);

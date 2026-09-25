/**
 * Gerenciador global (entidade do sistema) das missões de apoio aéreo.
 *
 * Cria a aeronave, avisa o prédio quando a missão termina e aplica o
 * dano das bombas. O dano fica aqui, e não no bombardeiro, para que
 * bombas ainda caindo acertem mesmo depois que a aeronave saiu do mapa.
 */
function AirSupportManager() {}

AirSupportManager.prototype.Schema =
	"<a:component type='system'/><empty/>";

/** Distância mantida da borda do mapa ao criar/remover a aeronave. */
AirSupportManager.prototype.MAP_EDGE_MARGIN = 8;

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
	if (type != "strategic_bomber")
		return 0;

	const missionId = this.nextMissionId++;
	const mission = {
		"id": missionId,
		"provider": provider,
		"owner": owner,
		"type": type,
		"target": { "x": target.x, "z": target.z },
		"parameters": parameters,
		"bomber": INVALID_ENTITY
	};
	this.missions[missionId] = mission;

	if (!this.SpawnStrategicBomber(mission))
	{
		delete this.missions[missionId];
		return 0;
	}

	return missionId;
};

AirSupportManager.prototype.SpawnStrategicBomber = function(mission)
{
	// O bombardeiro vem da direção do prédio que pediu o ataque.
	const direction = {
		"x": mission.target.x - mission.parameters.origin.x,
		"z": mission.target.z - mission.parameters.origin.z
	};
	const path = AirSupport.CreateFlightPath(mission.target, direction, this.MAP_EDGE_MARGIN);

	const entity = Engine.AddEntity(mission.parameters.template);
	if (entity == INVALID_ENTITY)
		return false;

	const cmpBomber = Engine.QueryInterface(entity, IID_StrategicBomber);
	const cmpOwnership = Engine.QueryInterface(entity, IID_Ownership);
	if (!cmpBomber || !cmpOwnership)
	{
		error("AirSupportManager: template '" + mission.parameters.template + "' needs StrategicBomber and Ownership.");
		Engine.DestroyEntity(entity);
		return false;
	}

	cmpOwnership.SetOwner(mission.owner);
	mission.bomber = entity;
	cmpBomber.StartMission(mission.id, mission.provider, path, mission.parameters);
	return true;
};

AirSupportManager.prototype.FinishMission = function(missionId)
{
	const mission = this.missions[missionId];
	if (!mission)
		return;

	delete this.missions[missionId];

	if (mission.bomber != INVALID_ENTITY)
		Engine.DestroyEntity(mission.bomber);

	const cmpProvider = Engine.QueryInterface(mission.provider, IID_AirSupportProvider);
	if (cmpProvider)
		cmpProvider.MissionFinished(missionId);
};

/**
 * Chamado pelo Timer quando uma bomba atinge o solo.
 * @param {Object} data - Montado em StrategicBomber.DropBomb.
 */
AirSupportManager.prototype.BombImpact = function(data, lateness)
{
	if (data.impactSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(
			data.impactSound, new Vector3D(data.position.x, 0, data.position.z));

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

Engine.RegisterSystemComponentType(IID_AirSupportManager, "AirSupportManager", AirSupportManager);

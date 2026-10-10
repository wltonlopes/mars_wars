/**
 * Estrategista dos jogadores controlados pela IA (entidade do sistema).
 *
 * A IA do jogo (Petra) roda fora da simulação e não conhece nada que é
 * próprio do Mars Wars. Este componente cuida, por ela, de duas coisas:
 *
 *  - Poderes de suporte especial (AirSupportProvider): escolhe o alvo de cada
 *    poder pelo valor do que ele atinge (ver POWER_PROFILES) e só dispara
 *    quando o alvo compensa; os reforços (cápsula, túnel, veículo de
 *    paraquedas) vão para a base atacada, para a frente de combate ou, sem
 *    nada disso, para casa.
 *  - Estruturas que a Petra não sabe construir (BUILD_PLANS): silos de
 *    mísseis e torres de defesa aérea; e, como rede de segurança, o primeiro
 *    quartel, a primeira garagem e as torres sentinela, se ela não os fizer.
 *  - Parques solares: são a única fonte de Energia (que toda construção
 *    custa) e só se ganham capturando. A Petra não faz isso e, sem energia,
 *    trava; aqui a infantaria ociosa é mandada capturar os parques.
 *  - Trabalhadores que a Petra deixa parados: vão coletar o recurso mais
 *    próximo.
 *
 * Um jogador da IA é atendido por vez (rodízio), para o custo ficar baixo.
 * A IA só mira no que o jogador dela enxerga: unidades visíveis e estruturas
 * já descobertas.
 */
function AIStrategist() {}

AIStrategist.prototype.Schema =
	"<a:component type='system'/><empty/>";

/** Intervalo entre dois atendimentos (um jogador por vez), em ms. */
AIStrategist.prototype.TICK_INTERVAL = 2500;
/** Nenhum poder é usado antes deste tempo de jogo, em ms. */
AIStrategist.prototype.MIN_GAME_TIME = 120000;
/** Tempo mínimo entre duas tentativas de construção do mesmo jogador, em ms. */
AIStrategist.prototype.BUILD_INTERVAL = 30000;
/** Máximo de pontos avaliados como alvo por decisão. */
AIStrategist.prototype.MAX_CANDIDATES = 36;
/** Inimigos a até esta distância de uma estrutura própria são uma ameaça. */
AIStrategist.prototype.THREAT_RANGE = 90;
/** Quantas unidades inimigas perto da base contam como ataque. */
AIStrategist.prototype.THREAT_MIN_UNITS = 3;

/**
 * Como a IA usa cada poder de ataque:
 *   radius       - raio (aproximado) do efeito, usado para pontuar o alvo
 *   minScore     - pontuação mínima para valer o disparo (ver GetValue)
 *   friendlyFire - o poder fere as próprias tropas: elas descontam em dobro
 *   structures / units - peso de estruturas e de unidades na pontuação
 */
AIStrategist.prototype.POWER_PROFILES = {
	"nuke": { "radius": 60, "minScore": 30, "friendlyFire": true, "structures": 1, "units": 1 },
	"orbital_saturation": { "radius": 70, "minScore": 25, "friendlyFire": true, "structures": 1, "units": 1 },
	"icbm": { "radius": 10, "minScore": 5, "friendlyFire": true, "structures": 1, "units": 0.3 },
	"strategic_bomber": { "radius": 25, "minScore": 8, "friendlyFire": false, "structures": 1, "units": 1 },
	"orbital_laser": { "radius": 12, "minScore": 5, "friendlyFire": false, "structures": 1.2, "units": 0.6 },
	"white_phosphorus": { "radius": 32, "minScore": 8, "friendlyFire": true, "structures": 0.3, "units": 1.5 },
	"sandstorm": { "radius": 60, "minScore": 10, "friendlyFire": false, "structures": 0.2, "units": 1.5 },
	// Minas: só contam tropas no chão; o alvo é adiantado no caminho delas.
	"mine_missile": { "radius": 32, "minScore": 6, "friendlyFire": false, "structures": 0, "units": 1, "lead": 12 }
};

/** Poderes que entregam tropas em vez de atacar. */
AIStrategist.prototype.REINFORCEMENT_POWERS = ["drop_pod", "tunnel", "vehicle_airdrop"];

/**
 * Estruturas construídas por este componente (a Petra não as conhece):
 *   template   - structures/{civ}/<template>; civs sem ele são ignoradas
 *   max        - quantas o jogador mantém
 *   minPop     - população mínima para começar a pensar nisso
 *   reserve    - o jogador precisa ter custo × reserve em recursos, para a
 *                construção não atrapalhar a economia da Petra
 */
AIStrategist.prototype.BUILD_PLANS = [
	// Rede de segurança: a Petra sabe construir estes, mas às vezes não constrói.
	{ "template": "barracks", "max": 1, "minPop": 12, "reserve": 1 },
	{ "template": "sentry_tower", "max": 2, "minPop": 25, "reserve": 1.3 },
	{ "template": "stable", "max": 1, "minPop": 35, "reserve": 1.2 },
	// A Petra não conhece estes.
	{ "template": "air_defense_tower", "max": 1, "minPop": 45, "reserve": 1.5 },
	{ "template": "silos", "max": 1, "minPop": 70, "reserve": 1.5 }
];

/** A infantaria ociosa a até esta distância de um parque solar vai capturá-lo. */
AIStrategist.prototype.CAPTURE_RANGE = 130;
/** Além disso, o parque livre mais próximo da base recebe até este tanto de unidades, de onde estiverem. */
AIStrategist.prototype.CAPTURE_PARTY = 4;
/** De quanto em quanto tempo a lista de parques solares do mapa é refeita, em ms. */
AIStrategist.prototype.PARK_REFRESH = 120000;
/** Trabalhadores parados procuram recursos a até esta distância deles. */
AIStrategist.prototype.GATHER_RANGE = 220;

AIStrategist.prototype.Init = function()
{
	this.nextPlayer = 1;
	// Por jogador: { lastBuild, nextPower }.
	this.players = {};
	// Parques solares do mapa (não são destruídos; só mudam de dono).
	this.parks = null;
	this.parksTime = 0;
	// Milissegundos desde o último atendimento. Contado em OnUpdate, e não
	// com o Timer: os componentes do sistema são criados em ordem alfabética
	// e o Timer ainda não existe quando este Init roda.
	this.sinceTick = 0;
};

AIStrategist.prototype.OnUpdate = function(msg)
{
	this.sinceTick += msg.turnLength * 1000;
	if (this.sinceTick < this.TICK_INTERVAL)
		return;
	this.sinceTick = 0;
	this.Tick();
};

AIStrategist.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

/**
 * Atende o próximo jogador da IA ainda ativo.
 */
AIStrategist.prototype.Tick = function()
{
	const numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
	for (let i = 1; i < numPlayers; ++i)
	{
		const player = this.nextPlayer;
		this.nextPlayer = this.nextPlayer + 1 < numPlayers ? this.nextPlayer + 1 : 1;

		const cmpPlayer = QueryPlayerIDInterface(player);
		if (!cmpPlayer || !cmpPlayer.IsAI() || !cmpPlayer.IsActive())
			continue;

		this.Think(player, cmpPlayer);
		return;
	}
};

AIStrategist.prototype.Think = function(player, cmpPlayer)
{
	if (!this.players[player])
		this.players[player] = { "lastBuild": 0, "nextPower": 0, "idleWorkers": [] };
	const memory = this.players[player];

	const context = this.BuildContext(player);

	// Economia primeiro: sem energia nada mais anda.
	this.CaptureSolarParks(player, context);
	this.PutIdleWorkersToWork(player, memory, context);

	if (this.GetTime() - memory.lastBuild >= this.BUILD_INTERVAL)
	{
		memory.lastBuild = this.GetTime();
		this.ManageConstruction(player, cmpPlayer, context);
	}

	if (context.enemies.length && this.GetTime() >= this.MIN_GAME_TIME)
		this.UsePowers(player, memory, context);
};

// ------------------------------------------------------------------ contexto

AIStrategist.prototype.HasClass = function(ent, className)
{
	const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
	return !!cmpIdentity && cmpIdentity.HasClass(className);
};

AIStrategist.prototype.GetPosition = function(ent)
{
	const cmpPosition = Engine.QueryInterface(ent, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return null;
	const pos = cmpPosition.GetPosition2D();
	return { "x": pos.x, "z": pos.y };
};

/**
 * O que o jogador tem e o que ele sabe do inimigo.
 */
AIStrategist.prototype.BuildContext = function(player)
{
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpDiplomacy = QueryPlayerIDInterface(player, IID_Diplomacy);
	const context = {
		"player": player,
		"enemies": cmpDiplomacy ? cmpDiplomacy.GetEnemies().filter(p => p > 0) : [],
		"friends": cmpDiplomacy ? cmpDiplomacy.GetAllies().filter(p => p > 0) : [player],
		"own": cmpRangeManager.GetEntitiesByPlayer(player),
		"providers": [],
		"structures": [],
		"centres": [],
		"army": [],
		"builders": []
	};
	if (context.friends.indexOf(player) == -1)
		context.friends.push(player);

	for (const ent of context.own)
	{
		const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIdentity)
			continue;
		if (cmpIdentity.HasClass("Structure"))
		{
			if (Engine.QueryInterface(ent, IID_Foundation))
				continue;
			context.structures.push(ent);
			if (cmpIdentity.HasClass("CivCentre"))
				context.centres.push(ent);
			if (Engine.QueryInterface(ent, IID_AirSupportProvider))
				context.providers.push(ent);
		}
		else if (cmpIdentity.HasClass("Unit"))
		{
			if (Engine.QueryInterface(ent, IID_Builder))
				context.builders.push(ent);
			else if (Engine.QueryInterface(ent, IID_Attack) && Engine.QueryInterface(ent, IID_UnitAI))
				context.army.push(ent);
		}
	}
	return context;
};

/**
 * Valor de uma entidade como alvo: { structure, unit } (um dos dois é 0).
 */
AIStrategist.prototype.GetValue = function(ent)
{
	const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
	if (!cmpIdentity)
		return { "structure": 0, "unit": 0 };

	if (cmpIdentity.HasClass("Structure"))
	{
		let value = 2;
		if (cmpIdentity.HasClass("CivCentre"))
			value = 12;
		else if (Engine.QueryInterface(ent, IID_AirSupportProvider) || Engine.QueryInterface(ent, IID_AirDefense))
			value = 6;
		else if (Engine.QueryInterface(ent, IID_Trainer) || cmpIdentity.HasClass("Defensive"))
			value = 5;
		else if (cmpIdentity.HasClass("Field"))
			value = 0.5;
		else if (cmpIdentity.HasClass("House"))
			value = 1;
		return { "structure": value, "unit": 0 };
	}

	if (!cmpIdentity.HasClass("Unit"))
		return { "structure": 0, "unit": 0 };

	let value = 1;
	if (cmpIdentity.HasClass("Siege"))
		value = 4;
	else if (cmpIdentity.HasClass("Vehicle"))
		value = 3;
	else if (cmpIdentity.HasClass("Worker"))
		value = 0.7;
	return { "structure": 0, "unit": value };
};

/**
 * O jogador sabe que a entidade está ali? Unidades precisam estar à vista;
 * estruturas bastam ter sido descobertas.
 */
AIStrategist.prototype.IsKnown = function(ent, player)
{
	const visibility = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).GetLosVisibility(ent, player);
	if (visibility == "visible")
		return true;
	return visibility == "fogged" && this.HasClass(ent, "Structure");
};

/**
 * Entidades inimigas conhecidas, com posição e valor: { ent, position, value }.
 * Calculado uma vez por atendimento.
 */
AIStrategist.prototype.GetKnownEnemies = function(context)
{
	if (context.knownEnemies)
		return context.knownEnemies;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	context.knownEnemies = [];
	for (const enemy of context.enemies)
		for (const ent of cmpRangeManager.GetEntitiesByPlayer(enemy))
		{
			if (!Engine.QueryInterface(ent, IID_Health) || !this.IsKnown(ent, context.player))
				continue;
			const position = this.GetPosition(ent);
			if (!position)
				continue;
			const value = this.GetValue(ent);
			if (value.structure || value.unit)
				context.knownEnemies.push({ "ent": ent, "position": position, "value": value });
		}
	return context.knownEnemies;
};

/**
 * Ataque à base: a estrutura própria com mais unidades inimigas por perto.
 * @return {Object|null} { structure, position, attackers: [{ent, position}] }
 */
AIStrategist.prototype.GetThreat = function(context)
{
	if (context.threat !== undefined)
		return context.threat;

	context.threat = null;
	const units = this.GetKnownEnemies(context).filter(enemy => enemy.value.unit >= 1);
	if (units.length < this.THREAT_MIN_UNITS)
		return null;

	const range2 = this.THREAT_RANGE * this.THREAT_RANGE;
	let best = 0;
	for (const structure of context.structures)
	{
		const position = this.GetPosition(structure);
		if (!position)
			continue;
		const attackers = units.filter(enemy =>
			Math.euclidDistance2DSquared(enemy.position.x, enemy.position.z, position.x, position.z) <= range2);
		if (attackers.length >= this.THREAT_MIN_UNITS && attackers.length > best)
		{
			best = attackers.length;
			context.threat = { "structure": structure, "position": position, "attackers": attackers };
		}
	}
	return context.threat;
};

AIStrategist.prototype.GetHome = function(context)
{
	const anchor = context.centres[0] || context.structures[0];
	return anchor !== undefined ? this.GetPosition(anchor) : null;
};

// ----------------------------------------------------------------- economia

/**
 * Todos os parques solares do mapa, de qualquer dono.
 */
AIStrategist.prototype.GetSolarParks = function()
{
	if (this.parks && this.GetTime() - this.parksTime < this.PARK_REFRESH)
		return this.parks;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
	this.parks = [];
	for (let owner = 0; owner < numPlayers; ++owner)
		for (const ent of cmpRangeManager.GetEntitiesByPlayer(owner))
			if (Engine.QueryInterface(ent, IID_Capturable) && this.HasClass(ent, "SolarPark"))
				this.parks.push(ent);
	this.parksTime = this.GetTime();
	return this.parks;
};

/**
 * A unidade que recebe a ordem: o líder, se ela for de um batalhão (o
 * comando de ataque é repassado aos membros).
 */
AIStrategist.prototype.GetCommandEntity = function(ent)
{
	const cmpMember = Engine.QueryInterface(ent, IID_BattalionMember);
	const leader = cmpMember ? cmpMember.GetLeader() : INVALID_ENTITY;
	return leader != INVALID_ENTITY ? leader : ent;
};

AIStrategist.prototype.IsCapturing = function(ent, target)
{
	const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
	const order = cmpUnitAI && cmpUnitAI.order;
	return !!order && order.type == "Attack" && !!order.data && order.data.target == target;
};

/**
 * Manda a infantaria ociosa capturar os parques solares que não são do
 * jogador nem de aliados:
 *  - toda unidade ociosa a até CAPTURE_RANGE de um parque vai capturá-lo;
 *  - o parque livre mais próximo da base recebe um grupo (CAPTURE_PARTY) de
 *    onde estiver, para a energia começar a entrar logo no início.
 * Quem já está ocupado (atacando, andando por ordem da Petra) não é tocado.
 */
AIStrategist.prototype.CaptureSolarParks = function(player, context)
{
	const home = this.GetHome(context);
	if (!home)
		return;

	// Infantaria que sabe capturar, com posição e se está ociosa.
	const infantry = [];
	for (const ent of context.army)
	{
		if (!this.HasClass(ent, "Infantry"))
			continue;
		const cmpAttack = Engine.QueryInterface(ent, IID_Attack);
		if (cmpAttack.GetAttackTypes().indexOf("Capture") == -1)
			continue;
		const position = this.GetPosition(ent);
		if (!position)
			continue;
		// Num batalhão, o líder também precisa estar sem ordens.
		const cmpLeaderAI = Engine.QueryInterface(this.GetCommandEntity(ent), IID_UnitAI);
		infantry.push({
			"ent": ent,
			"position": position,
			"idle": Engine.QueryInterface(ent, IID_UnitAI).IsIdle() && (!cmpLeaderAI || cmpLeaderAI.IsIdle())
		});
	}
	if (!infantry.length)
		return;

	const targets = [];
	for (const park of this.GetSolarParks())
	{
		const cmpOwnership = Engine.QueryInterface(park, IID_Ownership);
		const position = this.GetPosition(park);
		if (!cmpOwnership || !position || context.friends.indexOf(cmpOwnership.GetOwner()) != -1)
			continue;
		targets.push({
			"ent": park,
			"position": position,
			"gaia": cmpOwnership.GetOwner() == 0,
			"homeDistance": Math.euclidDistance2D(position.x, position.z, home.x, home.z)
		});
	}
	if (!targets.length)
		return;
	targets.sort((a, b) => a.homeDistance - b.homeDistance);

	const distanceTo = (unit, park) => Math.euclidDistance2D(unit.position.x, unit.position.z, park.position.x, park.position.z);
	const assigned = new Set();
	const send = (units, park) => {
		const entities = [];
		for (const unit of units)
		{
			assigned.add(unit.ent);
			const commandEntity = this.GetCommandEntity(unit.ent);
			if (entities.indexOf(commandEntity) == -1)
				entities.push(commandEntity);
		}
		if (entities.length)
			ProcessCommand(player, {
				"type": "attack",
				"entities": entities,
				"target": park.ent,
				"allowCapture": true,
				"queued": false
			});
	};

	// O parque livre (de ninguém) mais próximo da base: um grupo vai até lá.
	const nearest = targets.find(park => park.gaia);
	if (nearest)
	{
		const already = infantry.filter(unit => this.IsCapturing(unit.ent, nearest.ent)).length;
		if (already < this.CAPTURE_PARTY)
			send(infantry.filter(unit => unit.idle)
				.sort((a, b) => distanceTo(a, nearest) - distanceTo(b, nearest))
				.slice(0, this.CAPTURE_PARTY - already), nearest);
	}

	// Todos os parques perto de quem está ocioso.
	for (const park of targets)
	{
		const near = infantry.filter(unit => unit.idle && !assigned.has(unit.ent) && distanceTo(unit, park) <= this.CAPTURE_RANGE);
		if (near.length)
			send(near, park);
	}
};

/**
 * Trabalhadores parados por dois atendimentos seguidos (a Petra não lhes deu
 * o que fazer) vão coletar: o recurso disponível mais próximo, dando
 * preferência ao tipo que o jogador menos tem.
 */
AIStrategist.prototype.PutIdleWorkersToWork = function(player, memory, context)
{
	const idle = context.builders.filter(ent => {
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		return cmpUnitAI && cmpUnitAI.IsIdle() && !!Engine.QueryInterface(ent, IID_ResourceGatherer);
	});
	const stillIdle = idle.filter(ent => (memory.idleWorkers || []).indexOf(ent) != -1);
	memory.idleWorkers = idle;
	if (!stillIdle.length)
		return;

	const cmpPlayer = QueryPlayerIDInterface(player);
	const resources = cmpPlayer.GetResourceCounts();
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);

	// Quantos já foram mandados a cada fonte neste atendimento.
	const sent = new Map();
	for (const worker of stillIdle)
	{
		const position = this.GetPosition(worker);
		if (!position)
			continue;

		let best = INVALID_ENTITY;
		let bestScore = Infinity;
		for (const supply of cmpRangeManager.ExecuteQueryAroundPos(
			new Vector2D(position.x, position.z), 0, this.GATHER_RANGE, [0, player], IID_ResourceSupply, true))
		{
			const cmpSupply = Engine.QueryInterface(supply, IID_ResourceSupply);
			const supplyPosition = this.GetPosition(supply);
			if (!supplyPosition || !cmpSupply.GetCurrentAmount() || Engine.QueryInterface(supply, IID_Foundation))
				continue;
			if (cmpSupply.GetNumGatherers() + (sent.get(supply) || 0) >= cmpSupply.GetMaxGatherers())
				continue;
			const cmpGatherer = Engine.QueryInterface(worker, IID_ResourceGatherer);
			if (!cmpGatherer.GetTargetGatherRate(supply))
				continue;

			// Distância, com desconto para o recurso que está em falta.
			const type = cmpSupply.GetType().generic;
			const scarcity = Math.min(1, (resources[type] || 0) / 500);
			const distance = Math.euclidDistance2D(position.x, position.z, supplyPosition.x, supplyPosition.z);
			const score = distance * (0.4 + 0.6 * scarcity);
			if (score < bestScore)
			{
				bestScore = score;
				best = supply;
			}
		}
		if (best == INVALID_ENTITY)
			continue;

		sent.set(best, (sent.get(best) || 0) + 1);
		ProcessCommand(player, {
			"type": "gather",
			"entities": [worker],
			"target": best,
			"queued": false
		});
	}
};

// ------------------------------------------------------------------ poderes

/**
 * Usa no máximo um poder por atendimento: a decisão custa algumas consultas
 * de alcance, e um jogador humano também não dispara tudo de uma vez.
 */
AIStrategist.prototype.UsePowers = function(player, memory, context)
{
	if (this.GetTime() < memory.nextPower)
		return;

	// Lista de poderes prontos, em ordem sorteada para não viciar em um só.
	const ready = [];
	for (const provider of context.providers)
	{
		const cmpProvider = Engine.QueryInterface(provider, IID_AirSupportProvider);
		for (const status of cmpProvider.GetStatus())
			if (status.available)
				ready.push({ "provider": provider, "type": status.type });
	}

	while (ready.length)
	{
		const power = ready.splice(randIntExclusive(0, ready.length), 1)[0];
		const used = this.REINFORCEMENT_POWERS.indexOf(power.type) != -1 ?
			this.UseReinforcement(player, power, context) :
			this.UseStrike(player, power, context);
		if (used)
		{
			// Uma pausa antes do próximo, como um jogador que troca de prédio.
			memory.nextPower = this.GetTime() + randIntInclusive(4000, 12000);
			return;
		}
	}
};

/**
 * Pontuação de um ataque do tipo `profile` em `point`: valor do inimigo
 * atingido menos, com fogo amigo, o dobro do valor próprio e aliado.
 */
AIStrategist.prototype.ScoreStrike = function(point, profile, context)
{
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const origin = new Vector2D(point.x, point.z);

	let score = 0;
	for (const ent of cmpRangeManager.ExecuteQueryAroundPos(origin, 0, profile.radius, context.enemies, IID_Health, true))
	{
		const value = this.GetValue(ent);
		score += value.structure * profile.structures + value.unit * profile.units;
	}

	if (profile.friendlyFire && score > 0)
		for (const ent of cmpRangeManager.ExecuteQueryAroundPos(origin, 0, profile.radius, context.friends, IID_Health, true))
		{
			const value = this.GetValue(ent);
			score -= 2 * (value.structure + value.unit);
		}
	return score;
};

/**
 * Pontos candidatos a alvo: os inimigos conhecidos mais valiosos para o
 * perfil, limitados a MAX_CANDIDATES.
 */
AIStrategist.prototype.GetCandidates = function(profile, context)
{
	const weight = enemy => enemy.value.structure * profile.structures + enemy.value.unit * profile.units;
	return this.GetKnownEnemies(context)
		.filter(enemy => weight(enemy) > 0)
		.sort((a, b) => weight(b) - weight(a))
		.slice(0, this.MAX_CANDIDATES);
};

AIStrategist.prototype.UseStrike = function(player, power, context)
{
	const profile = this.POWER_PROFILES[power.type];
	if (!profile)
		return false;

	const cmpProvider = Engine.QueryInterface(power.provider, IID_AirSupportProvider);
	let best = null;
	let bestScore = profile.minScore;
	for (const candidate of this.GetCandidates(profile, context))
	{
		const score = this.ScoreStrike(candidate.position, profile, context);
		if (score < bestScore)
			continue;
		// Alvos sob defesa aérea inimiga (ou fora do mapa) são recusados.
		if (cmpProvider.CheckTarget(power.type, player, candidate.position, ""))
			continue;
		best = candidate.position;
		bestScore = score;
	}
	if (!best)
		return false;

	// Minas: adianta o alvo no caminho das tropas até a base.
	const home = this.GetHome(context);
	if (profile.lead && home)
	{
		const direction = AirSupport.Normalize({ "x": home.x - best.x, "z": home.z - best.z });
		const ahead = AirSupport.Offset(best, direction, profile.lead);
		if (!cmpProvider.CheckTarget(power.type, player, ahead, ""))
			best = ahead;
	}

	return cmpProvider.RequestSupport(power.type, best);
};

/**
 * Onde entregar reforços, por prioridade: a base atacada, a frente de
 * combate (tropas próprias perto de estruturas inimigas) e, por fim, casa.
 */
AIStrategist.prototype.GetReinforcementPoints = function(context)
{
	const points = [];

	const threat = this.GetThreat(context);
	if (threat)
		points.push(threat.position);

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	for (const ent of context.army.slice(0, 40))
	{
		const position = this.GetPosition(ent);
		if (!position)
			continue;
		const nearby = cmpRangeManager.ExecuteQueryAroundPos(
			new Vector2D(position.x, position.z), 0, 100, context.enemies, IID_Identity, true);
		if (nearby.some(enemy => this.HasClass(enemy, "Structure")))
		{
			points.push(position);
			break;
		}
	}

	const home = this.GetHome(context);
	if (home)
		points.push(home);
	return points;
};

AIStrategist.prototype.UseReinforcement = function(player, power, context)
{
	const cmpProvider = Engine.QueryInterface(power.provider, IID_AirSupportProvider);
	const options = cmpProvider.GetBattalionOptions(power.type);
	if (!options.length)
		return false;
	const battalion = pickRandom(options);

	for (const point of this.GetReinforcementPoints(context))
		// O ponto exato costuma estar ocupado ou perto demais do inimigo:
		// tenta em volta dele, cada vez mais longe.
		for (let attempt = 0; attempt < 6; ++attempt)
		{
			const angle = randFloat(0, 2 * Math.PI);
			const distance = 15 + attempt * 15;
			const target = {
				"x": point.x + Math.cos(angle) * distance,
				"z": point.z + Math.sin(angle) * distance
			};
			if (cmpProvider.CheckTarget(power.type, player, target, battalion))
				continue;
			if (cmpProvider.RequestSupport(power.type, target, battalion))
				return true;
		}
	return false;
};

// --------------------------------------------------------------- construção

AIStrategist.prototype.GetTemplateName = function(ent)
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager).GetCurrentTemplateName(ent);
};

AIStrategist.prototype.CanAfford = function(cmpPlayer, templateName, reserve)
{
	const template = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager).GetTemplate(templateName);
	const cost = template && template.Cost && template.Cost.Resources || {};
	const resources = cmpPlayer.GetResourceCounts();
	for (const type in cost)
		if ((resources[type] || 0) < +cost[type] * reserve)
			return false;
	return true;
};

/**
 * Os construtores do jogador mais próximos de `point`.
 */
AIStrategist.prototype.GetNearestBuilders = function(context, point, count)
{
	return context.builders
		.map(ent => ({ "ent": ent, "position": this.GetPosition(ent) }))
		.filter(builder => builder.position)
		.sort((a, b) =>
			Math.euclidDistance2DSquared(a.position.x, a.position.z, point.x, point.z) -
			Math.euclidDistance2DSquared(b.position.x, b.position.z, point.x, point.z))
		.slice(0, count)
		.map(builder => builder.ent);
};

AIStrategist.prototype.ManageConstruction = function(player, cmpPlayer, context)
{
	const home = this.GetHome(context);
	const cmpIdentity = QueryPlayerIDInterface(player, IID_Identity);
	if (!home || !cmpIdentity || !context.builders.length)
		return;

	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const civ = cmpIdentity.GetCiv();
	const ownTemplates = context.own.map(ent => this.GetTemplateName(ent));

	// Obras deste componente que ficaram sem ninguém: a Petra remaneja os
	// trabalhadores à vontade, então elas são reatribuídas aqui.
	for (let i = 0; i < context.own.length; ++i)
	{
		const cmpFoundation = Engine.QueryInterface(context.own[i], IID_Foundation);
		if (!cmpFoundation || cmpFoundation.GetNumBuilders() > 0)
			continue;
		if (!this.BUILD_PLANS.some(plan => ownTemplates[i] == "foundation|structures/" + civ + "/" + plan.template))
			continue;
		const position = this.GetPosition(context.own[i]);
		if (position)
			ProcessCommand(player, {
				"type": "repair",
				"entities": this.GetNearestBuilders(context, position, 2),
				"target": context.own[i],
				"autocontinue": true,
				"queued": false
			});
	}

	for (const plan of this.BUILD_PLANS)
	{
		const templateName = "structures/" + civ + "/" + plan.template;
		if (!cmpTemplateManager.TemplateExists(templateName))
			continue;
		if (cmpPlayer.GetPopulationCount() < plan.minPop)
			continue;
		if (ownTemplates.filter(name => name == templateName || name == "foundation|" + templateName).length >= plan.max)
			continue;
		if (!this.CanAfford(cmpPlayer, templateName, plan.reserve))
			continue;
		const cmpTechnologyManager = QueryPlayerIDInterface(player, IID_TechnologyManager);
		if (cmpTechnologyManager && !cmpTechnologyManager.CanProduce(templateName))
			continue;

		if (this.TryBuild(player, cmpPlayer, context, templateName, home))
			return;
	}
};

/**
 * Tenta alguns pontos em volta da base; TryConstructBuilding valida o
 * terreno, o território, os requisitos e os recursos, e só cobra se a obra
 * for aceita.
 */
AIStrategist.prototype.TryBuild = function(player, cmpPlayer, context, templateName, home)
{
	for (let attempt = 0; attempt < 10; ++attempt)
	{
		const angle = randFloat(0, 2 * Math.PI);
		const distance = randFloat(35, 95);
		const point = {
			"x": home.x + Math.cos(angle) * distance,
			"z": home.z + Math.sin(angle) * distance
		};
		if (!AirSupport.IsInsideMap(point, 20) || !AirSupport.IsOnLand(point))
			continue;

		const builders = this.GetNearestBuilders(context, point, 2);
		if (!builders.length)
			return false;

		if (TryConstructBuilding(player, cmpPlayer, false, {
			"type": "construct",
			"template": templateName,
			"x": point.x,
			"z": point.z,
			"angle": 3 * Math.PI / 4,
			"entities": builders,
			"autorepair": true,
			"autocontinue": true,
			"queued": false
		}))
			return true;
	}
	return false;
};

Engine.RegisterSystemComponentType(IID_AIStrategist, "AIStrategist", AIStrategist);

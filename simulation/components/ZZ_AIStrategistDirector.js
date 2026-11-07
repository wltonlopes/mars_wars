/**
 * Diretor da IA para as civs de economia própria (rfs, rpo, pmc, rup e fes).
 *
 * A Petra foi feita para coletar comida, madeira, pedra e metal. Nestas civs
 * nada é coletado (Requisição vem do Centro de Comando e dos pontos de
 * controle; Energia, dos Armazéns de Suprimentos), e ela trava: faz um
 * armazém, um quartel, uma leva de tropa e para. Este arquivo estende o
 * AIStrategist para conduzir o jogador da IA dessas civs:
 *
 *  - trabalhadores: mantém o limite cheio (o limite cresce por tecnologia);
 *  - recursos: Armazéns de Suprimentos até o limite, a infantaria ociosa
 *    captura os pontos de controle (como os parques solares do Mars Wars),
 *    e o que sobra de um recurso é trocado pelo outro no Depósito Logístico;
 *  - estruturas: uma ordem de construção por fase (BUILD_ORDER), com o que
 *    cada fase exige para a seguinte (5 estruturas de vila, 3 de cidade);
 *  - pesquisa: fases primeiro, depois o limite de trabalhadores e, com
 *    sobra de recursos, as demais tecnologias;
 *  - tropas: batalhões, veículos e aeronaves em cada estrutura que treina,
 *    respeitando a população;
 *  - ataque e defesa: junta o exército e ataca em ondas cada vez maiores;
 *    com a base atacada, chama todos de volta;
 *  - suportes especiais: além dos ataques e reforços que o AIStrategist já
 *    usa, pede o reconhecimento (RQ-900 e R-99) sobre a base inimiga e a
 *    patrulha de caças sobre a base atacada ou sobre a frente de combate.
 *
 * Uma só despesa por atendimento (pesquisa, obra ou tropa), para a ordem de
 * prioridade valer mesmo com pouco recurso.
 */
{
	/**
	 * Civs conduzidas por este diretor. Mars Wars: nenhuma, a Petra coleta
	 * os recursos das civs do mod. Valem para todas as civs só as partes de
	 * fora da condução: a captura dos pontos de controle (GetSolarParks) e o
	 * uso do reconhecimento e da patrulha aérea (UseStrike).
	 */
	AIStrategist.prototype.DIRECTED_CIVS = [];

	/**
	 * Ordem de construção: [template, quantidade]. Vale a primeira linha
	 * ainda não cumprida que o jogador pode construir e pagar; as de fase
	 * posterior ficam esperando a pesquisa. "field" é o Armazém de
	 * Suprimentos (Energia), limitado pela categoria Field do jogador.
	 */
	AIStrategist.prototype.BUILD_ORDER = [
		["field", 2], ["barracks", 1], ["storehouse", 1], ["field", 4], ["sentry_tower", 2], ["field", 6], ["stable", 1],
		// Fase 2: três estruturas de cidade liberam a fase 3.
		["range", 1], ["defense_tower", 2], ["comms_centre", 1], ["arsenal", 1], ["forge", 1], ["field", 8],
		["barracks", 2], ["at_position", 1], ["outpost", 1], ["stable", 2], ["defense_tower", 3]
	];
	/** Quartéis a mais, feitos só para subir a população, param aqui. */
	AIStrategist.prototype.MAX_BARRACKS = 4;
	/**
	 * Troca no Depósito Logístico (mercado): com menos de `low` de um recurso
	 * e mais de `high` do outro, vende `amount` do que sobra (até `max` de uma
	 * vez, quando a sobra é grande).
	 */
	AIStrategist.prototype.BARTER = { "low": 300, "high": 700, "amount": 100, "max": 500 };
	/** Folga em volta da planta do prédio, até onde procurar lugar e quantos pontos livres tentar. */
	AIStrategist.prototype.BUILD_MARGIN = 1.5;
	AIStrategist.prototype.BUILD_REACH = 170;
	AIStrategist.prototype.MAX_BUILD_TRIES = 4;
	/** Obras em andamento ao mesmo tempo. */
	AIStrategist.prototype.MAX_FOUNDATIONS = 2;
	/** População livre que um batalhão precisa (líder + 6 soldados). */
	AIStrategist.prototype.BATTALION_POPULATION = 7;
	/** Tamanho da primeira onda de ataque (batalhões + veículos) e o quanto cresce por onda. */
	AIStrategist.prototype.FIRST_WAVE = 6;
	/** Nenhuma onda de ataque antes deste tempo de jogo, em ms. */
	AIStrategist.prototype.FIRST_WAVE_TIME = 360000;
	AIStrategist.prototype.WAVE_GROWTH = 2;
	AIStrategist.prototype.MAX_WAVE = 14;
	/** Intervalo mínimo entre duas ondas e entre duas chamadas de defesa, em ms. */
	AIStrategist.prototype.WAVE_INTERVAL = 150000;
	AIStrategist.prototype.DEFENSE_INTERVAL = 20000;
	/** Poderes de reconhecimento e o intervalo mínimo entre dois pedidos, em ms. */
	AIStrategist.prototype.RECON_POWERS = ["recon_drone", "recon_aircraft"];
	AIStrategist.prototype.RECON_INTERVAL = 90000;

	const think = AIStrategist.prototype.Think;
	AIStrategist.prototype.Think = function(player, cmpPlayer)
	{
		think.call(this, player, cmpPlayer);
		const cmpIdentity = QueryPlayerIDInterface(player, IID_Identity);
		if (!cmpIdentity || this.DIRECTED_CIVS.indexOf(cmpIdentity.GetCiv()) == -1)
			return;

		const memory = this.players[player];
		const context = this.BuildContext(player);
		context.civ = cmpIdentity.GetCiv();
		context.templates = context.own.map(ent => this.GetTemplateName(ent));

		this.AssignIdleFoundations(player, context);
		this.DirectBarter(player, cmpPlayer, context);
		// Cada passo devolve true (gastou), "save" (falta dinheiro para a
		// prioridade da vez: nada menos importante gasta antes) ou false.
		const step = this.TrainWorkers(player, context) ||
			this.DirectResearch(player, cmpPlayer, context, false) ||
			this.DirectConstruction(player, cmpPlayer, context);
		// Poupando, a tropa só é treinada se o exército estiver pequeno.
		if (step === false || step == "save" && this.GetCommandGroups(context).length < this.FIRST_WAVE)
			this.DirectTraining(player, cmpPlayer, context) ||
				step === false && this.DirectResearch(player, cmpPlayer, context, true);
		this.DirectArmy(player, memory, context);
	};

	// --------------------------------------------------------- utilidades

	AIStrategist.prototype.CountTemplate = function(context, templateName)
	{
		return context.templates.filter(name => name == templateName || name == "foundation|" + templateName).length;
	};

	AIStrategist.prototype.HasEmptyQueue = function(ent)
	{
		const cmpQueue = Engine.QueryInterface(ent, IID_ProductionQueue);
		return !!cmpQueue && !cmpQueue.GetQueue().length;
	};

	AIStrategist.prototype.CanAffordCost = function(cmpPlayer, cost, reserve = 1)
	{
		const resources = cmpPlayer.GetResourceCounts();
		for (const type in cost)
			if ((resources[type] || 0) < +cost[type] * reserve)
				return false;
		return true;
	};

	/** Unidades que recebem ordens: líderes de batalhão e veículos, sem repetição. */
	AIStrategist.prototype.GetCommandGroups = function(context)
	{
		const groups = [];
		for (const ent of context.army)
		{
			if (this.HasClass(ent, "Support") || Engine.QueryInterface(ent, IID_ReconDrone))
				continue;
			// As torres dos blindados vão com o casco.
			const cmpTurretable = Engine.QueryInterface(ent, IID_Turretable);
			if (cmpTurretable && cmpTurretable.HolderID() != INVALID_ENTITY)
				continue;
			const commandEntity = this.GetCommandEntity(ent);
			if (groups.indexOf(commandEntity) == -1 && this.GetPosition(commandEntity))
				groups.push(commandEntity);
		}
		return groups;
	};

	// ------------------------------------------------------ trabalhadores

	AIStrategist.prototype.TrainWorkers = function(player, context)
	{
		const cmpEntityLimits = QueryPlayerIDInterface(player, IID_EntityLimits);
		const template = "units/" + context.civ + "/support_worker";
		if (!cmpEntityLimits || !context.centres.length)
			return false;
		const limit = cmpEntityLimits.GetLimits().Worker;
		if (limit === undefined || (cmpEntityLimits.GetCounts().Worker || 0) >= limit)
			return false;
		const centre = context.centres.find(ent => this.HasEmptyQueue(ent));
		if (centre === undefined)
			return false;
		ProcessCommand(player, { "type": "train", "entities": [centre], "template": template, "count": 1 });
		return true;
	};

	/** Obras sem ninguém: a Petra remaneja os trabalhadores à vontade. */
	AIStrategist.prototype.AssignIdleFoundations = function(player, context)
	{
		for (const ent of context.own)
		{
			const cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
			if (!cmpFoundation || cmpFoundation.GetNumBuilders() > 0)
				continue;
			const position = this.GetPosition(ent);
			const builders = position ? this.GetNearestBuilders(context, position, 2) : [];
			if (builders.length)
				ProcessCommand(player, {
					"type": "repair",
					"entities": builders,
					"target": ent,
					"autocontinue": true,
					"queued": false
				});
		}
	};

	// ------------------------------------------------------------- trocas

	/**
	 * Requisição e Energia entram em ritmos diferentes conforme a fase do
	 * jogo; o que sobra de uma vira a outra no Depósito Logístico.
	 */
	AIStrategist.prototype.DirectBarter = function(player, cmpPlayer, context)
	{
		if (!context.structures.some(ent => this.HasClass(ent, "Barter")))
			return;
		const resources = cmpPlayer.GetResourceCounts();
		for (const [buy, sell] of [["requisition", "energy"], ["energy", "requisition"]])
			if (resources[buy] < this.BARTER.low && resources[sell] > this.BARTER.high)
			{
				// O jogo só aceita trocas de 100 ou de 500 (o lote); o lote, só com sobra grande.
				ProcessCommand(player, { "type": "barter", "sell": sell, "buy": buy,
					"amount": resources[sell] > 3 * this.BARTER.max ? this.BARTER.max : this.BARTER.amount });
				return;
			}
	};

	// ---------------------------------------------------------- pesquisa

	/**
	 * Fases e limite de trabalhadores primeiro (`extras` = false). As demais
	 * só com folga: o dobro do custo em caixa.
	 */
	AIStrategist.prototype.DirectResearch = function(player, cmpPlayer, context, extras)
	{
		const cmpTechnologyManager = QueryPlayerIDInterface(player, IID_TechnologyManager);
		if (!cmpTechnologyManager)
			return false;
		const priority = tech => tech.indexOf("phase_") == 0 ? 0 : tech.indexOf("worker_limit") == 0 ? 1 : 2;

		for (const ent of context.structures)
		{
			const cmpResearcher = Engine.QueryInterface(ent, IID_Researcher);
			if (!cmpResearcher || !this.HasEmptyQueue(ent))
				continue;
			const techs = cmpResearcher.GetTechnologiesList()
				.filter(tech => typeof tech == "string" && (priority(tech) < 2) != extras)
				.sort((a, b) => priority(a) - priority(b));
			for (const tech of techs)
			{
				if (!cmpTechnologyManager.CanResearch(tech) || cmpTechnologyManager.IsTechnologyQueued(tech) ||
					cmpTechnologyManager.IsInProgress(tech))
					continue;
				const template = TechnologyTemplates.Get(tech);
				if (!template)
					continue;
				if (!this.CanAffordCost(cmpPlayer, template.cost || {}, extras ? 2 : 1))
				{
					// Fase liberada e sem dinheiro: poupa para ela.
					if (priority(tech) == 0)
						return "save";
					continue;
				}
				ProcessCommand(player, { "type": "research", "entity": ent, "template": tech });
				return true;
			}
		}
		return false;
	};

	// -------------------------------------------------------- construção

	AIStrategist.prototype.DirectConstruction = function(player, cmpPlayer, context)
	{
		const home = this.GetHome(context);
		if (!home || !context.builders.length)
			return false;
		if (context.own.filter(ent => Engine.QueryInterface(ent, IID_Foundation)).length >= this.MAX_FOUNDATIONS)
			return false;

		const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
		const cmpTechnologyManager = QueryPlayerIDInterface(player, IID_TechnologyManager);
		const cmpEntityLimits = QueryPlayerIDInterface(player, IID_EntityLimits);
		const limits = cmpEntityLimits ? cmpEntityLimits.GetLimits() : {};
		const counts = cmpEntityLimits ? cmpEntityLimits.GetCounts() : {};

		const order = this.BUILD_ORDER.slice();
		// População no teto: mais um quartel (cada um dá +20).
		if (cmpPlayer.GetPopulationLimit() - cmpPlayer.GetPopulationCount() < this.BATTALION_POPULATION &&
			cmpPlayer.GetPopulationLimit() < cmpPlayer.GetMaxPopulation())
			order.unshift(["barracks", Math.min(this.MAX_BARRACKS, this.CountTemplate(context, "structures/" + context.civ + "/barracks") + 1)]);

		for (const [name, wanted] of order)
		{
			const templateName = "structures/" + context.civ + "/" + name;
			if (!cmpTemplateManager.TemplateExists(templateName) || this.CountTemplate(context, templateName) >= wanted)
				continue;
			if (cmpTechnologyManager && !cmpTechnologyManager.CanProduce(templateName))
				continue;
			const template = cmpTemplateManager.GetTemplate(templateName);
			const category = template.BuildRestrictions && template.BuildRestrictions.Category;
			if (category && limits[category] !== undefined && (counts[category] || 0) >= limits[category])
				continue;
			// A primeira linha em aberto espera o dinheiro: nada mais barato passa na frente.
			if (!this.CanAfford(cmpPlayer, templateName, 1))
				return "save";
			// Sem lugar para esta (o hangar é enorme): a obra seguinte da
			// lista não fica presa atrás dela.
			if (this.TryBuildAround(player, cmpPlayer, context, templateName, home))
				return true;
		}
		return false;
	};

	/**
	 * Como TryBuild, com mais tentativas e mais longe de casa: as estruturas
	 * desta civ são grandes e a base enche depressa.
	 */
	AIStrategist.prototype.TryBuildAround = function(player, cmpPlayer, context, templateName, home)
	{
		const builders = this.GetNearestBuilders(context, home, 2);
		if (!builders.length)
			return false;
		// Só os pontos com o terreno livre (FindBuildSites) são tentados de
		// verdade: cada tentativa recusada cria e destrói uma obra de teste.
		let tries = 0;
		for (const point of this.FindBuildSites(context, templateName, home))
		{
			if (TryConstructBuilding(player, cmpPlayer, false, {
				"type": "construct",
				"template": templateName,
				"x": point.x,
				"z": point.z,
				"angle": point.angle,
				"entities": builders,
				"autorepair": true,
				"autocontinue": true,
				"queued": false
			}))
				return true;
			if (++tries >= this.MAX_BUILD_TRIES)
				break;
		}
		if (tries)
			return false;

		// Nenhum ponto passou no teste (ele é cauteloso: conta a planta com
		// folga): algumas tentativas ao acaso, que o jogo valida com a planta exata.
		const centres = context.centres.map(ent => this.GetPosition(ent)).filter(position => position);
		for (let attempt = 0; attempt < this.MAX_BUILD_TRIES * 2; ++attempt)
		{
			const around = centres.length ? pickRandom(centres) : home;
			const angle = randFloat(0, 2 * Math.PI);
			const distance = randFloat(45, this.BUILD_REACH);
			const point = { "x": around.x + Math.cos(angle) * distance, "z": around.z + Math.sin(angle) * distance };
			if (!AirSupport.IsInsideMap(point, 25) || !AirSupport.IsOnLand(point))
				continue;
			if (TryConstructBuilding(player, cmpPlayer, false, {
				"type": "construct",
				"template": templateName,
				"x": point.x,
				"z": point.z,
				"angle": pickRandom([0, Math.PI / 2, Math.PI, -Math.PI / 2]),
				"entities": builders,
				"autorepair": true,
				"autocontinue": true,
				"queued": false
			}))
				return true;
		}
		return false;
	};

	/**
	 * Pontos onde a estrutura cabe, do mais perto ao mais longe de um Centro
	 * de Comando do jogador: { x, z, angle }. Varre anéis em volta de cada
	 * centro e, em cada ponto, testa a planta do prédio (retângulo, de frente
	 * ou de lado) contra o que há em volta: árvores, minas, estruturas e
	 * obras. Em mapa de floresta, é isso que acha a clareira para um prédio
	 * grande como o hangar.
	 */
	AIStrategist.prototype.FindBuildSites = function(context, templateName, home)
	{
		const template = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager).GetTemplate(templateName);
		const square = template.Footprint && template.Footprint.Square;
		const width = (square ? +square["@width"] : 16) + 2 * this.BUILD_MARGIN;
		const depth = (square ? +square["@depth"] : 16) + 2 * this.BUILD_MARGIN;
		const reach = Math.hypot(width, depth) / 2;
		const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
		const numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
		const owners = [];
		for (let owner = 0; owner < numPlayers; ++owner)
			owners.push(owner);

		// O que impede a obra em volta de `point`: { x, z, size } relativos a ele.
		const blockers = point =>
		{
			const out = [];
			// + 40: o centro de uma estrutura vizinha grande fica longe da borda dela.
			for (const ent of cmpRangeManager.ExecuteQueryAroundPos(new Vector2D(point.x, point.z), 0, reach + 40, owners, IID_Obstruction, true))
			{
				if (Engine.QueryInterface(ent, IID_UnitAI))
					continue;
				const structure = this.HasClass(ent, "Structure") || !!Engine.QueryInterface(ent, IID_Foundation);
				if (!structure && !Engine.QueryInterface(ent, IID_ResourceSupply))
					continue;
				const position = this.GetPosition(ent);
				if (!position)
					continue;
				let size = 1.5;
				const cmpFootprint = structure && Engine.QueryInterface(ent, IID_Footprint);
				const shape = cmpFootprint && cmpFootprint.GetShape();
				if (shape)
					size = shape.type == "circle" ? shape.radius : Math.hypot(shape.width, shape.depth) / 2;
				out.push({ "x": position.x - point.x, "z": position.z - point.z, "size": size });
			}
			return out;
		};
		const fits = (around, w, d) => !around.some(b => Math.abs(b.x) < w / 2 + b.size && Math.abs(b.z) < d / 2 + b.size);

		const centres = context.centres.map(ent => this.GetPosition(ent)).filter(position => position);
		if (!centres.length)
			centres.push(home);
		const sites = [];
		for (const centre of centres)
			for (let distance = reach + 30; distance <= this.BUILD_REACH && sites.length < this.MAX_BUILD_TRIES; distance += 12)
			{
				const steps = Math.max(8, Math.round(2 * Math.PI * distance / 24));
				const turn = randFloat(0, 2 * Math.PI);
				for (let step = 0; step < steps; ++step)
				{
					const angle = turn + 2 * Math.PI * step / steps;
					const point = { "x": centre.x + Math.cos(angle) * distance, "z": centre.z + Math.sin(angle) * distance, "distance": distance };
					if (!AirSupport.IsInsideMap(point, reach) || !AirSupport.IsOnLand(point))
						continue;
					const around = blockers(point);
					// De frente (largura em X) ou de lado (largura em Z), virado para fora da base.
					const outX = point.x - centre.x;
					const outZ = point.z - centre.z;
					if (fits(around, width, depth))
						point.angle = outZ >= 0 ? 0 : Math.PI;
					else if (fits(around, depth, width))
						point.angle = outX >= 0 ? Math.PI / 2 : -Math.PI / 2;
					else
						continue;
					sites.push(point);
				}
			}
		return sites.sort((a, b) => a.distance - b.distance);
	};

	// ------------------------------------------------------------ tropas

	AIStrategist.prototype.DirectTraining = function(player, cmpPlayer, context)
	{
		const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
		const cmpTechnologyManager = QueryPlayerIDInterface(player, IID_TechnologyManager);
		const free = cmpPlayer.GetPopulationLimit() - cmpPlayer.GetPopulationCount();

		// Estruturas em ordem sorteada, para o exército sair misturado.
		const trainers = context.structures.filter(ent => Engine.QueryInterface(ent, IID_Trainer) && this.HasEmptyQueue(ent));
		while (trainers.length)
		{
			const ent = trainers.splice(randIntExclusive(0, trainers.length), 1)[0];
			const options = [];
			for (const templateName of Engine.QueryInterface(ent, IID_Trainer).GetEntitiesList())
			{
				const template = cmpTemplateManager.GetTemplate(templateName);
				if (!template || !template.Attack || !template.Cost || template.BattalionMember)
					continue;
				if (cmpTechnologyManager && !cmpTechnologyManager.CanProduce(templateName))
					continue;
				const population = +(template.Cost.Population || 1);
				if (population > free || !this.CanAfford(cmpPlayer, templateName, 1))
					continue;
				options.push(templateName);
			}
			if (!options.length)
				continue;
			ProcessCommand(player, { "type": "train", "entities": [ent], "template": pickRandom(options), "count": 1 });
			return true;
		}
		return false;
	};

	// ---------------------------------------------------- pontos de controle

	// Os pontos de controle rendem Requisição: entram na mesma rotina que
	// manda a infantaria ociosa capturar os parques solares.
	const getSolarParks = AIStrategist.prototype.GetSolarParks;
	AIStrategist.prototype.GetSolarParks = function()
	{
		const refresh = !this.parks || this.GetTime() - this.parksTime >= this.PARK_REFRESH;
		const parks = getSolarParks.call(this);
		if (!refresh)
			return parks;
		const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
		const numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
		for (let owner = 0; owner < numPlayers; ++owner)
			for (const ent of cmpRangeManager.GetEntitiesByPlayer(owner))
				if (Engine.QueryInterface(ent, IID_Capturable) && this.HasClass(ent, "ControlPoint") && parks.indexOf(ent) == -1)
					parks.push(ent);
		return parks;
	};

	// ----------------------------------------------------- ataque e defesa

	/**
	 * Onde atacar: a estrutura inimiga conhecida mais próxima de casa; sem
	 * nenhuma conhecida, o Centro de Comando inimigo (onde se espera achá-lo).
	 */
	AIStrategist.prototype.GetAttackTarget = function(context)
	{
		const home = this.GetHome(context);
		if (!home)
			return null;
		const distance = position => Math.euclidDistance2DSquared(position.x, position.z, home.x, home.z);
		const known = this.GetKnownEnemies(context).filter(enemy => enemy.value.structure > 0)
			.sort((a, b) => distance(a.position) - distance(b.position));
		if (known.length)
			return known[0].position;
		return this.GetEnemyBase(context);
	};

	AIStrategist.prototype.GetEnemyBase = function(context)
	{
		const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
		let fallback = null;
		for (const enemy of context.enemies)
		{
			const cmpEnemy = QueryPlayerIDInterface(enemy);
			if (!cmpEnemy || !cmpEnemy.IsActive())
				continue;
			for (const ent of cmpRangeManager.GetEntitiesByPlayer(enemy))
			{
				if (!this.HasClass(ent, "Structure"))
					continue;
				const position = this.GetPosition(ent);
				if (position && this.HasClass(ent, "CivCentre"))
					return position;
				fallback = fallback || position;
			}
		}
		return fallback;
	};

	AIStrategist.prototype.SendArmy = function(player, groups, target)
	{
		ProcessCommand(player, {
			"type": "attack-walk",
			"entities": groups,
			"x": target.x,
			"z": target.z,
			"targetClasses": { "attack": ["Unit", "Structure"] },
			"allowCapture": false,
			"queued": false
		});
	};

	AIStrategist.prototype.DirectArmy = function(player, memory, context)
	{
		const now = this.GetTime();
		const groups = this.GetCommandGroups(context);
		if (!groups.length)
			return;

		// Base atacada: todo mundo volta.
		const threat = this.GetThreat(context);
		if (threat)
		{
			if (now >= (memory.nextDefense || 0))
			{
				memory.nextDefense = now + this.DEFENSE_INTERVAL;
				this.SendArmy(player, groups, threat.position);
			}
			return;
		}

		if (now < Math.max(memory.nextWave || 0, this.FIRST_WAVE_TIME))
			return;
		const size = Math.min(this.MAX_WAVE, this.FIRST_WAVE + this.WAVE_GROWTH * (memory.waves || 0));
		if (groups.length < size)
			return;
		const target = this.GetAttackTarget(context);
		if (!target)
			return;
		memory.nextWave = now + this.WAVE_INTERVAL;
		memory.waves = (memory.waves || 0) + 1;
		this.SendArmy(player, groups, target);
	};

	// --------------------------------------------------- suportes especiais

	const count = function(strategist, player, type)
	{
		const memory = strategist.players[player];
		memory.powersUsed = memory.powersUsed || {};
		memory.powersUsed[type] = (memory.powersUsed[type] || 0) + 1;
	};

	const useStrike = AIStrategist.prototype.UseStrike;
	AIStrategist.prototype.UseStrike = function(player, power, context)
	{
		const mission = power.mission || power.type;
		const used = this.RECON_POWERS.indexOf(mission) != -1 ? this.UseRecon(player, power, context) :
			mission == "air_patrol" || mission == "drone_strike" ? this.UsePatrol(player, power, context) :
			useStrike.call(this, player, power, context);
		if (used)
			count(this, player, power.type);
		return used;
	};

	const useReinforcement = AIStrategist.prototype.UseReinforcement;
	AIStrategist.prototype.UseReinforcement = function(player, power, context)
	{
		const used = useReinforcement.call(this, player, power, context);
		if (used)
			count(this, player, power.type);
		return used;
	};

	/**
	 * Patrulha de caças: sobre a base, se ela está sendo atacada; senão,
	 * sobre a frente de combate (tropas próprias perto de estruturas inimigas).
	 * Sem nenhum dos dois, fica guardada.
	 */
	AIStrategist.prototype.UsePatrol = function(player, power, context)
	{
		const points = this.GetReinforcementPoints(context);
		// O último ponto é sempre "casa": só vale com a base sob ataque.
		if (!this.GetThreat(context))
			points.pop();
		const cmpProvider = Engine.QueryInterface(power.provider, IID_AirSupportProvider);
		for (const point of points)
			if (!cmpProvider.CheckTarget(power.type, player, point, "") && cmpProvider.RequestSupport(power.type, point))
				return true;
		return false;
	};

	/**
	 * Reconhecimento: sobre a base inimiga, para os ataques terem o que mirar.
	 * A defesa aérea inimiga pode recusar o alvo (o RQ-900 é abatido fácil);
	 * nesse caso tenta em volta, cada vez mais longe.
	 */
	AIStrategist.prototype.UseRecon = function(player, power, context)
	{
		const memory = this.players[player];
		if (this.GetTime() < (memory.nextRecon || 0))
			return false;
		const base = this.GetEnemyBase(context);
		if (!base)
			return false;
		const cmpProvider = Engine.QueryInterface(power.provider, IID_AirSupportProvider);
		for (let attempt = 0; attempt < 6; ++attempt)
		{
			const angle = randFloat(0, 2 * Math.PI);
			const target = { "x": base.x + Math.cos(angle) * attempt * 25, "z": base.z + Math.sin(angle) * attempt * 25 };
			if (cmpProvider.CheckTarget(power.type, player, target, ""))
				continue;
			if (cmpProvider.RequestSupport(power.type, target))
			{
				memory.nextRecon = this.GetTime() + this.RECON_INTERVAL;
				return true;
			}
		}
		return false;
	};
}

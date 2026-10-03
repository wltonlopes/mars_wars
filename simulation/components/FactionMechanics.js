/**
 * Mecânicas exclusivas das facções (Legião de Ares, Piratas, Coalizão e
 * Enxame), lidas de simulation/data/factions/{civ}.json:
 *
 * - Doutrina: modificadores permanentes da facção (ex.: armadura pesada de
 *   Ares, velocidade dos Piratas, custo alto da Coalizão), aplicados ao
 *   jogador no começo da partida.
 * - Ímpeto de Ares: abates enchem um medidor (0-100); cada nível dá
 *   armadura, dano e velocidade às tropas. Sem combate, o ímpeto cai.
 * - Saque pirata: veículos e estruturas inimigos destruídos perto de tropas
 *   piratas viram recursos para os piratas.
 *
 * Cadeia de Comando (Coalizão) e Coesão (Enxame) são auras das unidades
 * (simulation/data/auras/factions/).
 */
function FactionMechanics() {}

FactionMechanics.prototype.Schema = "<a:component type='system'/><empty/>";

FactionMechanics.prototype.FactionPath = "simulation/data/factions/";
/** Intervalo de atualização do Ímpeto (ms). */
FactionMechanics.prototype.TickInterval = 3000;

FactionMechanics.prototype.Init = function()
{
	this.initialised = false;
	this.elapsed = 0;
	// Ímpeto por jogador: { value, level, lastKills, lastKillTime }
	this.momentum = {};
};

FactionMechanics.prototype.GetFactionData = function(civ)
{
	if (!this.factionData)
		this.factionData = {};
	if (!(civ in this.factionData))
	{
		const path = this.FactionPath + civ + ".json";
		this.factionData[civ] = Engine.FileExists(path) ? Engine.ReadJSONFile(path) : null;
	}
	return this.factionData[civ];
};

FactionMechanics.prototype.GetCiv = function(playerID)
{
	return QueryPlayerIDInterface(playerID, IID_Identity)?.GetCiv();
};

FactionMechanics.prototype.ApplyModifiers = function(name, playerID, groups)
{
	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	const playerEnt = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetPlayerByID(playerID);
	cmpModifiersManager.RemoveAllModifiers(name, playerEnt);
	for (let i = 0; i < groups.length; ++i)
	{
		const derived = DeriveModificationsFromTech({
			"affects": groups[i].affects,
			"modifications": groups[i].modifications
		});
		cmpModifiersManager.AddModifiers(name + "/" + i, derived, playerEnt);
	}
};

/**
 * Doutrinas: aplicadas uma vez, quando a partida começa.
 */
FactionMechanics.prototype.Initialise = function()
{
	this.initialised = true;
	const numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
	for (let playerID = 1; playerID < numPlayers; ++playerID)
	{
		const data = this.GetFactionData(this.GetCiv(playerID));
		if (!data)
			continue;
		if (data.Doctrine)
			this.ApplyModifiers("faction_doctrine", playerID, data.Doctrine);
		if (data.Momentum)
			this.momentum[playerID] = { "value": 0, "level": 0, "lastKills": this.GetKills(playerID), "lastKillTime": 0 };
	}
};

FactionMechanics.prototype.OnUpdate = function(msg)
{
	if (!this.initialised)
		this.Initialise();

	this.elapsed += msg.turnLength * 1000;
	if (this.elapsed < this.TickInterval)
		return;
	this.elapsed = 0;

	for (const playerID in this.momentum)
		this.UpdateMomentum(+playerID);
};

// ------------------------------------------------ Ímpeto de Ares

/** Valor (em recursos) de tudo que o jogador já destruiu do inimigo. */
FactionMechanics.prototype.GetKills = function(playerID)
{
	const cmpStatistics = QueryPlayerIDInterface(playerID, IID_StatisticsTracker);
	if (!cmpStatistics)
		return 0;
	return (cmpStatistics.enemyUnitsKilledValue || 0) + (cmpStatistics.enemyBuildingsDestroyedValue || 0);
};

FactionMechanics.prototype.UpdateMomentum = function(playerID)
{
	const state = this.momentum[playerID];
	const config = this.GetFactionData(this.GetCiv(playerID))?.Momentum;
	const cmpPlayer = QueryPlayerIDInterface(playerID);
	if (!state || !config || !cmpPlayer || cmpPlayer.GetState() != "active")
		return;

	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	const kills = this.GetKills(playerID);
	const destroyed = kills - state.lastKills;
	state.lastKills = kills;

	if (destroyed > 0)
	{
		state.value += destroyed / config.ValuePerPoint;
		state.lastKillTime = now;
	}
	else if (now - state.lastKillTime > config.DecayDelay * 1000)
		state.value -= config.Decay;
	state.value = Math.max(0, Math.min(config.Max, state.value));

	const level = Math.floor(state.value / config.LevelSize);
	if (level == state.level)
		return;

	const rising = level > state.level;
	state.level = level;
	this.ApplyModifiers("ares_momentum", playerID, level ? [this.GetMomentumModifiers(level)] : []);

	Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).PushNotification({
		"type": "text",
		"players": [playerID],
		"message": rising ?
			markForTranslation("Ares' Momentum rises to level %(level)s: your troops fight harder.") :
			markForTranslation("Ares' Momentum falls to level %(level)s. Keep the offensive going!"),
		"parameters": { "level": level },
		"translateMessage": true
	});
};

/** Cada nível: +1 de armadura, +6% de dano e +3% de velocidade. */
FactionMechanics.prototype.GetMomentumModifiers = function(level)
{
	const modifications = [
		{ "value": "UnitMotion/WalkSpeed", "multiply": 1 + 0.03 * level }
	];
	for (const type of ["Hack", "Pierce", "Crush"])
		modifications.push({ "value": "Resistance/Entity/Damage/" + type, "add": level });
	for (const attack of ["Melee", "Ranged"])
		for (const type of ["Hack", "Pierce", "Crush", "Fire"])
			modifications.push({ "value": "Attack/" + attack + "/Damage/" + type, "multiply": 1 + 0.06 * level });
	return { "affects": ["Soldier", "Vehicle"], "modifications": modifications };
};

FactionMechanics.prototype.GetMomentum = function(playerID)
{
	const state = this.momentum[playerID];
	return state ? { "value": state.value, "level": state.level } : undefined;
};

// ------------------------------------------------ Saque pirata

FactionMechanics.prototype.OnGlobalOwnershipChanged = function(msg)
{
	// Só entidades destruídas (dono passa a ser -1) de jogadores de verdade.
	if (msg.to != INVALID_PLAYER || msg.from <= 0)
		return;

	const cmpIdentity = Engine.QueryInterface(msg.entity, IID_Identity);
	const cmpPosition = Engine.QueryInterface(msg.entity, IID_Position);
	const cmpCost = Engine.QueryInterface(msg.entity, IID_Cost);
	if (!cmpIdentity || !cmpCost || !cmpPosition || !cmpPosition.IsInWorld() ||
		Engine.QueryInterface(msg.entity, IID_Foundation))
		return;

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const position = cmpPosition.GetPosition2D();
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	for (let playerID = 1; playerID < cmpPlayerManager.GetNumPlayers(); ++playerID)
	{
		const loot = this.GetFactionData(this.GetCiv(playerID))?.Loot;
		if (!loot || playerID == msg.from || !QueryPlayerIDInterface(playerID, IID_Diplomacy)?.IsEnemy(msg.from))
			continue;
		if (!loot.Classes.some(cls => cmpIdentity.HasClass(cls)))
			continue;

		const looters = cmpRangeManager.ExecuteQueryAroundPos(position, 0, loot.Range, [playerID], IID_UnitAI, false);
		if (!looters.length)
			continue;

		// Sem custo em recursos (alguns veículos do mod): vale um tanto fixo
		// por população, em água e materiais.
		let costs = cmpCost.GetResourceCosts();
		if (!Object.keys(costs).some(type => costs[type] > 0))
		{
			const pop = Math.max(1, cmpCost.GetPopCost());
			costs = { "metal": loot.FallbackPerPop * pop, "stone": loot.FallbackPerPop * pop };
		}
		const gained = {};
		let total = 0;
		for (const type in costs)
		{
			const amount = Math.round(costs[type] * loot.Share);
			if (amount > 0)
			{
				gained[type] = amount;
				total += amount;
			}
		}
		if (!total)
			continue;

		QueryPlayerIDInterface(playerID).AddResources(gained);
		Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).PushNotification({
			"type": "text",
			"players": [playerID],
			"message": markForTranslation("Loot! %(amount)s resources salvaged from the wreck."),
			"parameters": { "amount": total },
			"translateMessage": true
		});
	}
};

Engine.RegisterSystemComponentType(IID_FactionMechanics, "FactionMechanics", FactionMechanics);

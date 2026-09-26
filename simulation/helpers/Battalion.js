/**
 * Número de estruturas BattalionBarracks de cada jogador, calculado no
 * máximo uma vez por turno (a capacidade de todos os batalhões depende
 * disso, e contar exige percorrer todas as entidades do jogador).
 * O cache é só um derivado do estado atual, indexado pelo tempo do turno,
 * então não precisa ser serializado.
 */
var g_BattalionBarracksCache = { "time": -1, "counts": {} };

function CountBattalionBarracks(owner)
{
	const time = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	if (g_BattalionBarracksCache.time != time)
		g_BattalionBarracksCache = { "time": time, "counts": {} };

	const counts = g_BattalionBarracksCache.counts;
	if (counts[owner] === undefined)
	{
		let barracks = 0;
		const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
		for (const ent of cmpRangeManager.GetEntitiesByPlayer(owner))
			if (Engine.QueryInterface(ent, IID_Identity)?.HasClass("BattalionBarracks"))
				++barracks;
		counts[owner] = barracks;
	}
	return counts[owner];
}

Engine.RegisterGlobal("CountBattalionBarracks", CountBattalionBarracks);

/**
 * Multiplicador do dano de área recebido por um soldado de batalhão
 * (postura "cobertura" reduz). 1 para quem não é de batalhão.
 */
function GetBattalionSplashMultiplier(ent)
{
	let leader = ent;
	const cmpMember = Engine.QueryInterface(ent, IID_BattalionMember);
	if (cmpMember && cmpMember.GetLeader() != INVALID_ENTITY)
		leader = cmpMember.GetLeader();

	const cmpTactics = Engine.QueryInterface(leader, IID_BattalionTactics);
	return cmpTactics ? cmpTactics.GetSplashDamageMultiplier() : 1;
}

Engine.RegisterGlobal("GetBattalionSplashMultiplier", GetBattalionSplashMultiplier);

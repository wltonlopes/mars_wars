/**
 * Funções comuns dos eventos de clima (DustDevil, Sandstorm).
 */
function WeatherHelperClass() {}

/**
 * Entidades de qualquer jogador (inclusive gaia) com o componente `iid`
 * dentro do círculo.
 * @param {Vector2D} center
 */
WeatherHelperClass.prototype.GetEntitiesInArea = function(center, radius, iid)
{
	const players = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetAllPlayers();
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQueryAroundPos(
		center, 0, radius, players, iid, false);
};

WeatherHelperClass.prototype.GetUnitsInArea = function(center, radius)
{
	return this.GetEntitiesInArea(center, radius, IID_UnitMotion);
};

/**
 * Mantém `modifiers` (id `modifierId`) só nas entidades de `current`:
 * aplica nas que entraram e remove das que saíram.
 * @return {number[]} `current`, para ser guardado como o novo `previous`.
 */
WeatherHelperClass.prototype.UpdateAreaModifiers = function(modifierId, previous, current, modifiers)
{
	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	const now = new Set(current);
	const before = new Set(previous);

	for (const ent of previous)
		if (!now.has(ent))
			cmpModifiersManager.RemoveAllModifiers(modifierId, ent);

	for (const ent of current)
		if (!before.has(ent))
			cmpModifiersManager.AddModifiers(modifierId, modifiers, ent);

	return current;
};

/**
 * Ponto aleatório em terra dentro do mapa, a `margin` metros da borda.
 */
WeatherHelperClass.prototype.RandomLandPoint = function(margin)
{
	const size = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetMapSize();
	for (let i = 0; i < 30; ++i)
	{
		const point = { "x": randFloat(margin, size - margin), "z": randFloat(margin, size - margin) };
		if (AirSupport.IsInsideMap(point, margin) && AirSupport.IsOnLand(point))
			return point;
	}
	return { "x": size / 2, "z": size / 2 };
};

Engine.RegisterGlobal("WeatherHelper", new WeatherHelperClass());

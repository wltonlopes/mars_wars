/**
 * Cálculos comuns do sistema de apoio aéreo.
 * Todos os pontos são objetos { x, z } em coordenadas do mundo.
 */
function AirSupportHelper() {}

AirSupportHelper.prototype.Normalize = function(vector)
{
	const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
	if (length <= 0.0001)
		return { "x": 1, "z": 0 };

	return { "x": vector.x / length, "z": vector.z / length };
};

AirSupportHelper.prototype.Offset = function(position, direction, distance)
{
	return {
		"x": position.x + direction.x * distance,
		"z": position.z + direction.z * distance
	};
};

/**
 * Distância, a partir de `position` e seguindo `direction`, até a borda
 * do mapa (menos `margin`). Funciona para mapas quadrados e circulares.
 */
AirSupportHelper.prototype.DistanceToMapEdge = function(position, direction, margin)
{
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const mapSize = cmpTerrain.GetMapSize();

	if (cmpRangeManager.GetLosCircular())
	{
		const center = mapSize / 2;
		const radius = Math.max(0, center - margin);
		const px = position.x - center;
		const pz = position.z - center;
		const b = px * direction.x + pz * direction.z;
		const c = px * px + pz * pz - radius * radius;
		return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
	}

	let distance = Infinity;
	for (const axis of ["x", "z"])
	{
		if (direction[axis] > 0.0001)
			distance = Math.min(distance, (mapSize - margin - position[axis]) / direction[axis]);
		else if (direction[axis] < -0.0001)
			distance = Math.min(distance, (margin - position[axis]) / direction[axis]);
	}
	return Math.max(0, distance);
};

/**
 * Rota reta de borda a borda do mapa passando pelo alvo.
 * @return {Object} { entry, exit, direction, targetDistance, length }
 *   targetDistance = distância da entrada até o alvo ao longo da rota.
 */
AirSupportHelper.prototype.CreateFlightPath = function(target, direction, margin)
{
	direction = this.Normalize(direction);
	const back = { "x": -direction.x, "z": -direction.z };

	const entryDistance = this.DistanceToMapEdge(target, back, margin);
	const exitDistance = this.DistanceToMapEdge(target, direction, margin);

	return {
		"entry": this.Offset(target, back, entryDistance),
		"exit": this.Offset(target, direction, exitDistance),
		"direction": direction,
		"targetDistance": entryDistance,
		"length": entryDistance + exitDistance
	};
};

Engine.RegisterGlobal("AirSupport", new AirSupportHelper());

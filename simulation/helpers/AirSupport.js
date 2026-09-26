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

/**
 * Se o ponto está dentro da área jogável do mapa (quadrado ou circular).
 */
AirSupportHelper.prototype.IsInsideMap = function(point, margin)
{
	const mapSize = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetMapSize();
	if (Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).GetLosCircular())
		return Math.hypot(point.x - mapSize / 2, point.z - mapSize / 2) <= mapSize / 2 - margin;

	return point.x >= margin && point.z >= margin && point.x <= mapSize - margin && point.z <= mapSize - margin;
};

/**
 * Se o ponto está em terra firme (acima do nível da água).
 */
AirSupportHelper.prototype.IsOnLand = function(point)
{
	const ground = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(point.x, point.z);
	const cmpWaterManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager);
	return !cmpWaterManager || ground > cmpWaterManager.GetWaterLevel(point.x, point.z);
};

/**
 * População total de um batalhão (líder + membros), lida dos templates
 * do mesmo jeito que BattalionLeader.GetMemberTemplateCounts.
 */
AirSupportHelper.prototype.GetBattalionPopCost = function(templateName)
{
	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const popOf = name => {
		const template = cmpTemplateManager.GetTemplate(name);
		return template && template.Cost ? +(template.Cost.Population || 0) : 0;
	};

	const leader = cmpTemplateManager.GetTemplate(templateName);
	if (!leader)
		return 0;

	let total = popOf(templateName);
	const battalion = leader.BattalionLeader;
	if (!battalion)
		return total;

	const members = [];
	for (const entry of String(battalion.MemberTemplates || "").split(/\s+/))
	{
		const parts = entry.split(":");
		if (parts.length == 2 && +parts[1])
			members.push({ "template": parts[0], "count": +parts[1] });
	}
	if (!members.length)
		members.push({ "template": templateName.replace("battalion_", "battalion_member_"), "count": +(battalion.Size || 20) - 1 });

	for (const member of members)
		total += popOf(member.template) * member.count;
	return total;
};

Engine.RegisterGlobal("AirSupport", new AirSupportHelper());

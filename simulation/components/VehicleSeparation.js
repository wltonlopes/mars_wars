/**
 * Impede que veículos terrestres entrem uns nos outros.
 * O "pushing" do motor é suave demais para cascos de 10-20 m, então a cada
 * intervalo o veículo procura outros veículos dentro da soma dos raios e se
 * afasta em passos pequenos (metade da sobreposição para cada lado), sem
 * subir penhascos, entrar na água ou sair do mapa.
 */
function VehicleSeparation() {}

VehicleSeparation.prototype.Schema =
	"<a:help>Keeps land vehicles from overlapping each other.</a:help>" +
	"<element name='Radius' a:help='Approximate hull radius, in metres.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='Interval' a:help='Check interval, in milliseconds.'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>";

/** Maior raio usado por qualquer veículo (alcance da busca). */
VehicleSeparation.prototype.MAX_RADIUS = 8;
/** Deslocamento máximo por passo, em metros. */
VehicleSeparation.prototype.MAX_STEP = 0.9;
/** Inclinação máxima aceita para o passo (igual à classe "vehicle"). */
VehicleSeparation.prototype.MAX_SLOPE = 1.0;

VehicleSeparation.prototype.Init = function()
{
	this.radius = +this.template.Radius;
};

VehicleSeparation.prototype.GetRadius = function()
{
	return this.radius;
};

VehicleSeparation.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	if (!this.timer)
	{
		const interval = +(this.template.Interval || 200);
		// Desfasado pelo id para não processar todos no mesmo turno.
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			this.entity, IID_VehicleSeparation, "Tick", interval + this.entity % 5 * 40, interval, null);
	}
};

VehicleSeparation.prototype.StopTimer = function()
{
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

VehicleSeparation.prototype.OnDestroy = function()
{
	this.StopTimer();
};

VehicleSeparation.prototype.Tick = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld() || cmpPosition.GetTurretParent() != INVALID_ENTITY)
		return;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const players = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetAllPlayers();
	const near = cmpRangeManager.ExecuteQuery(this.entity, 0, this.radius + this.MAX_RADIUS,
		players, IID_VehicleSeparation, false);
	if (!near.length)
		return;

	const pos = cmpPosition.GetPosition2D();
	let dx = 0;
	let dz = 0;
	for (const other of near)
	{
		const cmpOtherPos = Engine.QueryInterface(other, IID_Position);
		if (!cmpOtherPos || !cmpOtherPos.IsInWorld() || cmpOtherPos.GetTurretParent() != INVALID_ENTITY)
			continue;
		const minDist = this.radius + Engine.QueryInterface(other, IID_VehicleSeparation).GetRadius();
		const otherPos = cmpOtherPos.GetPosition2D();
		let vx = pos.x - otherPos.x;
		let vz = pos.y - otherPos.y;
		let dist = Math.sqrt(vx * vx + vz * vz);
		if (dist >= minDist)
			continue;
		if (dist < 0.01)
		{
			// Exatamente no mesmo lugar: direção determinística pelo id.
			const angle = (this.entity - other) * 2.3999;
			vx = Math.sin(angle);
			vz = Math.cos(angle);
			dist = 1;
		}
		const push = (minDist - Math.max(dist, 0.01)) / 2;
		dx += vx / dist * push;
		dz += vz / dist * push;
	}

	const len = Math.sqrt(dx * dx + dz * dz);
	if (len < 0.05)
		return;
	if (len > this.MAX_STEP)
	{
		dx *= this.MAX_STEP / len;
		dz *= this.MAX_STEP / len;
	}
	this.TryStep(cmpPosition, pos, dx, dz) ||
		this.TryStep(cmpPosition, pos, dx / 2, dz / 2);
};

/** Move se o destino for terreno válido (sem penhasco, água ou borda). */
VehicleSeparation.prototype.TryStep = function(cmpPosition, pos, dx, dz)
{
	const x = pos.x + dx;
	const z = pos.y + dz;
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const mapSize = cmpTerrain.GetMapSize();
	if (x < 8 || z < 8 || x > mapSize - 8 || z > mapSize - 8)
		return false;

	const h0 = cmpTerrain.GetGroundLevel(pos.x, pos.y);
	const h1 = cmpTerrain.GetGroundLevel(x, z);
	const step = Math.sqrt(dx * dx + dz * dz);
	if (Math.abs(h1 - h0) > step * this.MAX_SLOPE)
		return false;

	const cmpWaterManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager);
	if (cmpWaterManager && cmpWaterManager.GetWaterLevel(x, z) - h1 > 1)
		return false;

	cmpPosition.MoveTo(x, z);
	return true;
};

Engine.RegisterComponentType(IID_VehicleSeparation, "VehicleSeparation", VehicleSeparation);

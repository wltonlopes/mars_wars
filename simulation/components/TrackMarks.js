/**
 * Rastro de veículo no solo. A cada "Spacing" metros percorridos deixa um
 * decal em cada linha de rodas (offset lateral tirado dos props w_01/w_02 do
 * modelo), alinhado com a direção do movimento. Os decals são entidades locais
 * (puramente visuais, como cadáveres): esmaecem e somem após "Lifetime" s.
 */
function TrackMarks() {}

TrackMarks.prototype.Schema =
	"<a:help>Leaves temporary ground marks behind a moving land vehicle.</a:help>" +
	"<element name='Template' a:help='Mark entity template (created as a local entity).'>" +
		"<text/>" +
	"</element>" +
	"<element name='Offset' a:help='Lateral distance of each wheel line (props w_01/w_02) from the centre, in metres.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='Spacing' a:help='Distance between marks, in metres.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='Lifetime' a:help='Seconds a mark stays on the ground.'>" +
			"<ref name='positiveDecimal'/>" +
		"</element>" +
	"</optional>";

TrackMarks.prototype.INTERVAL = 250;
/** Limite de marcas vivas por veículo (segurança). */
TrackMarks.prototype.MAX_MARKS = 120;

TrackMarks.prototype.Init = function()
{
	this.marks = [];
};

// As marcas são entidades locais: ficam fora do estado sincronizado.
TrackMarks.prototype.Serialize = function()
{
	return { "timer": this.timer, "lastX": this.lastX, "lastZ": this.lastZ };
};

TrackMarks.prototype.Deserialize = function(data)
{
	this.timer = data.timer;
	this.lastX = data.lastX;
	this.lastZ = data.lastZ;
	this.marks = [];
};

TrackMarks.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	if (!this.timer)
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			this.entity, IID_TrackMarks, "Tick", this.INTERVAL, this.INTERVAL, null);
};

TrackMarks.prototype.StopTimer = function()
{
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

TrackMarks.prototype.OnDestroy = function()
{
	// As marcas já deixadas continuam e o Decay delas as remove.
	this.StopTimer();
};

TrackMarks.prototype.Tick = function()
{
	this.AgeMarks();

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld() || cmpPosition.GetTurretParent() != INVALID_ENTITY)
	{
		delete this.lastX;
		return;
	}

	const pos = cmpPosition.GetPosition2D();
	const spacing = +this.template.Spacing;
	if (this.lastX === undefined)
	{
		this.lastX = pos.x;
		this.lastZ = pos.y;
		return;
	}

	const dx = pos.x - this.lastX;
	const dz = pos.y - this.lastZ;
	const dist = Math.sqrt(dx * dx + dz * dz);
	// Teleporte (drop pod, desembarque...): recomeça sem rastro.
	if (dist > spacing * 6)
	{
		this.lastX = pos.x;
		this.lastZ = pos.y;
		return;
	}
	if (dist < spacing)
		return;

	const ux = dx / dist;
	const uz = dz / dist;
	const angle = Math.atan2(dx, dz);
	const count = Math.floor(dist / spacing);
	for (let i = 0; i < count; ++i)
	{
		const cx = this.lastX + ux * spacing * (i + 0.5);
		const cz = this.lastZ + uz * spacing * (i + 0.5);
		this.PlaceMarks(cx, cz, angle, ux, uz);
	}
	this.lastX += ux * spacing * count;
	this.lastZ += uz * spacing * count;
};

TrackMarks.prototype.PlaceMarks = function(cx, cz, angle, ux, uz)
{
	const offset = +this.template.Offset;
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const cmpWaterManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager);
	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	// Perpendicular à direção: as duas linhas de rodas (w_01 e w_02).
	for (const side of offset ? [1, -1] : [0])
	{
		const x = cx + uz * offset * side;
		const z = cz - ux * offset * side;
		if (cmpWaterManager && cmpWaterManager.GetWaterLevel(x, z) > cmpTerrain.GetGroundLevel(x, z))
			continue;
		const mark = Engine.AddLocalEntity(this.template.Template);
		const cmpMarkPosition = Engine.QueryInterface(mark, IID_Position);
		if (!cmpMarkPosition)
		{
			Engine.DestroyEntity(mark);
			continue;
		}
		cmpMarkPosition.JumpTo(x, z);
		cmpMarkPosition.SetYRotation(angle);
		this.marks.push({ "entity": mark, "time": now, "stage": 0 });
	}
	while (this.marks.length > this.MAX_MARKS)
		this.RemoveMark(this.marks.shift());
};

/** Esmaece (fresh -> mid -> old) e remove as marcas antigas. */
TrackMarks.prototype.AgeMarks = function()
{
	if (!this.marks.length)
		return;
	const lifetime = +(this.template.Lifetime || 10) * 1000;
	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	while (this.marks.length && now - this.marks[0].time >= lifetime)
		this.RemoveMark(this.marks.shift());
	for (const mark of this.marks)
	{
		const stage = now - mark.time >= lifetime * 0.75 ? 2 : now - mark.time >= lifetime * 0.45 ? 1 : 0;
		if (stage == mark.stage)
			continue;
		mark.stage = stage;
		Engine.QueryInterface(mark.entity, IID_Visual)?.SetVariant("track", stage == 2 ? "old" : "mid");
	}
};

TrackMarks.prototype.RemoveMark = function(mark)
{
	// Pode já ter sido removida pelo Decay.
	if (Engine.QueryInterface(mark.entity, IID_Position))
		Engine.DestroyEntity(mark.entity);
};

Engine.RegisterComponentType(IID_TrackMarks, "TrackMarks", TrackMarks);

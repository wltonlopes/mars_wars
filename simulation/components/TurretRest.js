/**
 * Torreta montada em veículo: sem alvo, gira suavemente de volta para a
 * frente do veículo (a rotação da torreta é absoluta, então sem isto ela
 * ficava apontada para o último alvo enquanto o casco virava).
 */
function TurretRest() {}

TurretRest.prototype.Schema =
	"<a:help>Turret on a vehicle: when it has no target it turns back to the holder's front.</a:help>" +
	"<optional>" +
		"<element name='Offset' a:help='Degrees added to the holder heading (for models facing another way).'>" +
			"<data type='decimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Interval' a:help='Check interval, in milliseconds.'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>";

TurretRest.prototype.Init = function()
{
	this.offset = +(this.template?.Offset || 0) * Math.PI / 180;
};

TurretRest.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	if (!this.timer)
	{
		const interval = +(this.template?.Interval || 400);
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			this.entity, IID_TurretRest, "Tick", interval, interval, null);
	}
};

TurretRest.prototype.StopTimer = function()
{
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

TurretRest.prototype.OnDestroy = function()
{
	this.StopTimer();
};

/** A torreta está mirando ou atirando em algo? */
TurretRest.prototype.IsEngaged = function()
{
	const cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
	if (cmpAttack && cmpAttack.target)
		return true;
	const state = Engine.QueryInterface(this.entity, IID_UnitAI)?.GetCurrentState() || "";
	return state.indexOf("COMBAT") != -1;
};

TurretRest.prototype.Tick = function()
{
	const holder = Engine.QueryInterface(this.entity, IID_Turretable)?.HolderID();
	if (!holder || holder == INVALID_ENTITY || this.IsEngaged())
		return;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpHolderPosition = Engine.QueryInterface(holder, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpHolderPosition || !cmpHolderPosition.IsInWorld())
		return;

	const desired = cmpHolderPosition.GetRotation().y + this.offset;
	const current = cmpPosition.GetRotation().y;
	const diff = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
	if (Math.abs(diff) > 0.03)
		cmpPosition.TurnTo(desired);
};

Engine.RegisterComponentType(IID_TurretRest, "TurretRest", TurretRest);

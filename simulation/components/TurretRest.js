/**
 * Torreta montada em veículo: sem alvo, gira suavemente de volta para a
 * frente do veículo (a rotação da torreta é absoluta, então sem isto ela
 * ficava apontada para o último alvo enquanto o casco virava).
 *
 * Modern Wars: sem alvo, a torreta também toca a animação "walk" enquanto o
 * veículo anda e "idle" quando ele para. É o que faz o atirador da
 * metralhadora do LMV (um prop do actor da torre) se segurar com o veículo
 * em movimento e voltar à posição de tiro parado. Atirando, vale a animação
 * de ataque do UnitAI.
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
	if (!holder || holder == INVALID_ENTITY)
		return;
	if (this.IsEngaged())
	{
		// O UnitAI troca a animação ao atirar: a próxima volta é refeita.
		delete this.animation;
		return;
	}

	const cmpHolderMotion = Engine.QueryInterface(holder, IID_UnitMotion);
	const moving = !!cmpHolderMotion && (cmpHolderMotion.IsMoveRequested() || cmpHolderMotion.GetCurrentSpeed() > 0);
	const animation = moving ? "walk" : "idle";
	if (animation != this.animation)
	{
		Engine.QueryInterface(this.entity, IID_Visual)?.SelectAnimation(animation, false, 1);
		this.animation = animation;
	}

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

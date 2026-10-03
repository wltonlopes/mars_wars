/**
 * Som de motor dos veículos: enquanto o veículo anda, toca trechos curtos de
 * motor (que se sobrepõem um pouco, soando contínuos), posicionados no
 * veículo.
 */
function VehicleSound() {}

VehicleSound.prototype.Schema =
	"<a:help>Engine sound played while the vehicle moves.</a:help>" +
	"<element name='MoveSound' a:help='Sound group, relative to audio/.'>" +
		"<text/>" +
	"</element>" +
	"<optional>" +
		"<element name='Interval' a:help='Time between clips while moving, in milliseconds (a bit shorter than the clip).'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>";

VehicleSound.prototype.Init = function()
{
};

VehicleSound.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	if (!this.timer)
	{
		const interval = +(this.template.Interval || 1300);
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			this.entity, IID_VehicleSound, "Tick", interval, interval, null);
	}
};

VehicleSound.prototype.StopTimer = function()
{
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

VehicleSound.prototype.OnDestroy = function()
{
	this.StopTimer();
};

VehicleSound.prototype.Tick = function()
{
	const cmpUnitMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpUnitMotion || !cmpPosition || !cmpPosition.IsInWorld() || !cmpUnitMotion.IsMoveRequested())
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager)?.PlaySoundGroup(this.template.MoveSound, this.entity);
};

Engine.RegisterComponentType(IID_VehicleSound, "VehicleSound", VehicleSound);

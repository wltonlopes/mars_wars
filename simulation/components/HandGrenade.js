/**
 * Granada de mão do fuzileiro granadeiro.
 *
 * O soldado carrega <Count> granadas (uma). Ele continua atirando com o fuzil;
 * quando o alvo entra no alcance de <Attack><Grenade>, o disparo seguinte é o
 * arremesso (Attack.prototype.TryThrowGrenade). Depois disso a granada volta:
 *   - sozinha, <RechargeTime> depois (2 minutos), em qualquer lugar; ou
 *   - em <Resupply><Time>, se o soldado estiver a até <Resupply><Range> de uma
 *     estrutura própria das classes <Resupply><Classes> (Centro de Comando,
 *     Quartel).
 */
function HandGrenade() {}

HandGrenade.prototype.Schema =
	"<a:help>Hand grenade thrown in place of a ranged shot when the target is in grenade range.</a:help>" +
	"<element name='Count' a:help='Grenades carried.'><data type='positiveInteger'/></element>" +
	"<element name='RechargeTime' a:help='Time to get a grenade back anywhere, in milliseconds.'><data type='positiveInteger'/></element>" +
	"<optional>" +
		"<element name='Resupply' a:help='Faster refill near own structures.'>" +
			"<interleave>" +
				"<element name='Range' a:help='Distance to the structure, in metres.'><ref name='positiveDecimal'/></element>" +
				"<element name='Time' a:help='Time to get a grenade back near the structure, in milliseconds.'><data type='positiveInteger'/></element>" +
				"<element name='Classes' a:help='Classes of own structures that resupply.'><text/></element>" +
			"</interleave>" +
		"</element>" +
	"</optional>";

// De quanto em quanto tempo a recarga é conferida.
HandGrenade.prototype.TICK = 1000;

HandGrenade.prototype.Init = function()
{
	this.max = +this.template.Count;
	this.count = this.max;
	// Tempo decorrido da recarga em andamento, em milissegundos.
	this.elapsed = 0;
};

HandGrenade.prototype.GetCount = function()
{
	return this.count;
};

HandGrenade.prototype.GetMaxCount = function()
{
	return this.max;
};

HandGrenade.prototype.HasGrenade = function()
{
	return this.count > 0;
};

/**
 * @return {number} - Milissegundos que faltam para a próxima granada onde o
 * soldado está agora (0 se ele está com todas).
 */
HandGrenade.prototype.GetTimeToNext = function()
{
	if (this.count >= this.max)
		return 0;
	return Math.max(0, this.GetNeededTime() - this.elapsed);
};

HandGrenade.prototype.GetNeededTime = function()
{
	const recharge = +this.template.RechargeTime;
	if (this.template.Resupply && this.IsNearResupplyPoint())
		return Math.min(recharge, +this.template.Resupply.Time);
	return recharge;
};

HandGrenade.prototype.Use = function()
{
	if (!this.count)
		return false;
	--this.count;
	this.StartRecharge();
	return true;
};

HandGrenade.prototype.SetCount = function(count)
{
	this.count = Math.max(0, Math.min(this.max, +count));
	if (this.count >= this.max)
		this.StopRecharge();
	else
		this.StartRecharge();
};

HandGrenade.prototype.StartRecharge = function()
{
	if (this.timer || this.count >= this.max)
		return;
	this.elapsed = 0;
	this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
		this.entity, IID_HandGrenade, "RechargeTick", this.TICK, this.TICK, null);
};

HandGrenade.prototype.StopRecharge = function()
{
	this.elapsed = 0;
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

HandGrenade.prototype.IsNearResupplyPoint = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpOwnership || cmpOwnership.GetOwner() <= 0)
		return false;

	const classes = this.template.Resupply.Classes;
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQuery(
		this.entity, 0, +this.template.Resupply.Range, [cmpOwnership.GetOwner()], IID_Identity, false
	).some(ent =>
		!Engine.QueryInterface(ent, IID_Foundation) &&
		MatchesClassList(Engine.QueryInterface(ent, IID_Identity).GetClassesList(), classes));
};

HandGrenade.prototype.RechargeTick = function()
{
	this.elapsed += this.TICK;
	if (this.elapsed < this.GetNeededTime())
		return;

	++this.count;
	this.elapsed = 0;
	if (this.count >= this.max)
		this.StopRecharge();
};

HandGrenade.prototype.OnDestroy = function()
{
	this.StopRecharge();
};

Engine.RegisterComponentType(IID_HandGrenade, "HandGrenade", HandGrenade);

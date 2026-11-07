/**
 * Finite ammunition for battalion/squad ranged weapons.
 *
 * This is a deliberately small adaptation of Grapejuice's Ammo component:
 * ammunition is consumed only by actual ranged shots.  Reloading is left to
 * a future supply/rearm mechanic; the secondary melee weapon remains usable.
 *
 * Mars Wars: com <Resupply>, a munição volta aos poucos enquanto a unidade
 * estiver perto de uma estrutura própria (ex.: granadas do granadeiro). Com
 * <RangedSecondary> no Attack, a unidade usa essa arma enquanto estiver sem
 * munição (ver Attack.prototype.IsUsingSecondary).
 *
 * Modern Wars: com <Reload>, a munição é uma salva. O relógio começa no
 * primeiro disparo e, <Time> depois, a salva volta inteira, em qualquer lugar
 * (lançador de foguetes ASTROS: dispara tudo em segundos e recarrega em 1
 * minuto). Se a salva foi interrompida no meio, o que sobrou pode ser
 * disparado enquanto a recarga corre.
 */
function Ammo() {}

Ammo.prototype.Schema =
	"<element name='CurrAmmo'><data type='nonNegativeInteger'/></element>" +
	"<element name='MaxAmmo'><data type='nonNegativeInteger'/></element>" +
	"<optional><element name='SwitchToMeleeRange'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional>" +
		"<element name='Reload' a:help='Salvo weapon: the whole load comes back Time after the first shot, anywhere.'>" +
			"<element name='Time' a:help='Milliseconds from the first shot of a salvo to the full reload.'><data type='positiveInteger'/></element>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Resupply' a:help='Refill ammunition near own structures.'>" +
			"<interleave>" +
				"<element name='Range' a:help='Distance to an own structure, in metres.'><ref name='positiveDecimal'/></element>" +
				"<element name='Interval' a:help='Time to refill Amount, in milliseconds.'><data type='positiveInteger'/></element>" +
				"<element name='Amount'><data type='positiveInteger'/></element>" +
				"<optional><element name='Classes' a:help='Classes of own entities that resupply. Defaults to Structure.'><text/></element></optional>" +
			"</interleave>" +
		"</element>" +
	"</optional>";

Ammo.prototype.Init = function()
{
	this.ammo = +this.template.CurrAmmo;
	this.maxAmmo = +this.template.MaxAmmo;
	// 0 desliga a troca para a arma branca (ex.: lança-chamas).
	this.switchToMeleeRange = this.template.SwitchToMeleeRange !== undefined ? +this.template.SwitchToMeleeRange : 12;
};

Ammo.prototype.GetAmmo = function()
{
	return this.ammo;
};

Ammo.prototype.GetMaxAmmo = function()
{
	return this.maxAmmo;
};

Ammo.prototype.HasAmmo = function()
{
	return this.ammo > 0;
};

Ammo.prototype.GetSwitchToMeleeRange = function()
{
	return this.switchToMeleeRange;
};

Ammo.prototype.Reduce = function(amount)
{
	if (!amount || !this.ammo)
		return 0;

	const spent = Math.min(this.ammo, amount);
	this.ammo -= spent;
	this.StartResupply();
	this.StartReload();
	return spent;
};

Ammo.prototype.SetAmmo = function(amount)
{
	this.ammo = Math.max(0, Math.min(this.maxAmmo, +amount));
	this.StartResupply();
	this.StartReload();
};

/**
 * Salva (<Reload>): liga o relógio no primeiro disparo; ao fim dele a carga
 * volta inteira.
 */
Ammo.prototype.StartReload = function()
{
	if (!this.template.Reload || this.reloadTimer || this.ammo >= this.maxAmmo)
		return;
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	this.reloadEnd = cmpTimer.GetTime() + +this.template.Reload.Time;
	this.reloadTimer = cmpTimer.SetTimeout(this.entity, IID_Ammo, "FinishReload", +this.template.Reload.Time, null);
};

Ammo.prototype.FinishReload = function()
{
	delete this.reloadTimer;
	delete this.reloadEnd;
	this.ammo = this.maxAmmo;
};

/**
 * Troca de template (montar/desmontar um lançador, promoção): a nova
 * entidade fica com a munição e a recarga que já corria; sem isso, montar e
 * desmontar recarregaria a salva na hora.
 */
Ammo.prototype.OnEntityRenamed = function(msg)
{
	const cmpNewAmmo = Engine.QueryInterface(msg.newentity, IID_Ammo);
	if (cmpNewAmmo)
		cmpNewAmmo.TakeOver(this.ammo, this.GetReloadTime());
};

Ammo.prototype.TakeOver = function(ammo, reloadLeft)
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	if (this.reloadTimer)
		cmpTimer.CancelTimer(this.reloadTimer);
	delete this.reloadTimer;
	delete this.reloadEnd;
	this.ammo = Math.min(this.maxAmmo, ammo);
	if (this.template.Reload && reloadLeft > 0 && this.ammo < this.maxAmmo)
	{
		this.reloadEnd = cmpTimer.GetTime() + reloadLeft;
		this.reloadTimer = cmpTimer.SetTimeout(this.entity, IID_Ammo, "FinishReload", reloadLeft, null);
	}
	else
		this.StartReload();
	this.StartResupply();
};

/** @return {number} Milissegundos que faltam para a salva voltar (0 se não está recarregando). */
Ammo.prototype.GetReloadTime = function()
{
	if (this.reloadEnd === undefined)
		return 0;
	return Math.max(0, this.reloadEnd - Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime());
};

/**
 * Liga o relógio de recarga enquanto faltar munição.
 */
Ammo.prototype.StartResupply = function()
{
	if (!this.template.Resupply || this.resupplyTimer || this.ammo >= this.maxAmmo)
		return;
	const interval = +this.template.Resupply.Interval;
	this.resupplyTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
		this.entity, IID_Ammo, "ResupplyTick", interval, interval, null);
};

Ammo.prototype.StopResupply = function()
{
	if (!this.resupplyTimer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.resupplyTimer);
	delete this.resupplyTimer;
};

Ammo.prototype.IsNearResupplyPoint = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpOwnership || cmpOwnership.GetOwner() <= 0)
		return false;

	const classes = this.template.Resupply.Classes || "Structure";
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQuery(
		this.entity, 0, +this.template.Resupply.Range, [cmpOwnership.GetOwner()], IID_Identity, false
	).some(ent =>
		!Engine.QueryInterface(ent, IID_Foundation) &&
		MatchesClassList(Engine.QueryInterface(ent, IID_Identity).GetClassesList(), classes));
};

Ammo.prototype.ResupplyTick = function()
{
	if (this.ammo >= this.maxAmmo)
	{
		this.StopResupply();
		return;
	}
	if (!this.IsNearResupplyPoint())
		return;

	this.ammo = Math.min(this.maxAmmo, this.ammo + +this.template.Resupply.Amount);
	if (this.ammo >= this.maxAmmo)
		this.StopResupply();
};

Ammo.prototype.OnDestroy = function()
{
	if (this.reloadTimer)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.reloadTimer);
	this.StopResupply();
};

Engine.RegisterComponentType(IID_Ammo, "Ammo", Ammo);

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
 */
function Ammo() {}

Ammo.prototype.Schema =
	"<element name='CurrAmmo'><data type='nonNegativeInteger'/></element>" +
	"<element name='MaxAmmo'><data type='nonNegativeInteger'/></element>" +
	"<optional><element name='SwitchToMeleeRange'><ref name='nonNegativeDecimal'/></element></optional>" +
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
	this.switchToMeleeRange = +(this.template.SwitchToMeleeRange || 12);
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
	return spent;
};

Ammo.prototype.SetAmmo = function(amount)
{
	this.ammo = Math.max(0, Math.min(this.maxAmmo, +amount));
	this.StartResupply();
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
	this.StopResupply();
};

Engine.RegisterComponentType(IID_Ammo, "Ammo", Ammo);

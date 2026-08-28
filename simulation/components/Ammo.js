/**
 * Finite ammunition for battalion/squad ranged weapons.
 *
 * This is a deliberately small adaptation of Grapejuice's Ammo component:
 * ammunition is consumed only by actual ranged shots.  Reloading is left to
 * a future supply/rearm mechanic; the secondary melee weapon remains usable.
 */
function Ammo() {}

Ammo.prototype.Schema =
	"<element name='CurrAmmo'><data type='nonNegativeInteger'/></element>" +
	"<element name='MaxAmmo'><data type='nonNegativeInteger'/></element>" +
	"<optional><element name='SwitchToMeleeRange'><ref name='nonNegativeDecimal'/></element></optional>";

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
	return spent;
};

Ammo.prototype.SetAmmo = function(amount)
{
	this.ammo = Math.max(0, Math.min(this.maxAmmo, +amount));
};

Engine.RegisterComponentType(IID_Ammo, "Ammo", Ammo);

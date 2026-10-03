/**
 * Tanque de combustível do lança-chamas: ao morrer com combustível (Ammo),
 * o tanque explode em chamas e atinge todos em volta, inclusive aliados.
 * O dano cresce com a fração de combustível restante.
 */
function FuelTankExplosion() {}

FuelTankExplosion.prototype.Schema =
	"<a:help>Explodes the fuel tank when the unit dies with fuel left.</a:help>" +
	"<element name='Damage' a:help='Damage with a full tank (scaled by the remaining fuel, minimum 30%).'>" +
		"<oneOrMore>" +
			"<element>" +
				"<anyName/>" +
				"<ref name='nonNegativeDecimal'/>" +
			"</element>" +
		"</oneOrMore>" +
	"</element>" +
	"<element name='Radius'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='FriendlyFire'>" +
		"<data type='boolean'/>" +
	"</element>" +
	"<optional>" +
		"<element name='ImpactActorName'>" +
			"<text/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='ImpactSound'>" +
			"<text/>" +
		"</element>" +
	"</optional>";

FuelTankExplosion.prototype.OnOwnershipChanged = function(msg)
{
	// Só na morte/remoção (dono passa a ser INVALID_PLAYER).
	if (msg.to != INVALID_PLAYER || msg.from == INVALID_PLAYER)
		return;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return;

	const cmpAmmo = Engine.QueryInterface(this.entity, IID_Ammo);
	const fuel = cmpAmmo ? cmpAmmo.GetAmmo() / Math.max(1, cmpAmmo.GetMaxAmmo()) : 1;
	if (fuel <= 0)
		return;

	const scale = Math.max(0.3, fuel);
	const damage = {};
	for (const type in this.template.Damage)
		damage[type] = +this.template.Damage[type] * scale;

	const position = cmpPosition.GetPosition();
	if (this.template.ImpactSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(this.template.ImpactSound, position);
	if (this.template.ImpactActorName)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).SpawnEffect({
			"actor": this.template.ImpactActorName,
			"position": { "x": position.x, "z": position.z },
			"lifetime": 3
		});

	AttackHelper.CauseDamageOverArea({
		"type": "Melee",
		"attackData": { "Damage": damage },
		"attacker": this.entity,
		"attackerOwner": msg.from,
		"origin": Vector2D.from3D(position),
		"radius": +this.template.Radius,
		"shape": "Circular",
		"direction": new Vector3D(0, 0, 1),
		"friendlyFire": this.template.FriendlyFire == "true",
		"isSplash": true
	});
};

Engine.RegisterComponentType(IID_FuelTankExplosion, "FuelTankExplosion", FuelTankExplosion);

function DelayedDamage() {}

DelayedDamage.prototype.Schema =
	"<a:component type='system'/><empty/>";

DelayedDamage.prototype.Init = function()
{
};

/**
 * When missiles miss their target, other units in MISSILE_HIT_RADIUS range are considered.
 * Large missiles should probably implement splash damage anyways,
 * so keep this value low for performance.
 */
DelayedDamage.prototype.MISSILE_HIT_RADIUS = 2;

/**
 * Handles hit logic (after a delay has passed).
 * @param {Object}   data - The data sent by the caller.
 * @param {string}   data.type - The type of damage.
 * @param {Object}   data.attackData - Data of the form { 'effectType': { ...opaque effect data... }, 'Bonuses': {...} }.
 * @param {number}   data.target - The entity id of the target.
 * @param {number}   data.attacker - The entity id of the attacker.
 * @param {number}   data.attackerOwner - The player id of the owner of the attacker.
 * @param {Vector3D} data.position - The expected position of the target.
 * @param {number}   data.projectileId - The id of the projectile.
 * @param {Vector3D} data.direction - The unit vector defining the direction.
 * @param {string}   data.attackImpactSound - The name of the sound emited on impact.
 * @param {boolean}  data.friendlyFire - A flag indicating whether allied entities can also be damaged.
 * ***When splash damage***
 * @param {boolean}  data.splash.friendlyFire - A flag indicating if allied entities are also damaged.
 * @param {number}   data.splash.radius - The radius of the splash damage.
 * @param {string}   data.splash.shape - The shape of the splash range.
 * @param {Object}   data.splash.attackData - same as attackData, for splash.
 */
DelayedDamage.prototype.Hit = function(data, lateness)
{
	if (!data.position)
		return;

	if (data.attackImpactSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(data.attackImpactSound, data.position);

	if (data.splash)
		AttackHelper.CauseDamageOverArea({
			"type": data.type,
			"attackData": data.splash.attackData,
			"attacker": data.attacker,
			"attackerOwner": data.attackerOwner,
			"origin": Vector2D.from3D(data.position),
			"radius": data.splash.radius,
			"shape": data.splash.shape,
			"direction": data.direction,
			"friendlyFire": data.splash.friendlyFire,
			//HC-Code
            		"Stun": data.splash.Knockback,
            		"isSplash": true,
			//HC-End
		});

	// Since we can't damage mirages, replace a miraged target by the real target.
	let target = data.target;
	const cmpMirage = Engine.QueryInterface(data.target, IID_Mirage);
	if (cmpMirage)
		target = cmpMirage.GetParent();

	if (!data.projectileId)
	{
		AttackHelper.HandleAttackEffects(target, data);
		return;
	}

	const cmpProjectileManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ProjectileManager);

	// Deal direct damage if we hit the main target
	// and we could handle the attack.
	if (PositionHelper.TestCollision(target, data.position, lateness) &&
		AttackHelper.HandleAttackEffects(target, data))
	{
		cmpProjectileManager.RemoveProjectile(data.projectileId);
		return;
	}

	// If we didn't hit the main target look for nearby units.
	const ents = PositionHelper.EntitiesNearPoint(Vector2D.from3D(data.position), this.MISSILE_HIT_RADIUS,
		AttackHelper.GetPlayersToDamage(data.attackerOwner, data.friendlyFire));

	let hitAnEnemy = false; //HC-Code

	for (const ent of ents)
	{
		if (!PositionHelper.TestCollision(ent, data.position, lateness) ||
			!AttackHelper.HandleAttackEffects(ent, data))
			continue;

		hitAnEnemy = true; //HC-Code
		cmpProjectileManager.RemoveProjectile(data.projectileId);
		break;
	}
    // HC-Code
    // Spawn on impact code
    //potentially spawn units if nothing was hit by this missile based on whether it is applicable for the impact spawner to do so
    if (hitAnEnemy){
		return;
	}
	
    let entityImpact = data.EntityOnImpact;
    if (entityImpact)
    {
        if (entityImpact.spawnOnImpact) // check if this attacker is allowed to spawn on impact
        {
            let cmpResistance = Engine.QueryInterface(data.target, IID_Resistance);
            if (!cmpResistance)
                return;

            let pos = { "x": data.position.x, "y": data.position.z };
            cmpResistance.SpawnImpactUnits(entityImpact, pos, entityImpact.spawnOnImpact.chance, data.attackerOwner);
        }
    }
    // HC-End
};

Engine.RegisterSystemComponentType(IID_DelayedDamage, "DelayedDamage", DelayedDamage);

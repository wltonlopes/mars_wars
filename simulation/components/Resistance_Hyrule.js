Resistance.prototype.InitHyrule = function()
{
    this.isStunned = false;
    this.isKnockedBack = false;
}

Resistance.prototype.PostInit = function ()
{
    let cmpIdentity = Engine.QueryInterface(this.entity, IID_Identity);
    if(cmpIdentity != undefined && cmpIdentity.HasClass("Human")) this.SetInvulnerability(false);
}

/**
 *
 * @param {*} data - Special data passed by the timer.
 * @param {*} lateness - How late this function was called.
 */
Resistance.prototype.StunEntity = function (entity, miliseconds, playAnimation = true)
{
    if (this.isStunned == true) // if the target is already stunned dont try to stun it again
        return;

    this.isStunned = true; // set the target to stunned state

    let cmpUnitMotion = Engine.QueryInterface(entity, IID_UnitMotion);
    if (!cmpUnitMotion)
    {
        this.isStunned = false;
        return;
    }

    cmpUnitMotion.SetSpeedMultiplier(+0.001); // the unit cant move when its stunned

    if (playAnimation == true) {
        let visualCmp = Engine.QueryInterface(entity, IID_Visual);
        if (visualCmp)
            visualCmp.SelectAnimation("idle", false, 0.1);
    }
    let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
    let data = {};
    data.timer = cmpTimer.SetTimeout(entity, IID_Resistance, "ResetStun", miliseconds, data); // reset the stun after given miliseconds
    this.stunData = data;
}

Resistance.prototype.ReStun = function (data, miliseconds) // a function meant to reinstigate the stun with new miliseconds (can only be used when another stun is already active)
{
    let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
    cmpTimer.CancelTimer(data.timer); // cancel the old timer
    data.timer = cmpTimer.SetTimeout(this.entity, IID_Resistance, "ResetStun", miliseconds, data); // reinstigate a new timer with set miliseconds
    this.stunData = data; // return the data with the new timer in it
}

Resistance.prototype.ResetStun = function (data, lateness)
{
    this.isStunned = false;
    let cmpUnitMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
    if (!cmpUnitMotion)
        return;

    let cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
    if (!cmpUnitAI)
        return;

    let cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
    if (!cmpVisual)
        return;

    cmpVisual.SelectAnimation("idle", false, 1.0); // reset to idle first

    cmpUnitMotion.SetSpeedMultiplier(+1); // reset speed multiplier to 1
    let cmpPos = Engine.QueryInterface(this.entity, IID_Position);
    if (!cmpPos || !cmpPos.IsInWorld())
        return;
    let pos = cmpPos.GetPosition2D();
    cmpUnitAI.Walk(pos.x + +1, pos.y, false); // for now, run a generic move command after to reset the orientation, TODO: make the entity attack the previous entity if it exists
}

Resistance.prototype.HasBlocked = function (type)
{
    if (type != "Ranged") //only run for ranged attacks
        return false;

    let block = this.GetBlockRating();
    if (block == 0)
        return false;

    let rand = (randFloat(0, 1) * 100);
    if (rand > block)
        return false;
    else
    {

        // play block animation if present
        //var visualCmp = Engine.QueryInterface(this.entity, IID_Visual);
        //visualCmp.SelectAnimation("block", true, 1.0);
        return true;
    }
}

Resistance.prototype.ApplyKnockback = function(origin, distance, chance)
{
    let cmpIdentity = Engine.QueryInterface(this.entity, IID_Identity);
    if (!cmpIdentity || !cmpIdentity.HasClass("Unit"))
        return;

    // Vehicles still receive the splash damage through AttackHelper, but their
    // mass makes them immune to the positional impulse.
    if (cmpIdentity.HasClass("Vehicle"))
        return;

    if (randFloat(0, 100) > chance)
        return;

    let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
    if (!cmpPosition || !cmpPosition.IsInWorld())
        return;

    let target = cmpPosition.GetPosition2D();
    let dx = target.x - origin.x;
    let dz = target.y - origin.y;
    let length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.001)
    {
        dx = 1;
        dz = 0;
        length = 1;
    }

    // Throw the unit away from the blast: instead of teleporting, it flies
    // along an arc over a few turns (see UpdateKnockback), facing the blast.
    let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
    this.CancelKnockback();

    cmpPosition.TurnTo(Math.atan2(-dx, -dz));
    this.knockback = {
        "start": { "x": target.x, "z": target.y },
        "direction": { "x": dx / length, "z": dz / length },
        "distance": distance,
        "peak": Math.min(this.KNOCKBACK_MAX_HEIGHT, distance * this.KNOCKBACK_HEIGHT_RATIO),
        "duration": Math.max(this.KNOCKBACK_MIN_TIME, Math.min(this.KNOCKBACK_MAX_TIME, distance * this.KNOCKBACK_TIME_PER_METRE)),
        "startTime": cmpTimer.GetTime(),
        "baseHeight": cmpPosition.GetHeightOffset()
    };
    this.knockbackTimer = cmpTimer.SetInterval(
        this.entity, IID_Resistance, "UpdateKnockback", this.KNOCKBACK_STEP, this.KNOCKBACK_STEP, null);

    // Keep UnitAI from replacing the reaction with walk/idle while airborne.
    this.isKnockedBack = true;

    // Human actors already provide the skeletal "death" animation as "Jump":
    // play it once as the fall while the explosion throws the unit.
    if (cmpIdentity.HasClass("Human"))
    {
        let cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
        if (cmpVisual)
            cmpVisual.SelectAnimation("Jump", true, 1.35);
    }
}

/** Milliseconds between two steps of the flight. */
Resistance.prototype.KNOCKBACK_STEP = 200;
/** Flight time: per metre thrown, within [min, max], in milliseconds. */
Resistance.prototype.KNOCKBACK_TIME_PER_METRE = 110;
Resistance.prototype.KNOCKBACK_MIN_TIME = 500;
Resistance.prototype.KNOCKBACK_MAX_TIME = 1000;
/** Top of the arc: a fraction of the distance, up to a maximum (metres). */
Resistance.prototype.KNOCKBACK_HEIGHT_RATIO = 0.5;
Resistance.prototype.KNOCKBACK_MAX_HEIGHT = 4;

/**
 * One step of the flight: fast at first and slowing down along the ground,
 * with a parabola for the height. Position interpolates between the steps.
 */
Resistance.prototype.UpdateKnockback = function()
{
    let knockback = this.knockback;
    let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
    if (!knockback || !cmpPosition || !cmpPosition.IsInWorld())
    {
        this.ResetKnockback();
        return;
    }

    let elapsed = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime() - knockback.startTime;
    let t = Math.min(1, elapsed / knockback.duration);
    let travelled = knockback.distance * (1 - (1 - t) * (1 - t));
    let point = {
        "x": knockback.start.x + knockback.direction.x * travelled,
        "z": knockback.start.z + knockback.direction.z * travelled
    };

    // Never leave the map; the unit drops where it is.
    if (!AirSupport.IsInsideMap(point, 4))
    {
        this.ResetKnockback();
        return;
    }

    cmpPosition.MoveTo(point.x, point.z);
    cmpPosition.SetHeightOffset(knockback.baseHeight + knockback.peak * 4 * t * (1 - t));

    if (t >= 1)
        this.ResetKnockback();
}

/**
 * Stops the flight where it is and puts the unit back on the ground,
 * without touching the animation (e.g. before the entity is replaced).
 */
Resistance.prototype.CancelKnockback = function()
{
    if (this.knockbackTimer != undefined)
        Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.knockbackTimer);
    this.knockbackTimer = undefined;

    if (this.knockback)
    {
        let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
        if (cmpPosition)
            cmpPosition.SetHeightOffset(this.knockback.baseHeight);
    }
    this.knockback = undefined;
    this.isKnockedBack = false;
}

Resistance.prototype.ResetKnockback = function()
{
    this.CancelKnockback();

    let cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
    if (cmpVisual)
        cmpVisual.SelectAnimation("idle", false, 1.0);
}

Resistance.prototype.GetBlockRating = function ()
{
    let rating = 0;
    let block = this.template.BlockRating;

    if (block)
        rating = +block;

    let applyMods = ApplyValueModificationsToEntity("Resistance/BlockRating", rating, this.entity);

    return applyMods;
}

Resistance.prototype.GetStunResistance = function ()
{
    let rating = 0;
    let resistance = this.template.StunResistance;
    if (resistance)
        rating = +resistance;

    let applyMods = ApplyValueModificationsToEntity("Resistance/StunResistance", rating, this.entity);

    return applyMods;
}

Resistance.prototype.SpawnImpactUnits = function (EntityImpact, pos, chance, AttackOwner) {
    // calculate random occurence chance based on parameter
    let rand = (randFloat(0, 1) * 100);
    if (rand > chance)
        return;

    // get random spawn number based on parameters
    let randSpawns = randIntInclusive(+EntityImpact.spawnNumberMin, +EntityImpact.spawnNumberMax);

    //Spawn units
    for (let i = 0; i < randSpawns; i++)
    {
        var spawnedUnit = Engine.AddEntity(EntityImpact.template);
		if (spawnedUnit == INVALID_ENTITY)
			continue;

        // A unit spawned that way needs to be marked as free and shall not take up a slot in the battalion count
        let cmpHealth = Engine.QueryInterface(spawnedUnit, IID_Health);
		if (cmpHealth)
			cmpHealth.freeUnit = true;

        // set spawned unit location
        var spawnedUnitPosCmp = Engine.QueryInterface(spawnedUnit, IID_Position);
		if (!spawnedUnitPosCmp)
		{
			Engine.DestroyEntity(spawnedUnit);
			continue;
		}
        spawnedUnitPosCmp.JumpTo(pos.x, pos.y);

        // set spawned unit rotation
        spawnedUnitPosCmp.SetYRotation(0);
        spawnedUnitPosCmp.SetXZRotation(0, 0);

        // set spawned unit ownership
        var spawnedUnitOwnershipCmp = Engine.QueryInterface(spawnedUnit, IID_Ownership);
        let ownerID = EntityImpact.ownerID;
		if (spawnedUnitOwnershipCmp && ownerID != undefined)
            spawnedUnitOwnershipCmp.SetOwner(+ownerID);
		else if (spawnedUnitOwnershipCmp)
            spawnedUnitOwnershipCmp.SetOwner(AttackOwner);
            
        // play spawn animation if present
        var spawnedUnitVisualCmp = Engine.QueryInterface(spawnedUnit, IID_Visual);
		if (spawnedUnitVisualCmp)
			spawnedUnitVisualCmp.SelectAnimation("spawn", true, 1.0);

        //play sound if present
        PlaySound("spawn", spawnedUnit);
    }
}

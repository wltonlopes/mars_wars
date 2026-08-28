Resistance.prototype.InitHyrule = function()
{
    this.isStunned = false;
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

    cmpPosition.JumpTo(
        target.x + dx / length * distance,
        target.y + dz / length * distance);
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

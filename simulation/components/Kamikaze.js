function Kamikaze() {}

Kamikaze.prototype.Schema =
	"<empty/>";

Kamikaze.prototype.Init = function()
{
	this.armed = false;
	this.detonated = false;

	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
		this.entity,
		IID_Kamikaze,
		"CheckGroundImpact",
		100,
		100);
};

Kamikaze.prototype.CheckGroundImpact = function()
{
	if (this.detonated)
		return;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpTerrain)
		return;

	const position = cmpPosition.GetPosition();
	const groundHeight = cmpTerrain.GetGroundLevel(position.x, position.z);

	if (position.y > groundHeight + 2)
	{
		this.armed = true;
		return;
	}

	if (this.armed)
		this.Detonate(position);
};

Kamikaze.prototype.Detonate = function(position)
{
	this.detonated = true;

	const cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	const splash = cmpAttack && cmpAttack.GetSplashData("Melee");
	if (splash && cmpOwnership)
	{
		AttackHelper.CauseDamageOverArea({
			"type": "Melee",
			"attackData": splash.attackData,
			"attacker": this.entity,
			"attackerOwner": cmpOwnership.GetOwner(),
			"origin": Vector2D.from3D(position),
			"radius": splash.radius,
			"shape": splash.shape,
			"direction": new Vector3D(0, 0, 1),
			"friendlyFire": splash.friendlyFire,
			"Stun": splash.Stun,
			"Knockback": splash.Knockback,
			"isSplash": true
		});
	}

	Engine.DestroyEntity(this.entity);
};

Engine.RegisterComponentType(IID_Kamikaze, "Kamikaze", Kamikaze);
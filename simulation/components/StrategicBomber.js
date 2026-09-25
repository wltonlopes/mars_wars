/**
 * Aeronave temporária de bombardeio estratégico.
 *
 * Não usa UnitMotion/pathfinder: voa em linha reta da borda do mapa,
 * passa sobre o alvo soltando um tapete de bombas e sai pela borda
 * oposta, onde o AirSupportManager a remove.
 */
function StrategicBomber() {}

StrategicBomber.prototype.Schema =
	"<a:help>Temporary aircraft used by strategic bombing missions.</a:help>" +
	"<element name='Speed' a:help='Metres per second.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='FlightAltitude' a:help='Height above the terrain in metres.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='Bomb'>" +
		"<interleave>" +
			"<element name='Damage' a:help='Damage per bomb at its centre, e.g. Crush, Fire.'>" +
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
			"<element name='ActorName' a:help='Actor of the falling bomb.'>" +
				"<text/>" +
			"</element>" +
			"<optional>" +
				"<element name='ImpactActorName'>" +
					"<text/>" +
				"</element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ImpactAnimationLifetime' a:help='Seconds.'>" +
					"<ref name='nonNegativeDecimal'/>" +
				"</element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ImpactSound' a:help='Sound group played on impact.'>" +
					"<text/>" +
				"</element>" +
			"</optional>" +
		"</interleave>" +
	"</element>";

StrategicBomber.prototype.GRAVITY = 9.81;

StrategicBomber.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.path = null;
	// Distância percorrida desde a entrada, ao longo da rota.
	this.travelled = 0;
	// Distâncias (ao longo da rota) onde cada bomba toca o solo.
	this.impacts = [];
	this.nextBomb = 0;
};

/**
 * @param {Object} path - Resultado de AirSupport.CreateFlightPath.
 * @param {Object} parameters - bombCount e bombingLength vindos do prédio.
 */
StrategicBomber.prototype.StartMission = function(missionId, provider, path, parameters)
{
	this.missionId = missionId;
	this.provider = provider;
	this.path = path;

	const count = parameters.bombCount;
	for (let i = 0; i < count; ++i)
	{
		const offset = count > 1 ? (i / (count - 1) - 0.5) * parameters.bombingLength : 0;
		this.impacts.push(Math.max(1, Math.min(path.length, path.targetDistance + offset)));
	}

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	cmpPosition.JumpTo(path.entry.x, path.entry.z);
	cmpPosition.SetYRotation(Math.atan2(path.direction.x, path.direction.z));
	cmpPosition.SetHeightOffset(+this.template.FlightAltitude);

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SelectAnimation("walk", false, 1);
};

/**
 * Tempo de queda livre da altitude de voo até o solo, em segundos.
 */
StrategicBomber.prototype.GetFallTime = function()
{
	return Math.sqrt(2 * this.template.FlightAltitude / this.GRAVITY);
};

StrategicBomber.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	this.travelled = Math.min(this.path.length, this.travelled + this.template.Speed * msg.turnLength);

	const position = AirSupport.Offset(this.path.entry, this.path.direction, this.travelled);
	Engine.QueryInterface(this.entity, IID_Position).MoveTo(position.x, position.z);

	// A bomba é solta antes do alvo para que a inércia a leve até ele.
	const lead = this.template.Speed * this.GetFallTime();
	const reachedExit = this.travelled >= this.path.length;
	while (this.nextBomb < this.impacts.length &&
		(reachedExit || this.impacts[this.nextBomb] - lead <= this.travelled))
		this.DropBomb(this.impacts[this.nextBomb++]);

	if (reachedExit)
		this.FinishMission();
};

StrategicBomber.prototype.DropBomb = function(impactDistance)
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const launchPoint = cmpPosition.GetPosition();
	const impact = AirSupport.Offset(this.path.entry, this.path.direction, impactDistance);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const targetPoint = new Vector3D(impact.x, cmpTerrain.GetGroundLevel(impact.x, impact.z), impact.z);

	// Todas as bombas levam o mesmo tempo para cair; a velocidade
	// horizontal é ajustada para acertar o ponto planejado.
	const fallTime = this.GetFallTime();
	const horizontalSpeed = Math.max(1, launchPoint.horizDistanceTo(targetPoint)) / fallTime;

	const bomb = this.template.Bomb;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_ProjectileManager).LaunchProjectileAtPoint(
		launchPoint, targetPoint, horizontalSpeed, this.GRAVITY,
		bomb.ActorName, bomb.ImpactActorName || "", +(bomb.ImpactAnimationLifetime || 0));

	const damage = {};
	for (const type in bomb.Damage)
		damage[type] = +bomb.Damage[type];

	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(SYSTEM_ENTITY, IID_AirSupportManager, "BombImpact", fallTime * 1000, {
		"position": impact,
		"attackData": { "Damage": damage },
		"attacker": this.provider,
		"attackerOwner": cmpOwnership.GetOwner(),
		"radius": +bomb.Radius,
		"friendlyFire": bomb.FriendlyFire == "true",
		"impactSound": bomb.ImpactSound || ""
	});
};

/**
 * Se a aeronave for removida por outro motivo, libera o prédio.
 */
StrategicBomber.prototype.OnDestroy = function()
{
	this.FinishMission();
};

StrategicBomber.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_StrategicBomber, "StrategicBomber", StrategicBomber);

/**
 * Ataque orbital de saturação (centro cívico da Coalizão), criado pelo
 * AirSupportManager.
 *
 * Depois de WarningTime segundos, ShellCount projéteis caem da órbita ao
 * longo de Duration segundos, em pontos sorteados dentro de Radius em volta
 * do alvo. Cada projétil leva FallTime para chegar ao solo; o dano de cada
 * impacto é aplicado pelo AirSupportManager (BombImpact).
 */
function OrbitalSaturation() {}

OrbitalSaturation.prototype.Schema =
	"<a:help>Orbital saturation strike: a barrage of shells falling on random points of a wide area.</a:help>" +
	"<element name='ShellCount'><data type='positiveInteger'/></element>" +
	"<element name='Radius' a:help='Radius of the saturated area, in metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='WarningTime' a:help='Seconds between the request and the first shell.'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='Duration' a:help='Seconds over which the shells are fired.'><ref name='positiveDecimal'/></element>" +
	"<element name='Shell'>" +
		"<interleave>" +
			"<element name='Damage' a:help='Damage per shell at its centre, e.g. Crush, Fire.'>" +
				"<oneOrMore>" +
					"<element>" +
						"<anyName/>" +
						"<ref name='nonNegativeDecimal'/>" +
					"</element>" +
				"</oneOrMore>" +
			"</element>" +
			"<element name='Radius'><ref name='positiveDecimal'/></element>" +
			"<element name='FriendlyFire'><data type='boolean'/></element>" +
			"<element name='ActorName' a:help='Actor of the falling shell.'><text/></element>" +
			"<element name='FallHeight' a:help='Height above the ground where the shell appears, in metres.'><ref name='positiveDecimal'/></element>" +
			"<element name='FallTime' a:help='Seconds from that height to the ground.'><ref name='positiveDecimal'/></element>" +
			"<element name='Slant' a:help='Horizontal distance covered during the fall, in metres (the shells come in at an angle).'><ref name='nonNegativeDecimal'/></element>" +
			"<optional>" +
				"<element name='ImpactActorName'><text/></element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ImpactAnimationLifetime' a:help='Seconds.'><ref name='nonNegativeDecimal'/></element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ImpactSound' a:help='Sound group played on impact.'><text/></element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ScorchActor' a:help='Left on the ground at each impact.'><text/></element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ScorchTime' a:help='Seconds.'><ref name='positiveDecimal'/></element>" +
			"</optional>" +
		"</interleave>" +
	"</element>";

OrbitalSaturation.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.target = null;
	// Direção horizontal de onde os projéteis vêm (a mesma para toda a salva).
	this.direction = null;
	this.elapsed = 0;
	this.nextShell = 0;
};

/**
 * @return {number} Tempo até os primeiros impactos, em milissegundos.
 */
OrbitalSaturation.prototype.StartMission = function(missionId, provider, target)
{
	this.missionId = missionId;
	this.provider = provider;
	this.target = target;

	const angle = randFloat(0, 2 * Math.PI);
	this.direction = { "x": Math.cos(angle), "z": Math.sin(angle) };

	Engine.QueryInterface(this.entity, IID_Position).JumpTo(target.x, target.z);
	return (+this.template.WarningTime + +this.template.Shell.FallTime) * 1000;
};

/**
 * Momento (segundos desde o pedido) em que o projétil `index` é disparado.
 */
OrbitalSaturation.prototype.GetShellTime = function(index)
{
	return +this.template.WarningTime + index * this.template.Duration / this.template.ShellCount;
};

OrbitalSaturation.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	this.elapsed += msg.turnLength;

	const count = +this.template.ShellCount;
	while (this.nextShell < count && this.GetShellTime(this.nextShell) <= this.elapsed)
	{
		this.FireShell();
		++this.nextShell;
	}

	// O controlador fica até o último impacto, para manter a visão da área.
	if (this.nextShell >= count && this.elapsed >= this.GetShellTime(count - 1) + +this.template.Shell.FallTime)
		this.FinishMission();
};

OrbitalSaturation.prototype.FireShell = function()
{
	// Ponto sorteado com distribuição uniforme no círculo.
	const angle = randFloat(0, 2 * Math.PI);
	const distance = this.template.Radius * Math.sqrt(randFloat(0, 1));
	const impact = {
		"x": this.target.x + Math.cos(angle) * distance,
		"z": this.target.z + Math.sin(angle) * distance
	};
	if (!AirSupport.IsInsideMap(impact, 4))
		return;

	const shell = this.template.Shell;
	const fallTime = +shell.FallTime;
	const ground = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(impact.x, impact.z);
	const start = AirSupport.Offset(impact, this.direction, -shell.Slant);
	const launchPoint = new Vector3D(start.x, ground + +shell.FallHeight, start.z);
	const targetPoint = new Vector3D(impact.x, ground, impact.z);

	// Sem gravidade o projétil desce em linha reta; o ProjectileManager
	// recebe a velocidade horizontal e tira a vertical do tempo de voo.
	const horizontalSpeed = Math.max(1, launchPoint.horizDistanceTo(targetPoint)) / fallTime;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_ProjectileManager).LaunchProjectileAtPoint(
		launchPoint, targetPoint, horizontalSpeed, 0,
		shell.ActorName, shell.ImpactActorName || "", +(shell.ImpactAnimationLifetime || 0));

	const damage = {};
	for (const type in shell.Damage)
		damage[type] = +shell.Damage[type];

	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(SYSTEM_ENTITY, IID_AirSupportManager, "BombImpact", fallTime * 1000, {
		"position": impact,
		"attackData": { "Damage": damage },
		"attacker": this.provider,
		"attackerOwner": Engine.QueryInterface(this.entity, IID_Ownership).GetOwner(),
		"radius": +shell.Radius,
		"friendlyFire": shell.FriendlyFire == "true",
		"impactSound": shell.ImpactSound || "",
		"impactEffects": shell.ScorchActor ? [{ "actor": shell.ScorchActor, "delay": 0, "lifetime": +(shell.ScorchTime || 20) }] : []
	});
};

/**
 * Se o controlador for removido por outro motivo, libera o prédio.
 */
OrbitalSaturation.prototype.OnDestroy = function()
{
	this.FinishMission();
};

OrbitalSaturation.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_OrbitalSaturation, "OrbitalSaturation", OrbitalSaturation);

/**
 * Míssil temporário (ICBM dos silos, míssil nuclear dos centros cívicos).
 *
 * Perfil "ballistic": sobe na vertical a partir do silo, faz um arco até
 * ApexHeight e mergulha na vertical sobre o alvo.
 * Perfil "reentry": entra pela borda do mapa a ApexHeight, em voo
 * nivelado, e mergulha cada vez mais inclinado até o alvo.
 *
 * Não usa UnitMotion: a posição é calculada a cada turno a partir do
 * tempo de voo.
 */
function IcbmMissile() {}

IcbmMissile.prototype.Schema =
	"<a:help>Temporary ballistic missile used by ICBM air support missions.</a:help>" +
	"<optional>" +
		"<element name='Profile' a:help='ballistic (default): launched from the structure. reentry: comes in from the map edge.'>" +
			"<choice>" +
				"<value>ballistic</value>" +
				"<value>reentry</value>" +
			"</choice>" +
		"</element>" +
	"</optional>" +
	"<element name='Speed' a:help='Average horizontal speed in metres per second.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='MinFlightTime' a:help='Seconds. Short-range launches still take at least this long.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='ApexHeight' a:help='Highest point of the flight, in metres above the terrain.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='Warhead'>" +
		"<interleave>" +
			"<element name='Damage' a:help='Damage at the centre of the blast, e.g. Crush, Fire. Falls off towards Radius.'>" +
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
				"<element name='ImpactAnimationLifetime' a:help='Seconds.'>" +
					"<ref name='nonNegativeDecimal'/>" +
				"</element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ImpactEffects' a:help='Staged effects, one child element per stage (any name), each spawning Actor after Delay seconds for Lifetime seconds.'>" +
					"<oneOrMore>" +
						"<element>" +
							"<anyName/>" +
							"<interleave>" +
								"<element name='Actor'><text/></element>" +
								"<element name='Delay'><ref name='nonNegativeDecimal'/></element>" +
								"<element name='Lifetime'><ref name='positiveDecimal'/></element>" +
							"</interleave>" +
						"</element>" +
					"</oneOrMore>" +
				"</element>" +
			"</optional>" +
			"<optional>" +
				"<element name='ImpactSound' a:help='Sound group played on impact.'>" +
					"<text/>" +
				"</element>" +
			"</optional>" +
		"</interleave>" +
	"</element>";

IcbmMissile.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.origin = null;
	this.target = null;
	this.flightTime = 0;
	this.elapsed = 0;
};

/**
 * @param {Object} origin - { x, z } do silo.
 * @param {Object} target - { x, z } do alvo.
 * @return {number} Tempo de voo em milissegundos.
 */
IcbmMissile.prototype.StartMission = function(missionId, provider, origin, target)
{
	this.missionId = missionId;
	this.provider = provider;
	this.origin = origin;
	this.target = target;

	const distance = Math.hypot(target.x - origin.x, target.z - origin.z);
	this.flightTime = Math.max(+this.template.MinFlightTime, distance / this.template.Speed) * 1000;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	cmpPosition.JumpTo(origin.x, origin.z);
	cmpPosition.SetYRotation(Math.atan2(target.x - origin.x, target.z - origin.z));
	this.UpdatePosition(cmpPosition, 0);

	return this.flightTime;
};

/**
 * Trajetória em função de u = tempo decorrido / tempo total (0..1).
 * ballistic - horizontal: smoothstep, com velocidade horizontal nula no
 *   lançamento e no impacto (sobe e desce na vertical); vertical: meia
 *   senoide até ApexHeight.
 * reentry - horizontal constante; vertical: parábola que começa nivelada
 *   em ApexHeight e termina no solo.
 */
IcbmMissile.prototype.GetProfile = function()
{
	return this.template.Profile || "ballistic";
};

IcbmMissile.prototype.GetTrajectory = function(u)
{
	if (this.GetProfile() == "reentry")
		return {
			"along": u,
			"height": this.template.ApexHeight * (1 - u * u)
		};

	return {
		"along": u * u * (3 - 2 * u),
		"height": this.template.ApexHeight * Math.sin(Math.PI * u)
	};
};

IcbmMissile.prototype.UpdatePosition = function(cmpPosition, u)
{
	const point = this.GetTrajectory(u);
	const x = this.origin.x + (this.target.x - this.origin.x) * point.along;
	const z = this.origin.z + (this.target.z - this.origin.z) * point.along;
	cmpPosition.MoveTo(x, z);
	cmpPosition.SetHeightOffset(Math.max(0, point.height));

	// Inclina o modelo (que fica em pé no repouso) na direção do movimento.
	const du = 0.01;
	const next = this.GetTrajectory(Math.min(1, u + du));
	const prev = this.GetTrajectory(Math.max(0, u - du));
	const horizontal = (next.along - prev.along) * Math.hypot(this.target.x - this.origin.x, this.target.z - this.origin.z);
	const vertical = next.height - prev.height;
	// A frente dos modelos é o eixo local -Z (o engine soma 180° à rotação Y):
	// rotação negativa em X inclina o topo (+Y) para a frente.
	cmpPosition.SetXZRotation(-Math.atan2(horizontal, vertical), 0);
};

IcbmMissile.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	this.elapsed = Math.min(this.flightTime, this.elapsed + msg.turnLength * 1000);
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	this.UpdatePosition(cmpPosition, this.elapsed / this.flightTime);

	if (this.elapsed >= this.flightTime)
		this.Detonate();
};

IcbmMissile.prototype.Detonate = function()
{
	const warhead = this.template.Warhead;
	const damage = {};
	for (const type in warhead.Damage)
		damage[type] = +warhead.Damage[type];

	const cmpManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager);
	cmpManager.BombImpact({
		"position": this.target,
		"attackData": { "Damage": damage },
		"attacker": this.provider,
		"attackerOwner": Engine.QueryInterface(this.entity, IID_Ownership).GetOwner(),
		"radius": +warhead.Radius,
		"friendlyFire": warhead.FriendlyFire == "true",
		"impactSound": warhead.ImpactSound || "",
		"impactActor": warhead.ImpactActorName || "",
		"impactActorLifetime": +(warhead.ImpactAnimationLifetime || 0),
		"impactEffects": Object.keys(warhead.ImpactEffects || {}).map(stage => ({
			"actor": warhead.ImpactEffects[stage].Actor,
			"delay": +warhead.ImpactEffects[stage].Delay,
			"lifetime": +warhead.ImpactEffects[stage].Lifetime
		}))
	});

	this.FinishMission();
};

/**
 * Se o míssil for removido por outro motivo, libera o silo.
 */
IcbmMissile.prototype.OnDestroy = function()
{
	this.FinishMission();
};

IcbmMissile.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_IcbmMissile, "IcbmMissile", IcbmMissile);

/**
 * Defesa aérea estratégica (torre de defesa aérea).
 *
 * Protege um raio em volta da estrutura contra ataques estratégicos de
 * jogadores inimigos (missões do AirSupportManager):
 *  - o prédio que pede o ataque não aceita alvos dentro do raio;
 *  - mísseis e bombardeiros que entram no raio são abatidos por um míssil
 *    interceptador, que explode no ar sem causar dano no solo;
 *  - bombardeiros não soltam bombas que cairiam dentro do raio.
 *
 * Fundações não têm este componente, então só a torre pronta protege.
 */
function AirDefense() {}

AirDefense.prototype.Schema =
	"<a:help>Protects the area around the structure from enemy strategic air strikes: they cannot target it, and missiles or bombers entering it are shot down.</a:help>" +
	"<a:example>" +
		"<Range>120</Range>" +
		"<Intercepts datatype='tokens'>icbm nuke strategic_bomber</Intercepts>" +
		"<InterceptorActor>props/units/weapons/ammo/sam_interceptor.xml</InterceptorActor>" +
		"<InterceptorSpeed>140</InterceptorSpeed>" +
		"<LaunchHeight>4</LaunchHeight>" +
		"<InterceptActor>props/units/explosions/air_burst.xml</InterceptActor>" +
		"<InterceptActorLifetime>4</InterceptActorLifetime>" +
	"</a:example>" +
	"<element name='Range' a:help='Radius of the protected area, in metres.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='Intercepts' a:help='Air support mission types shot down: icbm, nuke, strategic_bomber.'>" +
		"<optional><attribute name='datatype'><value>tokens</value></attribute></optional>" +
		"<text/>" +
	"</element>" +
	"<element name='InterceptorActor' a:help='Projectile actor of the interceptor missile.'>" +
		"<text/>" +
	"</element>" +
	"<element name='InterceptorSpeed' a:help='Metres per second.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='LaunchHeight' a:help='Height above the structure where interceptors start.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='InterceptActor' a:help='Air burst where the target is destroyed.'>" +
		"<text/>" +
	"</element>" +
	"<element name='InterceptActorLifetime' a:help='Seconds.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='LaunchSound' a:help='Sound group played when an interceptor is fired.'>" +
			"<text/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='InterceptSound' a:help='Sound group played at the air burst.'>" +
			"<text/>" +
		"</element>" +
	"</optional>";

/** Menor tempo de voo do interceptador, em segundos. */
AirDefense.prototype.MIN_INTERCEPT_TIME = 0.4;

AirDefense.prototype.GetRange = function()
{
	return ApplyValueModificationsToEntity("AirDefense/Range", +this.template.Range, this.entity);
};

AirDefense.prototype.GetInterceptedTypes = function()
{
	const types = this.template.Intercepts;
	return String(types._string !== undefined ? types._string : types).trim().split(/\s+/);
};

AirDefense.prototype.CanIntercept = function(type)
{
	return this.GetInterceptedTypes().indexOf(type) != -1;
};

AirDefense.prototype.GetOwner = function()
{
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	return cmpOwnership ? cmpOwnership.GetOwner() : INVALID_PLAYER;
};

/**
 * Se a torre protege contra ataques do jogador `player`.
 */
AirDefense.prototype.IsHostileTo = function(player)
{
	const owner = this.GetOwner();
	if (owner <= 0)
		return false;
	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	return !!cmpDiplomacy && cmpDiplomacy.IsEnemy(player);
};

/**
 * @return {number} Distância horizontal até `position` ({x, z}), ou Infinity.
 */
AirDefense.prototype.GetDistanceTo = function(position)
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return Infinity;
	const pos = cmpPosition.GetPosition2D();
	return Math.hypot(pos.x - position.x, pos.y - position.z);
};

AirDefense.prototype.Covers = function(position)
{
	return this.GetDistanceTo(position) <= this.GetRange();
};

AirDefense.prototype.GetLaunchPoint = function()
{
	const pos = Engine.QueryInterface(this.entity, IID_Position).GetPosition();
	return new Vector3D(pos.x, pos.y + +this.template.LaunchHeight, pos.z);
};

/**
 * Dispara um interceptador contra um alvo em movimento.
 *
 * @param {function} predict - Posição 3D (Vector3D) do alvo daqui a t segundos.
 * @param {number} maxTime - Segundos até o alvo cumprir a missão; o
 *   interceptador precisa chegar antes.
 * @return {number} Segundos até a interceptação.
 */
AirDefense.prototype.Engage = function(predict, maxTime)
{
	const launch = this.GetLaunchPoint();
	const speed = +this.template.InterceptorSpeed;
	const limit = Math.max(0.1, maxTime);

	// Ponto de encontro: poucas iterações bastam, o alvo é bem mais lento.
	let time = 0;
	let target = predict(0);
	for (let i = 0; i < 4; ++i)
	{
		time = Math.min(limit, Math.max(this.MIN_INTERCEPT_TIME, launch.distanceTo(target) / speed));
		target = predict(time);
	}

	// O ProjectileManager recebe a velocidade horizontal; a vertical sai
	// do tempo de voo (sem gravidade, o míssil vai em linha reta).
	const horizontalSpeed = Math.max(1, launch.horizDistanceTo(target)) / time;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_ProjectileManager).LaunchProjectileAtPoint(
		launch, target, horizontalSpeed, 0,
		this.template.InterceptorActor, this.template.InterceptActor, +this.template.InterceptActorLifetime);

	if (this.template.LaunchSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(this.template.LaunchSound, launch);

	return time;
};

AirDefense.prototype.PlayInterceptSound = function(position)
{
	if (this.template.InterceptSound)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_SoundManager).PlaySoundGroupAtPosition(this.template.InterceptSound, position);
};

/**
 * Círculo do raio protegido, mostrado com os alcances de aura ao selecionar.
 */
AirDefense.prototype.GetRangeOverlays = function()
{
	return [{
		"radius": this.GetRange(),
		"texture": "outline_border.png",
		"textureMask": "outline_border_mask.png",
		"thickness": 0.35
	}];
};

Engine.RegisterComponentType(IID_AirDefense, "AirDefense", AirDefense);

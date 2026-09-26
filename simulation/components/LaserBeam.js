/**
 * Arma de feixe laser (ex.: torre do vehicle_special mcc).
 *
 * Com este componente, o ataque Ranged da entidade deixa de lançar
 * projétil (ver Attack.js): o dano é instantâneo e um feixe é desenhado da
 * boca da arma até o alvo por Duration segundos.
 *
 * O feixe é uma entidade de efeito criada a partir de um actor de partículas
 * em espaço local (art/actors/props/units/weapons/laser_beam/beam_NNN.xml),
 * girada e inclinada na direção do alvo; o feixe é desenhado ao longo do
 * eixo local -Z, que é a frente de qualquer modelo no 0 A.D. Como actors não podem ser
 * escalados, há um actor por comprimento, de BeamStep em BeamStep metros.
 */
function LaserBeam() {}

LaserBeam.prototype.Schema =
	"<a:help>Turns the Ranged attack into an instant laser beam.</a:help>" +
	"<element name='BeamActorPrefix' a:help='Actor path prefix; the beam length in metres (3 digits) and .xml are appended.'>" +
		"<text/>" +
	"</element>" +
	"<element name='BeamStep' a:help='Metres between available beam lengths.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='MaxBeamLength'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='Duration' a:help='Seconds the beam stays visible.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='MuzzleHeight' a:help='Metres above the entity. Defaults to the Ranged projectile LaunchPoint.'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='TargetHeight' a:help='Metres above the target position that the beam aims at.'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='ImpactActor'>" +
			"<text/>" +
		"</element>" +
	"</optional>";

LaserBeam.prototype.GetMuzzlePosition = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return undefined;

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
	{
		const launchPoint = cmpVisual.GetProjectileLaunchPoint();
		if (launchPoint.length() > 0)
			return launchPoint;
	}

	let height = this.template.MuzzleHeight;
	if (height === undefined)
	{
		const cmpAttack = Engine.QueryInterface(this.entity, IID_Attack);
		const projectile = cmpAttack && cmpAttack.template.Ranged && cmpAttack.template.Ranged.Projectile;
		height = projectile && projectile.LaunchPoint ? projectile.LaunchPoint["@y"] : 2;
	}
	return Vector3D.add(cmpPosition.GetPosition(), new Vector3D(0, +height, 0));
};

/**
 * Desenha o feixe até o alvo. O dano é aplicado pelo Attack.
 * @param {Vector3D} targetPosition - Posição do alvo (no chão).
 */
LaserBeam.prototype.Fire = function(targetPosition)
{
	const muzzle = this.GetMuzzlePosition();
	if (!muzzle)
		return;

	const end = new Vector3D(targetPosition.x, targetPosition.y + +(this.template.TargetHeight || 1.2), targetPosition.z);
	const dx = end.x - muzzle.x;
	const dy = end.y - muzzle.y;
	const dz = end.z - muzzle.z;
	const horizontal = Math.hypot(dx, dz);
	const length = Math.hypot(horizontal, dy);

	const step = +this.template.BeamStep;
	const bucket = Math.max(step, Math.min(+this.template.MaxBeamLength, Math.round(length / step) * step));
	const actor = this.template.BeamActorPrefix + String(Math.round(bucket)).padStart(3, "0") + ".xml";

	const cmpManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager);
	const beam = Engine.AddEntity("actor|" + actor);
	const cmpBeamPosition = beam != INVALID_ENTITY && Engine.QueryInterface(beam, IID_Position);
	if (cmpBeamPosition)
	{
		cmpBeamPosition.JumpTo(muzzle.x, muzzle.z);
		cmpBeamPosition.SetHeightFixed(muzzle.y);
		cmpBeamPosition.SetYRotation(Math.atan2(dx, dz));
		// O engine soma 180° à rotação Y, então a frente do actor é o eixo
		// local -Z; nele, rotação positiva em X levanta a ponta.
		cmpBeamPosition.SetXZRotation(Math.atan2(dy, horizontal), 0);
		Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
			SYSTEM_ENTITY, IID_AirSupportManager, "RemoveEffect", +this.template.Duration * 1000, beam);
	}

	if (this.template.ImpactActor)
		cmpManager.SpawnEffect({
			"actor": this.template.ImpactActor,
			"position": { "x": targetPosition.x, "z": targetPosition.z },
			"lifetime": +this.template.Duration
		});
};

Engine.RegisterComponentType(IID_LaserBeam, "LaserBeam", LaserBeam);

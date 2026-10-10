/**
 * Operador de drones: em vez de disparar um projétil, o ataque à distância
 * (ver Attack.PerformAttack) solta um enxame de pequenos drones que voam até
 * o alvo e o atacam (o drone é uma unidade comum, com ataque próprio).
 *
 * O ritmo é o do próprio ataque: PrepareTime antes do primeiro enxame e
 * RepeatTime entre um enxame e o seguinte. MaxActive limita quantos drones
 * deste operador podem estar vivos ao mesmo tempo: cada ataque só solta os
 * que faltam para o limite.
 *
 * Prone (opcional, desligado nos templates atuais): inclina o corpo inteiro
 * para a frente, para actors sem animação de bruços. Com Prone false a
 * inclinação herdada na troca compactado/descompactado é desfeita.
 */
function DroneLauncher() {}

DroneLauncher.prototype.Schema =
	"<a:help>The ranged attack launches a swarm of small drones at the target instead of a projectile.</a:help>" +
	"<a:example>" +
		"<DroneTemplate>units/mla/drone_pvp</DroneTemplate>" +
		"<Count>2</Count>" +
		"<MaxActive>3</MaxActive>" +
		"<LaunchInterval>1000</LaunchInterval>" +
		"<Prone>true</Prone>" +
	"</a:example>" +
	"<element name='DroneTemplate'><text/></element>" +
	"<element name='Count' a:help='Drones per attack.'><data type='positiveInteger'/></element>" +
	"<optional>" +
		"<element name='MaxActive' a:help='Most drones launched by this unit that can be alive at the same time.'><data type='positiveInteger'/></element>" +
	"</optional>" +
	"<element name='LaunchInterval' a:help='Milliseconds between two drones of the same swarm.'><data type='nonNegativeInteger'/></element>" +
	"<element name='Prone' a:help='Tilt the whole body forward to lie on the ground, for actors without a prone animation.'><data type='boolean'/></element>";

/** Inclinação do corpo deitado (radianos) e altura para não afundar no chão. */
DroneLauncher.prototype.PRONE_ANGLE = -1.45;
DroneLauncher.prototype.PRONE_HEIGHT = 0.3;
/** Distância do operador em que os drones aparecem, em metros. */
DroneLauncher.prototype.LAUNCH_OFFSET = 1.5;

DroneLauncher.prototype.Init = function()
{
	// Drones soltos por esta unidade (os mortos saem da lista em GetActiveDrones).
	this.drones = [];

	// A troca compactado/descompactado copia a rotação da entidade antiga
	// depois de criar a nova; a pose é aplicada logo em seguida.
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(this.entity, IID_DroneLauncher, "ApplyPose", 1, null);
};

DroneLauncher.prototype.ApplyPose = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition)
		return;

	const prone = this.template.Prone == "true";
	cmpPosition.SetXZRotation(prone ? this.PRONE_ANGLE : 0, 0);
	cmpPosition.SetHeightOffset(prone ? this.PRONE_HEIGHT : 0);
};

DroneLauncher.prototype.GetCount = function()
{
	return Math.max(1, Math.round(ApplyValueModificationsToEntity("DroneLauncher/Count", +this.template.Count, this.entity)));
};

DroneLauncher.prototype.GetMaxActive = function()
{
	if (!this.template.MaxActive)
		return Infinity;
	return Math.max(1, Math.round(ApplyValueModificationsToEntity("DroneLauncher/MaxActive", +this.template.MaxActive, this.entity)));
};

/**
 * Drones desta unidade ainda vivos em campo.
 */
DroneLauncher.prototype.GetActiveDrones = function()
{
	this.drones = this.drones.filter(drone => {
		const cmpHealth = Engine.QueryInterface(drone, IID_Health);
		return cmpHealth && cmpHealth.GetHitpoints() > 0;
	});
	return this.drones;
};

/**
 * A troca compactado/descompactado cria outra entidade: ela herda os drones
 * em campo, para o limite não ser burlado compactando e descompactando.
 */
DroneLauncher.prototype.OnEntityRenamed = function(msg)
{
	const cmpNewLauncher = Engine.QueryInterface(msg.newentity, IID_DroneLauncher);
	if (cmpNewLauncher)
		cmpNewLauncher.drones = this.GetActiveDrones().slice();
};

/**
 * Chamado pelo Attack no lugar do disparo: solta o enxame, um drone de cada
 * vez, sem passar de MaxActive drones vivos.
 */
DroneLauncher.prototype.Launch = function(target)
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	const interval = +this.template.LaunchInterval;
	const count = Math.min(this.GetCount(), this.GetMaxActive() - this.GetActiveDrones().length);
	for (let i = 0; i < count; ++i)
	{
		const data = { "target": target, "index": i, "count": count };
		if (i == 0 || !interval)
			this.LaunchDrone(data);
		else
			cmpTimer.SetTimeout(this.entity, IID_DroneLauncher, "LaunchDrone", i * interval, data);
	}
};

DroneLauncher.prototype.LaunchDrone = function(data)
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpOwnership || cmpOwnership.GetOwner() <= 0)
		return;
	if (this.GetActiveDrones().length >= this.GetMaxActive())
		return;

	const drone = Engine.AddEntity(this.template.DroneTemplate);
	const cmpDronePosition = drone != INVALID_ENTITY && Engine.QueryInterface(drone, IID_Position);
	if (!cmpDronePosition)
	{
		error("DroneLauncher: could not create drone '" + this.template.DroneTemplate + "'.");
		return;
	}

	// Os drones saem em leque em volta do operador, já virados para o alvo.
	const pos = cmpPosition.GetPosition2D();
	const angle = 2 * Math.PI * data.index / data.count;
	cmpDronePosition.JumpTo(pos.x + Math.cos(angle) * this.LAUNCH_OFFSET, pos.y + Math.sin(angle) * this.LAUNCH_OFFSET);

	const cmpTargetPosition = Engine.QueryInterface(data.target, IID_Position);
	const targetAlive = cmpTargetPosition && cmpTargetPosition.IsInWorld();
	if (targetAlive)
	{
		const targetPos = cmpTargetPosition.GetPosition2D();
		cmpDronePosition.SetYRotation(Math.atan2(targetPos.x - pos.x, targetPos.y - pos.y));
	}
	else
		cmpDronePosition.SetYRotation(cmpPosition.GetRotation().y);

	Engine.QueryInterface(drone, IID_Ownership).SetOwner(cmpOwnership.GetOwner());
	this.drones.push(drone);

	// Sem alvo (já morreu), o drone decola e procura inimigos sozinho.
	const cmpUnitAI = Engine.QueryInterface(drone, IID_UnitAI);
	if (cmpUnitAI && targetAlive)
		cmpUnitAI.Attack(data.target, false, false);
};

Engine.RegisterComponentType(IID_DroneLauncher, "DroneLauncher", DroneLauncher);

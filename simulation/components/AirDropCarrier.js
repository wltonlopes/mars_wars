/**
 * Aeronave temporária que lança carga de paraquedas (veículos pesados da
 * Coalizão, pedidos na garagem).
 *
 * Como o StrategicBomber, não usa UnitMotion: voa em linha reta da borda do
 * mapa, passa sobre o alvo e sai pela borda oposta. Ao passar sobre o alvo
 * solta o contêiner (CargoTemplate, com ReinforcementDelivery), que desce
 * sozinho e libera o veículo; a aeronave segue viagem.
 *
 * Defesa aérea (AirDefense): se a aeronave entrar no raio de uma torre
 * inimiga antes de soltar a carga, é abatida e a carga se perde.
 */
function AirDropCarrier() {}

AirDropCarrier.prototype.Schema =
	"<a:help>Temporary aircraft that drops a cargo container over the target.</a:help>" +
	"<element name='Speed' a:help='Metres per second.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='FlightAltitude' a:help='Height above the terrain in metres. Should match Descent/StartHeight of the cargo.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='CargoTemplate' a:help='Container released over the target (needs ReinforcementDelivery).'>" +
		"<text/>" +
	"</element>";

AirDropCarrier.prototype.Init = function()
{
	this.missionId = 0;
	this.provider = INVALID_ENTITY;
	this.path = null;
	this.target = null;
	// Template da unidade que o contêiner entrega.
	this.payload = "";
	// Distância percorrida desde a entrada, ao longo da rota.
	this.travelled = 0;
	this.released = false;
	// { time (ms do jogo), airDefense } quando uma torre já disparou.
	this.interception = null;
};

/**
 * @param {Object} path - Resultado de AirSupport.CreateFlightPath.
 * @param {Object} target - { x, z } onde a carga pousa.
 * @param {string} payload - Template da unidade entregue.
 */
AirDropCarrier.prototype.StartMission = function(missionId, provider, path, target, payload)
{
	this.missionId = missionId;
	this.provider = provider;
	this.path = path;
	this.target = target;
	this.payload = payload;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	cmpPosition.JumpTo(path.entry.x, path.entry.z);
	cmpPosition.SetYRotation(Math.atan2(path.direction.x, path.direction.z));
	cmpPosition.SetHeightOffset(+this.template.FlightAltitude);

	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SelectAnimation("walk", false, 1);
};

AirDropCarrier.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

AirDropCarrier.prototype.GetOwner = function()
{
	return Engine.QueryInterface(this.entity, IID_Ownership).GetOwner();
};

/**
 * Posição 3D ao longo da rota, `distance` metros depois da entrada.
 */
AirDropCarrier.prototype.GetWorldPosition = function(distance)
{
	const point = AirSupport.Offset(this.path.entry, this.path.direction, Math.min(this.path.length, distance));
	const ground = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(point.x, point.z);
	return new Vector3D(point.x, ground + +this.template.FlightAltitude, point.z);
};

AirDropCarrier.prototype.OnUpdate = function(msg)
{
	if (!this.missionId)
		return;

	this.travelled = Math.min(this.path.length, this.travelled + this.template.Speed * msg.turnLength);

	const position = AirSupport.Offset(this.path.entry, this.path.direction, this.travelled);
	Engine.QueryInterface(this.entity, IID_Position).MoveTo(position.x, position.z);

	if (this.interception)
	{
		if (this.GetTime() >= this.interception.time)
		{
			this.ShotDown();
			return;
		}
	}
	else if (!this.released)
		this.CheckAirDefense(position);

	if (!this.released && this.travelled >= this.path.targetDistance)
		this.ReleaseCargo();

	if (this.travelled >= this.path.length)
		this.FinishMission();
};

AirDropCarrier.prototype.CheckAirDefense = function(position)
{
	const cmpManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager);
	const airDefense = cmpManager.FindAirDefense(cmpManager.GetMissionType(this.missionId), this.GetOwner(), position);
	if (airDefense == INVALID_ENTITY)
		return;

	const speed = +this.template.Speed;
	const remaining = Math.max(0, this.path.targetDistance - this.travelled) / speed;
	const time = Engine.QueryInterface(airDefense, IID_AirDefense).Engage(
		t => this.GetWorldPosition(this.travelled + speed * t), remaining);

	this.interception = {
		"time": this.GetTime() + time * 1000,
		"airDefense": airDefense
	};
};

/**
 * Abatida antes de soltar a carga: nada é entregue.
 */
AirDropCarrier.prototype.ShotDown = function()
{
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).MissionIntercepted(
		this.missionId, this.interception.airDefense, this.GetWorldPosition(this.travelled));
	this.FinishMission();
};

/**
 * Solta o contêiner sobre o alvo, alinhado com a rota. Ele é uma entrega
 * avulsa: desce, libera o veículo e se remove sozinho, sem depender da
 * aeronave (que sai do mapa antes).
 */
AirDropCarrier.prototype.ReleaseCargo = function()
{
	this.released = true;

	const cargo = Engine.AddEntity(this.template.CargoTemplate);
	if (cargo == INVALID_ENTITY)
		return;

	const cmpDelivery = Engine.QueryInterface(cargo, IID_ReinforcementDelivery);
	const cmpOwnership = Engine.QueryInterface(cargo, IID_Ownership);
	if (!cmpDelivery || !cmpOwnership)
	{
		error("AirDropCarrier: template '" + this.template.CargoTemplate + "' needs ReinforcementDelivery and Ownership.");
		Engine.DestroyEntity(cargo);
		return;
	}

	cmpOwnership.SetOwner(this.GetOwner());
	cmpDelivery.StartMission(this.missionId, this.provider, this.target, this.payload, { "standalone": true });
	Engine.QueryInterface(cargo, IID_Position).SetYRotation(Math.atan2(this.path.direction.x, this.path.direction.z));
};

/**
 * Se a aeronave for removida por outro motivo, libera o prédio.
 */
AirDropCarrier.prototype.OnDestroy = function()
{
	this.FinishMission();
};

AirDropCarrier.prototype.FinishMission = function()
{
	if (!this.missionId)
		return;

	const missionId = this.missionId;
	this.missionId = 0;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).FinishMission(missionId);
};

Engine.RegisterComponentType(IID_AirDropCarrier, "AirDropCarrier", AirDropCarrier);

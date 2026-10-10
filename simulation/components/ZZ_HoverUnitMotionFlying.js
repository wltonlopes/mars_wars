// Aeronaves que pairam (UnitMotionFlying com StationaryDistance, como o drone
// FPV): no componente original, StopMoving - chamado pela UnitAI quando a
// unidade chega ao alvo e começa a atirar - alterna para o pouso. Um
// helicóptero ou quadricóptero deve parar no ar onde está, sem descer.
{
	const hoverStopMoving = UnitMotionFlying.prototype.StopMoving;
	const hoverFaceTowardsPoint = UnitMotionFlying.prototype.FaceTowardsPoint;

	UnitMotionFlying.prototype.CanHover = function()
	{
		return !!this.template.StationaryDistance;
	};

	UnitMotionFlying.prototype.StopMoving = function()
	{
		if (!this.CanHover())
		{
			hoverStopMoving.call(this);
			return;
		}

		// Sem alvo o OnUpdate não mexe na posição: a aeronave fica parada na
		// altura em que está, nivelada.
		this.hasTarget = false;
		this.landing = false;
		this.speed = 0;
		this.pitch = 0;
		this.roll = 0;
		const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (cmpPosition)
			cmpPosition.SetXZRotation(0, 0);
	};

	const hoverOnUpdate = UnitMotionFlying.prototype.OnUpdate;

	// Parada, a aeronave sobe (ou desce) até a altura de voo e fica lá: assim
	// ela também decola na vertical quando o alvo já está no alcance e a
	// UnitAI nem chega a pedir movimento.
	UnitMotionFlying.prototype.OnUpdate = function(msg)
	{
		if (!this.CanHover() || this.hasTarget)
		{
			hoverOnUpdate.call(this, msg);
			return;
		}

		const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			return;

		const pos = cmpPosition.GetPosition();
		const ground = Math.max(
			Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain).GetGroundLevel(pos.x, pos.z),
			Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager).GetWaterLevel(pos.x, pos.z));
		const hoverHeight = ground + +this.template.FlyingHeight;
		this.onGround = false;
		if (pos.y == hoverHeight)
			return;

		const step = msg.turnLength * this.template.ClimbRate;
		cmpPosition.SetHeightFixed(pos.y < hoverHeight ? Math.min(hoverHeight, pos.y + step) : Math.max(hoverHeight, pos.y - step));
	};

	// Pairando, a aeronave gira no lugar para encarar o alvo em que atira (o
	// componente original ignora o pedido, pois o avião só vira voando).
	UnitMotionFlying.prototype.FaceTowardsPoint = function(x, z)
	{
		if (!this.CanHover() || this.hasTarget)
		{
			hoverFaceTowardsPoint.call(this, x, z);
			return;
		}

		const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			return;
		const pos = cmpPosition.GetPosition2D();
		if (pos.x != x || pos.y != z)
			cmpPosition.TurnTo(Math.atan2(x - pos.x, z - pos.y));
	};
}

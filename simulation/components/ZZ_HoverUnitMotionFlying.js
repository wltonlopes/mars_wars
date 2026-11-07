// Aeronaves que pairam (UnitMotionFlying com StationaryDistance, como o drone
// FPV e o helicóptero): no componente original, StopMoving - chamado pela UnitAI quando a
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
		if (!this.CanHover())
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
		const flyingHeight = +this.template.FlyingHeight;
		// Helicóptero (VerticalFlight): decola e pousa na vertical.
		const cmpVertical = Engine.QueryInterface(this.entity, IID_VerticalFlight);

		if (this.hasTarget)
		{
			if (cmpVertical)
				cmpVertical.ResetIdle();
			// Decolagem vertical: sobe parado, já virando para o destino, até
			// quase a altura de voo; depois segue como as outras aeronaves.
			if (cmpVertical && pos.y - ground < 0.85 * flyingHeight)
			{
				this.onGround = false;
				this.landing = false;
				this.speed = 0;
				this.pitch = 0;
				this.roll = 0;
				cmpPosition.SetXZRotation(0, 0);
				cmpPosition.TurnTo(Math.atan2(this.targetX - pos.x, this.targetZ - pos.z));
				cmpPosition.SetHeightFixed(Math.min(ground + flyingHeight, pos.y + msg.turnLength * this.template.ClimbRate));
				return;
			}
			hoverOnUpdate.call(this, msg);
			return;
		}

		// Sem destino: paira na altura de voo ou, ocioso há tempo, pousa na vertical.
		const landing = cmpVertical && cmpVertical.ShouldLand(msg.turnLength);
		const wanted = landing ? ground : ground + flyingHeight;
		this.onGround = landing && pos.y <= ground + 0.01;
		if (pos.y == wanted)
			return;

		// Desce mais devagar que sobe, como um pouso de verdade.
		const step = msg.turnLength * this.template.ClimbRate * (pos.y > wanted && landing ? 0.6 : 1);
		cmpPosition.SetHeightFixed(pos.y < wanted ? Math.min(wanted, pos.y + step) : Math.max(wanted, pos.y - step));
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

// Aeronaves (UnitMotionFlying) nas formações do 0AD. O componente original
// não tem MoveToFormationOffset, que a UnitAI chama para cada membro da
// formação; aqui a aeronave voa até seu lugar na formação, que acompanha a
// posição e a rotação do controlador a cada turno.
{
	// Distância em que a aeronave está no lugar quando a formação para. Maior
	// que o avanço de um turno a toda velocidade, para não passar direto.
	const FORMATION_ARRIVAL_RANGE = 8;

	/**
	 * Lugar na formação: o deslocamento girado pela rotação do controlador
	 * (como o CCmpUnitMotion faz).
	 */
	function GetFormationSlot(target, offsetX, offsetZ)
	{
		const cmpTargetPosition = Engine.QueryInterface(target, IID_Position);
		if (!cmpTargetPosition || !cmpTargetPosition.IsInWorld())
			return null;

		const pos = cmpTargetPosition.GetPosition2D();
		const angle = cmpTargetPosition.GetRotation().y;
		const s = Math.sin(angle);
		const c = Math.cos(angle);
		return {
			"x": pos.x + offsetX * c + offsetZ * s,
			"z": pos.y + offsetZ * c - offsetX * s
		};
	}

	/**
	 * A formação parada reenvia a ordem de entrar em formação a cada 2 s. Uma
	 * unidade de terra já no lugar a conclui na hora; uma aeronave decolaria,
	 * daria a volta e pousaria de novo. Por isso, com a formação parada, a
	 * aeronave pousada (ou pousando) perto do seu lugar fica onde está. "Perto"
	 * inclui o quanto ela avança enquanto freia para pousar.
	 */
	UnitMotionFlying.prototype.IsSettledInFormation = function(target, slot)
	{
		if (this.hasTarget && !this.landing)
			return false;

		const cmpTargetAI = Engine.QueryInterface(target, IID_UnitAI);
		if (!cmpTargetAI || cmpTargetAI.GetCurrentState() != "FORMATIONCONTROLLER.IDLE")
			return false;

		const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			return false;

		const maxSpeed = +this.template.MaxSpeed;
		const landingSpeed = +this.template.LandingSpeed;
		const slowingRate = Math.max(+this.template.SlowingRate, 0.1);
		const landingDistance = Math.max(0, maxSpeed * maxSpeed - landingSpeed * landingSpeed) / (2 * slowingRate) + FORMATION_ARRIVAL_RANGE;

		const pos = cmpPosition.GetPosition2D();
		return Math.euclidDistance2DSquared(pos.x, pos.y, slot.x, slot.z) <= landingDistance * landingDistance;
	};

	UnitMotionFlying.prototype.MoveToFormationOffset = function(target, x, z)
	{
		const slot = GetFormationSlot(target, x, z);
		if (slot && this.IsSettledInFormation(target, slot))
		{
			// A UnitAI conclui a ordem na hora e chama StopMoving, que aqui
			// inverteria o pouso e faria a aeronave decolar.
			this.formationTarget = undefined;
			this.reachedTarget = true;
			this.ignoreNextStop = true;
			return true;
		}

		this.ignoreNextStop = false;
		this.formationTarget = target;
		this.formationOffsetX = x;
		this.formationOffsetZ = z;
		this.hasTarget = true;
		this.landing = false;
		this.reachedTarget = false;
		this.targetMinRange = 0;
		this.UpdateFormationTarget();
		return true;
	};

	/**
	 * Enquanto o controlador anda, a aeronave só o acompanha; ela avisa que
	 * chegou só depois que ele para.
	 */
	UnitMotionFlying.prototype.UpdateFormationTarget = function()
	{
		const slot = GetFormationSlot(this.formationTarget, this.formationOffsetX, this.formationOffsetZ);
		if (!slot)
			return false;

		this.targetX = slot.x;
		this.targetZ = slot.z;

		const cmpTargetMotion = Engine.QueryInterface(this.formationTarget, IID_UnitMotion);
		this.targetMaxRange = cmpTargetMotion && cmpTargetMotion.IsMoveRequested() ? 0 : FORMATION_ARRIVAL_RANGE;
		return true;
	};

	// Usados pela UnitAI ao sair do lugar na formação. O voo controla o
	// próprio ângulo, então o valor só é guardado.
	UnitMotionFlying.prototype.SetFacePointAfterMove = function(facePointAfterMove)
	{
		this.facePointAfterMove = facePointAfterMove;
	};

	UnitMotionFlying.prototype.GetFacePointAfterMove = function()
	{
		return this.facePointAfterMove !== false;
	};

	const formationFlyingOnUpdate = UnitMotionFlying.prototype.OnUpdate;
	UnitMotionFlying.prototype.OnUpdate = function(msg)
	{
		if (this.formationTarget && this.hasTarget && !this.landing && !this.UpdateFormationTarget())
			this.formationTarget = undefined;

		formationFlyingOnUpdate.call(this, msg);
	};

	// Qualquer outra ordem de movimento encerra o voo em formação.
	for (const method of ["MoveToPointRange", "MoveToTargetRange"])
	{
		const original = UnitMotionFlying.prototype[method];
		UnitMotionFlying.prototype[method] = function(...args)
		{
			this.formationTarget = undefined;
			this.ignoreNextStop = false;
			return original.apply(this, args);
		};
	}

	const formationFlyingStopMoving = UnitMotionFlying.prototype.StopMoving;
	UnitMotionFlying.prototype.StopMoving = function()
	{
		this.formationTarget = undefined;
		if (this.ignoreNextStop)
		{
			this.ignoreNextStop = false;
			return;
		}
		formationFlyingStopMoving.call(this);
	};
}

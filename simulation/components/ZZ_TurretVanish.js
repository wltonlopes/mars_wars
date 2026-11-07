// Mars Wars: quando o veículo é destruído, as torretas presas a ele
// (TurretPoint com <Ejectable>false</Ejectable>) desaparecem junto. No jogo
// base o EjectOrKill força a saída (ignorando Ejectable) e a torre caía no
// chão como uma unidade solta.
{
	const turretHolderEjectOrKill = TurretHolder.prototype.EjectOrKill;
	TurretHolder.prototype.EjectOrKill = function(entities)
	{
		const fixed = [];
		const others = [];
		for (const entity of entities)
		{
			const cmpTurretable = Engine.QueryInterface(entity, IID_Turretable);
			if (cmpTurretable && cmpTurretable.HolderID() == this.entity && !cmpTurretable.ejectable)
				fixed.push(entity);
			else
				others.push(entity);
		}

		for (const entity of fixed)
		{
			this.LeaveTurretPoint(entity, true);
			Engine.DestroyEntity(entity);
		}
		if (fixed.length)
			Engine.PostMessage(this.entity, MT_TurretsChanged, {
				"added": [],
				"removed": fixed
			});

		if (others.length)
			turretHolderEjectOrKill.call(this, others);
	};
}

// Modern Wars: torres criadas pelo template (TurretPoint com <Template>) só
// nascem no primeiro instante de jogo. O TurretHolder do jogo base as cria
// assim que o veículo ganha dono; num mapa aleatório, as unidades iniciais
// ganham dono enquanto o mapa ainda está sendo carregado, e a torre criada
// nesse momento pega o número de entidade que o mapa reservou para a peça
// seguinte: o jogo para com 'Assertion failed: "!EntityExists(ent)"'. Isso
// acontecia com o LMV (metralhadora em torre) entre as unidades iniciais.
{
	const turretHolderCreateSubunit = TurretHolder.prototype.CreateSubunit;
	TurretHolder.prototype.CreateSubunit = function(turretPointName)
	{
		const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
		if (this.subunitsReady || !cmpTimer || cmpTimer.GetTime() > 0)
			return turretHolderCreateSubunit.call(this, turretPointName);

		if (!this.deferredSubunits)
		{
			this.deferredSubunits = [];
			cmpTimer.SetTimeout(this.entity, IID_TurretHolder, "CreateDeferredSubunits", 1, null);
		}
		if (this.deferredSubunits.indexOf(turretPointName) == -1)
			this.deferredSubunits.push(turretPointName);
		return true;
	};

	TurretHolder.prototype.CreateDeferredSubunits = function()
	{
		this.subunitsReady = true;
		for (const turretPointName of this.deferredSubunits || [])
			this.CreateSubunit(turretPointName);
		delete this.deferredSubunits;
	};
}

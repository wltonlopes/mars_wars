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

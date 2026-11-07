/**
 * Aeronaves (classe Aircraft) mortas em voo caem: no lugar do cadáver, o
 * AirSupportManager solta um destroço com a mesma aparência que despenca
 * girando, com fumaça e fogo, e explode no chão (o mesmo das aeronaves de
 * apoio abatidas). No chão (pousadas) morrem como qualquer unidade.
 * Drones kamikaze que explodem no mergulho não passam por aqui.
 */
{
	const handleDeath = Health.prototype.HandleDeath;
	Health.prototype.HandleDeath = function()
	{
		const cmpIdentity = Engine.QueryInterface(this.entity, IID_Identity);
		const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (!cmpIdentity || !cmpIdentity.HasClass("Aircraft") || !cmpPosition || !cmpPosition.IsInWorld() ||
			cmpPosition.GetHeightOffset() < 4)
		{
			handleDeath.call(this);
			return;
		}
		const cmpDeathDamage = Engine.QueryInterface(this.entity, IID_DeathDamage);
		if (cmpDeathDamage)
			cmpDeathDamage.CauseDeathDamage();
		PlaySound("death", this.entity);
		Engine.QueryInterface(SYSTEM_ENTITY, IID_AirSupportManager).SpawnWreck(this.entity);
		Engine.DestroyEntity(this.entity);
	};
}

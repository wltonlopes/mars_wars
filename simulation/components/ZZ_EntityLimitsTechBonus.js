// Mars Wars: tecnologias podem ampliar limites de categoria (ex.: o limite de
// trabalhadores) com modificações em "EntityLimits/Limits/<Categoria>" que
// afetam o jogador (affects: Player). O limite do template e os
// LimitChangers continuam valendo; o bônus das tecnologias é somado por cima.
{
	EntityLimits.prototype.GetTechBonus = function(category)
	{
		return ApplyValueModificationsToEntity("EntityLimits/Limits/" + category, 0, this.entity);
	};

	const entityLimitsAllowedToCreate = EntityLimits.prototype.AllowedToCreate;
	EntityLimits.prototype.AllowedToCreate = function(limitType, category, count, templateName, matchLimit)
	{
		const bonus = this.limit[category] !== undefined ? this.GetTechBonus(category) : 0;
		if (!bonus)
			return entityLimitsAllowedToCreate.call(this, limitType, category, count, templateName, matchLimit);

		this.limit[category] += bonus;
		try
		{
			return entityLimitsAllowedToCreate.call(this, limitType, category, count, templateName, matchLimit);
		}
		finally
		{
			this.limit[category] -= bonus;
		}
	};

	const entityLimitsGetLimits = EntityLimits.prototype.GetLimits;
	EntityLimits.prototype.GetLimits = function()
	{
		const limits = clone(entityLimitsGetLimits.call(this));
		for (const category in limits)
			if (limits[category] !== undefined)
				limits[category] += this.GetTechBonus(category);
		return limits;
	};
}

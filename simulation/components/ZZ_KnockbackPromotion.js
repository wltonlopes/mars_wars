{
	const knockbackPromote = Promotion.prototype.Promote;

	// A promoção troca a entidade e copia a altura: uma unidade arremessada por
	// uma explosão (Resistance.ApplyKnockback) pousa antes, senão ficaria no ar.
	Promotion.prototype.Promote = function(promotedTemplateName)
	{
		const cmpResistance = Engine.QueryInterface(this.entity, IID_Resistance);
		if (cmpResistance && cmpResistance.CancelKnockback)
			cmpResistance.CancelKnockback();

		return knockbackPromote.call(this, promotedTemplateName);
	};
}

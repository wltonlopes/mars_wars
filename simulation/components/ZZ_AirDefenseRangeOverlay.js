// Mostra o raio protegido da defesa aérea (AirDefense) junto com os alcances
// de aura, quando a torre está selecionada.
{
	const airDefenseUpdateRangeOverlays = RangeOverlayManager.prototype.UpdateRangeOverlays;

	RangeOverlayManager.prototype.UpdateRangeOverlays = function(componentName)
	{
		airDefenseUpdateRangeOverlays.call(this, componentName);

		if (componentName != "Auras")
			return;

		const cmpAirDefense = Engine.QueryInterface(this.entity, IID_AirDefense);
		if (!cmpAirDefense)
			return;

		const cmpAuras = Engine.QueryInterface(this.entity, IID_Auras);
		this.rangeVisualizations.set("Auras",
			(cmpAuras ? cmpAuras.GetRangeOverlays() : []).concat(cmpAirDefense.GetRangeOverlays()));
	};
}

// Mars Wars: unidades com Camouflage ficam ocultas para inimigos que não
// estejam perto o bastante (ver Camouflage.js), mesmo dentro da visão deles.
{
	// Mesmos valores de VIS_* em Visibility.js (constantes daquele script).
	const CAMO_VIS_HIDDEN = 0;
	const CAMO_VIS_VISIBLE = 2;
	const visibilityGetVisibility = Visibility.prototype.GetVisibility;
	Visibility.prototype.GetVisibility = function(player, isVisible, isExplored)
	{
		const cmpCamouflage = Engine.QueryInterface(this.entity, IID_Camouflage);
		if (!cmpCamouflage || this.preview || this.corpse)
			return visibilityGetVisibility.call(this, player, isVisible, isExplored);
		if (!isVisible)
			return CAMO_VIS_HIDDEN;
		return cmpCamouflage.IsVisibleTo(player) ? CAMO_VIS_VISIBLE : CAMO_VIS_HIDDEN;
	};
}

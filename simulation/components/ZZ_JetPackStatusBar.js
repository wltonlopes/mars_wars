/**
 * Barra de combustível do jetpack (JetPack.js), fina, logo acima da vida.
 * Usa as texturas da barra de "pack" do jogo base.
 */
{
	const sprites = StatusBars.prototype.Sprites;
	sprites.splice(sprites.indexOf("HealthBar"), 0, "JetPackFuelBar");

	StatusBars.prototype.AddJetPackFuelBar = function(cmpOverlayRenderer, yoffset)
	{
		const cmpJetPack = Engine.QueryInterface(this.entity, IID_JetPack);
		if (!cmpJetPack || !this.enabled)
			return 0;
		return this.AddBar(cmpOverlayRenderer, yoffset, "pack", cmpJetPack.GetFuel() / cmpJetPack.GetMaxFuel(), 1/2);
	};
}

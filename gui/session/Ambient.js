/**
 * This class is concerned with playing an ambient track, birds chirping etc.
 *
 * Mars Wars: em mapas de Marte (palavra-chave "mars") toca o vento marciano
 * em vez dos pássaros; os demais mapas mantêm a trilha original.
 */
class Ambient
{
	constructor()
	{
		Engine.PlayAmbientSound(pickRandom(this.IsMarsMap() ? this.MarsTracks : this.Tracks), true);
	}

	IsMarsMap()
	{
		try
		{
			const data = new MapCache().getMapData(g_InitAttributes.mapType, g_InitAttributes.map);
			return (data?.settings?.Keywords || []).indexOf("mars") != -1;
		}
		catch (err)
		{
			return false;
		}
	}
}

/**
 * TODO: Let the map decide the tracks.
 */
Ambient.prototype.Tracks = [
	"audio/ambient/dayscape/day_temperate_gen_03.ogg"
];

/** Vento de Marte, sem pássaros. */
Ambient.prototype.MarsTracks = [
	"audio/ambient/mars/mars_wind.ogg"
];

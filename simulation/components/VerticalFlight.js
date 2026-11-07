/**
 * Voo vertical (helicóptero). Usado por ZZ_HoverUnitMotionFlying.js em
 * aeronaves que pairam (UnitMotionFlying com StationaryDistance):
 *  - decolagem vertical: com uma ordem, a aeronave sobe parada até a altura
 *    de voo e só então segue para o destino;
 *  - pouso vertical: sem ordens (UnitAI ociosa) por LandDelay segundos, ela
 *    desce parada até o chão; qualquer ordem ou combate a faz decolar de novo.
 */
function VerticalFlight() {}

VerticalFlight.prototype.Schema =
	"<a:help>Vertical take-off and landing for hovering aircraft.</a:help>" +
	"<a:example>" +
		"<LandDelay>6</LandDelay>" +
	"</a:example>" +
	"<element name='LandDelay' a:help='Seconds idle in the air before landing.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>";

VerticalFlight.prototype.Init = function()
{
	this.idleTime = 0;
};

/**
 * Chamado a cada turno em que a aeronave está sem destino.
 * @return {boolean} Se ela deve pousar (está ociosa há LandDelay segundos).
 */
VerticalFlight.prototype.ShouldLand = function(turnLength)
{
	const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	if (!cmpUnitAI || !cmpUnitAI.IsIdle())
	{
		this.idleTime = 0;
		return false;
	}
	this.idleTime += turnLength;
	return this.idleTime >= +this.template.LandDelay;
};

VerticalFlight.prototype.ResetIdle = function()
{
	this.idleTime = 0;
};

Engine.RegisterComponentType(IID_VerticalFlight, "VerticalFlight", VerticalFlight);

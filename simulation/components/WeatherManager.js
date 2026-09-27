/**
 * Eventos de clima marciano (entidade do sistema).
 *
 * De tempos em tempos sorteia um evento: redemoinhos de areia (DustDevil) ou
 * uma tempestade de areia com raios (Sandstorm). Todos os jogadores são
 * avisados. Também cria entidades temporárias (ex.: os raios) e remove
 * depois de um tempo.
 *
 * Os eventos também podem ser chamados pelos cheats "martian dust devil" e
 * "martian sandstorm" (com cheats ativados na partida).
 */
function WeatherManager() {}

WeatherManager.prototype.Schema =
	"<a:component type='system'/><empty/>";

/** Liga/desliga os eventos automáticos (os cheats funcionam sempre). */
WeatherManager.prototype.ENABLED = true;

/** Primeiro evento, e intervalo entre eventos, em segundos de jogo. */
WeatherManager.prototype.FIRST_EVENT = [300, 420];
WeatherManager.prototype.EVENT_INTERVAL = [240, 420];

/** Chance de cada evento ser sorteado (somam 1). */
WeatherManager.prototype.EVENT_WEIGHTS = {
	"dust_devil": 0.6,
	"sandstorm": 0.4
};

/** Quantos redemoinhos se formam juntos. */
WeatherManager.prototype.DUST_DEVIL_COUNT = [1, 3];

WeatherManager.prototype.TEMPLATES = {
	"dust_devil": "special/weather/dust_devil",
	"sandstorm": "special/weather/sandstorm"
};

WeatherManager.prototype.MESSAGES = {
	"dust_devil": markForTranslation("Dust devils are forming on the Martian plains."),
	"sandstorm": markForTranslation("A Martian sandstorm with lightning is sweeping across the map: %(time)s.")
};

WeatherManager.prototype.Init = function()
{
	this.nextEvent = randFloat(this.FIRST_EVENT[0], this.FIRST_EVENT[1]) * 1000;
};

WeatherManager.prototype.OnUpdate = function()
{
	if (!this.ENABLED)
		return;

	const time = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	if (time < this.nextEvent)
		return;

	this.nextEvent = time + randFloat(this.EVENT_INTERVAL[0], this.EVENT_INTERVAL[1]) * 1000;
	this.StartEvent(this.PickEvent());
};

WeatherManager.prototype.PickEvent = function()
{
	let roll = randFloat(0, 1);
	for (const type in this.EVENT_WEIGHTS)
	{
		roll -= this.EVENT_WEIGHTS[type];
		if (roll <= 0)
			return type;
	}
	return "dust_devil";
};

/**
 * @param {string} type - "dust_devil" ou "sandstorm".
 * @param {Object} [position] - {x, z} perto de onde o evento começa (senão, aleatório).
 * @return {number[]} Entidades criadas.
 */
WeatherManager.prototype.StartEvent = function(type, position)
{
	const template = this.TEMPLATES[type];
	if (!template)
		return [];

	const created = [];
	let duration = 8000;
	if (type == "dust_devil")
	{
		const center = position || WeatherHelper.RandomLandPoint(40);
		const count = randIntInclusive(this.DUST_DEVIL_COUNT[0], this.DUST_DEVIL_COUNT[1]);
		for (let i = 0; i < count; ++i)
		{
			const ent = Engine.AddEntity(template);
			const point = i ? { "x": center.x + randFloat(-40, 40), "z": center.z + randFloat(-40, 40) } : center;
			Engine.QueryInterface(ent, IID_Position).JumpTo(point.x, point.z);
			created.push(ent);
		}
	}
	else
	{
		// Atravessa o mapa passando por `position` (ou por um ponto aleatório).
		const target = position || WeatherHelper.RandomLandPoint(60);
		const angle = randFloat(0, 2 * Math.PI);
		const path = AirSupport.CreateFlightPath(target, { "x": Math.sin(angle), "z": Math.cos(angle) }, 10);
		// Começa já com metade da tempestade dentro do mapa.
		const ent = Engine.AddEntity(template);
		duration = Engine.QueryInterface(ent, IID_Sandstorm).Start(path);
		created.push(ent);
	}

	Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).AddTimeNotification({
		"message": this.MESSAGES[type],
		"translateMessage": true
	}, duration);

	return created;
};

/**
 * Cria a entidade `data.template` em `data.position` ({x, z}) e a remove
 * depois de `data.lifetime` segundos.
 */
WeatherManager.prototype.SpawnTemplate = function(data)
{
	const ent = Engine.AddEntity(data.template);
	const cmpPosition = ent != INVALID_ENTITY && Engine.QueryInterface(ent, IID_Position);
	if (!cmpPosition)
		return;

	cmpPosition.JumpTo(data.position.x, data.position.z);
	cmpPosition.SetYRotation(randFloat(0, 2 * Math.PI));
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
		SYSTEM_ENTITY, IID_WeatherManager, "RemoveEntity", data.lifetime * 1000, ent);
};

WeatherManager.prototype.RemoveEntity = function(ent)
{
	Engine.DestroyEntity(ent);
};

Engine.RegisterSystemComponentType(IID_WeatherManager, "WeatherManager", WeatherManager);

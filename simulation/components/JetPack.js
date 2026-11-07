/**
 * Jetpack (soldados da Coalizão): a unidade voa enquanto anda ou combate e
 * pousa quando para (depois de LAND_DELAY), para economizar combustível.
 *
 *  - Voando: sobe até <FlightHeight> (subida/descida a <ClimbRate> m/s), anda
 *    mais rápido e enxerga mais longe, mas fica exposta: perde
 *    <ArmourPenalty> níveis de armadura (cada nível = 10% de dano a mais) e
 *    parte da chance de bloqueio.
 *  - Combustível: <Fuel> segundos de voo; gasta 1 por segundo no ar e
 *    recarrega <Refuel> por segundo pousada (só no chão). Sem combustível ela
 *    pousa e só decola de novo com <MinTakeOff> (fração) do tanque.
 *  - Visual: a seleção de variante "jetpack" vira "flying" no ar (jato,
 *    chama, brilho, faíscas e fumaça nos bocais; poeira no chão abaixo; pose
 *    parada) e "ground" no chão; "jetphase" marca as rajadas de decolagem e
 *    pouso (UpdatePhase). Barra de combustível acima da vida
 *    (ZZ_JetPackStatusBar.js).
 *
 * A altura é só visual/posição (Position.SetHeightOffset): a unidade continua
 * usando o caminho do chão.
 */
function JetPack() {}

JetPack.prototype.Schema =
	"<a:help>Jetpack: the unit flies while it has orders and lands when idle to save fuel.</a:help>" +
	"<element name='FlightHeight' a:help='Height above the ground while flying, in metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='ClimbRate' a:help='Climb and descent speed, in metres per second.'><ref name='positiveDecimal'/></element>" +
	"<element name='Fuel' a:help='Seconds of flight on a full tank.'><ref name='positiveDecimal'/></element>" +
	"<element name='Refuel' a:help='Fuel recovered per second while landed.'><ref name='positiveDecimal'/></element>" +
	"<element name='MinTakeOff' a:help='Fraction of the tank needed to take off again after running dry.'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='SpeedMultiplier' a:help='Walk speed multiplier while flying.'><ref name='positiveDecimal'/></element>" +
	"<element name='VisionMultiplier' a:help='Vision range multiplier while flying.'><ref name='positiveDecimal'/></element>" +
	"<element name='ArmourPenalty' a:help='Armour levels lost while flying (each level is 10% more damage).'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='BlockMultiplier' a:help='Block rating multiplier while flying.'><ref name='nonNegativeDecimal'/></element>";

JetPack.prototype.TICK = 100;
/** Parada mais curta que isto (ms) não faz pousar. */
JetPack.prototype.LAND_DELAY = 1500;
/** Velocidade (m/s) a partir da qual a unidade conta como andando. */
JetPack.prototype.MOVING_SPEED = 0.1;
JetPack.prototype.MODIFIER_ID = "JetPackFlight";
JetPack.prototype.VARIANT_KEY = "jetpack";
/**
 * Rajadas de decolagem e pouso: seleção de variante "jet_takeoff" ou
 * "jet_landing" (labareda nos bocais, anel de poeira) enquanto a unidade sobe
 * ou desce abaixo de BURST_HEIGHT metros, por pelo menos BURST_TIME ms; fora
 * disso, "jet_steady".
 */
JetPack.prototype.PHASE_KEY = "jetphase";
JetPack.prototype.BURST_HEIGHT = 2.5;
JetPack.prototype.BURST_TIME = 700;
JetPack.prototype.DAMAGE_TYPES = ["Hack", "Pierce", "Crush"];
/** De quanto em quanto (fração do tanque) a barra de combustível é redesenhada. */
JetPack.prototype.BAR_STEP = 0.05;

JetPack.prototype.Init = function()
{
	this.fuel = +this.template.Fuel;
	this.height = 0;
	this.airborne = false;
	// Esgotou o tanque: só decola de novo com MinTakeOff.
	this.dry = false;
	this.timer = undefined;
	this.lastBarFuel = this.fuel;
	this.phase = "jet_steady";
	this.phaseUntil = 0;
};

JetPack.prototype.GetFuel = function()
{
	return this.fuel;
};

JetPack.prototype.GetMaxFuel = function()
{
	return +this.template.Fuel;
};

JetPack.prototype.IsFlying = function()
{
	return this.airborne;
};

JetPack.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	if (this.timer === undefined)
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(this.entity, IID_JetPack, "Tick", this.TICK, this.TICK, null);
};

JetPack.prototype.StopTimer = function()
{
	if (this.timer === undefined)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	this.timer = undefined;
};

/**
 * Em atividade: andando de fato (velocidade acima de zero) ou em combate.
 * "Não ocioso" não basta: membros de batalhão às vezes ficam presos tentando
 * chegar ao lugar na formação (ordem de andar, velocidade zero).
 */
JetPack.prototype.IsActive = function()
{
	const cmpUnitMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	if (cmpUnitMotion && cmpUnitMotion.GetCurrentSpeed() > this.MOVING_SPEED)
		return true;
	const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	return !!cmpUnitAI && !cmpUnitAI.IsIdle() && cmpUnitAI.GetCurrentState().indexOf("COMBAT") != -1;
};

/** Quer voar: em atividade há pouco (LAND_DELAY), no mundo e com combustível. */
JetPack.prototype.WantsToFly = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld() || this.fuel <= 0)
		return false;
	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	if (this.IsActive())
		this.lastActive = now;
	else if (this.lastActive === undefined || now - this.lastActive > this.LAND_DELAY)
		return false;
	return !this.dry || this.fuel >= +this.template.MinTakeOff * this.GetMaxFuel();
};

JetPack.prototype.Tick = function(data, lateness)
{
	const dt = (this.TICK + lateness) / 1000;
	const max = this.GetMaxFuel();
	const wants = this.WantsToFly();

	if (this.airborne)
	{
		this.fuel = Math.max(0, this.fuel - dt);
		if (this.fuel <= 0)
			this.dry = true;
	}
	else if (this.height <= 0)
	{
		this.fuel = Math.min(max, this.fuel + +this.template.Refuel * dt);
		if (this.dry && this.fuel >= +this.template.MinTakeOff * max)
			this.dry = false;
	}

	// Decola na hora em que quer voar; os efeitos de voo saem só ao tocar o chão.
	if (wants && !this.airborne)
		this.SetAirborne(true);

	const target = wants ? +this.template.FlightHeight : 0;
	const step = +this.template.ClimbRate * dt;
	if (this.height != target)
	{
		this.height = this.height < target ? Math.min(target, this.height + step) : Math.max(target, this.height - step);
		const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (cmpPosition && cmpPosition.IsInWorld())
			cmpPosition.SetHeightOffset(this.height);
	}

	if (!wants && this.airborne && this.height <= 0)
		this.SetAirborne(false);

	this.UpdatePhase(target);

	if (Math.abs(this.fuel - this.lastBarFuel) >= this.BAR_STEP * max || (this.fuel == max) != (this.lastBarFuel == max))
	{
		this.lastBarFuel = this.fuel;
		const cmpStatusBars = Engine.QueryInterface(this.entity, IID_StatusBars);
		if (cmpStatusBars)
			cmpStatusBars.RegenerateSprites();
	}
};

/** Escolhe a rajada de decolagem/pouso perto do chão (ver PHASE_KEY). */
JetPack.prototype.UpdatePhase = function(target)
{
	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	let phase = now < this.phaseUntil ? this.phase : "jet_steady";
	if (this.height > 0 && this.height < this.BURST_HEIGHT && target != this.height)
	{
		const burst = target > this.height ? "jet_takeoff" : "jet_landing";
		if (burst != this.phase || now >= this.phaseUntil)
			this.phaseUntil = now + this.BURST_TIME;
		phase = burst;
	}
	if (phase == this.phase)
		return;
	this.phase = phase;
	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SetVariant(this.PHASE_KEY, phase);
};

JetPack.prototype.SetAirborne = function(airborne)
{
	this.airborne = airborne;
	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	cmpModifiersManager.RemoveAllModifiers(this.MODIFIER_ID, this.entity);
	if (airborne)
	{
		const modifiers = {
			"UnitMotion/WalkSpeed": [{ "multiply": +this.template.SpeedMultiplier, "affects": [] }],
			"Vision/Range": [{ "multiply": +this.template.VisionMultiplier, "affects": [] }],
			"Resistance/BlockRating": [{ "multiply": +this.template.BlockMultiplier, "affects": [] }]
		};
		const penalty = -this.template.ArmourPenalty;
		if (penalty)
			for (const type of this.DAMAGE_TYPES)
				modifiers["Resistance/Entity/Damage/" + type] = [{ "add": penalty, "affects": [] }];
		cmpModifiersManager.AddModifiers(this.MODIFIER_ID, modifiers, this.entity);
	}
	const cmpVisual = Engine.QueryInterface(this.entity, IID_Visual);
	if (cmpVisual)
		cmpVisual.SetVariant(this.VARIANT_KEY, airborne ? "flying" : "ground");
};

/** Ao trocar de template (promoção), a nova entidade herda o tanque. */
JetPack.prototype.OnEntityRenamed = function(msg)
{
	const cmpNew = Engine.QueryInterface(msg.newentity, IID_JetPack);
	if (cmpNew)
		cmpNew.fuel = Math.min(this.fuel, cmpNew.GetMaxFuel());
};

Engine.RegisterComponentType(IID_JetPack, "JetPack", JetPack);

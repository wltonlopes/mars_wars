/**
 * Camuflagem: os inimigos só enxergam a unidade de mais perto.
 *
 *  - em movimento (ou atacando): a visão de cada inimigo vale MovingFactor
 *    (0.5 = -50%);
 *  - parada e sem atacar há StillDelay ms: vale StillFactor (0.25 = -75%).
 *
 * A cada Interval ms, para cada jogador inimigo, verifica se alguma entidade
 * dele (unidades, estruturas) está a menos de "alcance de visão × fator".
 * O resultado alimenta a visibilidade por script (ZZ_VisibilityCamouflage.js)
 * e o Attack.CanAttack: quem não vê a unidade também não consegue mirá-la.
 */
function Camouflage() {}

Camouflage.prototype.Schema =
	"<a:help>Enemies only see this unit within a fraction of their vision range.</a:help>" +
	"<element name='MovingFactor' a:help='Fraction of enemy vision while moving or attacking.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<element name='StillFactor' a:help='Fraction of enemy vision while still and not attacking.'>" +
		"<ref name='positiveDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='StillDelay' a:help='Milliseconds without moving or attacking before the still bonus applies.'>" +
			"<data type='nonNegativeInteger'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Interval' a:help='Check interval, in milliseconds.'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>";

/** Maior alcance de visão considerado (metros). */
Camouflage.prototype.MAX_VISION = 200;

Camouflage.prototype.Init = function()
{
	this.revealedTo = {};
	this.lastActive = 0;
	this.concealed = false;
};

Camouflage.prototype.GetFactor = function()
{
	return this.concealed ? +this.template.StillFactor : +this.template.MovingFactor;
};

/** A unidade está totalmente camuflada (parada e sem atacar)? */
Camouflage.prototype.IsConcealed = function()
{
	return this.concealed;
};

Camouflage.prototype.GetOwner = function()
{
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	return cmpOwnership ? cmpOwnership.GetOwner() : INVALID_PLAYER;
};

/** Aliados (e o próprio dono) sempre veem normalmente. */
Camouflage.prototype.IsFriendly = function(player)
{
	const owner = this.GetOwner();
	if (player == owner || player <= 0 || owner == INVALID_PLAYER)
		return true;
	const cmpDiplomacy = QueryPlayerIDInterface(owner, IID_Diplomacy);
	return !!cmpDiplomacy && cmpDiplomacy.IsAlly(player);
};

/** O jogador consegue ver a unidade (desconsiderando a névoa)? */
Camouflage.prototype.IsVisibleTo = function(player)
{
	return this.IsFriendly(player) || !!this.revealedTo[player];
};

Camouflage.prototype.OnOwnershipChanged = function(msg)
{
	if (msg.to == INVALID_PLAYER)
	{
		this.StopTimer();
		return;
	}
	Engine.QueryInterface(this.entity, IID_Visibility)?.SetActivated(true);
	this.revealedTo = {};
	if (!this.timer)
	{
		const interval = +(this.template.Interval || 500);
		this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
			this.entity, IID_Camouflage, "Tick", 0, interval, null);
	}
};

Camouflage.prototype.OnDiplomacyChanged = function()
{
	this.Tick();
};

Camouflage.prototype.StopTimer = function()
{
	if (!this.timer)
		return;
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
	delete this.timer;
};

Camouflage.prototype.OnDestroy = function()
{
	this.StopTimer();
};

Camouflage.prototype.IsActive = function()
{
	if (Engine.QueryInterface(this.entity, IID_UnitMotion)?.IsMoveRequested())
		return true;
	const state = Engine.QueryInterface(this.entity, IID_UnitAI)?.GetCurrentState() || "";
	return state.indexOf("COMBAT") != -1;
};

Camouflage.prototype.Tick = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return;

	const now = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
	if (this.IsActive())
		this.lastActive = now;
	const concealed = now - this.lastActive >= +(this.template.StillDelay || 1500);
	if (concealed != this.concealed)
	{
		this.concealed = concealed;
		// Pista visual: um pouco mais escura quando totalmente camuflada.
		const shade = concealed ? 0.72 : 1;
		Engine.QueryInterface(this.entity, IID_Visual)?.SetShadingColor(shade, shade, shade, 1);
	}

	const factor = this.GetFactor();
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const pos = cmpPosition.GetPosition2D();
	let changed = false;
	const revealedFor = [];
	for (let player = 1; player < cmpPlayerManager.GetNumPlayers(); ++player)
	{
		if (this.IsFriendly(player))
			continue;
		let seen = false;
		for (const ent of cmpRangeManager.ExecuteQuery(this.entity, 0, this.MAX_VISION * factor, [player], IID_Vision, false))
		{
			const cmpOtherPosition = Engine.QueryInterface(ent, IID_Position);
			if (!cmpOtherPosition || !cmpOtherPosition.IsInWorld())
				continue;
			const range = Engine.QueryInterface(ent, IID_Vision).GetRange() * factor;
			if (cmpOtherPosition.GetPosition2D().distanceToSquared(pos) <= range * range)
			{
				seen = true;
				break;
			}
		}
		if (!!this.revealedTo[player] != seen)
		{
			this.revealedTo[player] = seen;
			changed = true;
			if (seen)
				revealedFor.push(player);
		}
	}
	if (changed)
		cmpRangeManager.RequestVisibilityUpdate(this.entity);
	for (const player of revealedFor)
		this.AlertNearbyEnemies(player);
};

/**
 * Recém-descoberta: unidades ociosas do jogador que já estavam perto não
 * recebem um novo aviso de alcance, então pedimos que procurem alvos.
 */
Camouflage.prototype.AlertNearbyEnemies = function(player)
{
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	for (const ent of cmpRangeManager.ExecuteQuery(this.entity, 0, this.MAX_VISION * this.GetFactor(), [player], IID_UnitAI, false))
	{
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (cmpUnitAI.IsIdle())
			cmpUnitAI.FindNewTargets();
	}
};

Engine.RegisterComponentType(IID_Camouflage, "Camouflage", Camouflage);

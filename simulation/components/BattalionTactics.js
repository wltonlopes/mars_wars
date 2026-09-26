/**
 * Táticas de batalhão, no líder (mixin battalion_leader):
 *
 * - Moral e supressão: tiros recebidos, baixas e a morte do líder derrubam o
 *   moral (atacantes da classe Suppressive, como LMG e gás, pesam mais).
 *   Abalado, o batalhão perde precisão, cadência e velocidade; quebrado,
 *   recua sozinho para o ponto de reforço mais próximo (exceto em "manter
 *   posição"). O moral se recupera quando o batalhão para de ser atingido.
 * - Posturas: normal, linha (mais precisão e cadência), coluna (mais
 *   velocidade) e cobertura (formação espaçada, metade do dano de área).
 * - Níveis: o XP acumulado no líder dá até 3 níveis, que melhoram precisão,
 *   cadência e resistência do moral do batalhão inteiro.
 * - Reforço automático: pede reforço sozinho perto de um ponto de reforço.
 *
 * Os efeitos são aplicados como modificadores (ModifiersManager) em todos os
 * soldados do batalhão. BattalionLeader chama Update() no seu próprio tick.
 */
function BattalionTactics() {}

BattalionTactics.prototype.Schema =
	"<a:help>Battalion morale, postures, experience levels and automatic reinforcement.</a:help>" +
	"<optional><element name='MoraleRecoveryRate' a:help='Morale per second once no longer under fire.'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional><element name='HitMoraleLoss' a:help='Morale lost per hit taken by any soldier.'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional><element name='CasualtyMoraleLoss' a:help='Morale lost per soldier killed.'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional><element name='LeaderLossMoraleLoss' a:help='Morale lost when the leader dies.'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional><element name='SuppressiveMultiplier' a:help='Hit morale loss multiplier for attackers of class Suppressive.'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional><element name='ShakenThreshold'><ref name='nonNegativeDecimal'/></element></optional>" +
	"<optional><element name='BrokenThreshold' a:help='Below this, the battalion retreats.'><ref name='nonNegativeDecimal'/></element></optional>";

BattalionTactics.prototype.POSTURES = ["normal", "line", "column", "cover"];

/** Multiplicadores por postura. columns: null = padrão do batalhão; "all" = uma linha só. */
BattalionTactics.prototype.POSTURE_EFFECTS = {
	"normal": { "spread": 1, "repeat": 1, "walk": 1, "columns": null, "spacing": 1, "splash": 1, "moraleLoss": 1 },
	"line": { "spread": 0.85, "repeat": 0.9, "walk": 0.9, "columns": "all", "spacing": 1, "splash": 1, "moraleLoss": 1 },
	"column": { "spread": 1, "repeat": 1, "walk": 1.2, "columns": 1, "spacing": 0.8, "splash": 1, "moraleLoss": 1 },
	"cover": { "spread": 1, "repeat": 1, "walk": 0.85, "columns": null, "spacing": 1.8, "splash": 0.5, "moraleLoss": 0.6 }
};

/** Multiplicadores por estado de moral. */
BattalionTactics.prototype.MORALE_EFFECTS = {
	"steady": { "spread": 1, "repeat": 1, "walk": 1 },
	"shaken": { "spread": 1.3, "repeat": 1.15, "walk": 0.85 },
	"broken": { "spread": 1.6, "repeat": 1.3, "walk": 1 }
};

/** XP (em múltiplos de RequiredXp do líder) para cada nível. */
BattalionTactics.prototype.LEVEL_THRESHOLDS = [1, 3, 6];

/** Segundos sem ser atingido antes do moral começar a subir. */
BattalionTactics.prototype.RECOVERY_DELAY = 4;
BattalionTactics.prototype.AUTO_REINFORCE_INTERVAL = 2;
BattalionTactics.prototype.MODIFIER_ID = "battalion_tactics";

BattalionTactics.prototype.Init = function()
{
	this.morale = 100;
	this.lastHitTime = -Infinity;
	this.posture = "normal";
	this.autoReinforce = false;
	this.retreating = false;
	this.lastMemberCount = -1;
	this.autoReinforceTimer = 0;
	this.appliedKey = "";
	this.appliedEntities = [];
};

BattalionTactics.prototype.Get = function(name, fallback)
{
	return this.template && this.template[name] !== undefined ? +this.template[name] : fallback;
};

BattalionTactics.prototype.GetTime = function()
{
	return Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).GetTime();
};

BattalionTactics.prototype.GetMoraleState = function()
{
	if (this.morale < this.Get("BrokenThreshold", 25))
		return "broken";
	if (this.morale < this.Get("ShakenThreshold", 60))
		return "shaken";
	return "steady";
};

BattalionTactics.prototype.GetLevel = function()
{
	const cmpLeader = Engine.QueryInterface(this.entity, IID_BattalionLeader);
	if (!cmpLeader)
		return 0;
	const xp = cmpLeader.GetCurrentXp();
	const required = Math.max(1, cmpLeader.GetRequiredXp());
	let level = 0;
	while (level < this.LEVEL_THRESHOLDS.length && xp >= this.LEVEL_THRESHOLDS[level] * required)
		++level;
	return level;
};

BattalionTactics.prototype.GetNextLevelXp = function()
{
	const cmpLeader = Engine.QueryInterface(this.entity, IID_BattalionLeader);
	const level = this.GetLevel();
	if (!cmpLeader || level >= this.LEVEL_THRESHOLDS.length)
		return undefined;
	return this.LEVEL_THRESHOLDS[level] * cmpLeader.GetRequiredXp();
};

BattalionTactics.prototype.GetPostureEffects = function()
{
	return this.POSTURE_EFFECTS[this.posture] || this.POSTURE_EFFECTS.normal;
};

/**
 * Colunas e espaçamento da formação para BattalionLeader.
 * @return {Object} { columns (número ou null), spacingScale }
 */
BattalionTactics.prototype.GetFormationOverride = function(memberCount)
{
	const effects = this.GetPostureEffects();
	return {
		"columns": effects.columns == "all" ? Math.max(1, memberCount) : effects.columns,
		"spacingScale": effects.spacing
	};
};

BattalionTactics.prototype.GetSplashDamageMultiplier = function()
{
	return this.GetPostureEffects().splash;
};

BattalionTactics.prototype.SetPosture = function(posture)
{
	if (this.POSTURES.indexOf(posture) == -1)
		return;
	this.posture = posture;
	this.ApplyModifiers();
};

BattalionTactics.prototype.SetAutoReinforce = function(enabled)
{
	this.autoReinforce = !!enabled;
	this.autoReinforceTimer = 0;
};

/**
 * Chamado quando o líder ou um membro é atingido.
 */
BattalionTactics.prototype.SoldierAttacked = function(msg)
{
	if (msg.fromStatusEffect && !msg.damage)
		return;

	let loss = this.Get("HitMoraleLoss", 1.5) + (msg.damage || 0) / 20;

	const cmpAttackerIdentity = Engine.QueryInterface(msg.attacker, IID_Identity);
	if (cmpAttackerIdentity && cmpAttackerIdentity.HasClass("Suppressive"))
		loss *= this.Get("SuppressiveMultiplier", 3);

	this.ReduceMorale(loss);
	this.lastHitTime = this.GetTime();
};

BattalionTactics.prototype.OnAttacked = function(msg)
{
	this.SoldierAttacked(msg);
};

/**
 * Perda de moral, atenuada pela postura (cobertura) e pelo nível.
 */
BattalionTactics.prototype.ReduceMorale = function(amount)
{
	const resistance = this.GetPostureEffects().moraleLoss * (1 - 0.15 * this.GetLevel());
	const before = this.GetMoraleState();
	this.morale = Math.max(0, this.morale - amount * resistance);
	if (this.GetMoraleState() != before)
		this.ApplyModifiers();
};

/**
 * Tick do batalhão (a cada 0,5 s), chamado por BattalionLeader.UpdateBattalion.
 */
BattalionTactics.prototype.Update = function(dt)
{
	const cmpLeader = Engine.QueryInterface(this.entity, IID_BattalionLeader);
	if (!cmpLeader)
		return;

	// Baixas desde o último tick.
	const count = cmpLeader.members.length;
	if (this.lastMemberCount >= 0 && count < this.lastMemberCount)
		this.ReduceMorale(this.Get("CasualtyMoraleLoss", 12) * (this.lastMemberCount - count));
	this.lastMemberCount = count;

	// Recuperação quando não está mais sob fogo.
	const stateBefore = this.GetMoraleState();
	if (this.GetTime() - this.lastHitTime > this.RECOVERY_DELAY * 1000)
		this.morale = Math.min(100, this.morale + this.Get("MoraleRecoveryRate", 4) * (1 + 0.25 * this.GetLevel()) * dt);

	const state = this.GetMoraleState();
	if (state == "broken" && !this.retreating)
		this.Retreat(cmpLeader);
	else if (this.retreating && state == "steady")
		this.retreating = false;

	if (this.autoReinforce && !cmpLeader.pendingReinforcement)
	{
		this.autoReinforceTimer -= dt;
		if (this.autoReinforceTimer <= 0)
		{
			this.autoReinforceTimer = this.AUTO_REINFORCE_INTERVAL;
			cmpLeader.RequestReinforcement();
		}
	}

	if (state != stateBefore)
		this.ApplyModifiers();
	else
		this.ApplyModifiers(true);
};

/**
 * Recuo: todo o batalhão corre para o ponto de reforço (ou centro cívico)
 * mais próximo. Não recua em "manter posição" nem em postura passiva.
 */
BattalionTactics.prototype.Retreat = function(cmpLeader)
{
	this.retreating = true;

	const cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	const stance = cmpUnitAI && cmpUnitAI.GetStanceName();
	if (stance == "standground" || stance == "passive")
		return;

	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpOwnership)
		return;

	const leaderPos = cmpPosition.GetPosition2D();
	let destination;
	let nearest = Infinity;
	for (const ent of Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).GetEntitiesByPlayer(cmpOwnership.GetOwner()))
	{
		const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIdentity || !cmpIdentity.HasClass("BattalionResupplyPoint") && !cmpIdentity.HasClass("CivCentre"))
			continue;
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld())
			continue;
		const distance = cmpPos.GetPosition2D().distanceToSquared(leaderPos);
		if (distance < nearest)
		{
			nearest = distance;
			destination = cmpPos.GetPosition2D();
		}
	}
	if (!destination)
		return;

	for (const ent of cmpLeader.GetBattalionEntities())
	{
		const cmpEntUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (cmpEntUnitAI)
			cmpEntUnitAI.Walk(destination.x, destination.y, false, false);
	}

	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	cmpGuiInterface.PushNotification({
		"type": "aichat",
		"players": [cmpOwnership.GetOwner()],
		"message": markForTranslation("A battalion's morale broke and it is retreating!"),
		"translateMessage": true
	});
};

/**
 * Soma postura, moral e nível num único conjunto de modificadores e o aplica
 * a todos os soldados. Só reaplica quando algo mudou.
 * @param {boolean} onlyIfMembersChanged - Reaplica só se a lista de soldados mudou.
 */
BattalionTactics.prototype.ApplyModifiers = function(onlyIfMembersChanged = false)
{
	const cmpLeader = Engine.QueryInterface(this.entity, IID_BattalionLeader);
	if (!cmpLeader)
		return;

	const posture = this.GetPostureEffects();
	const morale = this.MORALE_EFFECTS[this.GetMoraleState()];
	const level = this.GetLevel();

	const spread = posture.spread * morale.spread * (1 - 0.08 * level);
	const repeat = posture.repeat * morale.repeat * (1 - 0.05 * level);
	const walk = posture.walk * morale.walk;
	const key = [spread, repeat, walk].map(v => v.toFixed(3)).join("|");

	const entities = cmpLeader.GetBattalionEntities();
	const entitiesKey = entities.join(",");
	if (onlyIfMembersChanged && entitiesKey == this.appliedEntities.join(",") && key == this.appliedKey)
		return;

	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);
	for (const ent of this.appliedEntities)
		if (Engine.QueryInterface(ent, IID_Identity))
			cmpModifiersManager.RemoveAllModifiers(this.MODIFIER_ID, ent);

	const modifiers = {};
	const add = (path, value) => {
		if (Math.abs(value - 1) > 0.0005)
			modifiers[path] = [{ "multiply": value, "affects": [] }];
	};
	add("Attack/Ranged/Projectile/Spread", spread);
	add("Attack/Ranged/RepeatTime", repeat);
	add("UnitMotion/WalkSpeed", walk);

	const hasModifiers = Object.keys(modifiers).length > 0;
	if (hasModifiers)
		for (const ent of entities)
			cmpModifiersManager.AddModifiers(this.MODIFIER_ID, modifiers, ent);

	this.appliedEntities = hasModifiers ? entities : [];
	this.appliedKey = key;
};

/**
 * Chamado pelo novo líder quando o anterior morre: mantém postura, reforço
 * automático e moral (com a penalidade pela perda do líder).
 */
BattalionTactics.prototype.InheritFrom = function(cmpOld, formerLeader)
{
	this.posture = cmpOld.posture;
	this.autoReinforce = cmpOld.autoReinforce;
	this.morale = cmpOld.morale;
	this.lastHitTime = this.GetTime();
	this.retreating = cmpOld.retreating;
	// Os membros ainda têm os modificadores do líder anterior.
	this.appliedEntities = cmpOld.appliedEntities.filter(ent => ent != formerLeader);
	this.appliedKey = "";
	this.ReduceMorale(this.Get("LeaderLossMoraleLoss", 25));
};

BattalionTactics.prototype.GetStatus = function()
{
	const cmpLeader = Engine.QueryInterface(this.entity, IID_BattalionLeader);
	return {
		"morale": Math.round(this.morale),
		"moraleState": this.GetMoraleState(),
		"retreating": this.retreating,
		"posture": this.posture,
		"autoReinforce": this.autoReinforce,
		"level": this.GetLevel(),
		"xp": cmpLeader ? Math.round(cmpLeader.GetCurrentXp()) : 0,
		"nextLevelXp": this.GetNextLevelXp()
	};
};

Engine.RegisterComponentType(IID_BattalionTactics, "BattalionTactics", BattalionTactics);

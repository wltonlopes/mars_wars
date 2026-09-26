function BattalionLeader() {}

var g_PromotedBattalions = {};

BattalionLeader.prototype.Schema =
	"<a:help>Battalion settings</a:help>" +

	"<optional>" +
		"<element name='Size'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='Columns'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='Spacing'>" +
			"<data type='decimal'/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='LeaderTemplate'>" +
			"<text/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='RequiredXp'>" +
			"<data type='positiveInteger'/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='MemberTemplates'>" +
			"<text/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='MemberRoles'>" +
			"<text/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='Role'>" +
			"<text/>" +
		"</element>" +
	"</optional>" +

	"<optional>" +
		"<element name='ReinforcementRange'>" +
			"<data type='decimal'/>" +
		"</element>" +
	"</optional>";

BattalionLeader.prototype.Init = function()
{
	this.members = [];
	let cmpTemplateManager =
		Engine.QueryInterface(
			SYSTEM_ENTITY,
			IID_TemplateManager);

	this.memberTemplate =
		cmpTemplateManager.GetCurrentTemplateName(
			this.entity);

	this.size =
		+(this.template.Size || 20);

	this.columns =
		+(this.template.Columns || 4);

	this.spacing =
		+(this.template.Spacing || 2);

	this.leaderTemplate =
		this.template.LeaderTemplate ||
		this.memberTemplate;
	this.currentXp = 0;
	this.requiredXp =
		+(this.template.RequiredXp || 100);
	this.reinforcementRange =
		+(this.template.ReinforcementRange || 50);
	this.memberTemplates =
		this.GetMemberTemplateCounts();
	this.memberRoles = this.GetMemberRoles();
	this.roleByTemplate = this.BuildRoleByTemplate();
	this.role = (this.template.Role || "assault").toLowerCase();
	this.pendingReinforcement = false;
	this.state = "idle";
    this.spawned = false;
    this.promoted = false;

	// this.formationTemplate =
    // this.template.Formation ||
    // "special/formations/box";

	// Engine.AddEntity(
    // this.formationTemplate);

	if (g_PromotedBattalions[this.entity])
	{
		this.members =
			g_PromotedBattalions[this.entity];

		delete g_PromotedBattalions[this.entity];

		this.spawned = true;
		this.promoted = true;
	}
	let cmpTimer =
		Engine.QueryInterface(
			SYSTEM_ENTITY,
			IID_Timer);

	cmpTimer.SetInterval(
		this.entity,
		IID_BattalionLeader,
		"UpdateBattalion",
		500,
		500);

};

BattalionLeader.prototype.OnOwnershipChanged =
function(msg)
{
    if (msg.to == INVALID_PLAYER)
        return;

    if (this.spawned)
        return;

    this.spawned = true;

    this.SpawnMembers();
};

BattalionLeader.prototype.SpawnMembers =function()
{

    let cmpLeaderPos =
        Engine.QueryInterface(
            this.entity,
            IID_Position);

    if (!cmpLeaderPos || !cmpLeaderPos.IsInWorld())
    {
        return;
    }

    let pos =
        cmpLeaderPos.GetPosition2D();

	let offsets = this.GetFormationOffsets();

	let memberTemplates =
		this.GetSpawnMemberTemplates();

	this.state = "deploying";

	for (let i = 0; i < memberTemplates.length; ++i)
    {
        let ent =
			Engine.AddEntity(
				memberTemplates[i]);

		if (ent == INVALID_ENTITY)
		{
			continue;
		}

        let cmpMemberPos =
            Engine.QueryInterface(
                ent,
                IID_Position);

        if (cmpMemberPos)
        {
            cmpMemberPos.JumpTo(
                pos.x + offsets[i][0],
                pos.y + offsets[i][1]);
        }

        let cmpOwnership =
            Engine.QueryInterface(
                this.entity,
                IID_Ownership);

        let cmpMemberOwnership =
            Engine.QueryInterface(
                ent,
                IID_Ownership);

        if (cmpOwnership && cmpMemberOwnership)
            cmpMemberOwnership.SetOwner(
                cmpOwnership.GetOwner());

        let cmpMember =
            Engine.QueryInterface(
                ent,
                IID_BattalionMember);

        if (cmpMember)
            cmpMember.SetLeader(this.entity);

        this.members.push(ent);
    }
	this.state = "formation";
	// this.CreateFormation();
};

BattalionLeader.prototype.GetFormationProfile =
function()
{
	switch (this.role)
	{
		case "defense":
			return {
				columnsModifier: 1,
				spacingScale: 0.85,
				supportOffset: 0.5,
				flankOffset: 0.9
			};
		case "skirmisher":
			return {
				columnsModifier: 1,
				spacingScale: 1.2,
				supportOffset: 0.7,
				flankOffset: 1.25
			};
		case "anti_air":
			return {
				columnsModifier: 0,
				spacingScale: 1.15,
				supportOffset: 0.65,
				flankOffset: 1.35
			};
		case "assault":
		default:
			return {
				columnsModifier: 0,
				spacingScale: 1.0,
				supportOffset: 0.4,
				flankOffset: 1.0
			};
	}
};

BattalionLeader.prototype.GetMemberRoles =
function()
{
	if (!this.template.MemberRoles)
		return [];

	let result = [];
	let entries = String(this.template.MemberRoles).split(/\s+/);

	for (let entry of entries)
	{
		if (!entry)
			continue;

		let parts = entry.split(":");
		if (parts.length != 3)
			continue;

		let count = +parts[1];
		if (!count)
			continue;

		result.push({
			template: parts[0],
			count: count,
			role: String(parts[2]).toLowerCase()
		});
	}

	return result;
};

// Papel de cada template de membro, montado uma vez (antes era procurado na
// lista MemberRoles para cada membro a cada atualização).
BattalionLeader.prototype.BuildRoleByTemplate =
function()
{
	let roles = {};
	for (let entry of this.memberRoles)
		if (roles[entry.template] === undefined)
			roles[entry.template] = entry.role;
	return roles;
};

BattalionLeader.prototype.GetMemberRole =
function(ent)
{
	let templateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	if (!templateManager)
		return "front";

	// Jogos salvos antes do cache existir.
	if (!this.roleByTemplate)
		this.roleByTemplate = this.BuildRoleByTemplate();

	let role = this.roleByTemplate[templateManager.GetCurrentTemplateName(ent)];
	if (role !== undefined)
		return role;

	return this.role == "defense" ? "front" : this.role == "skirmisher" ? "flank" : "front";
};

BattalionLeader.prototype.GetFormationOffsets =
function()
{
	let profile = this.GetFormationProfile();
	let columns = Math.max(1, this.columns + profile.columnsModifier);
	let offsets = [];

	for (let i = 0; i < this.size - 1; ++i)
	{
		let row = Math.floor(i / columns);
		let col = i % columns;
		let spacing = this.spacing * profile.spacingScale;
		let roleBias = this.role == "defense" ? 0.2 : 0.5;

		offsets.push([
			(col - (columns - 1) / 2) * spacing + (col % 2 == 0 ? -roleBias * spacing : roleBias * spacing),
			-(row + 1) * spacing - (row > 0 ? profile.supportOffset * spacing : 0)
		]);
	}

	return offsets;
};

BattalionLeader.prototype.GetMemberFormationPosition =
function(leaderPos, index, ent, profile = this.GetFormationProfile(), override = this.GetFormationOverride())
{
	let columns = Math.max(1, override.columns || this.columns + profile.columnsModifier);
	let row = Math.floor(index / columns);
	let col = index % columns;
	let spacing = this.spacing * profile.spacingScale * override.spacingScale;
	let role = ent ? this.GetMemberRole(ent) : "front";
	let xBias = 0;
	let yBias = 0;

	if (role == "support")
	{
		xBias = (col % 2 == 0 ? -1 : 1) * profile.supportOffset * spacing;
		yBias = profile.supportOffset * spacing;
	}
	else if (role == "flank")
	{
		xBias = (col % 2 == 0 ? -1 : 1) * profile.flankOffset * spacing;
		yBias = profile.flankOffset * spacing * 0.5;
	}
	else if (role == "anti_air")
	{
		xBias = (col % 2 == 0 ? -1 : 1) * profile.flankOffset * spacing * 0.75;
		yBias = profile.supportOffset * spacing * 1.2;
	}

	return {
		x: leaderPos.x + (col - (columns - 1) / 2) * spacing + xBias,
		y: leaderPos.y - ((row + 1) * spacing) - yBias
	};
};

// Postura do batalhão (BattalionTactics): colunas e espaçamento.
BattalionLeader.prototype.GetFormationOverride =
function()
{
	let cmpTactics = Engine.QueryInterface(this.entity, IID_BattalionTactics);
	return cmpTactics ?
		cmpTactics.GetFormationOverride(this.members.length) :
		{ "columns": null, "spacingScale": 1 };
};

BattalionLeader.prototype.ShouldSkipMemberOrder =
function(cmpUnitAI)
{
	if (!cmpUnitAI || !cmpUnitAI.order)
		return false;

	return cmpUnitAI.order.type == "Attack" ||
		cmpUnitAI.order.type == "WalkAndFight" ||
		cmpUnitAI.order.type == "Patrol";
};

BattalionLeader.prototype.GetAliveMembers =
function()
{
	let alive = [];

	for (let ent of this.members)
	{
		let cmpHealth =
			Engine.QueryInterface(
				ent,
				IID_Health);

		if (cmpHealth &&
		    cmpHealth.GetHitpoints() > 0)
			alive.push(ent);
	}

	return alive;
};

// A battalion is replenished by training the normal battalion-member units in
// a barracks. An unassigned trained member is claimed by an under-strength
// battalion that has a matching slot for its template.
BattalionLeader.prototype.GetMissingMemberTemplate =
function()
{
	let counts = {};
	let alive = this.GetAliveMembers();

	for (let ent of alive)
	{
		let template = Engine.QueryInterface(
			SYSTEM_ENTITY,
			IID_TemplateManager).GetCurrentTemplateName(ent);
		counts[template] = (counts[template] || 0) + 1;
	}

	for (let member of this.memberTemplates)
	{
		let count = counts[member.template] || 0;
		if (count < member.count)
			return member.template;
	}

	// Extra slots granted by barracks and technology use the battalion's
	// standard infantry template. The original specialist composition is kept.
	if (alive.length < this.GetMemberCapacity())
		return this.GetDefaultMemberTemplate();

	return undefined;
};

BattalionLeader.prototype.GetMemberCapacity =
function()
{
	let baseCapacity = this.memberTemplates.reduce((total, member) => total + member.count, 0);
	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	// Contagem compartilhada por todos os batalhões do jogador no turno
	// (helpers/Battalion.js), em vez de percorrer todas as entidades aqui.
	let barracks = cmpOwnership ? CountBattalionBarracks(cmpOwnership.GetOwner()) : 0;

	let technologyBonus = ApplyValueModificationsToEntity(
		"BattalionLeader/AdditionalCapacity", 0, this.entity);
	return baseCapacity + 2 * barracks + technologyBonus;
};

BattalionLeader.prototype.FindReinforcement =
function()
{
	let requiredTemplate = this.GetMissingMemberTemplate();
	if (!requiredTemplate)
		return INVALID_ENTITY;

	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	let cmpLeaderPos = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpOwnership || !cmpLeaderPos || !cmpLeaderPos.IsInWorld())
		return INVALID_ENTITY;

	let cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	let cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	if (!cmpRangeManager || !cmpTemplateManager)
		return INVALID_ENTITY;

	let leaderPos = cmpLeaderPos.GetPosition2D();
	let candidate = INVALID_ENTITY;
	let nearestDistance = Infinity;

	for (let ent of cmpRangeManager.GetEntitiesByPlayer(cmpOwnership.GetOwner()))
	{
		let cmpMember = Engine.QueryInterface(ent, IID_BattalionMember);
		let cmpMemberPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpMember || cmpMember.GetLeader() != INVALID_ENTITY ||
			!cmpMemberPos || !cmpMemberPos.IsInWorld() ||
			cmpTemplateManager.GetCurrentTemplateName(ent) != requiredTemplate)
			continue;

		let memberPos = cmpMemberPos.GetPosition2D();
		let dx = memberPos.x - leaderPos.x;
		let dz = memberPos.y - leaderPos.y;
		let distance = dx * dx + dz * dz;
		if (distance < nearestDistance)
		{
			candidate = ent;
			nearestDistance = distance;
		}
	}

	return candidate;
};

// Replacements are only assigned while the battalion is at one of the
// player's supply locations.  The class is deliberately shared by civic
// centres, barracks and capturable strategic points, which keeps the rule
// independent of a faction's template names.
BattalionLeader.prototype.IsNearReinforcementPoint =
function()
{
	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	let cmpLeaderPos = Engine.QueryInterface(this.entity, IID_Position);
	let cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpOwnership || !cmpLeaderPos || !cmpLeaderPos.IsInWorld() || !cmpRangeManager)
		return false;

	// Consulta espacial do RangeManager: só entidades do jogador dentro do
	// raio (distância entre centros, como antes), sem varrer o jogador todo.
	return cmpRangeManager.ExecuteQueryAroundPos(
		cmpLeaderPos.GetPosition2D(), 0, this.reinforcementRange,
		[cmpOwnership.GetOwner()], IID_Identity, false
	).some(ent => Engine.QueryInterface(ent, IID_Identity).HasClass("BattalionResupplyPoint"));
};

BattalionLeader.prototype.Reinforce =
function(membersAlreadyCleaned = false)
{
	if (!this.pendingReinforcement)
		return;
	if (!membersAlreadyCleaned)
		this.CleanupMembers();

	if (!this.IsNearReinforcementPoint())
	{
		this.state = "repositioning";
		return;
	}

	this.state = "replenishing";
	let member = this.FindReinforcement();
	if (member == INVALID_ENTITY)
		return;

	let cmpMember = Engine.QueryInterface(member, IID_BattalionMember);
	if (!cmpMember)
		return;

	cmpMember.SetLeader(this.entity);
	this.members.push(member);
	this.pendingReinforcement = false;
};

BattalionLeader.prototype.RequestReinforcement =
function()
{
	this.CleanupMembers();
	if (this.pendingReinforcement || !this.IsNearReinforcementPoint())
		return false;
	this.state = "replenishing";
	let template = this.GetMissingMemberTemplate();
	if (!template)
		return false;

	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	let cmpLeaderPos = Engine.QueryInterface(this.entity, IID_Position);
	let cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpOwnership || !cmpLeaderPos || !cmpRangeManager)
		return false;

	let leaderPos = cmpLeaderPos.GetPosition2D();
	let queue = undefined;
	let nearest = Infinity;
	for (let ent of cmpRangeManager.ExecuteQueryAroundPos(
		leaderPos, 0, this.reinforcementRange, [cmpOwnership.GetOwner()], IID_ProductionQueue, false))
	{
		let identity = Engine.QueryInterface(ent, IID_Identity);
		let position = Engine.QueryInterface(ent, IID_Position);
		let production = Engine.QueryInterface(ent, IID_ProductionQueue);
		if (!identity || !identity.HasClass("BattalionResupplyPoint") ||
			!position || !position.IsInWorld() || !production)
			continue;

		let pos = position.GetPosition2D();
		let dx = pos.x - leaderPos.x;
		let dz = pos.y - leaderPos.y;
		let distance = dx * dx + dz * dz;
		if (distance <= this.reinforcementRange * this.reinforcementRange && distance < nearest)
		{
			queue = production;
			nearest = distance;
		}
	}

	if (!queue || !queue.AddItem(template, "unit", 1, { "battalion": this.entity }))
		return false;

	this.pendingReinforcement = true;
	return true;
};

BattalionLeader.prototype.QueueReinforcement =
function(template)
{
	this.CleanupMembers();
	if (this.pendingReinforcement || !this.IsNearReinforcementPoint() ||
		template != this.GetMissingMemberTemplate())
		return false;

	this.state = "replenishing";

	let cmpQueue = Engine.QueryInterface(this.entity, IID_ProductionQueue);
	if (!cmpQueue || !cmpQueue.AddItem(template, "unit", 1, { "battalion": this.entity }))
		return false;

	this.pendingReinforcement = true;
	return true;
};

BattalionLeader.prototype.OnDestroy = function(msg)
{
	let alive =
		this.GetAliveMembers();

	if (!alive.length)
	{
		return;
	}
	this.CleanupMembers();
	let successor =
		alive.sort((a, b) =>
		{
			let pa =
				Engine.QueryInterface(
					a,
					IID_Promotion);

			let pb =
				Engine.QueryInterface(
					b,
					IID_Promotion);

			let ra = 0;
			let rb = 0;

			if (pa)
			{
				if (pa.IsElite && pa.IsElite())
					ra = 3;
				else if (pa.IsAdvanced && pa.IsAdvanced())
					ra = 2;
				else
					ra = 1;
			}

			if (pb)
			{
				if (pb.IsElite && pb.IsElite())
					rb = 3;
				else if (pb.IsAdvanced && pb.IsAdvanced())
					rb = 2;
				else
					rb = 1;
			}

			return rb - ra;
		})[0];

	let remainingMembers =
		alive.filter(
			ent => ent != successor);

	// Cria novo líder
	let newLeader =
		Engine.AddEntity(
			this.leaderTemplate);

	if (!newLeader)
	{
		return;
	}

	// Obtém componente do novo líder
	let cmpLeader =
		Engine.QueryInterface(
			newLeader,
			IID_BattalionLeader);

	if (!cmpLeader)
	{
		return;
	}

	// MUITO IMPORTANTE:
	// impede SpawnMembers quando o owner for aplicado
	cmpLeader.spawned = true;
	cmpLeader.promoted = true;
	cmpLeader.currentXp = this.currentXp;

	// Copia posição do sucessor
	let cmpOldPos =
		Engine.QueryInterface(
			successor,
			IID_Position);

	let cmpNewPos =
		Engine.QueryInterface(
			newLeader,
			IID_Position);

	if (cmpOldPos && cmpNewPos && cmpOldPos.IsInWorld())
	{
		let pos =
			cmpOldPos.GetPosition2D();

		cmpNewPos.JumpTo(
			pos.x,
			pos.y);
	}

	// Copia dono
	let cmpOwner =
		Engine.QueryInterface(
			successor,
			IID_Ownership);
	let cmpNewOwner =
		Engine.QueryInterface(
			newLeader,
			IID_Ownership);

	if (cmpOwner &&
		cmpNewOwner)
	{
		cmpNewOwner.SetOwner(
			cmpOwner.GetOwner());
	}

	// The promoted soldier becomes the new leader.  Preserve the proportion of
	// health it had before the promotion so it cannot be healed by the swap.
	let cmpSuccessorHealth = Engine.QueryInterface(successor, IID_Health);
	let cmpNewLeaderHealth = Engine.QueryInterface(newLeader, IID_Health);
	if (cmpSuccessorHealth && cmpNewLeaderHealth)
	{
		let max = cmpSuccessorHealth.GetMaxHitpoints();
		if (max > 0)
			cmpNewLeaderHealth.SetHitpoints(
				cmpNewLeaderHealth.GetMaxHitpoints() *
				cmpSuccessorHealth.GetHitpoints() / max);
	}

	// Transfere membros
	cmpLeader.members =
		remainingMembers;

	cmpLeader.size =
		remainingMembers.length + 1;

	for (let ent of remainingMembers)
	{
		let cmpMember =
			Engine.QueryInterface(
				ent,
				IID_BattalionMember);

		if (cmpMember)
			cmpMember.SetLeader(
				newLeader);
	}

	// Postura, reforço automático e moral (com a penalidade pela perda do líder).
	let cmpOldTactics = Engine.QueryInterface(this.entity, IID_BattalionTactics);
	let cmpNewTactics = Engine.QueryInterface(newLeader, IID_BattalionTactics);
	if (cmpOldTactics && cmpNewTactics)
		cmpNewTactics.InheritFrom(cmpOldTactics, this.entity);

	// Remove o sucessor antigo
	Engine.DestroyEntity(
		successor);
};

// BattalionLeader.prototype.MarkPromoted =
// function()
// {
// 	this.promoted = true;
// 	this.spawned = true;
// };


BattalionLeader.prototype.IsBattalion =
function()
{
    return true;
};


BattalionLeader.prototype.CleanupMembers =
function()
{
	this.members =
		this.members.filter(ent =>
		{
			let cmpHealth =
				Engine.QueryInterface(
					ent,
					IID_Health);

			return cmpHealth &&
				cmpHealth.GetHitpoints() > 0;
		});
};

BattalionLeader.prototype.GetBattalionEntities =
function()
{
	let entities =
	[
		this.entity
	];

	for (let ent of this.members)
		entities.push(ent);

	return entities;
};

BattalionLeader.prototype.GetBattalionSize =
function()
{
    return this.members.length + 1;
};

BattalionLeader.prototype.AddExperience =
function(amount)
{
	this.currentXp += +amount;
	Engine.PostMessage(
		this.entity,
		MT_ExperienceChanged,
		{});
};

BattalionLeader.prototype.GetCurrentXp =
function()
{
	return this.currentXp;
};

BattalionLeader.prototype.GetRequiredXp =
function()
{
	return this.requiredXp;
};

BattalionLeader.prototype.GetMemberTemplateCounts =
function()
{
	if (!this.template.MemberTemplates)
		return [
			{
				"template": this.GetDefaultMemberTemplate(),
				"count": this.size - 1
			}
		];

	let result = [];
	let total = 0;
	let entries =
		String(this.template.MemberTemplates)
			.split(/\s+/);

	for (let entry of entries)
	{
		if (!entry)
			continue;

		let parts =
			entry.split(":");

		if (parts.length != 2)
		{
			continue;
		}

		let count =
			+parts[1];

		if (!count)
			continue;

		result.push(
			{
				"template": parts[0],
				"count": count
			});

		total += count;
	}

	if (!result.length)
		return [
			{
				"template": this.GetDefaultMemberTemplate(),
				"count": this.size - 1
			}
		];

	this.size = total + 1;

	return result;
};

BattalionLeader.prototype.GetSpawnMemberTemplates =
function()
{
	let templates = [];

	for (let member of this.memberTemplates)
		for (let i = 0; i < member.count; ++i)
			templates.push(member.template);

	return templates;
};

BattalionLeader.prototype.UpdateBattalion =
function()
{
	this.CleanupMembers();

    let cmpLeaderPos =
        Engine.QueryInterface(
            this.entity,
            IID_Position);

    // A leader may be garrisoned, dead, or not yet spawned. Those entities
    // still expose Position, but GetPosition2D is invalid outside the world.
    if (!cmpLeaderPos || !cmpLeaderPos.IsInWorld())
        return;

    this.Reinforce(true);

    let cmpTactics = Engine.QueryInterface(this.entity, IID_BattalionTactics);
    if (cmpTactics)
        cmpTactics.Update(0.5);

    if (this.GetMissingMemberTemplate())
        this.state = "replenishing";
    else if (this.pendingReinforcement)
        this.state = "repositioning";
    else
        this.state = "formation";

    let pos =
        cmpLeaderPos.GetPosition2D();

    let profile = this.GetFormationProfile();
    let override = this.GetFormationOverride();
    let index = 0;

    for (let ent of this.members)
    {
        let cmpMemberPos =
            Engine.QueryInterface(
                ent,
                IID_Position);

        let cmpUnitAI =
            Engine.QueryInterface(
                ent,
                IID_UnitAI);

        if (!cmpMemberPos || !cmpMemberPos.IsInWorld() || !cmpUnitAI)
            continue;

        // Combat and capture orders belong to the soldier itself.  Do not
        // replace them with a formation-walk order while they are active.
        if (this.ShouldSkipMemberOrder(cmpUnitAI))
            continue;

        let target =
            this.GetMemberFormationPosition(pos, index, ent, profile, override);

        let memberPos =
            cmpMemberPos.GetPosition2D();

        let dx = memberPos.x - target.x;
        let dz = memberPos.y - target.y;

        // Avoid reissuing movement orders when the member is already near the
        // desired formation position.
        if (dx * dx + dz * dz < 0.25)
        {
            ++index;
            continue;
        }

        // Já está indo para (quase) o mesmo lugar: reenviar a mesma ordem só
        // obrigaria o UnitMotion a recalcular o caminho a cada 0,5 s.
        if (this.IsAlreadyWalkingTo(cmpUnitAI, target))
        {
            ++index;
            continue;
        }

        cmpUnitAI.Walk(
            target.x,
            target.y,
            false,
            false);

        ++index;
    }
};

// Tolerância (m) para considerar que a ordem Walk atual já leva ao destino.
BattalionLeader.prototype.REORDER_TOLERANCE = 1.0;

BattalionLeader.prototype.IsAlreadyWalkingTo =
function(cmpUnitAI, target)
{
	let order = cmpUnitAI.order;
	if (!order || order.type != "Walk" || !order.data || cmpUnitAI.orderQueue.length > 1)
		return false;

	let dx = order.data.x - target.x;
	let dz = order.data.z - target.y;
	return dx * dx + dz * dz < this.REORDER_TOLERANCE * this.REORDER_TOLERANCE;
};

BattalionLeader.prototype.OnGlobalEntityRenamed =
function(msg)
{
};

BattalionLeader.prototype.GetDefaultMemberTemplate =
function()
{
    let cmpTemplateManager =
        Engine.QueryInterface(
            SYSTEM_ENTITY,
            IID_TemplateManager);

    let templateName =
        cmpTemplateManager.GetCurrentTemplateName(
            this.entity);

    return templateName.replace(
        "battalion_",
        "battalion_member_");
};

Engine.RegisterComponentType(
	IID_BattalionLeader,
	"BattalionLeader",
	BattalionLeader);

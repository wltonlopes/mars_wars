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
		"units/battalions/battalion_spearman_leader";
	this.currentXp = 0;
	this.requiredXp =
		+(this.template.RequiredXp || 100);
	this.memberTemplates =
		this.GetMemberTemplateCounts();
    this.spawned = false;
    this.promoted = false;

	// this.formationTemplate =
    // this.template.Formation ||
    // "special/formations/box";

	// Engine.AddEntity(
    // this.formationTemplate);

	if (g_PromotedBattalions[this.entity])
	{
		warn(
			"RESTORING BATTALION " +
			this.entity);

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

	cmpTimer.SetInterval(
		this.entity,
		IID_BattalionLeader,
		"DebugOrders",
		1000,
		1000);

};

BattalionLeader.prototype.OnOwnershipChanged =
function(msg)
{
    if (msg.to == INVALID_PLAYER)
        return;

    if (this.spawned)
        return;

    this.spawned = true;

    warn("BATTALION READY");

    this.SpawnMembers();
};

BattalionLeader.prototype.SpawnMembers =function()
{

	warn("SPAWNING MEMBERS FOR " + this.entity);

    let cmpLeaderPos =
        Engine.QueryInterface(
            this.entity,
            IID_Position);

    if (!cmpLeaderPos || !cmpLeaderPos.IsInWorld())
    {
        warn("LEADER NOT IN WORLD");
        return;
    }

    let pos =
        cmpLeaderPos.GetPosition2D();
	warn("LEADER IN WORLD");

	let offsets = [];

	for (
		let i = 0;
		i < this.size - 1;
		++i)
	{
		let row =
			Math.floor(
				i / this.columns);

		let col =
			i % this.columns;

		offsets.push([
			(col -
			(this.columns - 1) / 2)
			* this.spacing,

			-(row + 1)
			* this.spacing
		]);
	}

	let memberTemplates =
		this.GetSpawnMemberTemplates();

	for (let i = 0; i < memberTemplates.length; ++i)
    {
        let ent =
			Engine.AddEntity(
				memberTemplates[i]);

		if (ent == INVALID_ENTITY)
		{
			warn("FAILED TO CREATE BATTALION MEMBER " + memberTemplates[i]);
			continue;
		}

        warn("CREATED MEMBER " + ent);

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
	// this.CreateFormation();
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

BattalionLeader.prototype.OnDestroy = function(msg)
{
	warn(
		"LEADER DIED " +
		this.entity);

	warn(
		"MEMBER COUNT " +
		this.members.length);

	for (let ent of this.members)
		warn("CHECK " + ent);

	let alive =
		this.GetAliveMembers();

	if (!alive.length)
	{
		warn(
			"BATTALION DESTROYED");

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

	warn(
		"SUCCESSOR " +
		successor);

	let remainingMembers =
		alive.filter(
			ent => ent != successor);

	// Cria novo líder
	let newLeader =
		Engine.AddEntity(
			this.leaderTemplate);

	if (!newLeader)
	{
		warn(
			"FAILED TO CREATE LEADER");

		return;
	}

	warn(
		"SUCCESSOR = " +
		successor +
		" NEWLEADER = " +
		newLeader);

	// Obtém componente do novo líder
	let cmpLeader =
		Engine.QueryInterface(
			newLeader,
			IID_BattalionLeader);

	if (!cmpLeader)
	{
		warn(
			"NO BATTALION COMPONENT");

		return;
	}

	// MUITO IMPORTANTE:
	// impede SpawnMembers quando o owner for aplicado
	cmpLeader.spawned = true;
	cmpLeader.promoted = true;

	// Copia posição do sucessor
	let cmpOldPos =
		Engine.QueryInterface(
			successor,
			IID_Position);

	let cmpNewPos =
		Engine.QueryInterface(
			newLeader,
			IID_Position);

	if (cmpOldPos &&
		cmpNewPos)
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
	warn(
		"NEW LEADER OWNER = " +
		cmpOwner.GetOwner());
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

	warn(
		"PROMOTED " +
		newLeader);

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

BattalionLeader.prototype.CreateFormation =
function()
{
    let formation =
        Engine.AddEntity(
            "special/formations/box");

    let cmpFormation =
        Engine.QueryInterface(
            formation,
            IID_Formation);

    if (!cmpFormation)
        return;

    let members =
    [
        this.entity,
        ...this.members
    ];

	let cmpUnitAI =
		Engine.QueryInterface(
			this.entity,
			IID_UnitAI);

	warn(
		"LEADER UNITAI = " +
		!!cmpUnitAI);

	warn(
		"FORMATION = " +
		!!cmpFormation);
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
			warn("INVALID BATTALION MEMBER TEMPLATE ENTRY " + entry);
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

BattalionLeader.prototype.DebugOrders =
function()
{
    warn(
        "BATTALION " +
        this.entity +
        " MEMBERS " +
        this.members.length);

    let cmpUnitAI =
        Engine.QueryInterface(
            this.entity,
            IID_UnitAI);

    if (!cmpUnitAI)
        return;

    warn(
        "FORMATION CONTROLLER = " +
        cmpUnitAI.GetFormationController());

    warn(
        "ORDER = " +
        uneval(
            cmpUnitAI.order));
};

BattalionLeader.prototype.UpdateBattalion =
function()
{
    let cmpLeaderPos =
        Engine.QueryInterface(
            this.entity,
            IID_Position);

    if (!cmpLeaderPos)
        return;

    let pos =
        cmpLeaderPos.GetPosition2D();

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

        if (!cmpMemberPos || !cmpUnitAI)
            continue;

        let row =
            Math.floor(index / this.columns);

        let col =
            index % this.columns;

        let tx =
            pos.x +
            (col - (this.columns - 1) / 2)
            * this.spacing;

        let tz =
            pos.y -
            ((row + 1) * this.spacing);

        let memberPos =
            cmpMemberPos.GetPosition2D();

        let dx = memberPos.x - tx;
        let dz = memberPos.y - tz;

        // Evita reemitir ordens de movimentação se o membro já estiver
        // praticamente na posição final desejada.
        if (dx * dx + dz * dz < 0.25)
        {
            ++index;
            continue;
        }

        cmpUnitAI.Walk(
            tx,
            tz,
            false,
            false);

        ++index;
    }
};

BattalionLeader.prototype.OrderAttack =
function(target)
{
	for (let ent of this.members)
	{
		let cmpUnitAI =
			Engine.QueryInterface(
				ent,
				IID_UnitAI);

		if (!cmpUnitAI)
			continue;

		cmpUnitAI.PushOrderFront(
			"Attack",
			{
				"target": target,
				"force": false
			}
		);
	}
};

BattalionLeader.prototype.OrderWalk =
function(x, z)
{
	for (let ent of this.members)
	{
		let cmpUnitAI =
			Engine.QueryInterface(
				ent,
				IID_UnitAI);

		if (!cmpUnitAI)
			continue;

		cmpUnitAI.WalkToPoint(
			x,
			z,
			false
		);
	}
};

BattalionLeader.prototype.OrderPatrol =
function(x, z)
{
	for (let ent of this.members)
	{
		let cmpUnitAI =
			Engine.QueryInterface(
				ent,
				IID_UnitAI);

		if (!cmpUnitAI)
			continue;

		cmpUnitAI.PushOrderFront(
			"Patrol",
			{
				"x": x,
				"z": z,
				"targetClasses":
				{
					"attack":
						["Unit","Structure"]
				}
			}
		);
	}
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

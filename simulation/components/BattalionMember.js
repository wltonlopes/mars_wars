function BattalionMember() {}

BattalionMember.prototype.Schema =
	"<empty/>";

BattalionMember.prototype.Init = function()
{
	this.leader = INVALID_ENTITY;
};

BattalionMember.prototype.SetLeader = function(ent)
{
	this.leader = ent;
};

BattalionMember.prototype.GetLeader = function()
{
	return this.leader;
};

BattalionMember.prototype.IsAlive = function()
{
	let cmpHealth =
		Engine.QueryInterface(
			this.entity,
			IID_Health);

	return cmpHealth &&
	       cmpHealth.GetHitpoints() > 0;
};


BattalionMember.prototype.GetBattalionLeader =
function()
{
	return this.leader;
};

BattalionMember.prototype.GetLeader =
function()
{
	return this.leader;
};

// Tiros recebidos por um soldado afetam o moral do batalhão inteiro.
BattalionMember.prototype.OnAttacked = function(msg)
{
	let cmpTactics = this.leader != INVALID_ENTITY &&
		Engine.QueryInterface(this.leader, IID_BattalionTactics);
	if (cmpTactics)
		cmpTactics.SoldierAttacked(msg);
};

BattalionMember.prototype.CanBeSelected =
function()
{
    return true;
};

BattalionMember.prototype.IsControllable =
function()
{
    return true;
};

Engine.RegisterComponentType(
	IID_BattalionMember,
	"BattalionMember",
	BattalionMember);

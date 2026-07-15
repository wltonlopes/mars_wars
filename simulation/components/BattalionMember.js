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

BattalionMember.prototype.CanBeSelected =
function()
{
    return false;
};

BattalionMember.prototype.IsControllable =
function()
{
    return false;
};

Engine.RegisterComponentType(
	IID_BattalionMember,
	"BattalionMember",
	BattalionMember);
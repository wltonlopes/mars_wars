function GetBattalionSelection(ent)
{
	let cmpLeader =
		Engine.QueryInterface(
			ent,
			IID_BattalionLeader);

	if (cmpLeader)
		return [ent].concat(cmpLeader.members);

	let cmpMember =
		Engine.QueryInterface(
			ent,
			IID_BattalionMember);

	if (!cmpMember)
		return [ent];

	let leader =
		cmpMember.GetLeader();

	if (!leader)
		return [ent];

	let cmpLeaderObj =
		Engine.QueryInterface(
			leader,
			IID_BattalionLeader);

	if (!cmpLeaderObj)
		return [ent];

	return [leader].concat(
		cmpLeaderObj.members);
}
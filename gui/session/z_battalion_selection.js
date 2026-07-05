function getBattalionSelectableEntity(ent)
{
	const entState = GetEntityState(ent);
	if (!entState || !entState.battalion)
		return ent;

	return entState.battalion.leader || ent;
}

function getBattalionSelectableEntities(ents)
{
	const result = [];
	const seen = new Set();

	for (const ent of ents)
	{
		const battalionEnt = getBattalionSelectableEntity(ent);
		if (seen.has(battalionEnt))
			continue;

		seen.add(battalionEnt);
		result.push(battalionEnt);
	}

	return result;
}

{
	const battalionSelectionAddList = EntitySelection.prototype.addList;
	EntitySelection.prototype.addList = function(ents, quiet, force = false, addFormationMembers = true)
	{
		return battalionSelectionAddList.call(
			this,
			getBattalionSelectableEntities(ents),
			quiet,
			force,
			addFormationMembers);
	};

	const battalionSelectionRemoveList = EntitySelection.prototype.removeList;
	EntitySelection.prototype.removeList = function(ents, addFormationMembers = true)
	{
		return battalionSelectionRemoveList.call(
			this,
			getBattalionSelectableEntities(ents),
			addFormationMembers);
	};
}

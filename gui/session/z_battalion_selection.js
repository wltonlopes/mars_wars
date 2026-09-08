/**
 * Treat a battalion as one selectable object in the session interface.
 *
 * The leader is the canonical selection entry. Members remain ordinary
 * simulation entities (so they can fight, die and be reinforced), but
 * clicking, band-boxing or control-clicking a member selects its leader.
 * The standard single-entity details panel consequently displays one
 * battalion, rather than a list of its soldiers.
 */

function GetBattalionPanelEntity(entity)
{
	const state = GetEntityState(entity);
	return state?.battalion?.leader || entity;
}

function NormalizeBattalionPanelEntities(entities)
{
	const result = [];
	const seen = new Set();

	for (const entity of entities)
	{
		const leader = GetBattalionPanelEntity(entity);
		if (!seen.has(leader))
		{
			seen.add(leader);
			result.push(leader);
		}
	}

	return result;
}

// The leader is the only entry stored in g_Selection, but all battalion
// members must retain the same visual selection and status bars.
function ExpandBattalionPanelEntities(entities)
{
	const result = [];
	const seen = new Set();

	for (const entity of entities)
	{
		const battalion = GetEntityState(entity)?.battalion;
		const members = battalion?.members || [entity];

		for (const member of members)
			if (!seen.has(member))
			{
				seen.add(member);
				result.push(member);
			}
	}

	return result;
}

const battalionSetHighlight = _setHighlight;
_setHighlight = function(entities, alpha, selected)
{
	battalionSetHighlight(ExpandBattalionPanelEntities(entities), alpha, selected);
};

const battalionSetStatusBars = _setStatusBars;
_setStatusBars = function(entities, enabled)
{
	battalionSetStatusBars(ExpandBattalionPanelEntities(entities), enabled);
};

const battalionAddList = EntitySelection.prototype.addList;
EntitySelection.prototype.addList = function(entities, quiet, force, addFormationMembers)
{
	return battalionAddList.call(
		this,
		NormalizeBattalionPanelEntities(entities),
		quiet,
		force,
		addFormationMembers);
};

const battalionRemoveList = EntitySelection.prototype.removeList;
EntitySelection.prototype.removeList = function(entities, addFormationMembers)
{
	return battalionRemoveList.call(
		this,
		NormalizeBattalionPanelEntities(entities),
		addFormationMembers);
};

const battalionSetHighlightList = EntitySelection.prototype.setHighlightList;
EntitySelection.prototype.setHighlightList = function(entities)
{
	return battalionSetHighlightList.call(
		this,
		NormalizeBattalionPanelEntities(entities));
};

const battalionSelectAndMoveTo = EntitySelection.prototype.selectAndMoveTo;
EntitySelection.prototype.selectAndMoveTo = function(entity)
{
	return battalionSelectAndMoveTo.call(this, GetBattalionPanelEntity(entity));
};

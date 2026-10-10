{
	const cmpGuiInterfaceGetEntityState = GuiInterface.prototype.GetEntityState;

	GuiInterface.prototype.GetEntityState = function(player, ent)
	{
		const ret = cmpGuiInterfaceGetEntityState.call(this, player, ent);
		if (!ret)
			return ret;

		// Expose the same current/max ammunition state used by Grapejuice. This
		// lets session UI extensions display a counter without querying sim state.
		const cmpAmmo = Engine.QueryInterface(ent, IID_Ammo);
		if (cmpAmmo)
			ret.ammo = {
				"currAmmo": cmpAmmo.GetAmmo(),
				"maxAmmo": cmpAmmo.GetMaxAmmo()
			};

		const cmpLeader = Engine.QueryInterface(ent, IID_BattalionLeader);
		if (cmpLeader)
		{
			ret.battalion = {
				"leader": ent,
				"members": cmpLeader.GetBattalionEntities(),
				"pending": cmpLeader.pendingReinforcement,
				"nearReinforcementPoint": cmpLeader.IsNearReinforcementPoint(),
				"xp": cmpLeader.GetCurrentXp(),
				"requiredXp": cmpLeader.GetRequiredXp()
			};
			const cmpTactics = Engine.QueryInterface(ent, IID_BattalionTactics);
			if (cmpTactics)
				ret.battalion.tactics = cmpTactics.GetStatus();
			return ret;
		}

		const cmpMember = Engine.QueryInterface(ent, IID_BattalionMember);
		if (!cmpMember)
			return ret;

		const leader = cmpMember.GetLeader();
		if (leader == INVALID_ENTITY)
			return ret;

		ret.battalion = {
			"leader": leader,
			"member": ent
		};

		return ret;
	};
}

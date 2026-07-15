{
	const cmpGuiInterfaceGetEntityState = GuiInterface.prototype.GetEntityState;

	GuiInterface.prototype.GetEntityState = function(player, ent)
	{
		const ret = cmpGuiInterfaceGetEntityState.call(this, player, ent);
		if (!ret)
			return ret;

		const cmpLeader = Engine.QueryInterface(ent, IID_BattalionLeader);
		if (cmpLeader)
		{
			ret.battalion = {
				"leader": ent,
				"members": cmpLeader.GetBattalionEntities(),
				"xp": cmpLeader.GetCurrentXp(),
				"requiredXp": cmpLeader.GetRequiredXp()
			};
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

{
	const airSupportGetEntityState = GuiInterface.prototype.GetEntityState;

	GuiInterface.prototype.GetEntityState = function(player, ent)
	{
		const ret = airSupportGetEntityState.call(this, player, ent);
		if (!ret)
			return ret;

		const cmpProvider = Engine.QueryInterface(ent, IID_AirSupportProvider);
		if (cmpProvider)
			ret.airSupport = cmpProvider.GetStatus();

		return ret;
	};
}

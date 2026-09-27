// Cheats "martian dust devil" e "martian sandstorm": começam o evento de clima
// perto da primeira entidade selecionada (ou num ponto aleatório).
{
	const weatherCheat = g_Commands.cheat;
	g_Commands.cheat = function(player, cmd, data)
	{
		if (cmd.action != "weather")
		{
			weatherCheat(player, cmd, data);
			return;
		}
		if (!InitAttributes.settings.CheatsEnabled)
			return;

		let position;
		const selected = (cmd.selected || []).map(ent => Engine.QueryInterface(ent, IID_Position)).find(cmp => cmp && cmp.IsInWorld());
		if (selected)
		{
			const pos = selected.GetPosition2D();
			position = { "x": pos.x, "z": pos.y };
		}
		Engine.QueryInterface(SYSTEM_ENTITY, IID_WeatherManager).StartEvent(cmd.text, position);
	};
}

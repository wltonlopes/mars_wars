// Enviado pela GUI (gui/session/z_air_support.js) quando o jogador escolhe
// o ponto do bombardeio. Apenas a primeira estrutura disponível atende.
g_Commands["air-support"] = function(player, cmd, data)
{
	if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z))
		return;

	for (const ent of data.entities)
	{
		const cmpProvider = Engine.QueryInterface(ent, IID_AirSupportProvider);
		if (cmpProvider && cmpProvider.RequestSupport(cmd.supportType, { "x": cmd.x, "z": cmd.z }))
			return;
	}
};

// Battalions use the regular production buttons, but a trained unit is added
// to the selected squad instead of becoming an independent unit.
{
	const battalionTrainCommand = g_Commands.train;
	g_Commands.train = function(player, cmd, data)
	{
		const ordinaryEntities = [];
		for (const ent of data.entities)
		{
			const cmpLeader = Engine.QueryInterface(ent, IID_BattalionLeader);
			if (cmpLeader)
				cmpLeader.QueueReinforcement(cmd.template);
			else
				ordinaryEntities.push(ent);
		}

		if (ordinaryEntities.length)
		{
			const ordinaryData = Object.assign({}, data, { "entities": ordinaryEntities });
			battalionTrainCommand(player, cmd, ordinaryData);
		}
	};
}

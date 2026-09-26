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

// Táticas de batalhão (BattalionTactics): postura e reforço automático.
// Aceita líderes ou membros; cada batalhão é alterado uma vez.
{
	const forEachBattalionTactics = (entities, callback) => {
		const seen = {};
		for (const ent of entities)
		{
			let leader = ent;
			const cmpMember = Engine.QueryInterface(ent, IID_BattalionMember);
			if (cmpMember && cmpMember.GetLeader() != INVALID_ENTITY)
				leader = cmpMember.GetLeader();
			if (seen[leader])
				continue;
			seen[leader] = true;
			const cmpTactics = Engine.QueryInterface(leader, IID_BattalionTactics);
			if (cmpTactics)
				callback(cmpTactics);
		}
	};

	g_Commands["battalion-posture"] = function(player, cmd, data)
	{
		forEachBattalionTactics(data.entities, cmpTactics => cmpTactics.SetPosture(cmd.posture));
	};

	g_Commands["battalion-auto-reinforce"] = function(player, cmd, data)
	{
		forEachBattalionTactics(data.entities, cmpTactics => cmpTactics.SetAutoReinforce(!!cmd.enabled));
	};
}

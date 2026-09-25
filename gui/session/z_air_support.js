/**
 * Botão de apoio aéreo para estruturas com AirSupportProvider.
 *
 * O botão coloca a GUI em modo de mira (como Patrulhar); o clique
 * esquerdo no terreno envia o comando "air-support" para a simulação
 * e o clique direito cancela.
 */

const ACTION_AIR_STRIKE = 100;

g_UnitActions["air-strike"] = {
	"execute": function(position, action, selection, queued, pushFront)
	{
		Engine.PostNetworkCommand({
			"type": "air-support",
			"supportType": "strategic_bomber",
			"entities": [action.firstAbleEntity],
			"x": position.x,
			"z": position.z
		});

		DrawTargetMarker(position);
		return true;
	},
	"getActionInfo": function(entState, targetState)
	{
		return { "possible": !!entState.airSupport && entState.airSupport.available };
	},
	"preSelectedActionCheck": function(target, selection)
	{
		if (preSelectedAction != ACTION_AIR_STRIKE)
			return false;

		const actionInfo = getActionInfo("air-strike", target, selection);
		return actionInfo.possible && {
			"type": "air-strike",
			"cursor": "action-attack",
			"tooltip": translate("Left-click to send the bomber drone, right-click to cancel."),
			"target": target,
			"firstAbleEntity": actionInfo.entity
		};
	},
	"specificness": 0
};

g_UnitActionsSortedKeys = Object.keys(g_UnitActions).sort((a, b) => g_UnitActions[a].specificness - g_UnitActions[b].specificness);

g_EntityCommands["air-strike"] = {
	"getInfo": function(entStates)
	{
		const providers = entStates.filter(entState => entState.airSupport);
		if (!providers.length)
			return false;

		const available = providers.some(entState => entState.airSupport.available);
		const cooldown = Math.min(...providers.map(entState => entState.airSupport.cooldown));

		let status;
		if (available)
			status = translate("Choose a target: the bomber drone flies in from the direction of this building and carpet-bombs the area.");
		else if (providers.every(entState => entState.airSupport.missionActive))
			status = translate("The bomber drone is on its way.");
		else
			status = sprintf(translate("Available in %(time)s."), { "time": timeToString(cooldown) });

		return {
			"tooltip": translate("Drone Bombing") + "\n" + bodyFont(status),
			"icon": "attack-request.png",
			"count": available || !cooldown ? "" : Math.ceil(cooldown / 1000),
			"enabled": available
		};
	},
	"execute": function()
	{
		inputState = INPUT_PRESELECTEDACTION;
		preSelectedAction = ACTION_AIR_STRIKE;
	},
	"allowedPlayers": ["Player"]
};

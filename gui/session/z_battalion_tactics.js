/**
 * Táticas de batalhão (BattalionTactics) na interface.
 *
 * Os batalhões não usam as formações clássicas do 0AD (o comando "formation"
 * os ignora), então, quando a seleção tem batalhões, o painel de formações
 * mostra as posturas no lugar delas. Veículos, aeronaves e outras unidades
 * fora de batalhão continuam com as formações normais.
 *
 * O reforço automático é um botão do painel de comandos. Os tooltips das
 * posturas e do reforço mostram moral e nível do batalhão.
 */

var g_BattalionPostures = {
	"normal": {
		"name": markForTranslation("Normal"),
		"icon": "formations/box.png",
		"description": markForTranslation("The battalion's usual formation, with no bonuses or penalties.")
	},
	"line": {
		"name": markForTranslation("Line"),
		"icon": "formations/line_open.png",
		"description": markForTranslation("Everyone abreast: better accuracy and rate of fire, slower.")
	},
	"column": {
		"name": markForTranslation("Column"),
		"icon": "formations/column_open.png",
		"description": markForTranslation("Single file: 20% faster, for moving between fronts.")
	},
	"cover": {
		"name": markForTranslation("Cover"),
		"icon": "formations/scatter.png",
		"description": markForTranslation("Spread out: half damage from explosions and area attacks (drones, bombs, missiles) and steadier morale, slower.")
	}
};

var g_BattalionPostureOrder = ["normal", "line", "column", "cover"];

var g_BattalionMoraleStates = {
	"steady": markForTranslation("Steady"),
	"shaken": markForTranslation("Shaken"),
	"broken": markForTranslation("Broken")
};

function GetBattalionTacticsStates(entStates)
{
	return entStates.filter(entState => entState.battalion && entState.battalion.tactics &&
		entState.battalion.leader == entState.id);
}

/**
 * Moral e nível, para os tooltips. Com vários batalhões, mostra o primeiro.
 */
function GetBattalionTacticsSummary(leaders)
{
	const tactics = leaders[0].battalion.tactics;
	let summary = sprintf(translate("Morale: %(morale)s%% (%(state)s)"), {
		"morale": tactics.morale,
		"state": translate(g_BattalionMoraleStates[tactics.moraleState])
	});
	if (tactics.retreating)
		summary += " — " + translate("retreating");
	summary += "\n" + (tactics.nextLevelXp !== undefined ?
		sprintf(translate("Level %(level)s — XP %(xp)s/%(next)s"), { "level": tactics.level, "xp": tactics.xp, "next": tactics.nextLevelXp }) :
		sprintf(translate("Level %(level)s (maximum)"), { "level": tactics.level }));
	return summary;
}

// Painel de formações: posturas para batalhões, formações do 0AD para o resto.
{
	const battalionFormationPanel = g_SelectionPanels.Formation;
	const formationGetItems = battalionFormationPanel.getItems;
	const formationSetupButton = battalionFormationPanel.setupButton;

	battalionFormationPanel.getItems = function(unitEntStates)
	{
		// Seleção com batalhão: o comando "formation" não se aplica a ninguém
		// (unidades soltas junto de batalhões andam individualmente).
		if (!unitEntStates.some(entState => entState.battalion))
			return formationGetItems.call(this, unitEntStates);

		if (!GetBattalionTacticsStates(unitEntStates).length)
			return [];

		return g_BattalionPostureOrder.map(posture => ({ "battalionPosture": posture }));
	};

	battalionFormationPanel.setupButton = function(data)
	{
		const posture = data.item.battalionPosture;
		if (!posture)
			return formationSetupButton.call(this, data);

		const leaders = GetBattalionTacticsStates(data.unitEntStates);
		const info = g_BattalionPostures[posture];

		data.button.onPress = function()
		{
			Engine.PostNetworkCommand({
				"type": "battalion-posture",
				"entities": leaders.map(entState => entState.id),
				"posture": posture
			});
		};
		data.button.onMouseRightPress = function() {};

		data.button.tooltip = sprintf(translate("Posture: %(posture)s"), { "posture": translate(info.name) }) + "\n" +
			bodyFont(translate(info.description) + "\n" + GetBattalionTacticsSummary(leaders));

		data.button.enabled = controlsPlayer(data.player);
		data.guiSelection.hidden = !leaders.every(entState => entState.battalion.tactics.posture == posture);
		data.countDisplay.hidden = true;
		data.icon.sprite = "stretched:session/icons/" + info.icon;

		setPanelObjectPosition(data.button, data.i, data.rowLength);
		return true;
	};
}

g_EntityCommands["battalion-auto-reinforce"] = {
	"getInfo": function(entStates)
	{
		const leaders = GetBattalionTacticsStates(entStates);
		if (!leaders.length)
			return false;

		const enabled = leaders.every(entState => entState.battalion.tactics.autoReinforce);
		return {
			"tooltip": (enabled ? translate("Automatic reinforcement: on") : translate("Automatic reinforcement: off")) + "\n" +
				bodyFont(translate("When on, the battalion requests missing soldiers by itself whenever it is near a reinforcement point (civic centre, barracks), paying their normal cost.") + "\n" +
					GetBattalionTacticsSummary(leaders)),
			"icon": enabled ? "autoqueue-on.png" : "autoqueue-off.png",
			"count": leaders[0].battalion.tactics.level ? "N" + leaders[0].battalion.tactics.level : "",
			"enabled": true
		};
	},
	"execute": function(entStates)
	{
		const leaders = GetBattalionTacticsStates(entStates);
		if (!leaders.length)
			return;
		Engine.PostNetworkCommand({
			"type": "battalion-auto-reinforce",
			"entities": leaders.map(entState => entState.id),
			"enabled": !leaders.every(entState => entState.battalion.tactics.autoReinforce)
		});
	},
	"allowedPlayers": ["Player"]
};

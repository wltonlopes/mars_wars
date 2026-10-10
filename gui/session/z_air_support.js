/**
 * Botões de apoio aéreo e reforços para estruturas com AirSupportProvider.
 *
 * Cada tipo (bombardeiro, míssil nuclear, laser orbital, saturação orbital, ICBM, cápsula
 * orbital, túnel, tempestade de areia)
 * tem seu botão; uma estrutura pode ter vários (entState.airSupport é uma
 * lista, um status por poder). O botão coloca a GUI em
 * modo de mira (como Patrulhar); o clique esquerdo no terreno envia o
 * comando "air-support" para a simulação e o clique direito cancela.
 */

var g_AirSupportTypes = {
	"strategic_bomber": {
		"action": 100,
		"icon": "special/strategic_bomber.png",
		"name": markForTranslation("Drone Bombing"),
		"cursorTooltip": markForTranslation("Left-click to send the bomber drone, right-click to cancel."),
		"readyText": markForTranslation("Choose a target: the bomber drone flies in from the direction of this building and carpet-bombs the area."),
		"activeText": markForTranslation("The bomber drone is on its way.")
	},
	"nuke": {
		"action": 104,
		"icon": "special/icbm.png",
		"name": markForTranslation("Nuclear Strike"),
		"cursorTooltip": markForTranslation("Left-click to choose the impact point, right-click to cancel."),
		"readyText": markForTranslation("A nuclear missile comes in from outside the map and obliterates a wide area, including your own and allied units. Every player sees the countdown to impact."),
		"activeText": markForTranslation("The nuclear missile is inbound.")
	},
	"orbital_laser": {
		"action": 105,
		"icon": "special/orbital.png",
		"name": markForTranslation("Orbital Laser"),
		"cursorTooltip": markForTranslation("Left-click to choose where the beam strikes, right-click to cancel."),
		"readyText": markForTranslation("A satellite fires a laser beam at the chosen point for about 10 seconds: it locks on, burns at full power and then fades, damaging enemies in the area."),
		"activeText": markForTranslation("The orbital laser is firing.")
	},
	"orbital_saturation": {
		"action": 107,
		"icon": "special/orbital.png",
		"name": markForTranslation("Orbital Saturation Strike"),
		"cursorTooltip": markForTranslation("Left-click to choose the centre of the barrage, right-click to cancel."),
		"readyText": markForTranslation("Warships in orbit saturate a wide area around the chosen point with dozens of shells for about 12 seconds. The barrage is indiscriminate: it also hits your own and allied units. All players are warned before the first impacts."),
		"activeText": markForTranslation("The orbital barrage is under way.")
	},
	"icbm": {
		"action": 101,
		"icon": "special/icbm.png",
		"name": markForTranslation("Launch ICBM"),
		"cursorTooltip": markForTranslation("Left-click to choose the impact point, right-click to cancel."),
		"readyText": markForTranslation("Choose a target: a ballistic missile devastates a wide area, including your own and allied units. All players are warned of the launch."),
		"activeText": markForTranslation("The missile is in flight.")
	},
	"mine_missile": {
		"action": 108,
		"icon": "special/icbm.png",
		"name": markForTranslation("Fragmentation Missile"),
		"cursorTooltip": markForTranslation("Left-click to choose where the mines are scattered, right-click to cancel."),
		"readyText": markForTranslation("A missile bursts above the chosen point and scatters proximity mines over a wide area. The mines are hidden from the enemy until he is almost on top of them, explode when an enemy ground unit comes close and disarm after a few minutes. Your own and allied units are safe. All players are warned of the launch."),
		"activeText": markForTranslation("The missile is in flight.")
	},
	"white_phosphorus": {
		"action": 109,
		"icon": "special/icbm.png",
		"name": markForTranslation("White Phosphorus Missile"),
		"cursorTooltip": markForTranslation("Left-click to choose where the phosphorus rains down, right-click to cancel."),
		"readyText": markForTranslation("A missile launched from this building bursts above the chosen point and rains burning white phosphorus over a wide area. The fires burn for about 18 seconds and damage everything near them, including your own and allied units: deadly for infantry that stays, weak against buildings. All players are warned of the launch."),
		"activeText": markForTranslation("The missile is in flight.")
	},
	"vehicle_airdrop": {
		"action": 110,
		"icon": "special/drop_pod.png",
		"name": markForTranslation("Heavy Vehicle Airdrop"),
		"cursorTooltip": markForTranslation("Left-click to choose the drop zone, right-click to cancel."),
		"readyText": markForTranslation("A transport aircraft flies in from the direction of this building and drops a supply container on two parachutes; it lands and releases the vehicle (%(pop)s population). The drop zone must be on land, at least %(distance)s m from enemy buildings. Enemy air defense shoots the aircraft down."),
		"activeText": markForTranslation("The transport aircraft is on its way.")
	},
	"drop_pod": {
		"action": 102,
		"icon": "special/drop_pod.png",
		"name": markForTranslation("Orbital Drop Pod"),
		"cursorTooltip": markForTranslation("Left-click to choose the landing point, right-click to cancel."),
		"readyText": markForTranslation("A suborbital capsule lands anywhere on the map, damages everything around the impact and releases an infantry battalion (%(pop)s population)."),
		"activeText": markForTranslation("The drop pod is on its way.")
	},
	"tunnel": {
		"action": 103,
		"icon": "special/infiltration_tunnel.png",
		"name": markForTranslation("Tunnel Assault"),
		"cursorTooltip": markForTranslation("Left-click to choose the tunnel exit, right-click to cancel."),
		"readyText": markForTranslation("Dig a tunnel that opens at the chosen point and releases an infantry battalion (%(pop)s population). The exit must be at least %(distance)s m from enemy buildings."),
		"activeText": markForTranslation("The tunnel is being dug.")
	},
	"sandstorm": {
		"action": 106,
		"icon": "special/sandstorm.png",
		"name": markForTranslation("Summon Sandstorm"),
		"cursorTooltip": markForTranslation("Left-click to choose where the sandstorm forms, right-click to cancel."),
		"readyText": markForTranslation("A sandstorm with lightning forms at the chosen point and drifts away from this building for about 40 seconds. Inside it units move 25%% slower and see 50%% less; the lightning only strikes enemies. All players are warned."),
		"activeText": markForTranslation("The sandstorm is raging.")
	}
};

/** Máximo de opções de batalhão por poder de reforço (um botão cada). */
var g_AirSupportMaxBattalionChoices = 4;

/** Batalhão escolhido no último botão de reforço clicado. */
var g_AirSupportBattalion;

for (const type in g_AirSupportTypes)
{
	const info = g_AirSupportTypes[type];
	const name = "air-support-" + type;
	const statusOf = entState => entState.airSupport && entState.airSupport.find(power => power.type == type);
	const statusesOf = entStates => entStates.map(statusOf).filter(status => status);

	g_UnitActions[name] = {
		"execute": function(position, action, selection, queued, pushFront)
		{
			Engine.PostNetworkCommand({
				"type": "air-support",
				"supportType": type,
				"entities": [action.firstAbleEntity],
				"x": position.x,
				"z": position.z,
				"battalion": g_AirSupportBattalion
			});

			DrawTargetMarker(position);
			return true;
		},
		"getActionInfo": function(entState, targetState)
		{
			return {
				"possible": !!statusOf(entState) && statusOf(entState).available
			};
		},
		"preSelectedActionCheck": function(target, selection)
		{
			if (preSelectedAction != info.action)
				return false;

			const actionInfo = getActionInfo(name, target, selection);
			return actionInfo.possible && {
				"type": name,
				"cursor": "action-attack",
				"tooltip": translate(info.cursorTooltip),
				"target": target,
				"firstAbleEntity": actionInfo.entity
			};
		},
		"specificness": 0
	};

	// Poderes de reforço (cápsula, túnel) têm um botão por batalhão
	// disponível, com o retrato do batalhão; os demais, um botão só.
	for (let choice = -1; choice < g_AirSupportMaxBattalionChoices; ++choice)
		g_EntityCommands[choice < 0 ? name : name + "-" + choice] = {
			"getInfo": function(entStates)
			{
				const providers = statusesOf(entStates);
				if (!providers.length)
					return false;

				const battalions = providers[0].battalions || [];
				if (choice < 0 ? battalions.length : choice >= battalions.length)
					return false;
				const battalion = choice < 0 ? undefined : battalions[choice];

				const available = providers.some(status => status.available);
				const cooldown = Math.min(...providers.map(status => status.cooldown));

				let status;
				const locked = providers.every(status => status.locked);
				if (locked)
					status = providers[0].requiredTechnology.startsWith("phase_city") ?
						translate("Locked: requires the City Phase (phase 3).") :
						sprintf(translate("Locked: requires the technology %(technology)s."), { "technology": providers[0].requiredTechnology });
				else if (available)
					status = sprintf(translate(info.readyText), {
						"pop": battalion ? battalion.popCost : providers[0].popCost,
						"distance": providers[0].minDistanceFromEnemyStructures
					});
				else if (providers.every(status => status.missionActive))
					status = translate(info.activeText);
				else
					status = sprintf(translate("Available in %(time)s."), { "time": timeToString(cooldown) });

				return {
					"tooltip": translate(info.name) + (battalion ? ": " + translate(battalion.name) : "") + "\n" + bodyFont(status),
					"icon": info.icon,
					"portrait": battalion && battalion.icon,
					"count": available || locked || !cooldown ? "" : Math.ceil(cooldown / 1000),
					"enabled": available
				};
			},
			"execute": function(entStates)
			{
				const providers = statusesOf(entStates);
				const battalions = providers.length && providers[0].battalions || [];
				g_AirSupportBattalion = choice >= 0 && battalions[choice] ? battalions[choice].template : undefined;
				inputState = INPUT_PRESELECTEDACTION;
				preSelectedAction = info.action;
			},
			"allowedPlayers": ["Player"]
		};
}

g_UnitActionsSortedKeys = Object.keys(g_UnitActions).sort((a, b) => g_UnitActions[a].specificness - g_UnitActions[b].specificness);

// Botões de reforço mostram o retrato do batalhão (session/portraits), e não
// um ícone de session/icons.
{
	const airSupportSetupCommandButton = g_SelectionPanels.Command.setupButton;
	g_SelectionPanels.Command.setupButton = function(data)
	{
		const ret = airSupportSetupCommandButton.call(this, data);
		if (data.item.portrait)
			data.icon.sprite = "stretched:session/portraits/" + data.item.portrait;
		return ret;
	};
}

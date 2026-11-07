/**
 * Botões de apoio aéreo e reforços para estruturas com AirSupportProvider.
 *
 * Cada tipo (bombardeiro, míssil nuclear, laser orbital, saturação orbital, ICBM, cápsula
 * orbital, túnel e as aeronaves de apoio aircraft_1..8, com o retrato da aeronave)
 * O template pode trocar nome, descrição e ícone de um poder
 * (AirSupportProvider/<tipo>/Name, Tooltip e Icon).
 * tem seu botão; uma estrutura pode ter vários (entState.airSupport é uma
 * lista, um status por poder). Os botões ficam na mesma área dos botões de
 * treino (painel Training, logo depois das unidades), e não na fila de
 * comandos pequenos do meio (ver o fim deste arquivo). O botão coloca a GUI em
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
	"hypersonic": {
		"action": 116,
		"icon": "special/icbm.png",
		"name": markForTranslation("Hypersonic Missile"),
		"cursorTooltip": markForTranslation("Left-click to choose the impact point, right-click to cancel."),
		"readyText": markForTranslation("A hypersonic missile launched from this building strikes the chosen point within seconds. It is too fast for any air defense to intercept. It also hits your own and allied units."),
		"activeText": markForTranslation("The hypersonic missile is in flight.")
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
	"parachute_bomb": {
		"action": 111,
		"icon": "special/icbm.png",
		"name": markForTranslation("Heavy Parachute Bomb"),
		"cursorTooltip": markForTranslation("Left-click to choose the impact point, right-click to cancel."),
		"readyText": markForTranslation("A transport aircraft flies in from the direction of this building and drops a heavy bomb on parachutes; it devastates a wide area, including your own and allied units."),
		"activeText": markForTranslation("The aircraft is on its way.")
	},
	"recon_drone": {
		"action": 112,
		"icon": "special/strategic_bomber.png",
		"name": markForTranslation("Reconnaissance Drone"),
		"cursorTooltip": markForTranslation("Left-click to choose the area to watch, right-click to cancel."),
		"readyText": markForTranslation("A reconnaissance drone flies in from the direction of this building and circles the chosen point, revealing the area around it for a while."),
		"activeText": markForTranslation("The reconnaissance drone is in the air.")
	},
	"recon_aircraft": {
		"action": 113,
		"icon": "special/strategic_bomber.png",
		"name": markForTranslation("Remote Sensing Aircraft"),
		"cursorTooltip": markForTranslation("Left-click to choose the area to watch, right-click to cancel."),
		"readyText": markForTranslation("A remote sensing aircraft circles high above the chosen point, revealing a wide area for a long time. Only long-range air defense can shoot it down."),
		"activeText": markForTranslation("The remote sensing aircraft is in the air.")
	},
	"drone_strike": {
		"action": 115,
		"icon": "special/strategic_bomber.png",
		"name": markForTranslation("Attack Drone"),
		"cursorTooltip": markForTranslation("Left-click to choose the area to attack, right-click to cancel."),
		"readyText": markForTranslation("An attack drone circles the chosen point, fires its missiles at ground targets in the area and leaves."),
		"activeText": markForTranslation("The attack drone is in the air.")
	},
	"air_patrol": {
		"action": 114,
		"icon": "special/strategic_bomber.png",
		"name": markForTranslation("Fighter Air Patrol"),
		"cursorTooltip": markForTranslation("Left-click to choose the area to patrol, right-click to cancel."),
		"readyText": markForTranslation("Fighters circle the chosen point for a while, shooting down enemy support aircraft and aircraft and attacking ground units in the area."),
		"activeText": markForTranslation("The fighter patrol is in the air.")
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
	// Mars Wars: tempestade de areia dos Piratas (centro cívico).
	"sandstorm": {
		"action": 106,
		"icon": "special/sandstorm.png",
		"name": markForTranslation("Summon Sandstorm"),
		"cursorTooltip": markForTranslation("Left-click to choose where the sandstorm forms, right-click to cancel."),
		"readyText": markForTranslation("A sandstorm with lightning forms at the chosen point and drifts away from this building for about 40 seconds. Inside it units move 25%% slower and see 50%% less; the lightning only strikes enemies. All players are warned."),
		"activeText": markForTranslation("The sandstorm is raging.")
	}
};

// Aeronaves de apoio (AirSupportProvider aircraft_1..8): cada uma tem nome,
// descrição e retrato no template; os textos abaixo só valem se faltarem.
for (let n = 1; n <= 8; ++n)
	g_AirSupportTypes["aircraft_" + n] = {
		"action": 120 + n,
		"icon": "special/strategic_bomber.png",
		"name": markForTranslation("Air Support"),
		"cursorTooltip": markForTranslation("Left-click to choose the target, right-click to cancel."),
		"readyText": markForTranslation("Choose a target: the aircraft flies in from the direction of this building."),
		"activeText": markForTranslation("The aircraft is in the air.")
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
						providers[0].requiredTechnology.startsWith("phase_town") ?
						translate("Locked: requires the Town Phase (phase 2).") :
						sprintf(translate("Locked: requires the technology %(technology)s."), { "technology": providers[0].requiredTechnology });
				else if (available)
					status = sprintf(translate(providers[0].tooltip || info.readyText), {
						"pop": battalion ? battalion.popCost : providers[0].popCost,
						"distance": providers[0].minDistanceFromEnemyStructures
					});
				else if (providers.every(status => status.missionActive))
					status = translate(info.activeText);
				else
					status = sprintf(translate("Available in %(time)s."), { "time": timeToString(cooldown) });

				return {
					"tooltip": translate(providers[0].name || info.name) + (battalion ? ": " + translate(battalion.name) : "") + "\n" + bodyFont(status),
					"icon": providers[0].icon || info.icon,
					"portrait": battalion && battalion.icon || providers[0].portrait,
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

// ---------------------------------------------------------------------------
// Os botões de suporte ficam na área de treino (painel da direita), depois das
// unidades treináveis, no mesmo tamanho delas. O painel de comandos pequenos
// do meio deixa de mostrá-los. Como entram na conta de botões do painel de
// treino, as tecnologias (painel Research) continuam logo depois deles.
{
	const isSupport = name => name.startsWith("air-support-");

	g_SelectionPanels.Command.getItems = function(unitEntStates)
	{
		const commands = [];
		for (const command in g_EntityCommands)
		{
			if (isSupport(command))
				continue;
			const info = getCommandInfo(command, unitEntStates);
			if (!info)
				continue;
			info.name = command;
			if (commands.push(info) >= this.getMaxNumberOfItems())
				break;
		}
		return commands;
	};

	const trainingGetItems = g_SelectionPanels.Training.getItems;
	g_SelectionPanels.Training.getItems = function(unitEntStates)
	{
		const items = (trainingGetItems.call(this, unitEntStates) || []).slice();
		for (const command in g_EntityCommands)
		{
			if (!isSupport(command))
				continue;
			const info = getCommandInfo(command, unitEntStates);
			if (info)
				items.push({ "airSupport": command, "info": info });
		}
		return items;
	};

	const trainingSetupButton = g_SelectionPanels.Training.setupButton;
	g_SelectionPanels.Training.setupButton = function(data)
	{
		if (typeof data.item != "object" || !data.item.airSupport)
			return trainingSetupButton.call(this, data);

		const info = data.item.info;
		const command = data.item.airSupport;
		data.button.tooltip = info.tooltip;
		data.button.onPress = function()
		{
			performCommand(data.unitEntStates, command);
		};
		data.button.onPressRight = function() {};
		data.button.onPressRightDisabled = function() {};
		data.countDisplay.caption = info.count || "";
		data.button.enabled = info.enabled == true && controlsPlayer(data.player);

		// Indisponível (em recarga, em missão ou bloqueado): cinza, como uma
		// unidade que não pode ser treinada.
		const modifier = data.button.enabled ? "" : "color:0 0 0 127:grayscale:";
		data.icon.sprite = modifier + (info.portrait ?
			"stretched:session/portraits/" + info.portrait :
			"stretched:session/icons/" + info.icon);

		setPanelObjectPosition(data.button, data.i + getNumberOfRightPanelButtons(), data.rowLength);
		return true;
	};
}

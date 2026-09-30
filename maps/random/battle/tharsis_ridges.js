/**
 * Tharsis Ridges (modo batalha) — dois exércitos, oeste contra leste.
 *
 * - Uma mesa no centro, de paredes íngremes, com uma rampa virada para cada
 *   exército; no topo, o ponto de controle principal e dois parques solares.
 * - Duas cristas de rocha dividem o mapa em três faixas (norte, centro,
 *   sul), com passagens estreitas entre elas.
 * - 3 pontos de controle: topo da mesa, faixa norte e faixa sul
 *   (a maioria são 2).
 * - Morros e crateras espalhados, sempre espelhados para ser justo.
 */
Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

import { Battlefield, setupBattleAtmosphere, tRegolith } from "maps/random/battle/battlefield.js";

export function* generateMap(mapSettings)
{
	setBiome("generic/nubia");
	setupBattleAtmosphere();

	const baseHeight = 20;
	globalThis.g_Map = new RandomMap(baseHeight, tRegolith);
	const bf = new Battlefield(baseHeight, 2.5);
	const f = fractionToTiles;

	// Posições principais (o lado leste é o oeste girado 180°).
	const players = [bf.at(0.13, 0.5), bf.at(0.87, 0.5)];
	const controlPoints = [bf.at(0.5, 0.5), bf.at(0.5, 0.85), bf.at(0.5, 0.15)];
	const solarParks = [
		bf.at(0.455, 0.5), bf.at(0.545, 0.5),
		bf.at(0.40, 0.86), bf.at(0.60, 0.14),
		bf.at(0.60, 0.86), bf.at(0.40, 0.14),
		bf.at(0.18, 0.34), bf.at(0.82, 0.66)
	];
	const iceFields = [bf.at(0.44, 0.78), bf.at(0.56, 0.22)];

	for (const position of players)
		bf.keepClear(position, defaultPlayerBaseRadius());
	for (const position of controlPoints.slice(1))
		bf.keepClear(position, 11);
	for (const position of solarParks.slice(2))
		bf.keepClear(position, 8);
	for (const position of iceFields)
		bf.keepClear(position, 7);
	yield 10;

	g_Map.log("Raising the central mesa");
	bf.addMesa(bf.center, f(0.1), 14, [0, Math.PI], f(0.07), 0.3);

	g_Map.log("Raising the ridges");
	const ridge = (x0, z0, x1, z1) =>
	{
		bf.addRidge(bf.at(x0, z0), bf.at(x1, z1), 3, 12);
		bf.addRidge(bf.mirror(bf.at(x0, z0)), bf.mirror(bf.at(x1, z1)), 3, 12);
	};
	// Crista norte com passagens em x≈0.34 e depois de x≈0.72; a sul é a
	// mesma, girada.
	ridge(0.18, 0.70, 0.29, 0.71);
	ridge(0.40, 0.70, 0.72, 0.69);
	yield 20;

	g_Map.log("Hills and craters");
	bf.scatter(scaleByMapSize(3, 8), 8, p => bf.addHill(p, randFloat(5, 9), randFloat(4, 8)));
	bf.scatter(scaleByMapSize(1, 4), 10, p => bf.addCrater(p, randFloat(5, 8), randFloat(2, 3), randFloat(1, 2)));
	yield 30;

	bf.buildTerrain();
	yield 50;

	yield* bf.finish({
		"players": players,
		"controlPoints": controlPoints,
		"solarParks": solarParks,
		"iceFields": iceFields,
		"highLevel": baseHeight + 9
	});

	return g_Map;
}

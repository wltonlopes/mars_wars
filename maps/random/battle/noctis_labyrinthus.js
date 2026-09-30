/**
 * Noctis Labyrinthus (modo batalha) — o "labirinto da noite" de Marte:
 * dezenas de mesas de paredes íngremes formando corredores estreitos.
 *
 * - Mesas espalhadas (espelhadas) criam um labirinto de corredores; algumas
 *   têm uma rampa e servem de posto alto.
 * - No centro, uma mesa grande com quatro rampas e o ponto principal.
 * - 5 pontos de controle: o centro, norte, sul e um perto de cada exército
 *   (a maioria são 3, então é preciso tomar algum do meio).
 * - Parques solares nos corredores entre os pontos.
 */
Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

import { Battlefield, setupBattleAtmosphere, tRegolith } from "maps/random/battle/battlefield.js";

export function* generateMap(mapSettings)
{
	setBiome("generic/nubia");
	setupBattleAtmosphere();

	const baseHeight = 18;
	globalThis.g_Map = new RandomMap(baseHeight, tRegolith);
	const bf = new Battlefield(baseHeight, 2);
	const f = fractionToTiles;

	const players = [bf.at(0.12, 0.5), bf.at(0.88, 0.5)];
	const controlPoints = [
		bf.at(0.5, 0.5),
		bf.at(0.5, 0.82), bf.at(0.5, 0.18),
		bf.at(0.3, 0.5), bf.at(0.7, 0.5)
	];
	const solarParks = [
		bf.at(0.36, 0.27), bf.at(0.64, 0.73),
		bf.at(0.36, 0.73), bf.at(0.64, 0.27),
		bf.at(0.16, 0.2), bf.at(0.84, 0.8)
	];
	const iceFields = [bf.at(0.44, 0.86), bf.at(0.56, 0.14)];

	for (const position of players)
		bf.keepClear(position, defaultPlayerBaseRadius() + 4);
	for (const position of controlPoints)
		bf.keepClear(position, 13);
	for (const position of solarParks)
		bf.keepClear(position, 9);
	for (const position of iceFields)
		bf.keepClear(position, 8);
	yield 10;

	g_Map.log("Raising the central mesa");
	bf.addMesa(bf.center, f(0.075), 13, [0, Math.PI / 2, Math.PI, -Math.PI / 2], f(0.06), 0.26);
	// Não espalhar mesas em cima da mesa central.
	bf.blockScatter(bf.center, f(0.075) + f(0.06));

	g_Map.log("Raising the labyrinth");
	const mesaCount = scaleByMapSize(16, 44);
	bf.scatter(mesaCount, 11, p =>
	{
		// A mesma forma para o par espelhado: tamanho e rampa decididos pela
		// posição (ângulo da rampa girado 180° do outro lado).
		const seed = Math.abs(Math.sin(Math.min(p.x, bf.size - p.x) * 12.9898 + Math.min(p.y, bf.size - p.y) * 78.233)) % 1;
		const radius = 4 + seed * 5;
		const hasRamp = seed > 0.55;
		const rampAngle = seed * 2 * Math.PI + (p.x > bf.size / 2 ? Math.PI : 0);
		bf.addMesa(p, radius, 11 + seed * 5, hasRamp ? [rampAngle] : [], 10, 0.35);
	});
	bf.scatter(scaleByMapSize(2, 6), 6, p => bf.addHill(p, randFloat(4, 7), randFloat(3, 6)));
	yield 30;

	bf.buildTerrain();
	yield 50;

	yield* bf.finish({
		"players": players,
		"controlPoints": controlPoints,
		"solarParks": solarParks,
		"iceFields": iceFields,
		"highLevel": baseHeight + 8
	});

	return g_Map;
}

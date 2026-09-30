/**
 * Hellas Basin (modo batalha) — a grande bacia de impacto do sul de Marte.
 *
 * - No centro, o fundo rebaixado da bacia com um lago de gelo e o ponto de
 *   controle principal, protegido por dois rochedos de paredes íngremes.
 * - A bacia é cercada por uma muralha de rocha com quatro passagens
 *   (nas diagonais); cada passagem tem um ponto de controle.
 * - 5 pontos de controle: o centro e as quatro passagens (a maioria são 3).
 * - Os exércitos começam fora da muralha, a oeste e a leste; parques solares
 *   ficam nos flancos norte e sul, fora da muralha.
 */
Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

import { Battlefield, setupBattleAtmosphere, tRegolith } from "maps/random/battle/battlefield.js";

export function* generateMap(mapSettings)
{
	setBiome("generic/nubia");
	setupBattleAtmosphere();

	const baseHeight = 24;
	globalThis.g_Map = new RandomMap(baseHeight, tRegolith);
	const bf = new Battlefield(baseHeight, 2);
	const f = fractionToTiles;
	const polar = (angle, radius) => Vector2D.add(bf.center, new Vector2D(f(radius), 0).rotate(-angle)).round();

	const wallRadius = 0.28;
	const passAngles = [1, 3, 5, 7].map(i => i * Math.PI / 4);

	const players = [polar(Math.PI, 0.4), polar(0, 0.4)];
	const controlPoints = [bf.center.clone().round(), ...passAngles.map(a => polar(a, wallRadius))];
	const solarParks = [
		polar(Math.PI / 2, 0.4), polar(-Math.PI / 2, 0.4),
		polar(Math.PI / 2 - 0.35, 0.36), polar(-Math.PI / 2 - 0.35, 0.36),
		polar(Math.PI / 2 + 0.35, 0.36), polar(-Math.PI / 2 + 0.35, 0.36)
	];
	const iceFields = [polar(Math.PI / 4, 0.07), polar(-3 * Math.PI / 4, 0.07)];

	for (const position of players)
		bf.keepClear(position, defaultPlayerBaseRadius());
	for (const position of controlPoints)
		bf.keepClear(position, 12);
	for (const position of solarParks)
		bf.keepClear(position, 8);
	yield 10;

	g_Map.log("Digging the basin");
	bf.addCrater(bf.center, f(0.26), 9, 0);

	g_Map.log("Raising the basin wall with four passes");
	// Muralha em arcos entre as passagens (cada arco em três segmentos).
	for (let i = 0; i < 4; ++i)
	{
		const from = passAngles[i] + 0.2;
		const to = passAngles[i] + Math.PI / 2 - 0.2;
		for (let k = 0; k < 3; ++k)
		{
			const a0 = from + (to - from) * k / 3;
			const a1 = from + (to - from) * (k + 1) / 3;
			bf.addRidge(polar(a0, wallRadius), polar(a1, wallRadius), 3.5, 13);
		}
	}

	g_Map.log("Rock towers inside the basin");
	bf.addMesa(polar(Math.PI / 2, 0.13), 5, 11);
	bf.addMesa(polar(-Math.PI / 2, 0.13), 5, 11);
	yield 20;

	g_Map.log("Hills and craters outside the wall");
	bf.scatter(scaleByMapSize(3, 7), 10, p =>
	{
		if (p.distanceTo(bf.center) > f(wallRadius + 0.06))
			bf.addHill(p, randFloat(5, 9), randFloat(4, 8));
	});
	bf.scatter(scaleByMapSize(1, 3), 12, p =>
	{
		if (p.distanceTo(bf.center) > f(wallRadius + 0.08))
			bf.addCrater(p, randFloat(5, 7), randFloat(2, 3), randFloat(1, 2));
	});
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

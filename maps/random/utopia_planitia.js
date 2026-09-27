/**
 * Utopia Planitia — planície gigante do hemisfério norte de Marte, onde
 * pousou a Viking 2: chão plano de regolito, crateras espalhadas, terreno
 * poligonal rachado e gelo logo abaixo da superfície.
 *
 * - 5 pontos de controle: um no centro (dentro de uma grande cratera com
 *   gelo exposto) e um em cada ponto cardeal.
 * - Minas de gelo (Água) no centro, junto dos pontos cardeais, perto das
 *   bases e em campos disputados entre jogadores vizinhos.
 * - Parques solares (Energia) capturáveis: um perto de cada base e outros
 *   disputados entre as bases.
 * - Texturas marcianas do mod (regolito, gelo, pisos de colônia) misturadas
 *   com o bioma núbio (areia, dunas, terra rachada e rochas).
 */
Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

/**
 * Direção do primeiro ponto cardeal. O minimapa do 0 A.D. mostra o mapa
 * girado 45°, então as diagonais do mapa aparecem em cima, embaixo e dos
 * lados do minimapa.
 */
const CARDINAL_ANGLE_OFFSET = Math.PI / 4;

// Texturas.
const tRegolith = ["drift_01", "drift_02", "drift_01", "nubia_sand_01"];
const tDust = ["drift_02", "nubia_sand_ripples"];
const tDunes = ["nubia_sand_dunes_01", "nubia_sand_ripples", "nubia_sand_01_dunes"];
const tRocky = ["nubia_rocks_dirt_01", "nubia_rocks_dirt_02"];
const tPolygons = "nubia_dirt_cracks_01";
const tCraterRim = ["nubia_rocks_dirt_03", "nubia_rocks_dirt_02", "nubia_dirt_02"];
const tCraterFloor = ["nubia_dirt_01", "drift_02", "nubia_dirt_03"];
const tIce = ["glacial_01", "glacial_02", "glacial_03"];
const tIceEdge = "glacial_01";
const tBaseInner = "city_mars_01";
const tBaseOuter = "city_mars_02";
const tPad = "city_mars_01_02";
const tPadEdge = "city_mars_01_01";

// Entidades.
const oIce = "gaia/mars_ice_01";
const oSolarPark = "gaia/solar_park_01";
const oControlPoint = "structures/control_point";
const oRockLarge = "gaia/rock/savanna_large";
const oRockSmall = "gaia/rock/savanna_small";
const aBoulder = "actor|geology/stone_savanna_med_red.xml";
const aBoulderBrown = "actor|geology/stone_savanna_med_brown.xml";
const aStone = "actor|geology/stone_desert_med.xml";
const aIceChunk = "actor|props/special/eyecandy/iceberg.xml";

export function* generateMap(mapSettings)
{
	setBiome("generic/nubia");

	// Céu empoeirado cor de caramelo, sol fraco e névoa alaranjada.
	setSkySet("desert");
	setSunColor(1.18, 0.98, 0.82);
	setSunElevation(0.62);
	setSunRotation(randomAngle());
	setAmbientColor(0.42, 0.33, 0.29);
	setFogColor(0.82, 0.58, 0.42);
	setFogFactor(0.0032);
	setFogThickness(0.22);
	setPPEffect("hdr");
	setPPSaturation(0.9);
	setPPContrast(1.05);
	setPPBloom(0.15);

	const heightLand = 25;
	globalThis.g_Map = new RandomMap(heightLand, tRegolith);

	const mapCenter = g_Map.getCenter();
	const numPlayers = getNumPlayers();

	const clPlayer = g_Map.createTileClass();
	const clBaseResource = g_Map.createTileClass();
	const clControlPoint = g_Map.createTileClass();
	const clCrater = g_Map.createTileClass();
	const clIce = g_Map.createTileClass();
	const clSolar = g_Map.createTileClass();
	const clRock = g_Map.createTileClass();
	const clPatch = g_Map.createTileClass();
	const clDecor = g_Map.createTileClass();

	const polar = (angle, radius) => Vector2D.add(mapCenter, new Vector2D(radius, 0).rotate(-angle));

	// ------------------------------------------------ posições principais
	const cpRadius = fractionToTiles(0.38);
	const cpAngles = [0, 1, 2, 3].map(i => CARDINAL_ANGLE_OFFSET + i * Math.PI / 2);

	// Jogadores num círculo, girado para ficar o mais longe possível dos
	// pontos cardeais.
	const playerRadius = fractionToTiles(0.3);
	const angularDistance = (a, b) => {
		const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
		return d;
	};
	let bestStart = 0;
	let bestClearance = -1;
	const turn = randomAngle();
	for (let step = 0; step < 72; ++step)
	{
		const start = turn + step * Math.PI / 36;
		let clearance = Infinity;
		for (let i = 0; i < numPlayers; ++i)
			for (const cpAngle of cpAngles)
				clearance = Math.min(clearance, angularDistance(start + 2 * Math.PI * i / numPlayers, cpAngle));
		if (clearance > bestClearance + 1e-6)
		{
			bestClearance = clearance;
			bestStart = start;
		}
	}
	const { playerIDs, playerPosition, playerAngle } = playerPlacementCircle(playerRadius, bestStart);

	// ------------------------------------------------ relevo
	g_Map.log("Creating gentle undulations of the plain");
	createBumps(undefined, scaleByMapSize(40, 160), 2, 10, 4, 0, 1.2);
	yield 10;

	g_Map.log("Creating the central crater");
	const centralCraterRadius = Math.max(16, fractionToTiles(0.085));
	createCrater(mapCenter, centralCraterRadius, 5, 3, tIce, tCraterRim, clCrater);
	yield 15;

	g_Map.log("Creating scattered craters");
	const craterCount = scaleByMapSize(5, 22);
	for (let i = 0, tries = 0; i < craterCount && tries < craterCount * 30; ++tries)
	{
		const radius = randFloat(4, scaleByMapSize(8, 14));
		const position = new Vector2D(randFloat(0, g_Map.getSize()), randFloat(0, g_Map.getSize())).round();
		if (!g_Map.validTile(position, radius * 1.6 + 3))
			continue;
		if (position.distanceTo(mapCenter) < centralCraterRadius * 1.6 + radius * 1.6 + 6 ||
			playerPosition.some(p => p.distanceTo(position) < defaultPlayerBaseRadius() + radius * 1.6 + 8) ||
			cpAngles.some(a => polar(a, cpRadius).distanceTo(position) < radius * 1.6 + 14) ||
			!avoidClasses(clCrater, radius * 1.6 + 4).allows(position))
			continue;
		createCrater(position, radius, randFloat(1.5, 3.5), randFloat(0.8, 2), tCraterFloor, tCraterRim, clCrater);
		++i;
	}
	yield 25;

	// ------------------------------------------------ bases
	placePlayerBases({
		"PlayerPlacement": [playerIDs, playerPosition],
		"PlayerTileClass": clPlayer,
		"BaseResourceClass": clBaseResource,
		"Walls": false,
		"CityPatch": {
			"outerTerrain": tBaseOuter,
			"innerTerrain": tBaseInner,
			"radius": defaultPlayerBaseRadius() / 2.5
		},
		"Mines": {
			"types": [
				{ "template": oIce },
				{ "template": oRockLarge }
			],
			"distance": 14
		}
	});

	g_Map.log("Marking player areas");
	for (const position of playerPosition)
		createArea(new DiskPlacer(defaultPlayerBaseRadius(), position), new TileClassPainter(clPlayer));
	yield 35;

	g_Map.log("Placing a solar park near each base");
	for (let i = 0; i < numPlayers; ++i)
	{
		// Atrás da base (longe do centro); se não couber, nos lados.
		const outward = playerAngle[i];
		for (const offset of [0, 0.5, -0.5, 1, -1, 1.5, -1.5])
		{
			const position = Vector2D.add(playerPosition[i], new Vector2D(17, 0).rotate(-(outward + offset))).round();
			if (placeSolarPark(position, [clBaseResource, 3]))
				break;
		}
	}
	yield 40;

	// ------------------------------------------------ pontos de controle
	g_Map.log("Placing the five control points");
	placeControlPoint(mapCenter);
	g_Map.log("Central ice deposit");
	for (let i = 0; i < 4; ++i)
		placeIceMine(polar(i * Math.PI / 2, centralCraterRadius * 0.6).round(), false);

	for (const angle of cpAngles)
	{
		const position = polar(angle, cpRadius).round();
		placeControlPoint(position);
		// Duas minas de gelo ao lado de cada ponto cardeal, uma de cada lado.
		for (const side of [-1, 1])
			placeIceMine(Vector2D.add(position, new Vector2D(11, 0).rotate(-(angle + side * Math.PI / 2))).round(), true);
	}
	yield 50;

	// ------------------------------------------------ recursos disputados
	g_Map.log("Placing contested resources between neighbouring players");
	if (numPlayers > 1)
		for (let i = 0; i < numPlayers; ++i)
		{
			const a = playerAngle[i];
			let b = playerAngle[(i + 1) % numPlayers];
			if (b < a)
				b += 2 * Math.PI;
			const middle = (a + b) / 2;

			// Parque solar a meio caminho entre o centro e as bases.
			for (const radius of [fractionToTiles(0.2), fractionToTiles(0.23), fractionToTiles(0.17)])
				if (placeSolarPark(polar(middle, radius).round(), [clControlPoint, 12, clCrater, 2, clPlayer, 6]))
					break;

			// Campo de gelo com duas minas, se não ficar em cima de um ponto cardeal
			// (que já tem as suas).
			const icePosition = polar(middle, fractionToTiles(0.3)).round();
			if (avoidClasses(clControlPoint, 18, clPlayer, 8, clSolar, 8).allows(icePosition))
				for (const side of [-1, 1])
					placeIceMine(Vector2D.add(icePosition, new Vector2D(5, 0).rotate(-(middle + side * Math.PI / 2))).round(), true);
		}
	yield 60;

	// ------------------------------------------------ texturas da planície
	g_Map.log("Creating dune fields");
	createLayeredPatches(
		[scaleByMapSize(4, 8), scaleByMapSize(8, 16), scaleByMapSize(12, 26)],
		[tDust, tDunes],
		[1],
		avoidClasses(clPlayer, 6, clControlPoint, 6, clCrater, 2, clSolar, 3, clIce, 4),
		scaleByMapSize(6, 22),
		clPatch);

	g_Map.log("Creating polygonal patterned ground");
	createPatches(
		[scaleByMapSize(3, 6), scaleByMapSize(5, 11), scaleByMapSize(8, 18)],
		tPolygons,
		avoidClasses(clPlayer, 4, clControlPoint, 6, clPatch, 2, clSolar, 3),
		scaleByMapSize(10, 36),
		clPatch);

	g_Map.log("Creating rocky patches");
	createPatches(
		[scaleByMapSize(2, 4), scaleByMapSize(3, 7), scaleByMapSize(5, 12)],
		tRocky,
		avoidClasses(clPlayer, 4, clControlPoint, 6, clPatch, 1, clSolar, 3, clIce, 3),
		scaleByMapSize(10, 40),
		clPatch);
	yield 70;

	// ------------------------------------------------ materiais e gelo extra
	g_Map.log("Creating materials (rock) deposits");
	createBalancedStoneMines(
		oRockSmall,
		oRockLarge,
		clRock,
		avoidClasses(clPlayer, scaleByMapSize(18, 30), clControlPoint, 10, clSolar, 6, clIce, 8, clCrater, 1));

	g_Map.log("Creating extra buried ice");
	createBalancedMines(
		oIce,
		oIce,
		clIce,
		avoidClasses(clPlayer, scaleByMapSize(22, 34), clControlPoint, 14, clSolar, 6, clRock, 8, clCrater, 1),
		{
			"largeCount": Math.max(2, numPlayers),
			"smallCount": 0,
			"randomSmallCount": scaleByMapSize(1, 4)
		},
		0.1);
	yield 80;

	// ------------------------------------------------ decoração
	g_Map.log("Scattering boulders");
	createDecoration(
		[
			[new SimpleObject(aBoulder, 1, 2, 0, 1)],
			[new SimpleObject(aBoulderBrown, 1, 3, 0, 2)],
			[new SimpleObject(aStone, 2, 5, 0, 3)]
		],
		[
			scaleByMapAreaAbsolute(12),
			scaleByMapAreaAbsolute(10),
			scaleByMapAreaAbsolute(14)
		],
		avoidClasses(clPlayer, 8, clControlPoint, 5, clSolar, 3, clIce, 2, clRock, 3, clBaseResource, 3, clDecor, 3));

	g_Map.log("Ice chunks around the ice fields");
	createObjectGroupsDeprecated(
		new SimpleGroup([new SimpleObject(aIceChunk, 1, 2, 0, 2)], true, clDecor),
		0,
		[stayClasses(clIce, 1), avoidClasses(clDecor, 2, clControlPoint, 3, clSolar, 2)],
		scaleByMapSize(8, 30),
		30);
	yield 90;

	placePlayersNomad(clPlayer, avoidClasses(clControlPoint, 10, clSolar, 4, clIce, 4, clRock, 4, clCrater, 1));

	return g_Map;

	// ------------------------------------------------ auxiliares

	/**
	 * Cratera de impacto: fundo rebaixado em parábola, borda elevada e
	 * arredondada. Pinta o fundo e a borda.
	 */
	function createCrater(center, radius, depth, rimHeight, floorTerrain, rimTerrain, tileClass)
	{
		const outer = radius * 1.6;
		const minX = Math.max(0, Math.floor(center.x - outer));
		const maxX = Math.min(g_Map.getSize(), Math.ceil(center.x + outer));
		const minZ = Math.max(0, Math.floor(center.y - outer));
		const maxZ = Math.min(g_Map.getSize(), Math.ceil(center.y + outer));
		for (let x = minX; x <= maxX; ++x)
			for (let z = minZ; z <= maxZ; ++z)
			{
				const vertex = new Vector2D(x, z);
				const d = vertex.distanceTo(center) / radius;
				if (d > 1.6 || !g_Map.validHeight(vertex))
					continue;
				let height = g_Map.getHeight(vertex);
				if (d < 1)
					height -= depth * (1 - d * d);
				height += rimHeight * Math.exp(-Math.pow((d - 1) / 0.22, 2));
				g_Map.setHeight(vertex, height);

				if (!g_Map.validTile(vertex))
					continue;
				if (d < 0.75)
				{
					g_Map.setTexture(vertex, pickRandom(Array.isArray(floorTerrain) ? floorTerrain : [floorTerrain]));
					tileClass.add(vertex);
				}
				else if (d < 1.25 && randBool(1.3 - Math.abs(d - 1) * 2.5))
				{
					g_Map.setTexture(vertex, pickRandom(rimTerrain));
					tileClass.add(vertex);
				}
			}
	}

	/**
	 * Aplaina um disco na altura média do lugar.
	 */
	function flatten(position, radius)
	{
		createArea(
			new DiskPlacer(radius, position),
			new SmoothElevationPainter(ELEVATION_SET, g_Map.getHeight(position), 2));
	}

	function placeControlPoint(position)
	{
		flatten(position, 7);
		createArea(
			new ClumpPlacer(diskArea(6), 0.9, 0.8, Infinity, position),
			[
				new LayeredPainter([tPadEdge, tPad], [1]),
				new TileClassPainter(clControlPoint)
			]);
		createArea(new DiskPlacer(9, position), new TileClassPainter(clControlPoint));
		g_Map.placeEntityPassable(oControlPoint, 0, position, BUILDING_ORIENTATION);
	}

	/**
	 * Mina de gelo sobre uma mancha de gelo exposto.
	 */
	function placeIceMine(position, withField)
	{
		if (!g_Map.validTilePassable(position))
			return false;
		if (withField)
			createArea(
				new ClumpPlacer(diskArea(5), 0.7, 0.4, Infinity, position),
				[new LayeredPainter([tIceEdge, tIce], [1]), new TileClassPainter(clIce)]);
		else
			createArea(new DiskPlacer(3, position), new TileClassPainter(clIce));
		g_Map.placeEntityPassable(oIce, 0, position, randomAngle());
		return true;
	}

	/**
	 * Parque solar (30 m = ~8 tiles) num terreno aplainado, com piso de
	 * colônia embaixo.
	 */
	function placeSolarPark(position, avoid)
	{
		if (!g_Map.validTilePassable(position, 7) || !avoidClasses(clSolar, 12, clIce, 4, ...avoid).allows(position))
			return false;
		flatten(position, 6);
		createArea(
			new ClumpPlacer(diskArea(5), 0.95, 0.9, Infinity, position),
			[new TerrainPainter(tPad), new TileClassPainter(clSolar)]);
		createArea(new DiskPlacer(7, position), new TileClassPainter(clSolar));
		g_Map.placeEntityPassable(oSolarPark, 0, position, BUILDING_ORIENTATION);
		return true;
	}
}

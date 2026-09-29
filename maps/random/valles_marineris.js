/**
 * Valles Marineris — o maior sistema de cânions do sistema solar.
 *
 * O relevo vem de um heightmap real (valles_marineris.png): o cânion
 * principal (Ius / Melas / Coprates) corta o mapa de oeste para leste, com
 * a depressão de Candor Chasma no planalto norte.
 *
 * - Dois planaltos: os times ficam na borda norte e na borda sul do cânion.
 * - 5 pontos de controle: três no fundo do cânion (oeste, centro, leste),
 *   um no fundo de Candor Chasma (norte) e um numa cratera de gelo no
 *   planalto sul. Cada um tem minas de gelo (Água) por perto.
 * - Rampas escavadas nas paredes dão acesso ao fundo do cânion; os parques
 *   solares (Energia) disputados ficam no topo das rampas.
 * - Paredes íngremes viram penhascos intransponíveis.
 * - Texturas marcianas do mod (regolito, gelo, pisos de colônia) misturadas
 *   com o bioma núbio (areia, dunas, terra rachada e rochas).
 */
Engine.LoadLibrary("rmgen");
Engine.LoadLibrary("rmgen-common");
Engine.LoadLibrary("rmbiome");

// Texturas.
const tRegolith = ["drift_01", "drift_02", "drift_01", "nubia_sand_01"];
const tPlateau = ["drift_01", "drift_01", "nubia_dirt_02", "nubia_sand_01"];
const tCanyonFloor = ["drift_02", "nubia_sand_ripples", "nubia_dirt_01", "drift_02"];
const tDunes = ["nubia_sand_dunes_01", "nubia_sand_ripples", "nubia_sand_01_dunes"];
const tSlope = ["nubia_rocks_dirt_01", "nubia_rocks_dirt_02", "nubia_dirt_03"];
const tCliff = ["nubia_rock_02", "nubia_rock_01"];
const tRocky = ["nubia_rocks_dirt_01", "nubia_rocks_dirt_02"];
const tPolygons = "nubia_dirt_cracks_01";
const tRamp = ["nubia_dirt_01", "drift_02"];
const tCraterRim = ["nubia_rocks_dirt_03", "nubia_rocks_dirt_02", "nubia_dirt_02"];
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

/**
 * Posições em frações da imagem do heightmap (x da esquerda para a
 * direita, y de cima para baixo), escolhidas analisando o relevo.
 */
const cpCanyon = [
	{ "x": 0.28, "y": 0.44 }, // Ius / Melas oeste
	{ "x": 0.56, "y": 0.455 }, // Melas / Coprates
	{ "x": 0.84, "y": 0.44 } // Coprates leste
];
const cpNorth = { "x": 0.7, "y": 0.125 }; // Candor Chasma
const cpSouth = { "x": 0.4, "y": 0.9 }; // cratera de gelo no planalto sul
const playerRowNorth = 0.21;
const playerRowSouth = 0.72;

export function* generateMap(mapSettings)
{
	setBiome("generic/nubia");

	// Céu empoeirado cor de caramelo, sol fraco e névoa alaranjada.
	setSkySet("desert");
	setSunColor(1.18, 0.98, 0.82);
	setSunElevation(0.58);
	setSunRotation(randomAngle());
	setAmbientColor(0.42, 0.33, 0.29);
	setFogColor(0.82, 0.58, 0.42);
	setFogFactor(0.0076);
	setFogThickness(0.45);
	setPPEffect("hdr");
	setPPSaturation(0.5);
	setPPContrast(0.10);
	setPPBloom(0.05);

	globalThis.g_Map = new RandomMap(0, tRegolith);

	const mapSize = g_Map.getSize();
	const numPlayers = getNumPlayers();
	// Mesma escala que o HeightmapPainter usa para as alturas.
	const heightScale = h => h * (mapSize + 1) / 321;

	const clPlayer = g_Map.createTileClass();
	const clBaseResource = g_Map.createTileClass();
	const clControlPoint = g_Map.createTileClass();
	const clCanyon = g_Map.createTileClass();
	const clCliff = g_Map.createTileClass();
	const clRamp = g_Map.createTileClass();
	const clCrater = g_Map.createTileClass();
	const clIce = g_Map.createTileClass();
	const clSolar = g_Map.createTileClass();
	const clRock = g_Map.createTileClass();
	const clPatch = g_Map.createTileClass();
	const clDecor = g_Map.createTileClass();

	// ------------------------------------------------ relevo
	g_Map.log("Loading the Valles Marineris heightmap");
	const heightMin = 4;
	const heightMax = 58;
	g_Map.LoadHeightmapImage("valles_marineris.png", heightMin, heightMax);
	yield 10;

	g_Map.log("Smoothing heightmap");
	createArea(new MapBoundsPlacer(), new SmoothingPainter(2, 0.5, 2));
	yield 15;

	// A direção vertical da imagem no mapa depende do motor; confere pelo
	// relevo (o planalto norte é bem mais alto que a planície sul).
	const bandHeight = fy => {
		let sum = 0;
		let count = 0;
		for (let fx = 0.05; fx < 0.95; fx += 0.05)
		{
			sum += g_Map.getHeight(new Vector2D(fractionToTiles(fx), fractionToTiles(fy)).round());
			++count;
		}
		return sum / count;
	};
	const flipped = bandHeight(0.2) < bandHeight(0.8);
	const imagePos = p => new Vector2D(fractionToTiles(p.x), fractionToTiles(flipped ? 1 - p.y : p.y)).round();
	const north = new Vector2D(0, flipped ? 1 : -1);

	const canyonTop = heightScale(heightMin + (heightMax - heightMin) * 0.3);
	const plateauLevel = heightScale(heightMin + (heightMax - heightMin) * 0.4);

	// ------------------------------------------------ pontos de controle (posições)
	const canyonCPs = cpCanyon.map(imagePos);
	const northCP = imagePos(cpNorth);
	const southCP = imagePos(cpSouth);
	const allCPs = [...canyonCPs, northCP, southCP];

	// ------------------------------------------------ rampas
	g_Map.log("Carving ramps into the canyon walls");
	const rampTops = [];
	const addRamp = (from, dir) => {
		const top = carveRamp(from, dir);
		if (top)
			rampTops.push({ "position": top, "dir": dir });
	};
	for (const cp of canyonCPs)
	{
		addRamp(cp, north);
		addRamp(cp, Vector2D.mult(north, -1));
	}
	// Candor Chasma: saídas para oeste e para leste.
	addRamp(northCP, new Vector2D(-1, 0));
	addRamp(northCP, new Vector2D(1, 0));
	yield 20;

	// ------------------------------------------------ jogadores
	g_Map.log("Choosing player positions on the canyon rims");
	const playerIDs = sortAllPlayers();
	const numNorth = Math.ceil(numPlayers / 2);
	const numSouth = numPlayers - numNorth;
	const desired = [];
	for (let i = 0; i < numNorth; ++i)
		desired.push({ "x": 0.12 + 0.76 * (i + 0.5) / numNorth, "y": playerRowNorth });
	for (let i = 0; i < numSouth; ++i)
		desired.push({ "x": 0.12 + 0.76 * (i + 0.5) / numSouth, "y": playerRowSouth });

	const playerPosition = [];
	for (const d of desired)
		playerPosition.push(findBaseSpot(imagePos(d), playerPosition));

	g_Map.log("Flattening the player bases");
	for (const position of playerPosition)
		createArea(
			new ClumpPlacer(diskArea(defaultPlayerBaseRadius() * 0.85), 0.95, 0.6, Infinity, position),
			new SmoothElevationPainter(ELEVATION_SET, g_Map.getHeight(position), 6));
	yield 30;

	g_Map.log("Creating the southern ice crater");
	const southCraterRadius = Math.max(12, fractionToTiles(0.06));
	createCrater(southCP, southCraterRadius, 4, 2.5, tIce, tCraterRim, clCrater);

	g_Map.log("Creating scattered craters on the plateaus");
	const craterCount = scaleByMapSize(4, 16);
	for (let i = 0, tries = 0; i < craterCount && tries < craterCount * 30; ++tries)
	{
		const radius = randFloat(4, scaleByMapSize(7, 12));
		const position = new Vector2D(randFloat(0, mapSize), randFloat(0, mapSize)).round();
		if (!g_Map.validTile(position, radius * 1.6 + 3) ||
			g_Map.getHeight(position) < plateauLevel * 0.9 ||
			roughness(position, radius * 1.6) > heightScale(4) ||
			playerPosition.some(p => p.distanceTo(position) < defaultPlayerBaseRadius() + radius * 1.6 + 8) ||
			allCPs.some(p => p.distanceTo(position) < radius * 1.6 + 16) ||
			!avoidClasses(clCrater, radius * 1.6 + 4, clRamp, radius * 1.6 + 4).allows(position))
			continue;
		createCrater(position, radius, randFloat(1.5, 3), randFloat(0.8, 1.8), tDunes, tCraterRim, clCrater);
		++i;
	}
	yield 35;

	// ------------------------------------------------ texturas pelo relevo
	g_Map.log("Painting the terrain by height and slope");
	for (let x = 0; x < mapSize; ++x)
		for (let z = 0; z < mapSize; ++z)
		{
			const position = new Vector2D(x, z);
			if (clCrater.has(position) || clRamp.has(position))
				continue;
			const slope = g_Map.getSlope(position);
			const height = g_Map.getHeight(position);
			if (slope > 2.6)
			{
				g_Map.setTexture(position, pickRandom(tCliff));
				clCliff.add(position);
			}
			else if (slope > 1.3)
				g_Map.setTexture(position, pickRandom(tSlope));
			else if (height < canyonTop)
				g_Map.setTexture(position, pickRandom(tCanyonFloor));
			else if (height > plateauLevel)
				g_Map.setTexture(position, pickRandom(tPlateau));

			if (height < canyonTop)
				clCanyon.add(position);
		}
	yield 40;

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

	g_Map.log("Placing a solar park near each base");
	for (const position of playerPosition)
	{
		// Longe do cânion (para trás da base); se não couber, nos lados.
		const away = Vector2D.sub(position, new Vector2D(position.x, mapSize / 2)).normalize();
		const outward = Math.atan2(away.y, away.x);
		placeSolarParkNear(
			[17, 21].flatMap(radius => [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8].map(offset =>
				Vector2D.add(position, new Vector2D(radius, 0).rotate(-(outward + offset))).round())),
			[clBaseResource, 3, clCliff, 2, clRamp, 2]);
	}
	yield 50;

	// ------------------------------------------------ pontos de controle
	g_Map.log("Placing the five control points");
	for (const cp of canyonCPs)
	{
		placeControlPoint(cp);
		// Gelo no fundo do cânion, a leste e a oeste do ponto.
		for (const side of [-1, 1])
			placeIceMine(Vector2D.add(cp, new Vector2D(side * 11, 0)).round(), true);
	}

	placeControlPoint(northCP);
	for (const side of [-1, 1])
		placeIceMine(Vector2D.add(northCP, new Vector2D(0, side * 11)).round(), true);

	placeControlPoint(southCP);
	for (let i = 0; i < 4; ++i)
		placeIceMine(Vector2D.add(southCP, new Vector2D(southCraterRadius * 0.55, 0).rotate(i * Math.PI / 2 + Math.PI / 4)).round(), false);
	yield 55;

	// ------------------------------------------------ recursos disputados
	g_Map.log("Placing contested solar parks at the top of the ramps");
	for (const top of rampTops)
	{
		// Ao lado da rampa, sobre o planalto.
		const side = new Vector2D(-top.dir.y, top.dir.x);
		const candidates = [];
		for (const forward of [4, 9, 14])
			for (const sideways of [11, -11, 15, -15, 0])
				candidates.push(Vector2D.add(top.position, Vector2D.mult(side, sideways)).add(Vector2D.mult(top.dir, forward)).round());
		placeSolarParkNear(candidates, [clControlPoint, 10, clPlayer, 8, clRamp, 2, clCliff, 2]);
	}

	g_Map.log("Placing ice fields on the canyon floor");
	createBalancedMines(
		oIce,
		oIce,
		clIce,
		[
			stayClasses(clCanyon, 3),
			avoidClasses(clPlayer, 20, clControlPoint, 14, clSolar, 6, clCliff, 3, clRamp, 3, clIce, 14)
		],
		{
			"largeCount": Math.max(3, numPlayers),
			"smallCount": 0,
			"randomSmallCount": scaleByMapSize(1, 4)
		},
		0.1);
	yield 60;

	// ------------------------------------------------ texturas extras
	g_Map.log("Creating dune fields in the canyon");
	createLayeredPatches(
		[scaleByMapSize(3, 6), scaleByMapSize(6, 12), scaleByMapSize(9, 20)],
		[tCanyonFloor, tDunes],
		[1],
		[
			stayClasses(clCanyon, 2),
			avoidClasses(clPlayer, 6, clControlPoint, 6, clCliff, 1, clRamp, 1, clSolar, 3, clIce, 4)
		],
		scaleByMapSize(6, 24),
		clPatch);

	g_Map.log("Creating polygonal patterned ground on the plateaus");
	createPatches(
		[scaleByMapSize(3, 6), scaleByMapSize(5, 11), scaleByMapSize(8, 16)],
		tPolygons,
		avoidClasses(clPlayer, 4, clControlPoint, 6, clCanyon, 4, clCliff, 2, clRamp, 1, clPatch, 2, clSolar, 3, clCrater, 1),
		scaleByMapSize(8, 30),
		clPatch);

	g_Map.log("Creating rocky patches");
	createPatches(
		[scaleByMapSize(2, 4), scaleByMapSize(3, 7), scaleByMapSize(5, 12)],
		tRocky,
		avoidClasses(clPlayer, 4, clControlPoint, 6, clCliff, 1, clRamp, 1, clPatch, 1, clSolar, 3, clIce, 3, clCrater, 1),
		scaleByMapSize(10, 36),
		clPatch);
	yield 70;

	// ------------------------------------------------ materiais
	g_Map.log("Creating materials (rock) deposits");
	createBalancedStoneMines(
		oRockSmall,
		oRockLarge,
		clRock,
		avoidClasses(clPlayer, scaleByMapSize(18, 30), clControlPoint, 10, clSolar, 6, clIce, 8, clCrater, 1, clCliff, 3, clRamp, 3));
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
		avoidClasses(clPlayer, 8, clControlPoint, 5, clSolar, 3, clIce, 2, clRock, 3, clBaseResource, 3, clRamp, 2, clDecor, 3));

	g_Map.log("Boulders fallen at the foot of the cliffs");
	createObjectGroupsDeprecated(
		new SimpleGroup([new SimpleObject(aBoulder, 1, 3, 0, 2), new SimpleObject(aStone, 1, 3, 0, 2)], true, clDecor),
		0,
		[
			borderClasses(clCliff, 0, 2),
			avoidClasses(clCliff, 0, clPlayer, 8, clControlPoint, 5, clSolar, 3, clIce, 2, clRock, 3, clRamp, 2, clDecor, 3)
		],
		scaleByMapSize(20, 80),
		30);

	g_Map.log("Ice chunks around the ice fields");
	createObjectGroupsDeprecated(
		new SimpleGroup([new SimpleObject(aIceChunk, 1, 2, 0, 2)], true, clDecor),
		0,
		[stayClasses(clIce, 1), avoidClasses(clDecor, 2, clControlPoint, 3, clSolar, 2)],
		scaleByMapSize(8, 30),
		30);
	yield 90;

	placePlayersNomad(clPlayer, avoidClasses(clControlPoint, 10, clSolar, 4, clIce, 4, clRock, 4, clCrater, 1, clCliff, 4));

	return g_Map;

	// ------------------------------------------------ auxiliares

	/**
	 * Diferença entre a maior e a menor altura num disco.
	 */
	function roughness(center, radius)
	{
		let low = Infinity;
		let high = -Infinity;
		for (let dx = -radius; dx <= radius; dx += 2)
			for (let dz = -radius; dz <= radius; dz += 2)
			{
				if (dx * dx + dz * dz > radius * radius)
					continue;
				const vertex = Vector2D.add(center, new Vector2D(dx, dz)).round();
				if (!g_Map.validHeight(vertex))
					continue;
				const height = g_Map.getHeight(vertex);
				low = Math.min(low, height);
				high = Math.max(high, height);
			}
		return high - low;
	}

	/**
	 * Procura, perto da posição desejada, o lugar mais plano do planalto
	 * que fique longe dos pontos de controle e das outras bases.
	 */
	function findBaseSpot(desiredPosition, others)
	{
		const baseRadius = defaultPlayerBaseRadius();
		const searchRadius = fractionToTiles(0.08);
		const minCPDistance = fractionToTiles(0.12);
		const minPlayerDistance = fractionToTiles(0.15);
		let best = desiredPosition;
		let bestScore = Infinity;
		for (let dx = -searchRadius; dx <= searchRadius; dx += 2)
			for (let dz = -searchRadius; dz <= searchRadius; dz += 2)
			{
				const offset = new Vector2D(dx, dz);
				if (offset.length() > searchRadius)
					continue;
				const candidate = Vector2D.add(desiredPosition, offset).round();
				if (!g_Map.validTilePassable(candidate, baseRadius) || g_Map.getHeight(candidate) < canyonTop)
					continue;
				// Penalidades em vez de proibições, para sempre achar um lugar.
				const tooClose = (positions, distance) =>
					positions.reduce((sum, p) => sum + Math.max(0, distance - p.distanceTo(candidate)), 0);
				const score = roughness(candidate, baseRadius) +
					0.08 * offset.length() +
					2 * tooClose(allCPs, minCPDistance) +
					2 * tooClose(others, minPlayerDistance) +
					(avoidClasses(clRamp, baseRadius + 4).allows(candidate) ? 0 : 50);
				if (score < bestScore)
				{
					bestScore = score;
					best = candidate;
				}
			}
		return best;
	}

	/**
	 * Escava uma rampa reta a partir de um ponto no fundo do cânion até o
	 * primeiro lugar alto o bastante na direção dada. Devolve o topo.
	 */
	function carveRamp(start, dir, width = 5)
	{
		const maxLength = Math.max(24, fractionToTiles(0.16));
		const startHeight = g_Map.getHeight(start);

		// Procura o ponto mais alto no caminho e termina a rampa logo que
		// chegar perto dessa altura (a borda do planalto).
		const path = [];
		for (let d = 0; d < maxLength; ++d)
		{
			const point = Vector2D.add(start, Vector2D.mult(dir, d)).round();
			if (!g_Map.validTilePassable(point, width))
				break;
			path.push(point);
		}
		if (path.length < 10)
			return undefined;
		const highest = Math.max(...path.map(point => g_Map.getHeight(point)));
		if (highest < startHeight + heightScale(8))
			return undefined;
		const topIndex = path.findIndex(point => g_Map.getHeight(point) >= startHeight + (highest - startHeight) * 0.9);
		const end = path[Math.min(path.length - 1, topIndex + 3)];

		const endHeight = g_Map.getHeight(end);
		const length = start.distanceTo(end);
		const blend = 3;
		const flatStart = Math.min(9, length / 3);
		const box = getBoundingBox([start, end]);
		for (let x = Math.floor(box.min.x - width - blend); x <= Math.ceil(box.max.x + width + blend); ++x)
			for (let z = Math.floor(box.min.y - width - blend); z <= Math.ceil(box.max.y + width + blend); ++z)
			{
				const vertex = new Vector2D(x, z);
				if (!g_Map.validHeight(vertex))
					continue;
				const rel = Vector2D.sub(vertex, start);
				const along = rel.dot(dir);
				if (along < 0 || along > length)
					continue;
				const across = Math.abs(rel.cross(dir));
				if (across > width + blend)
					continue;
				// Plana perto do ponto de controle, depois sobe em linha reta.
				const t = Math.max(0, along - flatStart) / (length - flatStart);
				const target = startHeight + (endHeight - startHeight) * t;
				const weight = across <= width ? 1 : 1 - (across - width) / blend;
				g_Map.setHeight(vertex, g_Map.getHeight(vertex) * (1 - weight) + target * weight);
				if (across <= width && g_Map.validTile(vertex))
				{
					clRamp.add(vertex);
					g_Map.setTexture(vertex, pickRandom(tRamp));
				}
			}
		return end;
	}

	/**
	 * Cratera de impacto: fundo rebaixado em parábola, borda elevada e
	 * arredondada. Pinta o fundo e a borda.
	 */
	function createCrater(center, radius, depth, rimHeight, floorTerrain, rimTerrain, tileClass)
	{
		const outer = radius * 1.6;
		const baseHeight = g_Map.getHeight(center);
		const minX = Math.max(0, Math.floor(center.x - outer));
		const maxX = Math.min(mapSize, Math.ceil(center.x + outer));
		const minZ = Math.max(0, Math.floor(center.y - outer));
		const maxZ = Math.min(mapSize, Math.ceil(center.y + outer));
		for (let x = minX; x <= maxX; ++x)
			for (let z = minZ; z <= maxZ; ++z)
			{
				const vertex = new Vector2D(x, z);
				const d = vertex.distanceTo(center) / radius;
				if (d > 1.6 || !g_Map.validHeight(vertex))
					continue;
				// Aplaina o terreno dentro da cratera antes de escavá-la.
				let height = g_Map.getHeight(vertex);
				if (d < 1.2)
					height = baseHeight + (height - baseHeight) * Math.max(0, (d - 0.8) / 0.4);
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
	 * Aplaina um disco na altura do centro.
	 */
	function flatten(position, radius)
	{
		createArea(
			new DiskPlacer(radius, position),
			new SmoothElevationPainter(ELEVATION_SET, g_Map.getHeight(position), 3));
	}

	function placeControlPoint(position)
	{
		flatten(position, 8);
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
		if (!g_Map.validTilePassable(position) || g_Map.getSlope(position) > 2)
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

	function placeSolarParkNear(candidates, avoid)
	{
		return candidates.some(position => placeSolarPark(position, avoid));
	}

	/**
	 * Parque solar (30 m = ~8 tiles) num terreno aplainado, com piso de
	 * colônia embaixo.
	 */
	function placeSolarPark(position, avoid)
	{
		if (!g_Map.validTilePassable(position, 7) ||
			roughness(position, 6) > heightScale(6) ||
			!avoidClasses(clSolar, 12, clIce, 4, ...avoid).allows(position))
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

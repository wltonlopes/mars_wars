/**
 * Biblioteca dos mapas do modo batalha (maps/random/battle/*.js).
 *
 * Os mapas montam o relevo somando "formas" (mesas com rampas, cristas,
 * morros, crateras) sobre um terreno ondulado. Todas as formas aleatórias
 * são colocadas aos pares, giradas 180° em volta do centro, para que os dois
 * lados tenham exatamente o mesmo terreno.
 *
 * Uso típico (ver tharsis_ridges.js):
 *   setupBattleAtmosphere();
 *   const bf = new Battlefield(...);
 *   bf.addMesa(...); bf.addRidge(...); bf.addHills(...);
 *   bf.buildTerrain();
 *   bf.finish({ players, controlPoints, solarParks, iceFields });
 */

// Texturas (as do mod para Marte, mais o bioma núbio).
export const tRegolith = ["drift_01", "drift_02", "drift_01", "nubia_sand_01"];
export const tPlateau = ["drift_01", "drift_01", "nubia_dirt_02", "nubia_sand_01"];
export const tLowland = ["drift_02", "nubia_sand_ripples", "nubia_dirt_01", "drift_02"];
export const tDunes = ["nubia_sand_dunes_01", "nubia_sand_ripples", "nubia_sand_01_dunes"];
export const tSlope = ["nubia_rocks_dirt_01", "nubia_rocks_dirt_02", "nubia_dirt_03"];
export const tCliff = ["nubia_rock_02", "nubia_rock_01"];
export const tPolygons = "nubia_dirt_cracks_01";
export const tCraterRim = ["nubia_rocks_dirt_03", "nubia_rocks_dirt_02", "nubia_dirt_02"];
export const tIce = ["glacial_01", "glacial_02", "glacial_03"];
export const tIceEdge = "glacial_01";
export const tBaseInner = "city_mars_01";
export const tBaseOuter = "city_mars_02";
export const tPad = "city_mars_01_02";
export const tPadEdge = "city_mars_01_01";

// Entidades.
export const oIce = "gaia/mars_ice_01";
export const oSolarPark = "gaia/solar_park_01";
export const oControlPoint = "structures/control_point";
export const oRockLarge = "gaia/rock/savanna_large";
export const oRockSmall = "gaia/rock/savanna_small";
export const aBoulder = "actor|geology/stone_savanna_med_red.xml";
export const aBoulderBrown = "actor|geology/stone_savanna_med_brown.xml";
export const aStone = "actor|geology/stone_desert_med.xml";
export const aIceChunk = "actor|props/special/eyecandy/iceberg.xml";

/** Céu empoeirado de Marte, com as cores contidas ajustadas na Valles Marineris. */
export function setupBattleAtmosphere()
{
	setSkySet("desert");
	setSunColor(1.18, 0.98, 0.82);
	setSunElevation(randFloat(0.5, 0.7));
	setSunRotation(randomAngle());
	setAmbientColor(0.42, 0.33, 0.29);
	setFogColor(0.82, 0.58, 0.42);
	setFogFactor(0.0076);
	setFogThickness(0.45);
	setPPEffect("hdr");
	setPPSaturation(0.5);
	setPPContrast(0.10);
	setPPBloom(0.05);
}

const clamp01 = x => Math.max(0, Math.min(1, x));
const smoothstep = (edge0, edge1, x) =>
{
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};
const angleDiff = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);

/** Ruído suave (value noise) com rede aleatória. */
function makeNoise(scale)
{
	const size = 64;
	const grid = new Float32Array(size * size).map(() => randFloat(-1, 1));
	const at = (i, j) => grid[((i % size + size) % size) * size + ((j % size + size) % size)];
	return (x, z) =>
	{
		const fx = x / scale;
		const fz = z / scale;
		const i = Math.floor(fx);
		const j = Math.floor(fz);
		const tx = fx - i;
		const tz = fz - j;
		const sx = tx * tx * (3 - 2 * tx);
		const sz = tz * tz * (3 - 2 * tz);
		const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
		const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
		return a + (b - a) * sz;
	};
}

export class Battlefield
{
	/**
	 * @param baseHeight - altura do chão.
	 * @param roughness - amplitude do ondulado do chão.
	 */
	constructor(baseHeight, roughness = 2.5)
	{
		this.baseHeight = baseHeight;
		this.roughness = roughness;
		this.size = g_Map.getSize();
		this.center = g_Map.getCenter();
		// Formas somadas (morros, crateras) e formas elevadas (mesas,
		// cristas), que se combinam pelo máximo para não se empilharem.
		this.shapes = [];
		this.raised = [];
		this.noise = makeNoise(fractionToTiles(0.09));
		this.detail = makeNoise(fractionToTiles(0.025));

		this.clPlayer = g_Map.createTileClass();
		this.clBaseResource = g_Map.createTileClass();
		this.clControlPoint = g_Map.createTileClass();
		this.clCliff = g_Map.createTileClass();
		this.clHigh = g_Map.createTileClass();
		this.clCrater = g_Map.createTileClass();
		this.clIce = g_Map.createTileClass();
		this.clSolar = g_Map.createTileClass();
		this.clRock = g_Map.createTileClass();
		this.clPatch = g_Map.createTileClass();
		this.clDecor = g_Map.createTileClass();
		this.clKeepClear = g_Map.createTileClass();

		// Lugares que devem ficar planos e livres (bases, pontos, parques).
		this.clearings = [];
		// Lugares onde não se espalham formas aleatórias.
		this.noScatter = [];
	}

	/** Posição a partir de frações do mapa. */
	at(fx, fz)
	{
		return new Vector2D(fractionToTiles(fx), fractionToTiles(fz)).round();
	}

	/** O mesmo ponto girado 180° em volta do centro. */
	mirror(position)
	{
		return Vector2D.sub(Vector2D.mult(this.center, 2), position);
	}

	// ------------------------------------------------ formas do relevo

	/**
	 * Mesa (planalto de topo plano e paredes íngremes) com rampas.
	 * @param ramps - ângulos (radianos) das rampas; cada uma é uma faixa suave.
	 */
	addMesa(center, radius, height, ramps = [], rampLength = 14, rampHalfAngle = 0.28)
	{
		this.raised.push((x, z) =>
		{
			const dx = x - center.x;
			const dz = z - center.y;
			const d = Math.sqrt(dx * dx + dz * dz);
			if (d > radius + rampLength + 2)
				return 0;
			const angle = Math.atan2(dz, dx);
			const inRamp = ramps.some(r => angleDiff(angle, r) < rampHalfAngle);
			const edge = inRamp ? rampLength : 2.5;
			return height * (1 - smoothstep(radius, radius + edge, d));
		});
	}

	/** Crista (muralha de rocha) de p0 a p1; íngreme nas laterais. */
	addRidge(p0, p1, halfWidth, height)
	{
		const seg = Vector2D.sub(p1, p0);
		const length2 = seg.lengthSquared() || 1;
		this.raised.push((x, z) =>
		{
			const t = Math.max(0, Math.min(1, ((x - p0.x) * seg.x + (z - p0.y) * seg.y) / length2));
			const px = p0.x + seg.x * t - x;
			const pz = p0.y + seg.y * t - z;
			const d = Math.sqrt(px * px + pz * pz);
			if (d > halfWidth + 4)
				return 0;
			// Topo irregular e pontas um pouco mais baixas.
			const tip = 0.75 + 0.25 * Math.sin(Math.PI * t);
			return height * tip * (0.85 + 0.15 * this.detail(x, z)) * (1 - smoothstep(halfWidth, halfWidth + 3, d));
		});
	}

	/** Morro arredondado (subida suave, passável). */
	addHill(center, radius, height)
	{
		this.shapes.push((x, z) =>
		{
			const dx = x - center.x;
			const dz = z - center.y;
			const d2 = (dx * dx + dz * dz) / (radius * radius);
			return d2 > 6 ? 0 : height * Math.exp(-d2);
		});
	}

	/** Cratera: fundo rebaixado e borda elevada. */
	addCrater(center, radius, depth, rim)
	{
		this.shapes.push((x, z) =>
		{
			const dx = x - center.x;
			const dz = z - center.y;
			const d = Math.sqrt(dx * dx + dz * dz) / radius;
			if (d > 1.7)
				return 0;
			let h = rim * Math.exp(-Math.pow((d - 1) / 0.22, 2));
			if (d < 1)
				h -= depth * (1 - d * d);
			return h;
		});
		this.craters = (this.craters || []).concat([{ "center": center, "radius": radius }]);
	}

	/**
	 * Formas aleatórias espalhadas (morros ou crateras), sempre aos pares
	 * espelhados, longe dos lugares a manter livres.
	 */
	scatter(count, minDistance, add)
	{
		for (let placed = 0, tries = 0; placed < count && tries < count * 40; ++tries)
		{
			const position = new Vector2D(randFloat(0, this.size), randFloat(0, this.size)).round();
			if (!g_Map.validTile(position, 12) ||
				this.noScatter.some(c => c.position.distanceTo(position) < c.radius + minDistance) ||
				position.distanceTo(this.mirror(position)) < minDistance * 2)
				continue;
			add(position);
			add(this.mirror(position));
			++placed;
		}
	}

	/** Marca um lugar que precisa ficar plano e livre. */
	keepClear(position, radius)
	{
		this.clearings.push({ "position": position, "radius": radius });
		this.noScatter.push({ "position": position, "radius": radius });
	}

	/** Só impede formas aleatórias aqui (sem aplainar). */
	blockScatter(position, radius)
	{
		this.noScatter.push({ "position": position, "radius": radius });
	}

	// ------------------------------------------------ geração

	heightAt(x, z)
	{
		let h = this.baseHeight + this.roughness * this.noise(x, z) + 0.6 * this.detail(x, z);
		for (const shape of this.shapes)
			h += shape(x, z);
		let raise = 0;
		for (const shape of this.raised)
			raise = Math.max(raise, shape(x, z));
		return h + raise;
	}

	/** Aplica as formas, suaviza e aplaina as clareiras. */
	buildTerrain()
	{
		for (let x = 0; x <= this.size; ++x)
			for (let z = 0; z <= this.size; ++z)
			{
				const vertex = new Vector2D(x, z);
				if (g_Map.validHeight(vertex))
					g_Map.setHeight(vertex, this.heightAt(x, z));
			}

		createArea(new MapBoundsPlacer(), new SmoothingPainter(1, 0.35, 1));

		for (const clearing of this.clearings)
			createArea(
				new ClumpPlacer(diskArea(clearing.radius), 0.95, 0.6, Infinity, clearing.position),
				new SmoothElevationPainter(ELEVATION_SET, g_Map.getHeight(clearing.position), 4));
	}

	/** Texturas por altura e inclinação; marca penhascos e platôs. */
	paintTerrain(highLevel)
	{
		for (let x = 0; x < this.size; ++x)
			for (let z = 0; z < this.size; ++z)
			{
				const position = new Vector2D(x, z);
				if (!g_Map.validTile(position))
					continue;
				const slope = g_Map.getSlope(position);
				const height = g_Map.getHeight(position);
				if (slope > 2.2)
				{
					g_Map.setTexture(position, pickRandom(tCliff));
					this.clCliff.add(position);
				}
				else if (slope > 1.0)
					g_Map.setTexture(position, pickRandom(tSlope));
				else if (height > highLevel)
					g_Map.setTexture(position, pickRandom(tPlateau));
				else
					g_Map.setTexture(position, pickRandom(tRegolith));
				if (height > highLevel)
					this.clHigh.add(position);
			}

		for (const crater of this.craters || [])
			createArea(
				new ClumpPlacer(diskArea(crater.radius * 0.7), 0.8, 0.5, Infinity, crater.center),
				[new TerrainPainter(tLowland), new TileClassPainter(this.clCrater)],
				avoidClasses(this.clCliff, 0));
	}

	// ------------------------------------------------ objetos

	placeControlPoint(position)
	{
		createArea(
			new ClumpPlacer(diskArea(6), 0.9, 0.8, Infinity, position),
			[new LayeredPainter([tPadEdge, tPad], [1]), new TileClassPainter(this.clControlPoint)]);
		createArea(new DiskPlacer(10, position), new TileClassPainter(this.clControlPoint));
		g_Map.placeEntityPassable(oControlPoint, 0, position, BUILDING_ORIENTATION);
	}

	placeSolarPark(position)
	{
		createArea(
			new ClumpPlacer(diskArea(5), 0.95, 0.9, Infinity, position),
			[new TerrainPainter(tPad), new TileClassPainter(this.clSolar)]);
		createArea(new DiskPlacer(7, position), new TileClassPainter(this.clSolar));
		g_Map.placeEntityPassable(oSolarPark, 0, position, BUILDING_ORIENTATION);
	}

	placeIceField(position, mines = 2)
	{
		createArea(
			new ClumpPlacer(diskArea(6), 0.7, 0.4, Infinity, position),
			[new LayeredPainter([tIceEdge, tIce], [1]), new TileClassPainter(this.clIce)],
			avoidClasses(this.clCliff, 1));
		for (let i = 0; i < mines; ++i)
		{
			const offset = new Vector2D(mines > 1 ? 3.5 : 0, 0).rotate(2 * Math.PI * i / mines + randFloat(0, 1));
			g_Map.placeEntityPassable(oIce, 0, Vector2D.add(position, offset).round(), randomAngle());
		}
	}

	/**
	 * Termina o mapa: bases, pontos de controle, parques solares, gelo,
	 * pedra, manchas de textura e decoração.
	 */
	*finish({ players, controlPoints, solarParks, iceFields, highLevel })
	{
		this.paintTerrain(highLevel);
		yield 60;

		const playerIDs = sortAllPlayers();
		placePlayerBases({
			"PlayerPlacement": [playerIDs, players],
			"PlayerTileClass": this.clPlayer,
			"BaseResourceClass": this.clBaseResource,
			"Walls": false,
			"CityPatch": {
				"outerTerrain": tBaseOuter,
				"innerTerrain": tBaseInner,
				"radius": defaultPlayerBaseRadius() / 2.5
			},
			"Mines": {
				"types": [{ "template": oIce }, { "template": oRockLarge }],
				"distance": 14
			}
		});
		for (const position of players)
			createArea(new DiskPlacer(defaultPlayerBaseRadius(), position), new TileClassPainter(this.clPlayer));

		g_Map.log("Placing " + controlPoints.length + " control points");
		for (const position of controlPoints)
			this.placeControlPoint(position);
		for (const position of solarParks)
			this.placeSolarPark(position);
		for (const position of iceFields)
			this.placeIceField(position);
		yield 70;

		g_Map.log("Creating material deposits");
		createBalancedStoneMines(
			oRockSmall,
			oRockLarge,
			this.clRock,
			avoidClasses(this.clPlayer, 20, this.clControlPoint, 10, this.clSolar, 6, this.clIce, 6,
				this.clCliff, 3, this.clHigh, 0));

		g_Map.log("Creating dune fields and patterned ground");
		createLayeredPatches(
			[scaleByMapSize(3, 6), scaleByMapSize(6, 12), scaleByMapSize(9, 18)],
			[tLowland, tDunes],
			[1],
			avoidClasses(this.clPlayer, 6, this.clControlPoint, 4, this.clCliff, 1, this.clHigh, 0,
				this.clSolar, 2, this.clIce, 3, this.clCrater, 1),
			scaleByMapSize(6, 22),
			this.clPatch);
		createPatches(
			[scaleByMapSize(3, 6), scaleByMapSize(5, 10)],
			tPolygons,
			avoidClasses(this.clPlayer, 4, this.clControlPoint, 4, this.clCliff, 1, this.clPatch, 2, this.clSolar, 2),
			scaleByMapSize(6, 24),
			this.clPatch);
		yield 80;

		g_Map.log("Scattering boulders");
		const avoidAll = avoidClasses(this.clPlayer, 8, this.clControlPoint, 5, this.clSolar, 3, this.clIce, 2,
			this.clRock, 3, this.clBaseResource, 3, this.clDecor, 3);
		createDecoration(
			[
				[new SimpleObject(aBoulder, 1, 2, 0, 1)],
				[new SimpleObject(aBoulderBrown, 1, 3, 0, 2)],
				[new SimpleObject(aStone, 2, 5, 0, 3)]
			],
			[scaleByMapAreaAbsolute(10), scaleByMapAreaAbsolute(8), scaleByMapAreaAbsolute(12)],
			avoidAll);
		// Pedras caídas ao pé dos penhascos.
		createObjectGroupsDeprecated(
			new SimpleGroup([new SimpleObject(aBoulder, 1, 3, 0, 2), new SimpleObject(aStone, 1, 3, 0, 2)], true, this.clDecor),
			0,
			[borderClasses(this.clCliff, 0, 2), avoidClasses(this.clCliff, 0), avoidAll],
			scaleByMapSize(25, 90),
			30);
		createObjectGroupsDeprecated(
			new SimpleGroup([new SimpleObject(aIceChunk, 1, 2, 0, 2)], true, this.clDecor),
			0,
			[stayClasses(this.clIce, 1), avoidClasses(this.clDecor, 2, this.clControlPoint, 3, this.clSolar, 2)],
			scaleByMapSize(6, 20),
			30);
		yield 90;

		placePlayersNomad(this.clPlayer, avoidClasses(this.clControlPoint, 10, this.clSolar, 4, this.clIce, 4,
			this.clRock, 4, this.clCliff, 3));
	}
}

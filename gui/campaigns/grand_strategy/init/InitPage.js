// Regiões de Marte para filtrar a província inicial.
const REGION_DEFINITIONS = [
	{ id: "world", label: "All of Mars", provinceCodes: null },
	{ id: "northern_plains", label: "Northern Plains (Vastitas)", provinceCodes: [
		"arcadia_planitia", "acidalia_planitia", "acidalia_terra", "utopia_planitia", "vastitas_borealis", "elysium_nordis"
	] },
	{ id: "tharsis", label: "Tharsis Volcanic Region", provinceCodes: [
		"olympus_mons", "tharsis_montes", "pavonis_mons", "arsia_mons", "amazonis_planitia", "daedalia_planum"
	] },
	{ id: "equatorial", label: "Equatorial Belt", provinceCodes: [
		"tempe_terra", "lunae_planum", "arabia_terra", "syrtis_major", "isidis_planitia", "elysium_planitia", "elysium_mons", "valles_marineris", "sinai_planum", "tyrrhena_terra", "hesperia_planum", "terra_cimmeria"
	] },
	{ id: "southern_highlands", label: "Southern Highlands", provinceCodes: [
		"argyre_planitia", "terra_sabaea", "noachis_terra", "hellas_planitia", "terra_sirenum", "eridania_planitia", "promethei_terra", "aonia_terra", "solis_planum", "thaumasia_planum", "terra_australis", "sirenum_planitia", "australe_terra", "argyre_terra_australis"
	] },
	{ id: "polar_caps", label: "Polar Ice Caps", provinceCodes: [
		"north_polar_ice_cap", "south_polar_ice_cap"
	] },
];

class InitPage
{
	constructor(closePageCallback)
	{
		this.closePageCallback = closePageCallback;
		this.civs = this.loadCivData();
		this.provinces = this.loadProvinces();
		this.provincesByCode = Object.fromEntries(
			this.provinces.filter(p => p.code && p.provinceType !== "sea").map(p => [p.code, p])
		);
		this.regionDefinitions = REGION_DEFINITIONS;

		// UI setup.

		Engine.GetGUIObjectByName("abortButton").caption="Back to Main Menu";
		Engine.GetGUIObjectByName("abortButton").onPress =
			() => this.closePageCallback({
				[Engine.openRequest]:
				{
					page: "page_pregame.xml"
				}
			});

		Engine.GetGUIObjectByName("campaignTitle").caption = "Grand Strategy";
		let desc = "Destined for glory? Ever since you were young, you've had the spirit of a warrior. A strong soul, and the right combination of will, luck and destiny to wield it effectively. Now your people look to you to guide them into the future, whatever may come.";
		desc += "\nWelcome to 0 A.D.'s Grand Strategy campaign, where you will take control of a country through the eyes of a Hero character. Fortify your lands, conquer your neighbors, and lead your civilization to victory.";
		Engine.GetGUIObjectByName("campaignDescription").caption = desc;

		Engine.GetGUIObjectByName("campaignImage").sprite = "stretched:campaigns/grand_strategy/art/banner.png";

	    Engine.GetGUIObjectByName("playerSettings").caption = "Customize your civilization";

		Engine.GetGUIObjectByName("civSelectLabel").caption = "Civilization:";
		this.civSelect = Engine.GetGUIObjectByName("civSelect");
		Engine.GetGUIObjectByName("heroNameLabel").caption = "Hero Name:";
		this.heroName = Engine.GetGUIObjectByName("heroName");
		Engine.GetGUIObjectByName("regionSelectLabel").caption = "Region:";
		this.regionSelect = Engine.GetGUIObjectByName("regionSelect");
		Engine.GetGUIObjectByName("provinceSelectLabel").caption = "Starting Province:";
		this.provinceSelect = Engine.GetGUIObjectByName("provinceSelect");
		Engine.GetGUIObjectByName("tribeNameLabel").caption = "Tribe Name:";
		this.tribeName = Engine.GetGUIObjectByName("tribeName");

		Engine.GetGUIObjectByName("gameSettings").caption = "Game Settings";
		Engine.GetGUIObjectByName("difficultySelectLabel").caption = "Difficulty:";
		this.difficultySelect = Engine.GetGUIObjectByName("difficultySelect");

		this.startButton = Engine.GetGUIObjectByName("startButton");
		this.startButton.caption = "Start Campaign";
		this.startButton.onPress = () => this.onStartRequest();

		this.civSelect.onSelectionChange = () => this.onCivPick();
		this.regionSelect.onSelectionChange = () => this.onRegionPick();

		this.civSelect.list = Object.values(this.civs).map(x => x.Name);
		this.civSelect.list_data = Object.values(this.civs).map(x => x.Code);
		this.regionSelect.list = this.regionDefinitions.map(x => x.label);
		this.regionSelect.list_data = this.regionDefinitions.map(x => x.id);
		this.regionSelect.selected = this.regionDefinitions.findIndex(x => x.id === "world");

		this.applyProvinceFilter();
		this.difficultySelect.list = ["Easy", "Medium", "Hard"];
		this.difficultySelect.list_data = ["easy", "medium", "hard"];
		this.difficultySelect.selected = 0;
		this.difficultySelect.onHoverChange = () => {
			this.difficultySelect.tooltip = [
				"AI players will range from Sandbox to Easy difficulty",
				"AI players will range from Easy to Hard difficulty",
				"AI players will range from Medium to Very Hard difficulty",
			]?.[this.difficultySelect.hovered] ?? "";
		};

		this.customHeroName = false;
		this.customTribeName = false;
		this.customProvince = false;
		this.heroName.onTextEdit = () => { this.customHeroName = true; };
		this.tribeName.onTextEdit = () => { this.customTribeName = true; };
		this.provinceSelect.onSelectionChange = () => { this.customProvince = true; };

		const page = Engine.GetGUIObjectByName("initPageWindow");
		const pageSize = page.getComputedSize();
		this.usePagination = (pageSize.bottom - pageSize.top) < 900;
		if (this.usePagination)
		{
			const size = Engine.GetGUIObjectByName("initSubPanel").size;
			size.rtop = 50;
			size.top = -250;
			size.rbottom = 50;
			size.bottom = 250;
			Engine.GetGUIObjectByName("initSubPanel").size = size;
			Engine.GetGUIObjectByName("page2").hidden = true;
			const p1size = Engine.GetGUIObjectByName("page1").size;
			p1size.bottom += 30;
			Engine.GetGUIObjectByName("page1").size = p1size;
			Engine.GetGUIObjectByName("page1Button").hidden = false;
			Engine.GetGUIObjectByName("page1Button").caption = "Start";
			Engine.GetGUIObjectByName("page1Button").onPress = () => {
				Engine.GetGUIObjectByName("page1").hidden = true;
				Engine.GetGUIObjectByName("page2").hidden = false;
				const p2size = Engine.GetGUIObjectByName("page2").size;
				p2size.top = 0;
				Engine.GetGUIObjectByName("page2").size = p2size;
			};
		}
		// Done at the bottom: in case of errors earlier things won't bug out every frame.
		page.onTick = () => this.render();
	}

	onCivPick()
	{
		if (this.provinceSelect.selected === -1 || !this.customProvince)
		{
			this.provinceSelect.selected =
				this.getDefaultStartingProvince(
					this.civSelect.list_data[
						this.civSelect.selected
					]
				);

			this.customProvince = false;
		}

		if (!this.heroName.caption || !this.customHeroName)
			this.heroName.caption =
				pickRandom(
					this.civs[
						this.civSelect.list_data[
							this.civSelect.selected
						]
					].AINames
				);

		if (!this.tribeName.caption || !this.customTribeName)
			this.tribeName.caption =
				this.civSelect.list[
					this.civSelect.selected
				];
	}

	getRegionDefinition(regionId)
	{
		return this.regionDefinitions.find(x => x.id === regionId) ?? this.regionDefinitions[0];
	}

	getProvincesForRegion(regionId)
	{
		const region = this.getRegionDefinition(regionId);
		if (!region)
			return [];

		if (region.id === "world" || !region.provinceCodes)
			return this.provinces.filter(p => p.provinceType !== "sea");

		return region.provinceCodes
			.map(code => this.provincesByCode[code])
			.filter(Boolean)
			.filter(p => p.provinceType !== "sea");
	}

	onRegionPick()
	{
		this.applyProvinceFilter();
	}

	applyProvinceFilter()
	{
		const regionId = this.regionSelect.list_data[this.regionSelect.selected] ?? "world";
		const filteredProvinces = this.getProvincesForRegion(regionId);
		const previousSelectedCode = this.provinceSelect.list_data[this.provinceSelect.selected] ?? null;

		this.provinceSelect.list = filteredProvinces.map(p => p.name);
		this.provinceSelect.list_data = filteredProvinces.map(p => p.code);

		if (filteredProvinces.length === 0)
		{
			this.provinceSelect.selected = -1;
			return;
		}

		const preferredCode = this.getDefaultStartingProvince(
			this.civSelect.list_data[this.civSelect.selected]
		);
		let targetIndex = filteredProvinces.findIndex(p => p.code === previousSelectedCode);
		if (targetIndex === -1)
			targetIndex = filteredProvinces.findIndex(p => p.code === preferredCode);
		if (targetIndex === -1)
			targetIndex = 0;

		this.provinceSelect.selected = targetIndex;
		this.customProvince = false;
	}

	render()
	{
		this.updateCanStart();
	}

	updateCanStart()
	{
		const feedback = Engine.GetGUIObjectByName("feedbackText");
		const ok = (() => {
			if (this.civSelect.selected === -1)
			{
				feedback.caption = "Select a civilization to play.";
				return false;
			}
			if (this.provinceSelect.selected === -1)
			{
				feedback.caption = "Select a province to start from.";
				return false;
			}
			if (this.heroName.caption === "")
			{
				feedback.caption = "Choose a name for your Hero.";
				return false;
			}
			if (this.tribeName.caption === "")
			{
				feedback.caption = "Choose a name for your Tribe.";
				return false;
			}
			return true;
		})();
		if (ok)
			feedback.caption = "";
		this.startButton.enabled = ok;
	}

onStartRequest()
{
    this.actuallyStart();
}

	actuallyStart()
	{
		// Writes g_GameData
		warn("CREATE GAME");

		GameData.createNewGame(
			{
				"civ": this.civSelect.list_data[this.civSelect.selected],
				"tribeName": this.tribeName.caption,
				"startProvince": this.provinceSelect.list_data[this.provinceSelect.selected],
			},
			this.difficultySelect.list_data[this.difficultySelect.selected]
		);

		warn("GAME CREATED");

		const run = CampaignRun.getCurrentRun();

		warn("RUN = " + run.filename);

		warn("Saving GameData");

		g_GameData.save(run);

		warn("Saved");

		warn("Serialized keys = " + Object.keys(run.data));

		this.closePageCallback({
			[Engine.openRequest]:
			{
				page: "campaigns/grand_strategy/page.xml",
				argument:
				{
					filename: run.filename
				}
			}
		});
	}

	loadCivData()
	{
		const civData = loadCivFiles(true); // Selectables only.
		translateObjectKeys(civData, ["Name", "Description", "History", "Special"]);
		return civData;
	}

	loadProvinces()
	{
		let geo =
			new GeoProvinceManager();

		return geo.data.features.map(
			f => f.properties
		);
	}

	// getDefaultStartingProvince(code)
	// {
	// 	return this.provinces.findIndex(x => x.code === {
	// 		"athen": "thessalia",
	// 		"brit": "london",
	// 		"cart": "carthage",
	// 		"gaul": "central_gaul",
	// 		"iber": "iberia",
	// 		"mace": "macedonia",
	// 		"pers": "phrygia",
	// 		"ptol": "nile_delta",
	// 		"rome": "latium",
	// 		"sele": "thrace",
	// 		"spart": "peloponnese",
	// 		}[code]);
	// 	}
	getDefaultStartingProvince(code)
	{
		return 0;
	}
	}

	var g_InitPage;

	function init(initData)
	{
		return new Promise(closePageCallback =>
		{
			g_InitPage =
				new InitPage(closePageCallback);

			g_InitPage.render();
		});
	}
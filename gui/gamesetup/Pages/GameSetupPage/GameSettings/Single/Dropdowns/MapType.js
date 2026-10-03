/**
 * Maptype design:
 * Scenario maps have fixed terrain and all settings predetermined.
 * Skirmish maps have fixed terrain, playercount but settings are free.
 * For random maps, settings are fully determined by the player and the terrain is generated based on them.
 */
GameSettingControls.MapType = class MapType extends GameSettingControlDropdown
{
	constructor(...args)
	{
		super(...args);

		// Mars Wars: só os tipos de mapa que têm algum mapa de Marte (os outros
		// mapas ficam ocultos; um tipo vazio deixaria a lista de mapas inválida).
		const mapFilters = new MapFilters(new MapCache());
		this.types = g_MapTypes.Name
			.map((name, i) => ({ "name": name, "title": g_MapTypes.Title[i], "description": g_MapTypes.Description[i] }))
			.filter(type => mapFilters.getFilteredMaps(type.name, "all", true));
		if (!this.types.length)
			this.types = g_MapTypes.Name.map((name, i) => ({ "name": name, "title": g_MapTypes.Title[i], "description": g_MapTypes.Description[i] }));

		this.dropdown.list = this.types.map(type => type.title);
		this.dropdown.list_data = this.types.map(type => type.name);

	}

	onSettingsLoaded()
	{
		if (this.gameSettingsController.guiData.lockSettings?.map)
			this.setEnabled(false);
		else
		{
			g_GameSettings.map.watch(() => this.render(), ["type"]);

			// Select a default map type if none are currently chosen.
			// This in cascade will select a default filter and a default map.
			if (!g_GameSettings.map.type || !this.types.some(type => type.name == g_GameSettings.map.type))
			{
				const defaultType = g_MapTypes.Name[g_MapTypes.Default];
				g_GameSettings.map.setType(this.types.some(type => type.name == defaultType) ? defaultType : this.types[0].name);
			}
		}

		this.render();
	}

	onHoverChange()
	{
		this.dropdown.tooltip = this.types[this.dropdown.hovered]?.description || this.Tooltip;
	}

	render()
	{
		if (!this.enabled)
		{
			if (!this.hidden)
				this.setHidden(true);
			return;
		}

		this.setSelectedValue(g_GameSettings.map.type);
	}

	getAutocompleteEntries()
	{
		return this.types.map(type => type.title);
	}

	onSelectionChange(itemIdx)
	{
		g_GameSettings.map.setType(this.types[itemIdx].name);
		this.gameSettingsController.setNetworkInitAttributes();
	}
};

GameSettingControls.MapType.prototype.TitleCaption =
	translate("Map Type");

GameSettingControls.MapType.prototype.Tooltip =
	translate("Select a map type.");

GameSettingControls.MapType.prototype.AutocompleteOrder = 0;

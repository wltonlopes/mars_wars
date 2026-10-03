class GrandStrategyPage
{
    constructor(initData, closePageCallback)
    {
        warn("INIT DATA:");
        warn(uneval(initData));
		this.closePageCallback = closePageCallback;

		try
		{
            let filename =
                initData?.filename ||
                CampaignRun.getCurrentRunFilename();

            let run = new CampaignRun(filename).load();

            warn("RUN LOADED");

            warn("run exists = " + (run !== undefined));

            warn("run.data keys = " + Object.keys(run.data).join(","));

            if ("gameData" in run.data)
                warn("gameData exists");
            else
                warn("gameData missing");

			// Save feito com outro mapa de províncias (ex.: o mapa antigo da
			// Terra): não dá para carregar. Deixa essa campanha de lado e abre
			// a criação de uma nova, em vez de travar.
			if (run.data.gameData && !GrandStrategyPage.IsCompatibleSave(run.data.gameData))
			{
				warn("Grand Strategy: the saved campaign '" + filename + "' uses an old province map and cannot be loaded. Starting a new campaign.");
				CampaignRun.clearCurrentRun();
				closePageCallback({
					[Engine.openRequest]:
					{
						page: "campaigns/grand_strategy/init/page.xml"
					}
				});
				return;
			}

			if (!run.data.gameData)
			{
                warn("ABRINDO INIT");
				closePageCallback({
					[Engine.openRequest]:
					{
						page: "campaigns/grand_strategy/init/page.xml"
					}
				});
				return;
			}

			// this.menu =
			// 	new CampaignMenu(
			// 		run,
			// 		closePageCallback
			// 	);

			// this.menu.initialise();
            warn("CampaignMenu = " + typeof CampaignMenu);

            this.menu = new CampaignMenu(
                run,
                closePageCallback
            );

            warn("Menu criado");

            this.menu.initialise();

            warn("Inicializado");
		}
		catch (err)
		{
			error("ERR = " + uneval(err));
            error("NAME = " + err.name);
            error("MSG = " + err.message);
            error("STACK = " + err.stack);
			error(err.stack);

			closePageCallback({
				[Engine.openRequest]:
				{
					page: "page_pregame.xml"
				}
			});
		}
	}
}

/**
 * O save serve se a maioria das províncias dele existe no mapa atual.
 */
GrandStrategyPage.IsCompatibleSave = function(gameData)
{
	const saved = Object.keys(gameData.provinces || {});
	if (!saved.length)
		return true;
	const geo = Engine.ReadJSONFile("campaigns/grand_strategy/data/provinces.geojson");
	const codes = new Set((geo && geo.features || []).map(feature => feature.properties.code));
	const known = saved.filter(code => codes.has(code)).length;
	return known >= saved.length * 0.8;
};

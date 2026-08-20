/**********************************************************************
 * SurvivalVictory.js
 **********************************************************************/

/**********************************************************************
 * CONSTANTES
 **********************************************************************/

const SURVIVAL_DURATION = 20 * 60 * 1000; // 20 minutos
const DEFENDER_PLAYER_ID = 1;

/**********************************************************************
 * INICIALIZAÇÃO
 **********************************************************************/

Trigger.prototype.ResetSurvivalData = function()
{
    this.defenderCivicCenter = undefined;
    this.survivalTimer = undefined;
    this.survivalMessage = undefined;
};

Trigger.prototype.InitSurvivalGame = function()
{
    this.ResetSurvivalData();

    const settings = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).GetGameSettings();
    if (settings.mapType !== "random")
    {
        warn("Survival mode is only available on random maps.");
        // Encerra a inicialização se o mapa não for do tipo "random".
        return;
    }

    // Move o CC do Defensor para o centro e o registra
    this.SetupDefender();

    if (!this.defenderCivicCenter)
    {
        warn("Survival mode could not start: Defender's Civic Center not found.");
        return;
    }

    // Desabilita a construção de novos Centros Cívicos para o defensor
    this.RestrictDefenderBuildings();

    // Inicia a contagem regressiva
    this.StartSurvivalCountdown();
};

Trigger.prototype.SetupDefender = function()
{
    const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
    const entities = cmpRangeManager.GetEntitiesByPlayer(DEFENDER_PLAYER_ID);

    for (const ent of entities)
    {
        const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
        if (cmpIdentity && cmpIdentity.HasClass("CivCentre"))
        {
            this.defenderCivicCenter = ent;
            break;
        }
    }

    if (!this.defenderCivicCenter)
        return;

    // Move o CC para o centro do mapa
    const mapSize = TriggerHelper.GetMapSizeTerrain();
    const center = { "x": mapSize / 2, "z": mapSize / 2 };
    const cmpPosition = Engine.QueryInterface(this.defenderCivicCenter, IID_Position);
    if (cmpPosition)
        cmpPosition.JumpTo(center.x, center.z);
};

Trigger.prototype.RestrictDefenderBuildings = function()
{
    const cmpTechnologyManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TechnologyManager);
    const cmpPlayer = QueryPlayerIDInterface(DEFENDER_PLAYER_ID);
    const civ = cmpPlayer.GetCiv();

    // Lista de templates de centros cívicos a serem desabilitados
    const ccTemplates = [
        `structures/${civ}/civil_centre`,
        `structures/${civ}/town_centre`,
        `structures/${civ}/city_centre`
    ];

    for (const template of ccTemplates)
        if (cmpTechnologyManager.IsTemplateAvailable(template, DEFENDER_PLAYER_ID))
            cmpTechnologyManager.SetTemplateEnabled(template, DEFENDER_PLAYER_ID, false);
};

/**********************************************************************
 * VITÓRIA E DERROTA
 **********************************************************************/

Trigger.prototype.StartSurvivalCountdown = function()
{
    const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);

    this.survivalMessage = cmpGuiInterface.AddTimeNotification({
        "message": markForTranslation("Survive for %(time)s to win!"),
        "players": [DEFENDER_PLAYER_ID],
        "translateMessage": true
    }, SURVIVAL_DURATION);

    this.survivalTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
        SYSTEM_ENTITY,
        IID_Trigger,
        "SurvivalVictory",
        SURVIVAL_DURATION,
        {}
    );
};

Trigger.prototype.OnEntityDestroyed = function(data)
{
    if (data.entity === this.defenderCivicCenter)
    {
        warn("Defender's Civic Center was destroyed. Attackers win.");

        // Cancela a contagem regressiva
        Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.survivalTimer);
        Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface).DeleteTimeNotification(this.survivalMessage);

        // Define os atacantes como vencedores
        const attackers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetActivePlayers().filter(pID => pID != DEFENDER_PLAYER_ID);
        Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).MarkPlayersAsWon(
            attackers,
            n => markForTranslation("The attackers have won (Survival)."),
            n => markForTranslation("The defender has been defeated (Survival).")
        );
    }
};

Trigger.prototype.SurvivalVictory = function()
{
    warn("Defender survived for the required duration. Defender wins.");
    Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).MarkPlayersAsWon(
        [DEFENDER_PLAYER_ID],
        n => markForTranslation("The defender has won (Survival)."),
        n => markForTranslation("The attackers have been defeated (Survival).")
    );
};

/**********************************************************************
 * REGISTRO
 **********************************************************************/

{
    const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
    cmpTrigger.ResetSurvivalData();
    cmpTrigger.DoAfterDelay(1000, "InitSurvivalGame", {}); // Delay para garantir que as entidades do mapa já existam
    cmpTrigger.RegisterTrigger("OnEntityDestroyed", "OnEntityDestroyed", { "enabled": true });
}
/**********************************************************************
 * EconomicVictory.js
 **********************************************************************/

/**********************************************************************
 * CONSTANTES
 **********************************************************************/

const ECONOMIC_VICTORY_SCORE_LEAD = 10000;
const ECONOMIC_VICTORY_DURATION = 5 * 60 * 1000; // 5 minutos
const ECONOMIC_VICTORY_CHECK_INTERVAL = 5 * 1000; // 5 segundos

/**********************************************************************
 * INICIALIZAÇÃO
 **********************************************************************/

Trigger.prototype.ResetEconomicVictoryData = function()
{
    this.economicVictoryTimer = undefined;
    this.ownEconomicVictoryMessage = undefined;
    this.othersEconomicVictoryMessage = undefined;
    this.economicVictoryCountdownPlayer = undefined;
    this.checkIntervalTimer = undefined;
};

Trigger.prototype.InitEconomicVictoryGame = function()
{
    this.ResetEconomicVictoryData();

    const settings = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).GetGameSettings();

    // Esta condição de vitória só funciona no modo Tycoon
    if (settings.GameType !== "tycoon")
    {
        warn("Economic Victory is only available in Tycoon game mode.");
        return;
    }

    this.checkIntervalTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
        SYSTEM_ENTITY,
        IID_Trigger,
        "CheckEconomicVictory",
        0,
        ECONOMIC_VICTORY_CHECK_INTERVAL,
        {}
    );
};

/**********************************************************************
 * VITÓRIA
 **********************************************************************/

Trigger.prototype.CheckEconomicVictory = function()
{
    const activePlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetActivePlayers();
    if (activePlayers.length < 2)
        return;

    const cmpTechnologyManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TechnologyManager);
    const finalPhase = "phase_city";

    let leadingPlayer = -1;

    for (const playerID of activePlayers)
    {
        const cmpPlayer = QueryPlayerIDInterface(playerID);
        if (!cmpPlayer || cmpPlayer.GetState() !== "active")
            continue;

        // Verifica se o jogador alcançou a era final
        if (!cmpTechnologyManager.IsTechnologyResearched(finalPhase, playerID))
            continue;

        const playerScore = cmpPlayer.GetStatistics().totalScore;
        let hasLead = true;

        for (const otherPlayerID of activePlayers)
        {
            if (playerID === otherPlayerID)
                continue;

            const cmpOtherPlayer = QueryPlayerIDInterface(otherPlayerID);
            if (!cmpOtherPlayer || cmpOtherPlayer.GetState() !== "active")
                continue;

            const otherScore = cmpOtherPlayer.GetStatistics().totalScore;
            if (playerScore < otherScore + ECONOMIC_VICTORY_SCORE_LEAD)
            {
                hasLead = false;
                break;
            }
        }

        if (hasLead)
        {
            leadingPlayer = playerID;
            break;
        }
    }

    if (leadingPlayer !== -1)
    {
        if (this.economicVictoryCountdownPlayer !== leadingPlayer)
            this.StartEconomicVictoryCountdown(leadingPlayer);
    }
    else
    {
        this.DeleteEconomicVictoryMessages();
    }
};

Trigger.prototype.DeleteEconomicVictoryMessages = function()
{
    if (!this.economicVictoryTimer)
        return;

    Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.economicVictoryTimer);
    this.economicVictoryTimer = undefined;

    Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.checkIntervalTimer);
    this.checkIntervalTimer = undefined;

    const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
    cmpGuiInterface.DeleteTimeNotification(this.ownEconomicVictoryMessage);
    cmpGuiInterface.DeleteTimeNotification(this.othersEconomicVictoryMessage);
    this.economicVictoryCountdownPlayer = undefined;
};

Trigger.prototype.StartEconomicVictoryCountdown = function(winningPlayer)
{
    const others = [-1];
    for (let playerID = 1; playerID < TriggerHelper.GetNumberOfPlayers(); ++playerID)
        if (playerID != winningPlayer)
            others.push(playerID);

    this.economicVictoryCountdownPlayer = winningPlayer;

    const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);

    this.othersEconomicVictoryMessage = cmpGuiInterface.AddTimeNotification({
        "message": markForTranslation("%(_player_)s has a major score lead and will win in %(time)s."),
        "players": others,
        "parameters": { "_player_": winningPlayer },
        "translateMessage": true,
        "translateParameters": []
    }, ECONOMIC_VICTORY_DURATION);

    this.ownEconomicVictoryMessage = cmpGuiInterface.AddTimeNotification({
        "message": markForTranslation("You have a major score lead and will win in %(time)s."),
        "players": [winningPlayer],
        "translateMessage": true
    }, ECONOMIC_VICTORY_DURATION);

    this.economicVictoryTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
        SYSTEM_ENTITY,
        IID_Trigger,
        "EconomicVictorySetWinner",
        ECONOMIC_VICTORY_DURATION,
        { "playerID": winningPlayer }
    );
};

Trigger.prototype.EconomicVictorySetWinner = function(data)
{
    if (this.checkIntervalTimer)
        Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.checkIntervalTimer);

    Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).MarkPlayersAsWon(
        [data.playerID],
        n => markForTranslation("%(lastPlayer)s has won (Economic Victory)."),
        n => markForTranslation("%(lastPlayer)s has been defeated (Economic Victory).")
    );
};

/**********************************************************************
 * REGISTRO
 **********************************************************************/

{
    const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
    cmpTrigger.ResetEconomicVictoryData();
    cmpTrigger.DoAfterDelay(0, "InitEconomicVictoryGame", {});
    cmpTrigger.RegisterTrigger("OnPlayerWon", "DeleteEconomicVictoryMessages", { "enabled": true });
}
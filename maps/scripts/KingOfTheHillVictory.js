/**********************************************************************
 * KingOfTheHillVictory.js
 *
 * Baseado em ControlPointVictory.js
 **********************************************************************/

/**********************************************************************
 * CONSTANTES
 **********************************************************************/

const KING_OF_THE_HILL_DURATION = 10 * 60 * 1000; // 10 minutos
const KING_OF_THE_HILL_TEMPLATE = "structures/gaul/fortress";
const KING_OF_THE_HILL_CLEAR_RADIUS = 15;

/**********************************************************************
 * INICIALIZAÇÃO
 **********************************************************************/

Trigger.prototype.ResetKingOfTheHillData = function()
{
    this.hillEntity = undefined;
    this.hillData = {};
    this.hillVictoryTimer = undefined;
    this.ownHillVictoryMessage = undefined;
    this.othersHillVictoryMessage = undefined;
    this.hillVictoryCountdownPlayer = undefined;
};

Trigger.prototype.InitKingOfTheHillGame = function()
{
    this.ResetKingOfTheHillData();

    // Em "Rei da Colina", sempre criamos uma fortaleza central.
    this.SpawnCentralFortress();

    if (this.hillEntity)
    {
        warn("King of the Hill: Central fortress spawned successfully.");
        this.CheckHillVictoryCountdown();
    }
    else
    {
        warn("King of the Hill: Failed to spawn the central fortress.");
    }
};

/**********************************************************************
 * SPAWN
 **********************************************************************/

Trigger.prototype.SpawnCentralFortress = function()
{
    const mapSize = TriggerHelper.GetMapSizeTerrain();
    const center = { "x": mapSize / 2, "z": mapSize / 2 };

    // Garante que a área está livre
    if (!this.IsPositionClear(center.x, center.z))
    {
        warn("King of the Hill: Center position is blocked. Cannot spawn fortress.");
        return;
    }

    const ent = Engine.AddEntity(KING_OF_THE_HILL_TEMPLATE);

    const cmpPosition = Engine.QueryInterface(ent, IID_Position);
    if (!cmpPosition)
    {
        Engine.DestroyEntity(ent);
        error("King of the Hill: Fortress template is missing Position component.");
        return;
    }

    // Define o dono como Gaia (jogador 0)
    const cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
    if (cmpOwnership)
        cmpOwnership.SetOwner(0);

    cmpPosition.JumpTo(center.x, center.z);
    cmpPosition.SetYRotation(randomAngle());

    // Adiciona o componente ControlPoint dinamicamente para que o sistema o reconheça
    Engine.AddDynamicComponent(ent, "ControlPoint", { "Weight": 1 });

    this.RegisterHillEntity(ent);
};

Trigger.prototype.IsPositionClear = function(x, z)
{
    const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
    const entities = cmpRangeManager.GetEntitiesByRange(x, z, KING_OF_THE_HILL_CLEAR_RADIUS, [IID_Identity], true);

    for (const ent of entities)
    {
        const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
        if (cmpIdentity && (cmpIdentity.HasClass("Structure") || cmpIdentity.HasClass("Resource")))
            return false;
    }
    return true;
};

Trigger.prototype.RegisterHillEntity = function(ent)
{
    const cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
    const owner = cmpOwnership ? cmpOwnership.GetOwner() : 0;

    this.hillEntity = ent;
    this.hillData = { "owner": owner };
};

/**********************************************************************
 * EVENTOS
 **********************************************************************/

Trigger.prototype.HillOwnershipChanged = function(data)
{
    if (!this.hillData || data.entity != this.hillEntity)
        return;

    this.hillData.owner = data.to;

    warn("King of the Hill: Player " + data.to + " captured the fortress.");

    this.CheckHillVictoryCountdown();
};

/**********************************************************************
 * VITÓRIA
 **********************************************************************/

Trigger.prototype.CheckHillVictoryCountdown = function()
{
    const owner = this.hillData.owner;

    // Se Gaia ou ninguém controla, ou se o jogador já está em contagem, não faz nada
    if (owner <= 0 || owner === this.hillVictoryCountdownPlayer)
    {
        // Se o dono mudou e não é mais um jogador, cancela a contagem
        if (owner <= 0 && this.hillVictoryCountdownPlayer)
            this.DeleteHillVictoryMessages();
        return;
    }

    this.StartHillVictoryCountdown(owner);
};

Trigger.prototype.DeleteHillVictoryMessages = function()
{
    if (!this.hillVictoryTimer)
        return;

    Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.hillVictoryTimer);
    this.hillVictoryTimer = undefined;

    const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
    cmpGuiInterface.DeleteTimeNotification(this.ownHillVictoryMessage);
    cmpGuiInterface.DeleteTimeNotification(this.othersHillVictoryMessage);
    this.hillVictoryCountdownPlayer = undefined;
};

Trigger.prototype.StartHillVictoryCountdown = function(winningPlayer)
{
    this.DeleteHillVictoryMessages();

    const others = [-1];
    for (let playerID = 1; playerID < TriggerHelper.GetNumberOfPlayers(); ++playerID)
        if (playerID != winningPlayer)
            others.push(playerID);

    this.hillVictoryCountdownPlayer = winningPlayer;

    const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);

    this.othersHillVictoryMessage = cmpGuiInterface.AddTimeNotification({
        "message": markForTranslation("%(_player_)s is controlling the hill and will win in %(time)s."),
        "players": others,
        "parameters": { "_player_": winningPlayer },
        "translateMessage": true,
        "translateParameters": []
    }, KING_OF_THE_HILL_DURATION);

    this.ownHillVictoryMessage = cmpGuiInterface.AddTimeNotification({
        "message": markForTranslation("You are controlling the hill and will win in %(time)s."),
        "players": [winningPlayer],
        "translateMessage": true
    }, KING_OF_THE_HILL_DURATION);

    this.hillVictoryTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetTimeout(
        SYSTEM_ENTITY,
        IID_Trigger,
        "HillVictorySetWinner",
        KING_OF_THE_HILL_DURATION,
        { "playerID": winningPlayer }
    );
};

Trigger.prototype.HillVictorySetWinner = function(data)
{
    Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).MarkPlayersAsWon(
        [data.playerID],
        n => markForTranslation("%(lastPlayer)s has won (King of the Hill)."),
        n => markForTranslation("%(lastPlayer)s has been defeated (King of the Hill).")
    );
};

/**********************************************************************
 * REGISTRO
 **********************************************************************/

{
    const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
    cmpTrigger.ResetKingOfTheHillData();
    cmpTrigger.DoAfterDelay(0, "InitKingOfTheHillGame", {});
    cmpTrigger.RegisterTrigger("OnOwnershipChanged", "HillOwnershipChanged", { "enabled": true });
    cmpTrigger.RegisterTrigger("OnPlayerWon", "DeleteHillVictoryMessages", { "enabled": true });
}
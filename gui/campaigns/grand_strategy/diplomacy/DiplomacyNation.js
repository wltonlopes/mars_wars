function loadNation(controller)
{
    let info = controller.info;

    Engine.GetGUIObjectByName("tribeName").caption =
        info.name;

    Engine.GetGUIObjectByName("tribeEmblem").sprite =
        "stretched:session/portraits/emblems/emblem_" +
        info.civ+".png";

    Engine.GetGUIObjectByName("tribeCulture").caption =
        "Culture: " + info.culture;

    Engine.GetGUIObjectByName("tribeCapital").caption =
        "Capital: " + info.capital;
}
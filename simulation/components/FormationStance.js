function FormationStance() {}

FormationStance.prototype.Schema = "<empty/>";

FormationStance.prototype.OnUpdate = function()
{
    let cmpFormation = Engine.QueryInterface(this.entity, IID_Formation);
    if (!cmpFormation)
        return;

    let members = cmpFormation.GetMembers();

    for (let ent of members)
    {
        let cmpPos = Engine.QueryInterface(ent, IID_Position);
        let cmpVisual = Engine.QueryInterface(ent, IID_Visual);

        if (!cmpPos || !cmpVisual)
            continue;

        let row = cmpFormation.GetMemberRow(ent);

        let stance = "stand";

        if (row === 0)
            stance = "prone";
        else if (row === 1)
            stance = "kneel";

        cmpVisual.SetVariant("stance", stance);
    }
};

Engine.RegisterComponentType(IID_FormationStance, "FormationStance", FormationStance);
function Loot() {}

Loot.prototype.Schema =
	"<a:help>Specifies the loot credited when this entity is killed.</a:help>" +
	"<a:example>" +
		"<xp>35</xp>" +
		"<metal>10</metal>" +
	"</a:example>" +
	Resources.BuildSchema("nonNegativeInteger", ["xp"]);

Loot.prototype.Serialize = null; // we have no dynamic state to save

/**
 * Mars Wars (como no Modern Wars): o espólio também rende Requisição. Além do
 * que o template dá, metade do total dos outros recursos vira Requisição
 * (a não ser que o template já diga quanto de Requisição dá).
 */
Loot.prototype.REQUISITION_SHARE = 0.5;

Loot.prototype.GetXp = function()
{
	return Math.floor(ApplyValueModificationsToEntity("Loot/xp", +(this.template.xp || 0), this.entity));
};

Loot.prototype.GetResources = function()
{
	const ret = {};
	let total = 0;
	for (const res of Resources.GetCodes())
	{
		ret[res] = Math.floor(ApplyValueModificationsToEntity("Loot/" + res, +(this.template[res] || 0), this.entity));
		if (res != "requisition")
			total += ret[res];
	}
	if (ret.requisition !== undefined && this.template.requisition === undefined)
		ret.requisition = Math.floor(total * this.REQUISITION_SHARE);
	return ret;
};

Engine.RegisterComponentType(IID_Loot, "Loot", Loot);

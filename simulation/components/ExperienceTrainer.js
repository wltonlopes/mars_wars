/**
 * Instrutor de campo (médico de combate do mla): de tempos em tempos dá
 * experiência aos batalhões do próprio jogador que estão por perto.
 *
 * A experiência dos batalhões fica no líder (BattalionLeader.AddExperience),
 * e não no componente Promotion, por isso uma aura comum não serve aqui.
 */
function ExperienceTrainer() {}

ExperienceTrainer.prototype.Schema =
	"<a:help>Periodically gives experience to the owner's battalions nearby.</a:help>" +
	"<a:example>" +
		"<Range>30</Range>" +
		"<Amount>2</Amount>" +
		"<Interval>2000</Interval>" +
	"</a:example>" +
	"<element name='Range' a:help='Metres.'><ref name='positiveDecimal'/></element>" +
	"<element name='Amount' a:help='Experience given to each battalion per interval.'><ref name='nonNegativeDecimal'/></element>" +
	"<element name='Interval' a:help='Milliseconds.'><data type='positiveInteger'/></element>";

ExperienceTrainer.prototype.Init = function()
{
	const interval = +this.template.Interval;
	this.timer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).SetInterval(
		this.entity, IID_ExperienceTrainer, "GiveExperience", interval, interval, null);
};

ExperienceTrainer.prototype.GetRange = function()
{
	return ApplyValueModificationsToEntity("ExperienceTrainer/Range", +this.template.Range, this.entity);
};

ExperienceTrainer.prototype.GetAmount = function()
{
	return ApplyValueModificationsToEntity("ExperienceTrainer/Amount", +this.template.Amount, this.entity);
};

ExperienceTrainer.prototype.GiveExperience = function()
{
	const cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	const cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (!cmpPosition || !cmpPosition.IsInWorld() || !cmpOwnership || cmpOwnership.GetOwner() <= 0)
		return;

	const amount = this.GetAmount();
	if (amount <= 0)
		return;

	// Um batalhão conta uma vez só, esteja perto o líder ou algum membro.
	const leaders = new Set();
	for (const ent of Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager).ExecuteQueryAroundPos(
		cmpPosition.GetPosition2D(), 0, this.GetRange(), [cmpOwnership.GetOwner()], IID_Identity, true))
	{
		if (Engine.QueryInterface(ent, IID_BattalionLeader))
			leaders.add(ent);

		const cmpMember = Engine.QueryInterface(ent, IID_BattalionMember);
		const leader = cmpMember ? cmpMember.GetLeader() : INVALID_ENTITY;
		if (leader != INVALID_ENTITY)
			leaders.add(leader);
	}

	for (const leader of leaders)
	{
		const cmpLeader = Engine.QueryInterface(leader, IID_BattalionLeader);
		if (cmpLeader)
			cmpLeader.AddExperience(amount);
	}
};

ExperienceTrainer.prototype.OnDestroy = function()
{
	if (this.timer)
		Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.timer);
};

Engine.RegisterComponentType(IID_ExperienceTrainer, "ExperienceTrainer", ExperienceTrainer);

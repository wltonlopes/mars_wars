{
	const battalionPromotionIncreaseXp = Promotion.prototype.IncreaseXp;

	Promotion.prototype.IncreaseXp = function(amount)
	{
		const cmpMember = Engine.QueryInterface(this.entity, IID_BattalionMember);
		if (cmpMember)
		{
			const leader = cmpMember.GetLeader();
			const cmpLeader = leader != INVALID_ENTITY &&
				Engine.QueryInterface(leader, IID_BattalionLeader);

			if (cmpLeader)
				cmpLeader.AddExperience(amount);

			return;
		}

		return battalionPromotionIncreaseXp.call(this, amount);
	};
}

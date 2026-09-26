// O UnitAI.js do mod é baseado no do 0AD 0.27, mas o Formation.js vem do
// jogo instalado (0.29), que removeu parte da API usada por ele. Sem isto,
// qualquer comando de formação dá erro ("SetRearrange is not a function").
// Aqui essa API volta, com o comportamento do 0.27, sobre o Formation.js
// atual (que tem o schema dos templates de formação do 0.29).
{
	const proto = Formation.prototype;

	if (!proto.SetRearrange)
	{
		proto.variablesToSerialize = proto.variablesToSerialize.concat(["idleEntities", "rearrange"]);

		const formationCompatInit = proto.Init;
		proto.Init = function(deserialized = false)
		{
			formationCompatInit.call(this, deserialized);
			this.idleEntities = new Set();
			// Se os membros podem ser rearranjados (o UnitAI desliga em combate).
			this.rearrange = true;
		};

		proto.SetRearrange = function(rearrange)
		{
			this.rearrange = rearrange;
		};

		proto.SetIdleEntity = function(ent)
		{
			this.idleEntities.add(ent);
		};

		proto.UnsetIdleEntity = function(ent)
		{
			this.idleEntities.delete(ent);
		};

		proto.ResetIdleEntities = function()
		{
			this.idleEntities.clear();
		};

		proto.AreAllMembersIdle = function()
		{
			return this.idleEntities.size === this.members.length;
		};

		proto.GetClosestMember = function(ent, filter)
		{
			return this.GetClosestMemberToEntity(ent, filter);
		};

		proto.MoveMembersIntoFormation = function(moveCenter, force, variant)
		{
			this.ArrangeFormation(moveCenter, force, variant);
		};

		// No 0.27, entrar ou sair um membro rearranjava a formação na hora;
		// no 0.29 quem faz isso é o UnitAI novo.
		const formationCompatRemoveMembers = proto.RemoveMembers;
		proto.RemoveMembers = function(ents, renamed = false)
		{
			if (!ents.length)
				return;
			for (const ent of ents)
				this.idleEntities.delete(ent);

			formationCompatRemoveMembers.call(this, ents, renamed);

			if (!renamed && this.rearrange && this.members.length)
				this.MoveMembersIntoFormation(true, true, this.lastOrderVariant);
		};

		const formationCompatAddMembers = proto.AddMembers;
		proto.AddMembers = function(ents, renamed = false)
		{
			formationCompatAddMembers.call(this, ents, renamed);

			if (!renamed && this.rearrange && this.members.length)
				this.MoveMembersIntoFormation(true, true, this.lastOrderVariant);
		};

		const formationCompatMerge = proto.UpdateTwinFormationsForMerge;
		proto.UpdateTwinFormationsForMerge = function()
		{
			if (this.rearrange)
				formationCompatMerge.call(this);
		};
	}
}

// Enquanto um drone kamikaze mergulha, o componente Kamikaze controla a
// posição; o voo normal de avião (que passa do alvo e fica circulando)
// não pode sobrescrevê-la.
{
	const kamikazeFlyingOnUpdate = UnitMotionFlying.prototype.OnUpdate;

	UnitMotionFlying.prototype.OnUpdate = function(msg)
	{
		const cmpKamikaze = Engine.QueryInterface(this.entity, IID_Kamikaze);
		if (cmpKamikaze && cmpKamikaze.IsDiving())
			return;

		kamikazeFlyingOnUpdate.call(this, msg);
	};
}

# Créditos de arte de terceiros

## Roach (bioarma do Enxame)

- Arquivos: `art/meshes/skeletal/roach.dae`, `art/skeletons/roacharm.xml`,
  `art/animation/quadraped/roach_*.dae`, `art/textures/skins/skeletal/roach*.png`
  e as cópias retintas em `art/textures/skins/skeletal/swarm/`.
- Autores: Danimal (http://opengameart.org/users/danimal) e Atmostatic
  (http://opengameart.org/users/atmostatic).
- Fonte: https://opengameart.org/content/roach-game-ready-and-animated
- Licença: CC-BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
- Alterações: exportado para COLLADA para o 0 A.D.; texturas extraídas do
  arquivo .blend original; a cópia do Enxame tem a textura de cor retinta.

## Modelos importados dos .zip da raiz do mod

Convertidos por `tools/imported/import_*.py` (Blender 4.3): limpeza, malha
única, textura única assada, esqueleto/animações novos para o 0 A.D. Actors em
`art/actors/vehicle/imported/`. **Os zips não trazem autor nem licença:
confirmar na página de origem antes de distribuir o mod.**

| Modelo | Zip | Autor (metadados) | Fonte / licença |
|---|---|---|---|
| Mech5 (`vehicle/mech5`) | `Mech5_final3.zip` | ? (.blend de 2011, Blender 2.49) | a confirmar |
| XV8 Crisis (`vehicle/xv8`) | `xv8-crisis.zip` | "Alex" (3ds Max) | a confirmar |
| Spider tank (`vehicle/spider_tank`) | `spider-tank.zip` | ? (glTF do Blender, rig de Source) | a confirmar |
| BiCopter (`vehicle/bicopter`) | `BiCopter.zip` | ? (Maya, 2017) | a confirmar |
| TAV-37B (`vehicle/tav37b`) | `tav-37b-space-shuttle.zip` | "arthur-----a,s" (SketchUp 7) | a confirmar |

## Estruturas da Legião de Ares (`ref/*.zip`)

Modelos OBJ gerados no Tripo, convertidos por
`tools/imported/import_structures.py`: malha reduzida com o mapa UV
original. As texturas do Tripo foram repintadas com as cores de
`structural/ares_struct.png` e juntadas no atlas `structural/ares_structures.png`
(+ _norm, _spec) por `tools/imported/structures_texture.py ares`. Malhas em
`art/meshes/structural/ares/`. **Confirmar os termos de uso do Tripo
para a conta que gerou os modelos antes de distribuir o mod.**

| Estrutura | Zip | Actor |
|---|---|---|
| Centro cívico (Cidadela) | `red+sci-fi+base+3d+model.zip` | `structures/ares/cc_citadel.xml` |
| Barracks (Salão de Guerra) | `red+sci-fi+fortress+3d+model.zip` | `structures/ares/barracks_war_hall.xml` |
| Laboratório (forge) | `red+sci-fi+base+3d+model(1).zip` | `structures/ares/lab_research.xml` |
| Garagem (stable) | `futuristic+vehicle+3d+model.zip` | `structures/ares/vehicle_garage.xml` |
| Heliponto (aero) | `battle+arena+3d+model.zip` | `structures/ares/helipad.xml` |
| Reator de energia | `sci-fi+factory+3d+model.zip` | `structures/ares/reactor.xml` |
| Fortaleza planetária | `sci-fi+fortress+3d+model(1).zip` | `structures/ares/planetary_fortress.xml` |

## Estruturas da Coalizão (`ref/coa/*.zip`)

Modelos OBJ gerados no Tripo, convertidos como os da Ares:
`tools/imported/import_structures.py -- coa` (malha reduzida, mapa UV
original) e `tools/imported/structures_texture.py coa` (texturas repintadas
com as cores de `structural/coa_struct.png`, atlas
`structural/coa_structures.png` + _norm, _spec). Malhas em
`art/meshes/structural/coa/`. **Confirmar os termos de uso do Tripo antes de
distribuir o mod.** Os modelos trazem um emblema parecido com o da ONU.

| Estrutura | Zip | Actor |
|---|---|---|
| Centro cívico (Comando) | `military+base+tower+3d+model.zip` | `structures/coa/cc_command_tower.xml` |
| Barracks (Guarnição) | `sci-fi+military+barracks+3d+model.zip` | `structures/coa/barracks_garrison.xml` |
| Laboratório (forge) | `space+laboratory+3d+model.zip` | `structures/coa/lab_space.xml` |
| Garagem (stable) | `vehicular+garage+3d+model.zip` | `structures/coa/vehicle_garage.xml` |
| Heliponto (aero) | `helicopter+landing+pad+3d+model.zip` | `structures/coa/helipad.xml` |
| Reator de energia | `energy+reactor+3d+model.zip` | `structures/coa/reactor.xml` |
| Fortaleza | `futuristic+fortress+3d+model.zip` | `structures/coa/fortress.xml` |

## Estruturas do Enxame (`ref/swarm/*.zip`)

Modelos OBJ gerados no Tripo, convertidos como os da Ares e da Coalizão:
`tools/imported/import_structures.py -- swarm` e
`tools/imported/structures_texture.py swarm` (aqui sem repintar: os modelos
já vêm na paleta do Enxame; atlas `structural/swarm_structures.png` + _norm,
_spec). Malhas em `art/meshes/structural/swarm/`. **Confirmar os termos de
uso do Tripo antes de distribuir o mod.**

| Estrutura | Zip | Actor |
|---|---|---|
| Barracks (Câmara de desova) | `purple+barracks+3d+model.zip` | `structures/swarm/spawn_barracks.xml` |
| Laboratório (forge) | `futuristic+laboratory+3d+model.zip` | `structures/swarm/gene_laboratory.xml` |
| Garagem (stable) | `futuristic+vehicle+garage+3d+model.zip` | `structures/swarm/vehicle_garage.xml` |
| Ninho de pouso (aero) | `futuristic+landing+pad+3d+model.zip` | `structures/swarm/landing_pad.xml` |
| Reator de biomassa | `energy+reactor+3d+model.zip` | `structures/swarm/reactor.xml` |
| Fortaleza | `fantasy+fortress+3d+model.zip` | `structures/swarm/fortress.xml` |

## Mecânicas vindas do Modern Wars (`../modern_wars`)

- Componentes trazidos do Modern Wars: HandGrenade, ReconDrone, AirEvasion,
  Trample, ZZ_AircraftWreck, ZZ_AIStrategistDirector e as versões novas de
  AirSupportManager, AirSupportProvider, AirDefense, Attack, Ammo e afins
  (mesclados com a tempestade de areia do Mars Wars); flares
  (`art/particles/flares_*.xml`); recurso Requisição e seus ícones.

## Exo Walker da Legião de Ares (`refs/exo/exo walker 3d model.zip`)

Modelo OBJ gerado no Tripo, convertido por `tools/imported/import_ares_exo.py`:
malha reduzida, esqueleto e animações novos, textura do Tripo repintada com as
cores de `structural/ares_struct.png`. Arquivos: `art/meshes/skeletal/ares_exo_walker.dae`,
`art/skeletons/ares_exo_walker.xml`, `art/animation/units/ares_exo_walker/`,
`art/textures/skins/skeletal/ares/exo_walker*.png`, actor `units/ares/exo_walker.xml`.
**Confirmar os termos de uso do Tripo antes de distribuir o mod.**

## Tanques, VTOL, drone e fábrica (`refs/exo/*.zip`)

Modelos OBJ gerados no Tripo, convertidos por `tools/imported/import_exo_models.py`
(malhas em `art/meshes/vehicle/exo/` e `art/meshes/structural/exo/`). As versões
de facção usam as texturas de veículos já existentes (`vehicle/mcc_veh_01.png`,
`coe_veh.png`, `mla_veh_01.png`, `ares/mla_veh_01.png`; a do Enxame,
`vehicle/swarm/mla_veh_01.png`, é a da MLA retinta como em `gen_factions.py`),
ou a textura do Tripo repintada (o VTOL usa a textura original do modelo em
todas as facções); as genéricas ficam em `art/actors/vehicle/exo/`.
**Confirmar os termos de uso do Tripo antes de distribuir o mod.**

## Bio-Dragão do Enxame (`refs/exo/purple dragon 3d model.zip`)

Modelo OBJ gerado no Tripo, convertido por `tools/imported/import_swarm_dragon.py`:
malha inteira, esqueleto de quadrúpede e animações novos, textura do Tripo.
Arquivos: `art/meshes/skeletal/swarm_bio_dragon.dae`, `art/skeletons/swarm_bio_dragon.xml`,
`art/animation/units/swarm_bio_dragon/`, `art/textures/skins/skeletal/swarm/bio_dragon*.png`,
actor `units/swarm/bio_dragon.xml`. Fogo roxo e dourado (feito para o mod): partículas
`art/particles/dragon_*.xml`, textura `art/textures/particles/dragon_flame.png` (gerada),
bola de fogo `props/units/weapons/ammo/dragon_fireball.xml` (malha e textura do tracer
pesado do mod, recoloridas) e impacto `props/units/explosions/dragon_fire_impact.xml`.
Substitui o elefante provisório do Acid Behemoth (`units/swarm/behemoth`).
**Confirmar os termos de uso do Tripo antes de distribuir o mod.**

## Stalker do Enxame (`refs/exo/purple demon 3d model.zip`)

Modelo OBJ gerado no Tripo, convertido por `tools/imported/import_swarm_stalker.py`:
malha inteira, esqueleto bípede (pernas digitígradas) e animações novos (idle, walk, run,
dois ataques corpo a corpo e death), textura do Tripo.
Arquivos: `art/meshes/skeletal/swarm_stalker.dae`, `art/skeletons/swarm_stalker.xml`,
`art/animation/units/swarm_stalker/`, `art/textures/skins/skeletal/swarm/stalker*.png`,
actor `units/swarm/stalker.xml`. Substitui o tigre provisório do Stalker (`units/swarm/stalker`).
**Confirmar os termos de uso do Tripo antes de distribuir o mod.**

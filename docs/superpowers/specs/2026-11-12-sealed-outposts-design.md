# Sealed outposts on the land map

Status: approved in chat, 12 November 2026.

## What this builds

The four planets whose settlements are sealed outposts (red, moon, volcanic and acid) still draw ten placeholder cuboids. This replaces them with large, detailed metal structures, laid out on bare ground with no streets, because an outpost's modules are joined underground.

It delivers:

1. A layout for sealed outposts with no street grid, and foundation plates that can join neighbours into clusters.
2. A set of metal parts, a hazard stripe surface, and colour slots in the landmark material.
3. Nine structure families, each a designed building with three or four presets.
4. A set of colourways for each sealed planet.

## Decisions already made

These came from the brainstorm on 12 November 2026.

- The 0.75 lot stays.
- No roads, streets, avenues or boulevards inside an outpost. Bare planet ground shows between structures.
- Each structure stands on a foundation plate, and neighbours can share one.
- Structures are metal and take colour. Each structure has shape variants (presets) and colour variants (colourways).
- Every family appears on every sealed planet. A planet's character comes from its colourways. Buildings unique to one planet may come later and are not built here.
- The references are designed buildings, not modular kits. Each family is one building design whose presets vary its proportions and features. The parts are only how a design is written.
- Fable 5.2 builds the families and does all visual tuning.

The reference images are those the user attached to the brainstorm: a grey and orange industrial block, an orange and grey stacked tower, a desert saucer tower, a desert spire, a field of Mars domes, a white snow base with orange stripes, a huge white block of stacked capsules, pods on a trestle, and a grey saucer tower.

## Layout

`layoutOutpost(town, grid, models, ground)` in `towns3d/layout.ts`, beside `layoutTown`, which is not changed. It returns the same `Placement` list plus the plates.

- Lots of 0.75 tile edge to edge across the outpost, along the town's axis. There are no street gaps and no cleared lanes for arriving roads. A road stops at the outpost's edge.
- A lot is skipped outside the edge, on water, on a river bank or on ground too steep to build on, as in `layoutTown`.
- Wanted height follows the open town rule: tall in the middle, low at the edge, lower for a small outpost than a capital. Fewer lots are built towards the edge.
- Each lot takes the preset nearest its wanted height whose lots are all free. There is no stretch, because stretching a dome or a saucer distorts it.
- A city gets one centrepiece and a capital two, from the presets marked `landmark`.
- A structure is pulled off its lot centre by a seeded jitter and given a seeded quarter turn. Round structures take any turn.
- Where two built lots are adjacent, a seeded share of them are joined by one plate across both and the gap between. Chains of joins make clusters. A structure on a shared plate stands at its lot centre with no jitter, so the plate lines up.
- An outpost with no buildable lot gets its lowest single lot preset at its centre, if the ground there allows it.
- Seeded from the town's own seed, so a map always draws the same outposts.

The jitter, the share of joins and the plate margins are starting guesses, tuned on screen.

### Foundation plates

A plate is low, chamfered metal, a little larger than the footprint or footprints it carries, and reaches down to the lowest ground under it. It replaces the slope fill sealed buildings have today. A plate carries a raised rim, light strips along its edge, hatches, hazard stripes on its rim, and now and then a ramp down to the ground. That detail is what shows of the link underground.

### Ground

A sealed outpost draws no street sheet. The fog dimming, the ring, the badge, the star and the shadow map stay as they are. The ring follows the furthest plate.

## Parts and material

### Parts

`towns3d/outpostParts.ts` holds the parts. Each is a pure function returning geometry with kinds and part tags, with no knowledge of the galaxy material, so a later parts pack for the model editor could reuse them. The set:

- hull masses with rounded or chamfered shoulders
- ribbed domes with a base ring, a crown cap or skylight and an entry vestibule
- cylinders and tanks with end caps and bands
- window bands, glass set into a hull
- gantries, trusses, ladders and railings
- vent stacks, radiator fins and pipe runs
- masts with dishes and antennas
- landing legs and splayed supports

There is no fixed triangle budget per preset. The sealed version of the harness test map must come to no more triangles than the open town version of the same map. Both figures go in the PR.

### Material

- A new kind for hazard stripes: diagonal bands in the stripe's two colours that fade to their average far off, as the panel patterns do. It goes on ramps, plate rims, pad edges and door frames.
- Painted plate (kind 11) is checked at the closest zoom insets before any coarser plate pattern is added.

### Colour slots

A preset paints each part from a slot of the colourway it is given: `hull`, `hull2`, `accent`, `trim`, `metal`, `glass` and `stripe`. Hull, second hull and accent are all painted metal, so the open towns' remap by kind after building cannot tell them apart. So a preset's build function takes the colourway, and each pair of preset and colourway is built once, when an outpost first needs it, and cached for the layer's life.

## Families

| Family | Reference | Design | Footprints | Height |
|---|---|---|---|---|
| Habitat dome | Mars domes | Ribbed dome on a drum ring, with vestibule entries, a crown skylight and boxy annexes against the drum. Presets: one dome, a dome with wings, twin domes on one plinth, a great dome ringed by annexes. | 1x1, 2x1, 2x2 | low to mid |
| Industrial deck | Grey and orange block | Low, wide hull with a sunken hatch court on top, banks of tanks along two sides, ladders, railings and hazard-striped rims. | 1x1, 2x1 | low |
| Stacked tower | Orange and grey tower | Panelled segments stacked with offset bands, braced accent panels and a roof cap with plant. Presets differ in segment count. | 1x1 | mid to tall |
| Spire | Desert spire | Tall tapering shaft with buttress fins at its foot, vertical window lines and a mast at its tip. | 2x2 | landmark |
| Saucer tower | Desert tower, grey saucer tower | Core shaft with cylinders and pods clinging to it, under a wide disc with a window band and antennas. | 1x1, 2x2 | tall, one landmark preset |
| Perched fortress | Pods on a trestle | Blocky rounded pods cantilevered from a braced trestle base, with a ramp to the plate. | 1x1, 2x1 | mid |
| Capsule stack | Huge white block | Long rounded capsule hulls stacked and offset, gantries between them, wide ramps at the foot. | 2x1, 2x2 | mid |
| Research complex | Snow base | Tall slab with accent stripes up it, a cluster of cylinders on top, and a curved gallery wing with a window band at its foot. | 2x1, 2x2 | tall |
| Utility | Detail in every image | Low and small, to thin an outpost at its edge: a tank farm, a comms mast with a dish, a landing pad, a radiator array, an airlock hut. | 1x1 | lowest |

Heights span 0.18 to 3.6, the range the cuboids cover today. Three or four presets per family, about 30 in all. That count is a choice and changes if the harness shows repeats.

## Colourways

`towns3d/outpostColourways.ts` holds a set per sealed planet, `Record<SealedPlanetId, Colourway[]>`, so a missing planet fails the build. A colourway fills every slot, has a share, and may name the families it suits. One with no families suits all.

- Colours are absolute. Painted metal is factory paint, so it is not multiplied by the planet's wall colour.
- The planet's `top` colour settles on upward faces as it does now. A dust stain in the same colour rises up the foot of each wall, through the kit's `stains`. Plates take the same dust.
- Each copy keeps the layer's small shade drift.

Starting sets, first guesses tuned on screen:

| Planet | Common | Others | Rare |
|---|---|---|---|
| Moon | white with orange | white with blue-grey, pale grey with yellow stripes | graphite with orange |
| Red | cream with terracotta, copper domes | white with orange, weathered grey with rust | bronze |
| Volcanic | gunmetal with yellow stripes | grey with orange, soot black with red | pale grey |
| Acid | pale green-grey with teal | white with yellow, gunmetal with lime | copper |

Red's copper goes only on domes and capsule stacks.

## Testing

Vitest in the node environment.

- `layoutOutpost`: every structure inside the edge, no two on one lot, the same outpost gives the same layout, a tiny outpost still gets one structure, a shared plate only joins adjacent built lots and its structures stand at their lot centres, no lane is cleared for an arriving road.
- Presets: each stands on y = 0, stays inside its footprint less the setback, and paints only known slots. The test prints each preset's triangle count.
- Colourways: every slot filled, every sealed planet has a set with shares above zero, every family on every planet has at least one colourway it may take.
- Town layer: a sealed outpost draws no street sheet, builds each pair of preset and colourway once, and keeps its tops, ring and fog.
- Material: the stripe kind compiles and draws its bands.

The look is checked on screen, not by tests.

## Verification on screen

In the `town.ts` harness in `docs/reports/town-3d/` (memory `town-3d-spike-harness`):

1. A gallery of every preset in every colourway close up, with the closest zoom insets, saved to `docs/reports/`.
2. A capital, a mid outpost and a small outpost on each sealed planet at far, mid and closest zoom.
3. One outpost hidden by fog and one selected.
4. The triangle total against the open town total on the same map.
5. Frame timing before and after on a quiet machine, run alone.

## Delivery

Three PRs, each after `bun run check` passes and a `bun tauri dev` run for the user to look.

1. Groundwork, by Opus: `layoutOutpost`, plates, no street sheet, the stripe kind, colour slots and colourway plumbing. The cuboids stay, painted through one plain colourway.
2. Families, by Fable 5.2 agents: all nine families built roughly first, then the gallery, then a stop for the user's review before any tuning. The cuboids go.
3. Tuning, by Fable 5.2: changes from the user's review.

At most three agents at once, counting nested ones. Each Fable agent has a cap on harness runs and puts one shot in front of the user early.

## Out of scope

- Buildings unique to one planet.
- A parts pack for the model editor built from these parts. The user is taking that to another agent.
- Roads between outposts.
- Drawing structures as instances, unless the frame timing calls for it.

# Nonlinear campaign map

Status: idea / not scheduled. Captured during galactic-conquest planning (2026-07-07).

## What it is

A presentation and progression upgrade to the existing campaign feature: instead of an ordered list, missions become nodes on a map (star chart, world map, or abstract flow chart) with explicit unlock edges. Branching paths, optional side missions, and multiple endings become possible without any new game systems - it is still "play authored missions, track completion".

## Why it fits coilbox

- `CampaignMission.id` is already documented in `src/campaign/model.ts` as a stable node id for a future DAG.
- Progress logic is pure and isolated (`progress.ts`, `results.ts`): the linear rule ("previous mission complete") generalises to "all/any-of prerequisite node ids complete".
- Auto win/loss detection, media slots (panorama, cutscene, voiceover) and the builder UI all carry over unchanged.

## Sketch

- Schema: bump campaign `schemaVersion`; missions gain `requires?: string[]` (mission ids) and optional `position?: {x,y}`; campaign gains an optional map backdrop/theme.
- `missionStates()` generalises from array order to edge evaluation; linear campaigns (no `requires`) keep today's behaviour exactly, via the migration point in `parseCampaignJson`.
- New `CampaignMapView` (pan/zoom) alongside the list view; the list stays as the accessible/simple fallback.
- Builder: drag nodes to position, draw prerequisite edges.

## Relationship to galactic conquest

Shares the node-map model and theming hooks built for conquest. Once conquest ships, this is mostly a schema + progress-rule change plus builder UI.

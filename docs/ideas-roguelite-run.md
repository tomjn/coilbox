# Roguelite run mode

Status: idea / not scheduled. Captured during galactic-conquest planning
(2026-07-07).

## What it is

A procedurally generated single-player run: pick a path through a generated
node graph (FTL / Slay the Spire style). Nodes are battles, events, or
upgrades; losing ends the run (or costs a life); finishing grants
meta-unlocks. Runs are short-lived state, unlike the persistent conquest
galaxy.

## Why it fits coilbox

- Reuses the skirmish launch path (`usePlay().launch`, `toBattleConfig`) and
  replay-based win/loss detection.
- Procedural generation seeds from installed content: maps from unitsync
  scan, AIs from the validais-filtered list, modoptions as difficulty/mutator
  knobs.
- Run state is a small JSON doc - same opaque-storage pattern as campaign
  progress.

## Sketch

- Generator: seeded RNG -> layered DAG (columns, forward edges), node types
  weighted (battle / elite / event / reward / boss).
- Battle nodes synthesise a `SkirmishDraft`: map pool filtered by
  size/players, AI opponents scaled by depth, handicap/modoptions as
  difficulty dials.
- Run doc: `{ seed, graph, position, lives, modifiers, unlocks }` persisted
  across restarts; meta-progress doc for cross-run unlocks.
- Defeat is a normal outcome, so the ambiguous-result fallback needs a
  "concede run" path.
- Works generically for any game with skirmish AIs; games may declare
  suitability via a small manifest.

## Relationship to galactic conquest

Shares node-map rendering, procedural generation, and the "synthesise a
skirmish from strategic state" layer. Best built after conquest proves those
pieces.

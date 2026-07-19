# Conquest living-galaxy enemy phase

Date: 2026-07-19
Status: approved (design)

## Goal

Turn the single-player conquest enemy phase from a pure player-pressure system
(one incursion at a time, aimed only at the player) into a **living galaxy**:
enemy factions expand into neutral systems and war each other, so a dominant
power and a smaller rival emerge, and the rival's fight with the giant can buy
the player time. The player can also deliberately wait to let rivals grind each
other down.

## Baseline (today)

`rules.ts` runs `enemyPhase` once after each resolved player battle
(`advanceAfterBattle`: outcome -> expiry -> enemyPhase -> fog -> status). The
enemy phase, at most **one** global incursion at a time, has the first faction
to pass an `aggression` roll open an incursion against a player frontier node;
an unanswered incursion makes that node fall automatically on
`expiresOnTurn`. Enemies never take neutrals, never fight each other, and the
map is otherwise static. Turns advance only by fighting.

## Design

All strategic logic stays in `rules.ts` as pure, seeded functions with unit
tests (mirroring `rules.test.ts`). No Rust, no galaxy-doc schema change; only
additive `ConquestState` fields plus one field type change with migration.

### 1. Turn model + Wait action

- A turn advances on any player action **or** a new "Hold position" control that
  runs one enemy round with no player battle (turn +1).
- Every turn triggers one **enemy round**: each living enemy faction, in doc
  order, takes exactly one action. One action / faction / turn keeps runs short
  and the map legible.

### 2. Faction action

For each enemy faction (skip the player, skip eliminated factions):

- Compute its **frontier**: nodes adjacent to a node it owns that it does not
  already own (neutral, a rival's, or the player's).
- Score each candidate by `winOdds(target) * value(target)`, where
  `value = 1 + node.difficulty`, capitals weighted down (× 0.35) so they fall
  late. Attacking a **rival or the player** is additionally scaled by the
  faction's `aggression` (peaceful factions still creep into neutrals but rarely
  start wars); attacking **neutral** is always fully weighted.
- Pick one target by weighted draw on the per-turn RNG (emergent, not greedy).
  If it has no frontier, it passes.

### 3. Auto-resolve

`P(attacker wins) = atkStrength / (atkStrength + defStrength)`, rolled on the
seeded per-turn RNG.

- `factionStrength(f) = sum over owned nodes of (1 + difficulty)`.
- `atkStrength = factionStrength(attacker)`.
- `defStrength = factionStrength(defender) + defenderLocalBonus`, where a neutral
  node's defender strength is `NEUTRAL_GARRISON * (1 + difficulty)` and the
  contested node's own `(1 + difficulty)` (doubled for a capital) is added as a
  local bonus so tough systems and homeworlds resist.
- Win -> ownership flips to the attacker; loss -> nothing changes.

The strength formula and the `NEUTRAL_GARRISON` / aggression / capital
constants are the balance levers, all in one place.

### 4. Player-facing pressure (symmetric)

- When a faction's chosen target is one of the **player's** systems, it does not
  auto-resolve immediately; it opens an **incursion** = advance warning with a
  grace timer (`turn + graceTurns`). The single-incursion cap is dropped, so the
  player can face several fronts at once.
- The player may **defend** the incursion by playing it in Spring before it
  expires. If unanswered by `expiresOnTurn`, it **auto-resolves by the same odds**
  on expiry (a strong system may still hold) instead of falling automatically.
- The player may leave incursions pending and race for territory, at the risk of
  losing a node when its timer runs out.

### 5. Legibility (recap)

Each enemy round records its captures as `lastRound: TurnEvent[]` on the state
(replaced each round). A small "Last turn" panel on the map lists them
("Core took Pikas", "Verdant fell to Core", "Hanan fell to Core"). Player
battles are still recorded in `history` as today.

### 6. Win / loss

Unchanged: the player wins by holding all surviving enemy capitals and loses if
their own capital falls. Rivals may eliminate each other, shrinking the player's
target list; a rival can also grow large enough to threaten the player's
homeworld through an incursion.

## Data model changes (`model.ts`, additive + one migration)

- `ConquestState.incursion?: Incursion` -> `incursions: Incursion[]`.
- New `ConquestState.lastRound?: TurnEvent[]`.
- New `interface TurnEvent { factionId: string; nodeId: string; from: string; }`
  (`from` = previous owner: a faction id or `NEUTRAL`).
- `reconcileState` migrates old saves: `incursions = state.incursions ??
  (state.incursion ? [state.incursion] : [])`, then drops any whose target is no
  longer player-owned or whose faction no longer exists (same validity rule as
  today, applied per element).

## Pure functions (`rules.ts`)

- `factionStrength(state, factionId): number`
- `winOdds(galaxy, state, attackerId, nodeId): number`
- `enemyRound(galaxy, state, rng, now): { state, events }` — replaces
  `enemyPhase`; iterates factions, one action each, resolving neutral/rival
  captures and opening player incursions.
- `applyExpiry` — now iterates `incursions`; each expired one auto-resolves via
  `winOdds` (attacker win flips the node, else the incursion clears), emitting
  `TurnEvent`s.
- `advanceAfterBattle` — outcome -> expiry(all) -> enemyRound -> fog -> status,
  setting `lastRound`.
- `advanceTurn(galaxy, state, now)` — the Wait path: turn +1 -> expiry(all) ->
  enemyRound -> fog -> status.

## UI (`pages/`)

- Header: render one amber `BracketFrame` incursion card per active incursion
  (stacked) instead of a single one.
- New "Hold position" control (a `BracketFrame` button) that calls
  `saveFor(galaxy.id, advanceTurn(galaxy, state))`.
- "Last turn" recap panel (bottom-left) listing `lastRound` events; hidden when
  empty.
- `battleMode`/defend detection switches from `state.incursion?.nodeId === id`
  to `state.incursions.some(i => i.nodeId === id)` (GalaxyPage + run.ts +
  BattleOverlay + any `attackableNodes` reference).

## Testing (`rules.test.ts`, extend)

Seeded, deterministic:

- A faction captures an adjacent neutral.
- A strong faction takes a weak rival's node; a weak faction usually fails.
- `winOdds` is deterministic for a fixed seed/turn.
- A player-node target opens an incursion (no immediate capture).
- An unanswered incursion auto-resolves on expiry (strong player holds; weak
  player falls), emitting a `TurnEvent`.
- Multiple incursions coexist.
- `advanceTurn` (Wait) advances the turn and runs one round.
- `reconcileState` migrates a singular `incursion` to `incursions` and drops
  invalid ones.

## Non-goals

- Per-faction economy / army accumulation (odds are stateless).
- Diplomacy, alliances, or player-visible AI intent beyond the recap.
- Multiplayer conquest (separate design).
- Player auto-resolving their own battles (the player still plays theirs in
  Spring; only AI-vs-AI/neutral and unanswered incursions auto-resolve).

## Open tuning levers (defaults, adjustable)

- One action / faction / turn (pacing).
- `NEUTRAL_GARRISON`, capital weight (× 0.35 pick / × 2 defence), aggression
  scaling of rival/player attacks.
- Whether `lastRound` also lists "held" (repelled) events or captures only
  (default: captures + player-node falls).

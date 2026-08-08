# Match analytics and map insight

2026-08-08. Design for the replay analytics milestone.

Coilbox already keeps a replay library, ingests every file into a local stats store, and shows a
player dossier with win rates, factions, maps and head to head. What it cannot do is tell you
anything about what happened inside a match. A replay detail page lists who played and who won.
The graph the engine drew at the end of the game, the one every player screenshots and argues
over, is not there, even though the numbers behind it are sitting in the file on disk.

This milestone reads the rest of the replay. It turns coilbox into the tool a player opens after
a game to find out why they lost, and the tool a mapper or a game author opens to find out how
their map or their game is actually being played.

## Why now, and why in coilbox

The community answer today is a website. You upload nothing, but you do go elsewhere, and the
elsewhere only knows one game. Arkounay's bar-stats reached the same conclusion from the other
direction and became a local app that reads your own replay folder, which is precisely the shape
coilbox already is. Gex is a hosted service for Beyond All Reason.

Coilbox has three advantages none of them have.

1. It already has the replay library, the stats store, the ingest watcher and the dossier. The
   analytics attach to records that exist.
2. It has unitsync. Every BAR specific hack the other tools need is a lookup for us. Unit def
   ids resolve to real unit names and real categories, map extent is a fact and not a guess from
   symmetry, faction sides come from the game's own side data.
3. It runs the engine. The one class of question a file cannot answer, where things died and
   where the fighting was, is answerable by replaying the replay with a logger attached, which is
   how knorke's demonaut answered it in 2010 and how bar-replay-analyzer answers it today.

## Vocabulary

- Trailer: the fixed size records after the demo stream. Winning ally teams, player statistics,
  team statistics. Decodable with a seek and a struct read.
- Stream: the recorded network packets between the header and the trailer. Player intent, which
  is to say orders, selections, chat, start positions.
- Series: one team's trailer samples for one metric over the match.
- Event log: what a coilbox Lua widget writes while the engine plays a replay back. Outcomes the
  file does not hold, chiefly where units died.
- Insight: an aggregate over many replays rather than one, such as a map's death heatmap or a
  matchup record.

## Where the data actually is

Verified against RecoilEngine source, not inferred.

`rts/System/LoadSave/demofile.h` gives a 352 byte header, format version 5, then the start script,
then the stream, then one byte per winning ally team, then player statistics, then team
statistics. Every size needed to seek is in the header.

`rts/Sim/Misc/TeamStatistics.h` gives 20 fields per sample, 80 bytes, taken every
`teamStatPeriod` seconds, 15 in practice, at 30 sim frames per second:

frame, metalUsed, energyUsed, metalProduced, energyProduced, metalExcess, energyExcess,
metalReceived, energyReceived, metalSent, energySent, damageDealt, damageReceived, unitsProduced,
unitsDied, unitsReceived, unitsSent, unitsCaptured, unitsOutCaptured, unitsKilled.

All are running totals, so a per minute view is a difference of consecutive samples and needs no
second series.

Player statistics are 5 int32 per player, on disk in this order: numCommands, unitCommands,
mousePixels, mouseClicks, keyPresses. That is not the order the header file declares, see the
correction below. Actions per minute is numCommands over match minutes.

The stream frames every packet as `float32 modGameTime, uint32 length, payload`, so an unknown
message is skipped exactly and a decoder never has to understand everything. The messages that
matter are KEYFRAME 1, NEWFRAME 2, PLAYERNAME 6, CHAT 7, COMMAND 11, SELECT 12, AICOMMAND 14,
GAMEOVER 30, STARTPOS 36. A build order is a COMMAND whose id is negative, where the absolute
value is the unit def id and the parameters carry x, y, z and facing.

All of the above is verified by hand decoding the seven replays in `~/.spring/demos`, not read off a
header file. Three corrections came out of that, and each would have cost a day.

The trailer order is winning ally teams first, then player statistics, then the team stat counts,
then the samples. Everything is little endian with no padding. And `PlayerStatistics` derives from
`TeamControllerStatistics`, so the base members come first and the real field order is
numCommands, unitCommands, mousePixels, mouseClicks, keyPresses, which is not the order the header
declares. Reading it as declared puts mouse pixels where the command count belongs.

Of the seven, four decode fully with plausible values, two are zero length aborted recordings, and
one has a structurally valid trailer with zero samples and uninitialised player statistics. So a
decoder must treat a zero count as an answer rather than an error, and the empty state has to be
real rather than theoretical.

This splits cleanly into three tiers, and the milestone is ordered by them.

| Tier | Source | Cost | Answers |
| --- | --- | --- | --- |
| 1 | trailer | a seek and a struct read | economy, damage, unit counts over time, winners |
| 2 | stream | one pass over a few MB | build orders, order positions, APM, chat with frames, start positions |
| 3 | re-run | engine time, minutes per replay | deaths, unit positions, fight locations |

## Decisions

- Decode natively in Rust. Not `demotool`. The trailer is fixed size records at offsets the
  header states, and the existing parser already knows those offsets. Shelling out costs an
  engine folder, a subprocess, a text format nobody specified, and a timeout, for data that is a
  seek away. This also removes the last reason winners can be unknown, which today depends on a
  binary that ships beside the engine.
- Refuse rather than guess. Header version 5, header size 352 and team stat element size 80 are
  asserted before any offset is trusted. A wrong offset in a packed struct file does not fail, it
  returns plausible numbers, which is the worst outcome available. Arkounay's decoder makes the
  same call and it is the right one.
- Series never live in the stats store. The store is a single JSON file read and written whole.
  One 40 minute 16 player match is roughly 160 samples times 16 teams times 20 fields. Putting
  that in `stats.json` multiplies the file by a factor that ends the design. Series are read from
  the replay on demand when a match is opened, and only small per match summaries are stored.
- The metric list is one registry, in Rust, published to the frontend. The dropdown, the
  sparkline grid, the roster columns and the headline tiles all build from it. Adding a metric is
  a registry entry, not a frontend edit in four files.
- Nothing is game specific. Where the other tools use a name suffix or a game's own broadcast, we
  ask unitsync. Where unitsync cannot answer, the feature degrades to unresolved ids and says so,
  rather than guessing from a naming convention that only holds in one game.
- The event logger is opt in, per replay, and never runs without the player asking. It costs an
  engine run.
- No upload, no account, no outbound call in the core feature. Optional enrichment from a game's
  own service is a distribution profile concern, not a default.

## What each source contributes

Gex, Arkounay's bar-stats, and demonaut are three different answers to the same question, and
each has something we want.

From bar-stats we take the shape of the match page. It is the best worked example of this data in
a UI that exists: a metric dropdown grouped into economy, military and units, a cumulative and per
minute toggle, a players and teams toggle where teams sums an ally side, a main line chart with a
crosshair and a value table, a grid of small multiples where every metric is a sparkline you can
click to enlarge, a clickable legend that emphasises one series everywhere at once, and a roster
grouped by ally team with per side chart toggles. We take that layout wholesale. We do not take
its BAR specific recovery hacks, because we have unitsync. We also take three of its engineering
decisions: index in two phases so the list appears before the full parse finishes, treat a zero
length replay as a match in progress rather than a corrupt file, and build synthetic replays byte
by byte in tests, because a field offset error fails silently.

From demonaut we take the spatial half, which no current tool has. Its output is a minimap with
events drawn on it: a scatter coloured per player with a symbol per unit category, a heatmap built
by accumulating soft sprites then normalising to the brightest point and running a green to red
ramp, commander movement trails, and, most valuable of all, the same picture built from many
replays of one map at once. Its "defenses from 10 FFA games on Throne" image is a map design
document that nobody has been able to produce since 2010. It also windowed its heatmaps by frame
range, so you could ask where the fighting was in the first ten minutes as opposed to the last
ten. Its unbuilt TODO list is a good backlog on its own: which start position wins most often, and
where units get produced.

From Gex we take the deep end. It is MIT, at github.com/varunda/gex, and it is the most complete
implementation of tier 3 that exists. Its parser walks the demo stream for the same messages we
plan to, and everything beyond that comes from one 909 line Lua widget running under
`spring-headless --write-dir`, which records unit creation, death with attacker and weapon,
per unit damage and resources, transports, projectiles, commander positions every 5 seconds, all
unit positions every 30 seconds, and an army, defence, utility and economy value split every 15
seconds.

Three specific things we take from it. The value split, because it is the number people argue
about and it is not in the file at any price. The speed technique, because setting max and min
speed to 9999 and skipping ahead turns a 6 minute duel into a 22 second analysis and changes what
tier 3 costs. And the unit definition set snapshot, hashed and stored once per distinct set, which
is the correct answer to a replay of a game version that is no longer installed.

We also take three of its interface ideas: named start position roles per map, an opening shown as
a map crop of each player's base rather than a list of unit icons, and a raw event log viewer.

Its BAR coupling is concentrated in about six places: match discovery through api.bar-rts.com, a
BAR widget config filename, a BAR gadget global that is the only route to attacker ids on damage
events, hardcoded faction names, BAR `customParams` keys for unit classification, and a literal
list of BAR factory names for opening detection. Everything else is plain Spring and Recoil.

The gadget global looked like the one that mattered, because without an equivalent a game gets
damage numbers with nothing to attribute them to, and no game we do not control will add one for
us. The mutator route below removes it as a constraint, because we ship the gadget ourselves.

## The match page

Replay detail gains a statistics section below what it already shows. The 3D map preview and start
box overlay stay, and gain a start position layer: a dot per player at their world coordinates in
their real colour, labelled with what they opened with. Coilbox knows map extent from unitsync, so
those coordinates are exact rather than recovered from symmetry.

Below that, the chart block described above. Above it, headline tiles for duration, result, player
count and the two totals worth surfacing without a click.

The roster table is the join between the chart and the rest of the app. It already knows about
ally teams, colours and factions. It gains per team and per side chart toggles, a rating badge
where the start script carries one, APM from player statistics, and one column per metric flagged
for the roster.

## Spatial analytics

Two views, sharing one renderer.

A per match view, over the map image, showing what the stream knows: where each player started,
where they placed buildings and in what order, where they sent orders. This is intent, and it is
worth saying so in the interface, because a cancelled build order is still an order that was given.

A per map view, over many replays, showing the same layers aggregated, plus anything the event
logger has collected. This is the demonaut picture, and it is the one that changes what a mapper
can know about their own map.

Both need a heatmap layer over the existing map preview. Both need time windowing, because "where
did the fighting happen" has a different answer at minute 5 and minute 35.

## The event logger

A coilbox Lua widget, in this repo beside the mission runtime, written into a coilbox controlled
write directory when the player asks for a replay to be analysed. The engine plays the replay back,
the widget writes one structured event file, coilbox reads it and stores it beside the replay.

Demonaut's log grammar is a reasonable starting point and its field set is close to right:
position, frame, unit name, cost, owner, and whether the unit was a commander. We write JSON lines
rather than a tagged text format, and we record unit def id rather than human name so unitsync can
resolve categories rather than the logger guessing them.

The logger does not go into the player's game. Coilbox generates a game of its own that depends on
the game the replay used, carrying the logger, and rewrites the replay's gametype to point at it.
Both halves of that already exist: `rewrite_demo` rewrites a start script and updates `scriptSize`,
because replays bind to a game by name rather than by checksum, and `buildMutatorModInfo` plus
`mutator.rs` already write a loose `.sdd` declaring `depend` on somebody else's game.

This is the decision that makes tier 3 multigame rather than per game. A game that will never adopt
anything runs our gadget regardless, a packaged `.sd7` works because we only depend on it, and,
because the gadget is synced rather than a widget, `UnitDamaged` carries the attacker and weapon
unconditionally. That last point is the difference between attributing damage and not, and it is
the one thing Gex needs BAR to ship a gadget for.

The cost is that the simulation must reproduce. A demo is a command stream, so an analysis run
replays the match rather than reading it, and anything that perturbs the simulation produces a
confident picture of a game nobody played. The replay is its own oracle here. The trailer states
the true winner, the true final frame and the true final totals, so every run ends by comparing
what it observed against what the file says, and a run that diverged is discarded rather than
stored.

## Library analytics

The dossier and stats page gain what a library of matches can answer that a single match cannot.
Opening builds and how they did. Records by map, by faction and by matchup with the time series
behind them rather than only the outcome. Where your economy diverges from the games you win. The
existing achievements engine gains the AI opponents it has been missing, which is issue #543, since
the start script's AI sections are parsed as part of this work anyway.

## Distribution and enrichment

A profile distribution can hide the whole analytics surface, the same way it hides any nav key
today. A profile narrowed to one game may point at that game's own service for enrichment, which
for Beyond All Reason means the open API at api.bar-rts.com and the public data dumps at
data-marts.beyondallreason.dev. That is one optional source behind a profile setting, not a
dependency, and nothing in the core feature calls out.

## Testing

Synthetic replays built byte by byte, following bar-stats' reasoning that offset errors produce
plausible output rather than errors. Fixtures for a truncated file, an aborted recording with a
valid header and zeroed counts, a match with an ally side that never scored, and a header that is
not version 5. The event logger gets the headless harness the mission runtime already uses.

## Out of scope

Uploading or sharing replays, any coilbox hosted service, live in game overlays, rating
calculation, cross player comparison against people whose replays you do not have, and replay
playback control beyond what the engine offers today. All are later milestones or other people's
jobs.

## Milestone shape

The work splits across two milestones, because the first phase and a half is shippable on its own
and answers most of what people currently leave the app for.

"The graph the engine already drew", milestone 18, is the first slice. Trailer decode, header
validation, winners without demotool, player statistics, the metric registry, the store sizing
decision, the live match watcher fix, synthetic fixtures, and the match statistics section with
its chart, metric dropdown, cumulative and per minute toggle, players and teams toggle and value
table. The AI section parsing sits here too, since it is start script work and unblocks #543.
Fourteen issues, all offline, no engine, no widget, no network.

"Every replay knows what happened", milestone 17, is the rest, in this order.

1. Match page finish. Highlight me and shared emphasis, small multiples, colour policy, roster
   columns and chart controls.
2. Stream decode. Packet walk, commands and build orders, start positions, selections, APM, chat
   with frames, AI sections, unit def resolution through unitsync.
3. Spatial per match. Start position layer, build placement layer, order heatmap, time window.
4. Event logger. Widget, write directory injection, analysis run, event store, verification.
5. Map insight. Aggregation across replays for one map, the demonaut picture, start position win
   rates.
6. Library analytics. Opening builds, matchup records, series backed comparisons, AI achievements.
7. Fit and finish. Profile hiding, optional enrichment, export, docs.

Forty two issues, including #410 and #543 which were already open and belong here.

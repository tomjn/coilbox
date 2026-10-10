# Where a replay's numbers come from

Coilbox shows numbers about a match from up to four places, and they do not all mean the same kind of thing. Some are the engine's own record, some are what players asked for, and some come from playing the match again. This page says which is which, what each costs to read, and why two numbers on screen can disagree.

Three of the four sources exist today. The fourth, a game's own service, is planned and not built.

The first half is for players who want to know which number to trust. The second half, from [For people extending this](#for-people-extending-this), is for developers.

## The sources at a glance

| Source | What it is | What it can tell you | Present when |
| --- | --- | --- | --- |
| The trailer | The engine's own record, written at the end of the replay file | Economy, damage and unit counts over time for each team, per player command counts, the winners | The match reached a game over and the engine wrote statistics |
| The demo stream | The network packets recorded during the match | What players asked for. Orders, selections, chat, start positions, pauses, players leaving | Always, unless the file is damaged |
| The event log | What the simulation did when coilbox played the replay back with its own recorder | Where units were made and lost | Only for a replay you chose to analyse, and only if the playback reproduced the recorded match |
| A game's own service | Data a game's own website or server keeps | Not built | Not present. See the section on a game's own service below |

Two more inputs are not sources of match results but appear beside them. The start script, which is the text setup the match was launched with, gives names, teams, sides, colours and ratings. The installed copy of the game, read through unitsync, gives unit names, costs and categories for the stream's unit numbers.

## What is in a replay file

A replay is one file, gzip compressed when it ends in `.sdfz` and raw when it ends in `.sdf`. Coilbox checks the first two bytes and does not trust the extension. The parts come in this order.

| Part | Holds |
| --- | --- |
| Header | 352 bytes at format version 5. The engine version, a game id, the start time, the match length in whole seconds, and the size of every part that follows |
| Start script | The setup as text. Map, game name, players, teams, ally teams, sides, colours, mod options, and a rating for each player when the lobby wrote one |
| Demo stream | Every network packet the game sent, each framed as a time, a length and a payload. The first byte of the payload says what kind of message it is |
| Trailer | One byte per winning ally team, then five counters per player, then a run of statistics samples per team |

A replay names its game in two places. One is the start script after the header. The other is the first packet of the stream, which holds the same script again, compressed. The engine loads the game from the packet, so a copy of a replay with only the header changed still plays the original game.

A replay binds to its game by name and version text. The header holds no checksum of the game. The first stream packet holds the game archive's checksum as the recording host saw it. When the installed archive differs, the engine warns and plays on.

## The trailer

### What it is and what coilbox reads

The engine writes the trailer when a game ends. It holds three things.

- The winning ally teams.
- Five counters per player, in this order on disk: commands given, units that received a command, mouse pixels, mouse clicks and key presses.
- A run of samples for each team. A sample is a frame number and 19 running totals, taken every few seconds. The header states the period. It was 15 seconds in all 18 non-empty replays on the development machine.

The 19 totals are metal and energy used, produced, in excess, received and sent, damage dealt and received, and seven unit counts. Four of the unit counts are decoded and shown nowhere. They are units received, given away, captured, and lost to capture.

Every total is a running total. A per minute view is worked out from consecutive samples.

### What it costs

Coilbox reads the whole file to reach the trailer, because a gzip file cannot be read from the end. The header's sizes tell it where the trailer starts, and the trailer is then a fixed layout with no search.

Nobody measured the trailer read on its own. It happens once for each new or changed replay when the library is indexed, and once each time a replay page opens. What the library keeps is a handful of end of match totals per team and never the samples, so the library file does not grow with the length of a match.

### When it is missing

- The recording has no game over. The header's team count and match length are both zero. 10 of the 18 non-empty replays on the development machine were like this.
- The match ended and the engine wrote no samples. Every team has a sample count of zero and the player counters beside it are not measurements, so coilbox withholds them. Three replays used in development named a winner and had no samples.
- The layout is one coilbox refuses. It checks that the header is version 5 and 352 bytes, and that the sample and player records are no smaller than the sizes it knows. A wrong offset in a packed file returns plausible numbers instead of an error, so coilbox refuses rather than guesses. The map and the players still decode. The winner then comes from `demotool` if one ships beside the engine. Without one there is no winner and no statistics.

A match with no result is not a match where everyone lost. The header decides whether there is a result at all, and the trailer only says what it is.

### How far to trust it

It is the engine's own count, so it is the most reliable source here. Its limits are the sampling period and the match length in the header, which is in whole seconds. The last sample places the end of the match to within one period, and the header's seconds are the frame divided by 30, so the exact final frame is not in the file.

The player counters are the engine's. It adds one to a player's command count each time its selected units handler is given a command flagged as coming from the user, and it adds the size of the selection to the unit command count. Coilbox did not check whether orders sent by a widget are included.

## The demo stream

### What it is and what coilbox reads

The stream is intent, not outcome. It records what each player asked for. A build order that was later cancelled is in it. A building that finished is not.

Coilbox walks the packets and decodes these messages. Any other message is skipped by its declared length.

| Message | Decoded as |
| --- | --- |
| Chat and system message | Chat lines, each with its frame and who it was for |
| Player name, new player | Names for players who joined mid game |
| Command, tracked and untracked unit command, unit commands | Orders, each marked as coming from a selection, a Lua widget or a skirmish AI |
| Select | Which units a player had selected, used to count builders on a selection order |
| Game over | A game over event with the winning ally teams |
| Start position | Where each team started |
| Pause, player left, team action | Pauses, resignations, departures, give aways and team deaths |

Frames come from the stream's own key frame and new frame messages. An event before the match starts has frame -1, which is the engine's own value.

From these, the interface builds:

- the chat log and the chat timeline
- the timeline's typed marks, which are pauses, resignations, players leaving, give aways, eliminated teams and late joiners
- each player's build orders, the folded opening, the cost of what was ordered, and the split of that cost by kind of unit
- each team's start position, drawn as a dot on the replay's map
- where buildings were ordered, drawn on the replay's map as a mark for each order and as a density

### What it costs

One pass over the decompressed stream. These timings were measured on one Mac, mostly in a debug build, on the largest replay on that machine (3,083,826 bytes). A reader's machine will differ.

| Read | Debug | Release |
| --- | --- | --- |
| Replay info including start positions, median of 7 runs | 60.7 ms | 15.2 ms |
| A full read followed by a walk that stops at the first frame | 113 ms | 28 ms |
| The chat and event walk when a replay page opens | about 125 ms | not measured |

Start positions only need the pregame, so that read stops at the first frame and decompresses only as much of the file as it needs.

The replay page reads chat and events once, when the page opens. It reads build orders only when you press "Show build orders". Naming units needs the installed game's unit list from unitsync. That cost was not measured for this page.

### When it is missing or partial

- Coilbox refuses to read a stream when the header is not version 5 or not 352 bytes. The map and players still decode.
- A stream that breaks part way stops the walk and keeps what it had. The page says the replay could not be read to the end.
- A packet that does not fit its layout is counted and skipped.
- Some layouts are from the engine source and have never been seen in a real replay on the development machine. These are the pause message, the tracked AI command, an AI command sent by a real skirmish AI, the team action for giving everything away, and a build wrapped in an insert command that carries a command tag and not a queue position.

### How far to trust it

It says what was asked for. A builder drops a build it cannot reach, and a second order on the same spot cancels the first. None of that is in the stream. The build order list says so, and so do the opening and its cost.

Rules coilbox applies to build orders, each checked against the engine source.

- A command with a negative id is a build order. The unit definition id is the absolute value.
- Three or more parameters are a position. A fourth alone is a facing. Fewer than three is a factory queue order, which carries a count of 1, 5, 20 or 100 from the shift and control keys.
- A build wrapped in an insert command counts. In one local replay with 13 players that was 95 of 3,605 build orders, which is 2.6%.
- A factory queue order with the right mouse key takes units off a queue. It is counted and left out of the list.
- A widget that sends one building to several builders sends one packet per builder in the same frame. That is one order, with the builders counted.

Unit numbers in the stream are definition ids. The engine numbers a game's definitions from 1 in sorted key order, and unitsync reads the same table sorted the same way, so id n is entry n minus 1 of the unit list. On the seven replays checked against the installed Splinter Faction checkout, all 110 orders were consistent with that offset. With no offset, 10 were inconsistent and 7 were out of range.

Which game's list names the ids is decided by name and version.

- The replay's game is installed. Names show, and the section says they were matched by name and version.
- Another version of the same game is installed. Names show with a warning that they come from a different build and may be wrong. One unit added or removed moves every id after it.
- No version is installed. Each order shows its id and the section says why.

Unitsync reads a game's definitions with default mod options. The engine ran them with the match's. A game whose mod options add or remove units would number them differently. No such game was available to check.

## The event log

### What it is and what coilbox reads

A replay holds orders and totals. It does not hold where a unit died, because that is a result of the simulation, and the simulation is reproduced and not recorded. So coilbox plays the match again, headless, with something watching.

For each run coilbox does the following.

1. Refuses a replay with no recorded outcome to check against.
2. Writes a game of its own into a scratch folder. It is named "Coilbox replay analysis 1", depends on the game the replay was recorded on, and carries one gadget and nothing else.
3. Writes a scratch copy of the replay with the game name changed in both places, the header and the first stream packet.
4. Runs the engine headless on the copy, asking the server to play fast.
5. Reads the file the gadget wrote.
6. Compares what the run saw with the replay's trailer, and keeps the events only if they agree.
7. Deletes the scratch folder, whatever happened.

The replay itself is never written. The gadget records a header line, a game start line, a line for each unit created, finished and destroyed with its position and, for a loss, the attacker and weapon, and a game over line with every team's final totals.

A run starts only when you press the button on the replay page, and a distribution can hide the button with `analytics.run`. Runs go through a queue the app owns, so leaving the page changes nothing. A game you start always wins. A running analysis is stopped and put back at the front of the queue.

### What it costs

An engine run. These were measured on one Mac with engine 2026.07.01.

| Match | Game length | Time at the server's own speed | Time under the analysis game |
| --- | --- | --- | --- |
| Splinter Faction | 769 s | 803 s | 28.5 s |
| Metal Factions, two of its own AIs | 232 s | 259 s | 19.4 s |

Pointing the Metal Factions run at the real content folder took 24.4 s, so scanning every archive cold cost about 5 s.

The run's time limit is the match length plus 300 seconds for the engine to start. The 300 is an allowance and was not measured. The only start up figures taken were 9 to 11 seconds to load and 23.4 seconds for a cold archive scan, on one Mac.

A stored analysis is small. The 769 second Splinter Faction match stored 136 lines in 2,527 bytes, from 15,659 bytes of JSON.

### When it is missing

- Nobody analysed the replay. This is the usual case.
- The replay recorded no game over, so there is nothing to check a run against, and coilbox refuses it. This rules out 10 of the 18 non-empty replays on the development machine.
- A remix has no analysis of its own. It keeps its original's game id and trailer.
- The engine the replay was recorded on, its game or its map are not installed.
- The run crashed, ran out of time or was cancelled. That is kept in the queue for the session and not stored.
- The run finished and did not reproduce the match. Coilbox remembers that, with the figures that disagreed, and stores no events.
- The analysis is outdated. An earlier coilbox recorded less. The section offers "Analyse again".

### How far to trust it

The events are stored only when the run reproduced the recorded match. Reproducing means all of these agree exactly, with no tolerance.

- The winners, and the match length to the second.
- Every team's sample count and 19 totals.
- A created line for every unit the trailer says a team produced, and a destroyed line for every unit it says a team lost.
- No desync warnings from the engine, which compares its simulation with the checksums the replay carries. That checksum covers where objects are and which way they face, their waypoints and the random number generator. It does not cover health or resources.

Two matches from two games reproduced exactly. The check was tried by changing the Splinter Faction match once at frame 3000 in three ways.

- Giving a team 500 metal was caught by the totals.
- Drawing one random number was caught by 270 desync warnings, a game one second longer and 12 different totals.
- Taking 50 health off a unit was not caught. The unit regenerated it, and the log was identical to a clean run's, byte for byte.

So the check answers for what coilbox records. It does not answer for every value the simulation holds.

What was not verified when the run was built: unit definition ids were not asserted against the base game directly, positions were checked against a stub and not known positions in a real engine, and nothing ran on Linux, Windows or Beyond All Reason.

## A game's own service

A distribution narrowed to one game may in future point at that game's own service for more data. That would be somebody else's data and could disagree with coilbox's. It is not built. Issue [#1171](https://github.com/tomjn/coilbox/issues/1171) tracks it. This page documents no interface for it. When it exists, a figure from a service is meant to be marked as coming from one.

## What the interface shows

This table lists each part of the interface, the source it shows, and what makes it wrong or missing.

### On a replay page

| Part | Source | Wrong or missing when |
| --- | --- | --- |
| Details block (game, engine, played, duration, file size) | Header and start script | The header holds a zero length for a match with no game over |
| Details block, result | Trailer winners | No game over, so no result |
| Players table, names, sides, colours | Start script | A seat the script does not describe |
| Players table, result | Trailer winners | No game over, so no result. Not the same as a loss |
| Players table, rating | Start script. The first number in the player's `skill` text, with `skilluncertainty` in the tooltip as written | The lobby wrote no rating. Coilbox computes nothing from the uncertainty |
| Players table, APM | Trailer player counters, commands over match minutes using the header's length | No trailer samples, or a header length of zero |
| Players table, metric columns and sorting | Trailer, the last sample for each team. One row per team, not per seat | No samples. Players sharing a team show one total |
| Headline tiles | Duration from the header, result from the trailer, players from the start script, two totals from the trailer summed across teams | As the rows above |
| Match chart, value table, CSV export | Trailer samples | No samples. The engine sampled every 15 seconds on the replays checked, so nothing finer exists |
| Build orders | Stream | An order that was cancelled or refused is listed. A damaged stream may be missing later orders |
| Folded opening and cost of what was ordered | Stream, priced through unitsync against an installed game | Game not installed, or another build installed. Orders are not purchases |
| Cost by kind of unit | The same, with each unit classified by coilbox from its definition | Units the classifier cannot place are shown as unclassified |
| Map time window | Stream, for when each order was given, and the match's length from the header, stretched if an order falls after it. A range under the map limits the building layers to orders given inside it. The first and last five minutes are presets. When the match has statistics, the chart's lead metric per minute across all teams is drawn behind the range | It filters by when an order was given, not when anything was built. Orders given before the game belong to a window that starts at 0:00. Start boxes and start positions are not filtered. A replay with no statistics has a plain track |
| Map layer, start positions | Stream. A dot for each team where its start was set before the game, in the colour of that player's line on the match chart | A team that never readied has no dot. The engine can move a start into its start box, so the commander may have appeared a short way off |
| Map layer, buildings ordered | Stream. A mark for each order to place a building, in its player's colour. The shape is the kind of building, classified by coilbox through unitsync against an installed game | An order that was cancelled or refused is a mark like any other. Factory queue orders have no position and are not drawn. With the game not installed every mark is one shape. With another build installed a shape may be wrong |
| Map layer, building density | Stream. The same orders added up into a heatmap, drawn on the minimap and on the 3D preview. Colours are relative to the busiest spot on that map, and the legend states how many orders that spot holds | It shows where buildings were ordered, not where every order was given. Move, attack and other orders are not in it yet |
| Chat log and chat timeline | Stream | A damaged stream, with a note |
| Timeline typed marks | Stream | The pause layout has not been checked against a real replay |
| Analysis section and recorded events | Event log | Not analysed, or the playback did not reproduce the match |
| Map preview and the start boxes layer | The installed map, with start boxes from the start script | No engine or map is installed. A match with fixed or random starts has no boxes |

### Across the library

| Part | Source | Wrong or missing when |
| --- | --- | --- |
| Replays page figure cells and sorts | The library store's copy of trailer totals. Seven metrics, rounded to whole numbers | The replay has no samples, or with "My figures" the player was not in the match or the record has no team id. It has no figure and sorts last in both directions |
| Dossier rates, ratio and trend | The same store | Games with no totals, no team id or no usable length are left out and counted on the page |
| Matchup view | The store, using start script teams and sides, trailer winners and header length | A game where you were not on opposing teams is not counted |
| Stats page and achievements | The store, using start script players, sides and AIs, and trailer winners | A remix or refight rerun is left out. A game with no result is not a win |

The store is one JSON file written whole, and it never holds a series.

## Why two numbers may not match

These are the reasons the code and the pull requests established.

- Orders are not buildings. A cost of what was ordered is not what was spent, because cancelled orders count and queue removals are not subtracted. The trailer's "metal used" is the engine's own count.
- A unit's name and cost come from the installed build of the game, matched by name. A different installed build can name the wrong unit. 518 million metal once appeared under Defence on a Splinter Faction 0.1.77 replay, because that game's definitions give its lootboxes, drop pods and scanner probe a cost of 518,181,504 and the replay's ids landed on them in the installed build. The page showed its "different build" warning.
- A figure for a player in the library is their own army's. The store keys totals by engine team, which is the army one player controls. The replay page uses "Team 1" and "Team 2" for a side. Allies on one side each have their own army and their own figure.
- A library row for a whole match uses the best single army for metal and energy, and the sum of all armies for damage and unit counts. The "My figures" switch uses the player's own army for every metric.
- The trailer is sampled every 15 seconds on the replays checked, and the header holds the match length in whole seconds. The last point on the chart is the last sample, not the last frame.
- The library keeps totals rounded to whole numbers. The chart and the CSV file use the samples as the engine wrote them.
- A rate in the dossier is the mean of each game's own rate, with the median beside it. It is not total over total minutes, which would let one long game outweigh several short ones. The ratio of units lost per unit killed is built the same way, and a game with no kills has no ratio and is counted in its own cell.
- Player statistics and the stream count different things. The trailer's APM comes from the engine's counter of commands a player gave from the interface. The stream lists every order packet, including ones widgets send, and one packet can carry many orders.
- A rating is the text the lobby wrote, for the lobby's declared game mode. The uncertainty is shown as written.
- The analysis is stored only when it reproduced the trailer exactly. The check covers what coilbox records and not every value in the simulation. A game that reads `Game.gameName` will see the analysis game's name, not its own.
- Reading a result as a loss for everyone is wrong. A replay with no game over has no result.

## What is not game specific

Nothing in the interface names a game or a unit. Where unitsync cannot answer, the feature shows unit ids and says so.

The unit classifier is `classifyUnit` in `src/content/unitCategory.ts`. It reads only fields in the unit list and applies these rules from the top, stopping at the first match.

1. Builder or factory. This needs the `builder` flag. A static unit with a build menu is a factory and any other builder is a builder.
2. Transport, from a transport capacity above zero.
3. Armed. A moving unit with a weapon is offence and a fixed one is defence.
4. Economy, from income or storage. A negative upkeep counts as income, as it does in the engine.
5. Intelligence, from a radar, sonar, jammer or seismic range.
6. Otherwise unclassified.

On the page, factory, builder, intelligence and transport share an "Other" column.

The share of buildable units left unclassified was measured on two games.

| Game | Buildable units | Unclassified |
| --- | --- | --- |
| Splinter Faction | 89 | 4 (4.5%) |
| Beyond All Reason test-30922 | 407 | 21 (5.2%) |

Over all units and not only buildable ones, the unclassified share is 4.5% (7 of 154) for Splinter Faction and 10.8% (61 of 564) for that Beyond All Reason build, mostly cosmetic and test units.

What it cannot see lands in unclassified. That includes Beyond All Reason's energy converters and Splinter Faction's supply depots and research centre, which are set through `customParams` or gadgets, and walls and decoys, which declare nothing.

Two calls are known to be wrong. A static unit with a weapon is defence, so nuke silos and static artillery read as defence. Splinter Faction's lootboxes read as economy. A player does not order either in an opening.

## For people extending this

### Where each decoder lives

All paths are under `crates/tauri-plugin-coilbox-content/src/`.

| Part | File |
| --- | --- |
| Header, start script, trailer, the replay info | `demo.rs` |
| The stream walk and its message decoders | `demo/stream.rs` |
| Build orders | `demo/build_orders.rs` |
| The analysis run, its game, the retargeted copy, the launch, the divergence check | `demo/analysis.rs` and `demo/analysis/` |
| The event store and the queue | `demo/analysis/store.rs` and `demo/analysis/queue.rs` |
| The metric registry and the ratios | `metrics.rs` |
| What the library store keeps | `stats.rs` |
| The recording gadget | `lua/replay-logger/luarules/gadgets/coilbox_replay_logger.lua` |

The unit classifier is in `src/content/unitCategory.ts`.

### Adding a stream message

Add a decoder function and an arm for its message id in `decoder` in `stream.rs`. It must refuse bytes that do not fit its layout exactly, including a size field that disagrees with the packet's length. A refusal then costs one packet, because the framing already says where the next one starts. Layouts come from the engine's packet writers and not from the comments in the message type header, which leave out a command's timeout and parameter count. Build test replays byte by byte, because an offset error fails by returning plausible numbers.

### The metric registry

A metric is an entry in `metrics.rs`. The chart's dropdown, the sparkline grid, the roster columns and the headline tiles are all built from the registry, so adding a metric is one line. Frontend code must not name a metric key. `src/content/metricRegistry.test.ts` scans `src/` and fails if any file other than the bindings spells one out. A ratio is an entry in the registry's ratio list and is not a field on a metric.

### Adding an event kind

A reader must skip a kind it does not know and ignore a field it does not know. The Rust reader keeps an unknown kind as unknown and stops nothing. When the gadget starts recording a new kind or a new field, raise `LOGGER_VERSION` in `demo/analysis/log.rs`. Stored analyses carry the version, and an older one shows as outdated. The test `the_logger_writes_the_kinds_this_version_stands_for` fails when the gadget's set of kinds changes and the version did not.

The logger's line format number is separate. Raise it only when a line loses or changes a field a reader depends on, never for an addition.

### The gadget must stay read only

A replay is a stream of orders, so the match is simulated again. Anything that changes the simulation produces a record of a game nobody played. The synced half of the gadget calls only functions that read, draws no random numbers, and hands each line to the unsynced half, which is the only half that opens a file. Synced code has no `io`.

To check a change, run the ignored test `a_real_replay_reproduces_under_the_analysis_game` in `demo/analysis.rs` against a real engine, game and replay. Set `COILBOX_ANALYSIS_LOGGER` to the path of a deliberately perturbed copy of the gadget to prove the divergence check still catches it. The run is then expected to diverge.

The analysis game must hold only a `modinfo.lua` and the gadget. A unit, weapon or feature definition in it would join the base game's and move the definition ids every event is keyed by. A test pins the file list.

### Things earlier notes got wrong

The design notes and tickets assumed these points wrongly, and the code follows what was found.

- The trailer order is the winners, then player statistics, then every team's sample count, then the samples. The sample counts come as one run before any samples.
- A player statistics record is read in the order commands, unit commands, mouse pixels, mouse clicks, key presses. That is not the order the engine's header declares.
- A single unit command message is sent by Lua widgets as well as AIs. Every one in the largest local replay came from a player's own widgets, so counting by message id would hand a person's orders to a bot.
- An insert command's first parameter is a queue position only when the alt bit is set, and a command tag otherwise.
- Rewriting the game name in the header script does not change the game the engine loads.
- A jammer's range is `radarDistanceJam` in the engine. There is no `jammerRadius`.
- The trailer is not read with a seek. A gzip file is read whole.

### Profile keys

`analytics.matchStats` hides the statistics sections and `analytics.run` hides the button and everything that steers a run. See [Distribution profile](distribution-profile.md) and [Routes](routes.md) for all of them.

## Reading list

The work was built from these. Reading them first saves time.

- The engine's own sources, at [RecoilEngine](https://github.com/beyond-all-reason/RecoilEngine). `rts/System/LoadSave/demofile.h` for the header, `rts/Sim/Misc/TeamStatistics.h` for the sample fields, and `rts/Net/Protocol/NetMessageTypes.h` for the message ids. For the packet layouts read the writers in `BaseNetProtocol.cpp`, because the comments in `NetMessageTypes.h` leave out fields.
- knorke's demonaut, from 2010. It plays a replay with a logger attached and draws a minimap with events on it. It contributed the spatial half, including heatmaps by frame range and the same picture built from many replays of one map. Its unbuilt to do list is a good backlog. This page has no link for it because neither the design notes nor any pull request give one.
- Arkounay's bar-stats, a local app that reads your own replay folder. It contributed the shape of the match page, the decision to refuse a trailer whose sizes it does not recognise, indexing in two phases, treating an empty replay as a match in progress, and building test replays byte by byte. No link, for the same reason.
- bar-replay-analyzer, which answers where things died today by running the engine. The design notes name it and give no link.
- Gex, at [varunda/gex](https://github.com/varunda/gex), under the MIT licence. It is the most complete example of the event log. Its parser walks the same stream messages and a 909 line Lua widget under a headless engine records unit creation, deaths with attacker and weapon, damage, transports, projectiles, commander positions every 5 seconds, all unit positions every 30 seconds, and an army, defence, utility and economy value split every 15 seconds. It contributed the value split, the speed technique of setting the maximum and minimum speed to 9999 to turn a 6 minute duel into a 22 second analysis, and storing a unit definition set once per distinct set so a replay of a game version that is no longer installed can still be read. Coilbox has not built the value split or the definition snapshot.

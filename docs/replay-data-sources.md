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

The player counters are the engine's. It adds one to a player's command count each time its selected units handler is given a command flagged as coming from the user, and it adds the size of the selection to the unit command count. Read in the engine source, the count is raised by `CSelectedUnitsHandler::GiveCommand` when the command is flagged as from the user. That covers a click through the engine's interface and a widget that calls `Spring.GiveOrder`, which orders the current selection. It does not cover a widget that calls `Spring.GiveOrderToUnit` or its array and pairwise forms, because those are sent as orders to named units and never reach that function. So the count includes some widget orders and leaves out others, and it counts one command at a time, not one per unit in the selection.

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
- where every order with a place was aimed, drawn on the replay's map as a density
- how many orders each team gave in each statistics period, charted as commands per minute under the match chart

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

### Which unit list names the ids

A unit list comes from one of four places. Coilbox takes the first that applies.

1. The engine's own list, when the replay has been analysed. The replay logger writes the engine's unit definitions at the start of an analysis run, so this is the numbering the match really used, with its mod options, its AIs and its map applied. It always names an analysis's events. It names the replay's build orders when the run used the game the replay records, and not when it had to use another version.
2. A packaged archive (`.sdz`, `.sd7`, or a rapid package) installed under the exact name and version the replay records, read through unitsync. The section says the names were matched by name and version.
3. A list coilbox kept for this replay. The section says when it was recorded and from which game. A kept list also stands in for an exact match that is a loose folder (`.sdd`), and then the section says so, because a folder can change under the same name and the list is what it held the day the replay was read.
4. Another installed version of the same game, with a warning that names come from a different build and may be wrong. One unit added or removed moves every id after it.

With none of these, each order shows its id and the section says the game is not installed.

### The kept unit lists

Coilbox keeps the unit list a replay was read against, so the replay still names its units after the game is updated or removed.

- What a list holds. For each definition id in order: the unit's key, its name, its metal and energy cost, whether it moves, whether it builds, whether it has a build menu, whether it has a weapon, and the numbers that say what it makes, stores, senses and carries. That is what the replay page reads. It holds no picture, model or footprint. A build picture is asked of an installed game of the same family by the unit's key, and a unit with none gets the neutral placeholder.
- Where lists are. `content/replay-unit-def-sets/` under coilbox's data folder, beside the analyses. Each distinct list is one gzipped file named after the sha256 of its content, so replays that share a list share a file. `links.json` records, for each replay's game id, which lists were recorded for it, from where and when. Splinter Faction's 154 definitions take 3,404 bytes. Metal Factions' 716, with a link file for one replay, take 13,212.
- When one is kept. When a replay is analysed and the run reproduced the match. And when a replay's build orders are read against a game installed under its exact name, the replay has build orders, and every one of them fits the list. A replay with no build orders gets none from unitsync.
- Which wins. The engine's list, then a packaged archive's, then a loose folder's. A list already recorded is never replaced by a different one from the same kind of read, except that a new analysis replaces the last one's.
- A remix carries its original's game id and its original's unit ids, so it reads its original's list.
- When one goes. With the last replay of its match, by the rule an analysis goes by. Deleting an analysis removes the engine's list for that replay. The Storage screen says how many lists are kept and what they cost.

### When unitsync's list is not the engine's

Unitsync runs a game's definition scripts with no mod options and no match. The engine ran them with the match's. For most games that makes no difference. For some it does, and then unitsync's list numbers the units differently from the match, for the right build of the right game. This was measured on 10 October 2026.

- Mod options. In Beyond All Reason test-30922, 9 of the 145 on, off and list settings tried change the unit list. With no options there are 564 definitions. `experimentalextraunits` or `scavunitsforplayers` makes 918, `experimentallegionfaction` 809, `ruins` enabled or any `zombies` setting 1,828, and `forceallunits` 1,955. Zero-K v1.14.8.0 gains one definition with `campaign_chassis`. No setting changed the list in the other 29 installed games, the three Splinter Faction builds and Metal Factions v2.58 among them. Number options were not tried.
- The AIs in the match. Beyond All Reason's definition scripts read the team list and add units when a Scavengers or Raptors AI is playing. Read in its source and not measured.
- Definitions the engine refuses. The engine gives no id to a definition with no health, a negative cost, no build time, a negative speed, or a movement class the game does not define, and the next definition takes its id. Unitsync still lists it. XTA 9.65 has 15 such definitions, which the engine's own log names. Total Annihilation Prime 1.05 has 10 candidates and Jauria RTS 0.6.7 has 1, found by reading their definitions and not confirmed on an engine.
- Key case is not a cause. The engine lowercases every definition key before it sorts them, and so does the unit list. None of the 31 installed games has a key that is not already lowercase.

On the two matches checked directly, the engine's own list equalled unitsync's entry for entry: 154 of 154 for Splinter Faction and 716 of 716 for Metal Factions, in name, order, cost and whether each unit moves.

What protects a replay from a wrong list:

- An analysed replay uses the engine's list, which has none of these problems.
- For any other replay the page checks the list against the replay's own build orders. A placed order should name a unit that does not move, a factory order one that does, and no id should be past the end of the list. When some orders do not fit, the build order section says how many and that names and costs may be wrong, and no list is kept from that read. On a 10 player Beyond All Reason replay read against a later build, 1,413 of 3,605 orders did not fit.
- The check can pass on a wrong list, when the ids that moved are not ones the players ordered. A replay with no build orders cannot be checked at all. Reading unitsync's list with the match's own mod options and AIs is not built.

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

The replay itself is never written. The gadget records these kinds of line.

| Kind | What it holds |
| --- | --- |
| `header` | The game, map and engine as the run saw them, the map's size, the Gaia team, and how many frames lie between two positions of a starting unit |
| `game_start` | The frame the game started on |
| `unit_created`, `unit_finished`, `unit_destroyed` | The frame, the unit, its definition id, its team and where it was. A created unit names its builder. A destroyed unit names the attacker's unit, definition and team and the weapon, when the engine names them |
| `unit_given` | A unit that changed team, written once it has: the team it went to, the team it left, and whether the engine counted it as a capture or a gift |
| `start_unit_position` | Where a living starting unit was, every 60 frames, left out when it has not moved since the last one |
| `unit_def` | One of the engine's unit definitions, one line for each in id order, straight after the header: its key, name, costs, whether it moves, builds, has a build menu or a weapon, and what it makes, stores, senses and carries. Kept in the unit list store and not in the replay's analysis file. Written since logger version 3 |
| `game_over` | The winners and every team's final totals |

A unit line also says when the unit is a starting unit. The engine has no idea of a commander: its unit definitions' `isCommander` always answers false, the engine spawns nothing itself, and the start unit a side declares is a name the game is free to ignore. Splinter Faction declares `fedcommander` and spawns `fedcommander_up1`, some hundreds of frames into the match. So the gadget flags the one thing the engine can say for any game: a unit created for a team other than Gaia, by no builder, on the frame that team's first unit was created. In most games that is the commander, and the interface says "starting unit". A team whose first unit was given to it has none. A game that swaps a unit for another when it upgrades ends the starting unit there, because the engine reports one unit destroyed and another created, and nothing in the log ties the two together.

Positions are every 60 frames because a path is drawn at the grain of the map's heat field, 256 cells on the longer side. The fastest starting unit of three games moves 2 elmos a frame, so 60 frames is 120 elmos, which is 3.75 cells on a map 8192 elmos long. On a 248 second Metal Factions match of three AIs the positions were 163 lines of 344, and 14,227 bytes of 36,256. As arithmetic and not a measurement, 16 starting units that never stood still for 40 minutes would be 19,200 lines.

The replay's map draws four layers from these lines: deaths, buildings finished, starting unit deaths and starting unit paths. Only the kinds a layer needs are read, and only when that layer is switched on. The value of living units by kind, under the match chart, is added up from the finished, destroyed and given lines. The gadget samples nothing for it.

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
| Map time window | Stream, for when each order was given, the event log, for when each event happened, and the match's length from the header, stretched if an order falls after it. A range under the map limits the building layers and the order density layer to orders given inside it and the event layers to events inside it. The first and last five minutes are presets. When the match has statistics, the chart's lead metric per minute across all teams is drawn behind the range | It filters orders by when each was given, not when anything was built, and events by when each happened in the playback. With order layers and event layers both on, the readout counts each in its own words, such as orders and deaths, and never adds them. Orders given before the game belong to a window that starts at 0:00. Start boxes and start positions are not filtered. A replay with no statistics has a plain track |
| Map layer, start positions | Stream. A dot for each team where its start was set before the game, in the colour of that player's line on the match chart | A team that never readied has no dot. The engine can move a start into its start box, so the commander may have appeared a short way off |
| Map layer, buildings ordered | Stream. A mark for each order to place a building, in its player's colour. The shape is the kind of building, classified by coilbox through unitsync against an installed game | An order that was cancelled or refused is a mark like any other. Factory queue orders have no position and are not drawn. With the game not installed every mark is one shape. With another build installed a shape may be wrong |
| Map layer, order density | Stream, walked again when the layer is switched on. Every order that has a place, from the player's own selection, widgets acting for them and AIs, added into one heatmap with the same colours and legend as building density. Filtered by the time window | Orders aimed at a unit have a unit id in the stream and no place, so they are not on it, and the count is stated. Commands the engine does not define, which a game or a widget made up, are left out and counted, because their parameters could mean anything. Widget orders are most of what it holds in the replays checked, because a widget sends one order for each unit. Where an order was aimed is not where anything happened |
| Commands per minute | Stream, walked when the reader asks for the chart. One order is one command, counted for the player's own selection, for widgets and for AIs as three separate series, each added across the players on a team. A bucket is the replay's own statistics period from the header, 15 seconds in every replay checked, and 15 when the header names none (`TeamStatistics::statsPeriod`). The count is shown as a rate per minute at the end of its bucket, which is where the trailer's samples sit | Not the same count as the trailer's APM, so neither checks the other. The default series is the player's own, because that is the sender the engine's counter covers. A widget's rate can be thousands a minute, and an AI's rate is an AI's. The stretch after the last whole period is left out |
| Map layer, building density | Stream. The same orders added up into a heatmap, drawn on the minimap and on the 3D preview. Colours are relative to the busiest spot on that map, and the legend states how many orders that spot holds | It shows where buildings were ordered. Where every order was aimed is the order density layer |
| Map layer, bases | Stream, for the orders, and the replay's start positions. A square crop of the minimap round each player's start, all the same size in elmos, with that player's orders to place a building drawn on it as in the buildings layer. Only the orders inside the map's time window are drawn. Allies sit together | The crop is a quarter of the map's shorter side, a display choice and not a measurement, and the page states its size. An order outside it is counted and not drawn. A start near the map's edge is not centred, because the crop stays on the map. Orders are not buildings, and a cancelled order is drawn. Factory queue orders have no position and are not drawn. A team with no start position has no crop. With the game not installed every mark is one shape and there is no opening |
| Chat log and chat timeline | Stream | A damaged stream, with a note |
| Timeline typed marks | Stream | The pause layout has not been checked against a real replay |
| Analysis section and recorded events | Event log | Not analysed, or the playback did not reproduce the match |
| Map layer, deaths | Event log. Every unit the playback destroyed, added up into a heatmap on the minimap and on the 3D preview, for all players together. Colours are relative to the busiest spot, and the legend states how many deaths that spot holds. With the game installed a second mode counts each death as its unit's metal cost, which shows where value was lost and not where units died | The layer cannot be switched on until the replay is analysed, and a replay whose playback did not reproduce the match, or a remix, has no events. A death with no attacker, such as a cancelled build, counts like the rest. The cost mode reads costs through unitsync against an installed game, so another build installed can give wrong costs, and a unit with no stated cost counts nothing |
| Map layer, buildings finished | Event log. An outline for each unit the playback finished that is a building, in its player's colour and in the shape of its kind. Beside the buildings ordered layer, which is filled, a fill with an outline round it is an order that was carried out | Needs the game installed, because the log holds a unit definition id and only the game says which is a building. Finished units that move are left out, since their position is where they left a factory. An order with no outline may have been cancelled or never carried out, and an outline with no order is a building no order in the window placed. The window filters each layer by its own time, when an order was given and when a building finished |
| Map layer, starting unit deaths | Event log. A mark where each starting unit ended, in its player's colour, and a list of them with the time and who destroyed it. A cross is a unit destroyed. A ring is a unit the game's own script took away with no attacker, which is what an upgrade looks like in the log | Needs an analysis from logger version 2 or later. An older one holds no starting units and says so. A starting unit is not always a commander. A unit a game replaces when it upgrades ends there, and the unit that replaced it is not followed |
| Map layer, starting unit paths | Event log. A line for each starting unit through the positions recorded for it, in the colour of the player who started with it, with a dot where the line begins and the player's name where it ends. The time window keeps the part of the line inside it | The same. A position is recorded every 60 frames and only when the unit has moved, so a line cuts a corner of up to 2 seconds of travel. A unit that changed hands keeps its first player's colour |
| Value of living units by kind | Event log for which units were alive and whose, and the installed game through unitsync for what each costs and what it is for. One small chart for each line on the match chart, all on one scale, sampled on the trailer's own period, with metal and energy as two views | Needs an analysis and the game installed. With another build installed the costs and kinds may be wrong. A unit counts from when it is finished, so one being built counts nothing. An analysis from before logger version 2 did not record a unit changing hands |
| Map preview and the start boxes layer | The installed map, with start boxes from the start script | No engine or map is installed. A match with fixed or random starts has no boxes |

### Across the library

| Part | Source | Wrong or missing when |
| --- | --- | --- |
| Replays page figure cells and sorts | The library store's copy of trailer totals. Seven metrics, rounded to whole numbers | The replay has no samples, or with "My figures" the player was not in the match or the record has no team id. It has no figure and sorts last in both directions |
| Dossier rates, ratio and trend | The same store | Games with no totals, no team id or no usable length are left out and counted on the page |
| Matchup view | The store, using start script teams and sides, trailer winners and header length | A game where you were not on opposing teams is not counted |
| Stats page and achievements | The store, using start script players, sides and AIs, and trailer winners | A remix or refight rerun is left out. A game with no result is not a win |
| A map's page, how this map is played | Every match on the map by its name with a trailing version taken off (`Talus v1.0` and `Talus v1.1` are one map), counted once however many files hold it. Each version is listed with a count and can be left out, and so can each game version. Each replay's stream is walked once and kept as counts on the map's grid by minute. Start positions are a dot a team a match. Building density, order density and the two kinds of building are stream orders. Deaths are from the event log. Each match is scaled before the matches are averaged, and the legend says what the brightest spot holds under that scaling | Orders are not buildings. A layer is drawn from the matches that have it, and the number beside the layer says how many: every match with a stream for orders, only an analysed match for deaths. Defences and economy leave out a match whose exact game build is not installed. A replay records the map's name and nothing else, so the grouping is by name and not by archive, and a version's layout may differ from the page's map. A version known to be another size is left out until asked for, and one that is not installed has no size to compare. A remix is left out, and so is a match under a minute unless asked for |
| A map's page, records for the map | The same matches as the picture, under the same filters. Start positions come from the stream and results from the trailer, joined by engine team id and then side, so a position is counted as won when the side that held it won. Length is the header's length. Factions are the start script's sides for every player | A record saved before team ids were kept has none and is left out of the position counts, and the page says how many. A match with no result is a start taken and in no win or loss. A position's record in a team game is confounded by the team it was on and who was beside it, and so is a faction's. The other maps' lengths are counted under the same filters. With more than one version in, every start is placed on the page's map. Positions can be named: the names are the player's own, kept on this computer under the map's exact name, and positions given one name are one row |

The store is one JSON file written whole, and it never holds a series.

### The picture of every match on a map

A map's page in the library has a section called "How this map is played". It adds every match on that map into one picture: where teams started, where buildings were ordered, where orders were aimed and, for analysed matches, where units died.

One match is an anecdote, so the section always says how many matches it is drawn from, and the number differs by layer. Every match with a readable stream has orders. Only a match you analysed, whose playback reproduced it, has deaths. The number beside each layer's name is the count of matches with something on that layer in the window of match time you chose.

Each match is scaled before the matches are averaged, so one long game does not become the whole picture. There are three ways to scale, and they answer different questions.

| Scaling | What each match is scaled to | What the brightest spot means |
| --- | --- | --- |
| Share of each match, the default | Its events add up to one | The average share of a match's events that fell near that spot. "On average 12% of a match's orders to place a building within 320 elmos of one spot" |
| Each match's busiest spot | Its own brightest point is one | The place that was busiest in the most matches. It is not a count |
| Per minute of match | Divided by its minutes in the window | Events a minute near that spot, averaged over the matches |

The share is the default because it answers the mapper's question, which is where the building in a typical match goes. Under it a short quiet match weighs as much as a long busy one. That is why matches under a minute are left out unless you ask for them: a ten second test with four orders would otherwise count as much as a full game.

The window of match time runs on each match's own clock. The first five minutes is the first five of every match. The last five is each match's own last five. A stretch between two minutes misses a match that ended before it, and the section says how many matches have anything in the window. The window is in whole minutes.

The filters narrow which matches are in the picture: the number of players, the games and versions, which can each be switched off with a count beside them, how the sides were arranged, whether the match was analysed, a range of days, and a set of replays.

What counts as one match and one map:

- A match is counted once however many files hold it. A remix is a copy of a match pointed at another game, and is left out. Two plain files with the same game id are one match.
- The map is matched by its name with a trailing version taken off. A version is only a last word that is plainly one: an optional `v` and dotted numbers (`v2.4.1`, `5.17`), or `v` and one number (`v3`), after a space, underscore or hyphen. A bare number (`DSD 2`, `Throne 8`) and a word with anything else in it (`1.0b`) are not. When in doubt the name is left whole, because a wrong merge puts two different maps in one picture.
- Every version found is listed with its count and a box. All are in by default, the page's own is marked, and a line above the picture and the records says "Across 3 versions of this map" when they span more than one. A replay records the map's name and nothing that says which archive or size it used, so the grouping is by name and not by archive. A version that is installed with a size other than the page's map is left out by default, because its coordinates would land in the wrong place. A version that is not installed has no size to compare.
- The start positions of every included version are placed on the page's map, using the positions that map declares.
- Defences and economy need to know what each building is for. A unit definition id means a unit in one build of one game, so a match is only classified against an installed game with exactly the name and version the replay records. A match on any other build is left out of those two layers and counted in the note under them.

Reading a replay costs a walk of its whole stream, the first time. The counts are then kept in the app's cache folder, one small file a replay, and the next visit reads those. On one Mac, in an unoptimised build, the largest replay in a library of 18 (3.1 MB on disk, 105,824 orders with a place) took 364 ms to walk and 7 ms to read back from its kept file, which was 177 KB. All 18 took 1.3 seconds to walk between them and their kept files came to 651 KB. The cost grows with the number of replays, and nothing here measures a large library. A kept file is thrown away when the replay file changes size or modified time, and the folder can be cleared from the storage settings at any time.

### Exporting the picture's numbers

The section has two CSV exports, for anyone who wants to do their own analysis. Neither computes anything the screen does not. Each is disabled, with the reason as its tooltip, when there is nothing to write. Both are plain RFC 4180 files with CRLF line ends, a dot decimal and every digit of each number. Text a spreadsheet would run as a formula (a leading `=`, `+`, `-`, `@`, tab or carriage return) gets a single quote in front. The provenance is repeated as columns on every row, so there is no header block to skip and two files can be joined.

Coordinates in both files are in elmos from the map's north west corner. `x` grows east and `z` grows south, as a replay records them. Column 0 is the grid's west edge and row 0 its north edge. A cell's `x` and `z` are those of its middle.

Export layer CSV writes the layer on screen, one row for each grid cell that has an event in it. A cell that is not in the file is zero. The grid is the one the replays are counted on, 256 cells along the map's longer side, and nothing in the file is smoothed.

| Column | Holds |
| --- | --- |
| `cell_column`, `cell_row` | The cell, from 0 |
| `x_elmos_from_west`, `z_elmos_from_north` | The middle of the cell |
| `mean_scaled_per_match` | Each contributing match's events in the cell, scaled by the mode in `scaling`, then averaged over the contributing matches. This is the array the picture is smoothed from. Its unit is the mode's: a fraction of a match's events for share, a fraction of a match's busiest spot for peak, events a minute for rate |
| `events_unscaled` | The plain number of events in the cell over the contributing matches, for anyone who wants another scaling |
| `map`, `map_versions`, `game_versions` | The page's map, and the map names and game versions of the matches in the picture, joined with `; ` |
| `matches_in_picture`, `matches_in_layer` | Matches after every filter, and those with something on this layer in the window |
| `layer`, `scaling`, `window` | The layer, the scaling mode and the window of match time |
| `filter_players`, `filter_sides`, `filter_analysed`, `filter_played_from`, `filter_played_until`, `filter_replay_set`, `includes_matches_under_a_minute` | The other filters in force. An empty date or set is no bound |
| `map_width_elmos`, `map_height_elmos`, `grid_width_cells`, `grid_height_cells` | The map's size and the grid's |
| `exported_utc` | When the file was made |

Export start positions CSV writes the positions in the records under the picture, one row for each position. The table on screen joins positions the player gave one name into a row. This file lists the positions, so the counts of the rows that share a `row_number` add up to the table's row. `name` is the player's own text.

| Column | Holds |
| --- | --- |
| `row_number`, `position_key`, `position_kind` | The number on the minimap, the key (`d3` for the map's third declared position, `c3:7` for a group of starts), and `declared` or `cluster` |
| `name` | The name the player gave the position, or empty |
| `x_elmos_from_west`, `z_elmos_from_north`, `radius_elmos` | The position's centre, and the distance from it to the farthest start in a group (0 for a declared position) |
| `taken`, `taken_by_ai`, `with_result`, `won` | Starts at the position, those held by an AI, those in a match with a recorded result, and those among them whose side won |
| `team_1_*`, `team_2_*` | Taken, with result and won for each team, only when the matches in the picture are all 1v1 or all two sides, as the table splits them |
| the provenance columns above, `declared_tolerance_elmos`, `grouping_distance_elmos` | How a start was placed at a position. Empty when the map has no such figure |

Export picture saves a PNG of what is on screen with its provenance written under the map. The map is at the top, with the layer over it and the start marks if they are on. A white panel under it, which does not change with the app's theme, holds the colour bar, the legend's sentence, and in words the map, the number of replays and how many have something on the layer, the time window, the scaling, the map and game versions, the filters, and "Made with coilbox" with the app's version and the day of the export. The day is there because the picture is made from a library that grows, so the same filters give another picture later. Text is wrapped to the panel and never drawn over the map. Only the start marks are, and a position's name sits on its own dark label.

The map is as wide as the minimap along its longer side, up to 2048 pixels, and never enlarged, so a 1024 pixel minimap gives a map 1024 pixels across. The shorter side follows the map's shape. The image is at least 720 pixels wide, with a thin map centred on the panel.

The minimap is read with `fetch` and drawn from a bitmap made from the bytes. An `<img>` of the page's `coilbox://` address draws fine, but a canvas it was drawn on refuses to be saved. The PNG is written with the unit builder's save command, which writes bytes to an absolute path and does not care what the file is.

### The records under a map's picture

Under the picture the section counts what the library knows about the map, over the same matches and the same filters, so a filter changes both together. A refight is left out here as it is left out of the stats page.

Every figure is a count with the number it is out of, such as "won 3 of 5". The page shows no percentage and hides no figure for a small sample, because the codebase has no rule for when a sample is big enough.

- Results: how many matches have a recorded result, and which team won among the matches of two teams. Team 1 is the team with the lower number in the match.
- Length: the median and the range of match lengths on this map, beside the same for every other map in the library under the same filters, each with its count. Nothing tests whether the difference is more than chance.
- Factions: the games and wins of each faction for every player on the map. Skirmish AIs are not counted. In a team game a faction's record is not separated from its team or the factions beside it.
- Start positions: how often each position was taken, how many of those have a result, and how many were won.

A start position is joined to a result through the engine team id. The start belongs to a team, the team belongs to a side, and the side won or lost. A record saved before team ids were kept cannot be joined, and an absent id is never read as team 0. Those matches are counted on the page as left out.

Which starts are the same position depends on the map.

- On a map that declares start positions, a start within half the smallest distance between two declared positions of one is at it. That is the largest radius at which a start cannot be near two, so a start exactly between two is at neither. The tolerance comes from the map and not from a number of elmos.
- Every other start is grouped by distance. Two starts within 1/32 of the map's shorter side of each other, directly or through others, are one position. That is the grain of the density layers. It is a display choice and nothing measured says it suits every map. On a map where players spread their starts evenly through a box it can chain them into one wide group, and the table gives each group's radius so that shows.
- A position can be given a name. The names are the player's own, kept on this computer under the map's exact name, so a name given on one version is not shown on another. A name is stored with the position's key and its centre. It is found again by key, then by the nearest group within the grouping distance, and a name that finds nothing is listed under the table until the player deletes it. Positions given one name, ignoring case, are one row with their counts added.
- A group's key is the cell its centre falls in, on a grid of squares one grain across, such as `c3:7`. A declared position's key is `d` and its number in the map's own list. The same starts in any order give the same groups. Adding a start never splits a group, and a key changes only when a group's centre moves into another cell.

A position in a free for all or a duel has no pair of sides to split by, and the table says so. In a team game the table splits each position by team, and says that nothing else is controlled for. When the matches in view are a mix of arrangements the table is not split by team.

## Why two numbers may not match

These are the reasons the code and the pull requests established.

- Orders are not buildings. A cost of what was ordered is not what was spent, because cancelled orders count and queue removals are not subtracted. The trailer's "metal used" is the engine's own count.
- A unit's name and cost come from a unit list: the engine's own for an analysed replay, and otherwise the installed build of the game matched by name, or a list kept from when it was. A different installed build can name the wrong unit, and so can the right build when the match's mod options changed its unit list. 518 million metal once appeared under Defence on a Splinter Faction 0.1.77 replay, because that game's definitions give its lootboxes, drop pods and scanner probe a cost of 518,181,504 and the replay's ids landed on them in the installed build. The page showed its "different build" warning.
- A figure for a player in the library is their own army's. The store keys totals by engine team, which is the army one player controls. The replay page uses "Team 1" and "Team 2" for a side. Allies on one side each have their own army and their own figure.
- A library row for a whole match uses the best single army for metal and energy, and the sum of all armies for damage and unit counts. The "My figures" switch uses the player's own army for every metric.
- The trailer is sampled every 15 seconds on the replays checked, and the header holds the match length in whole seconds. The last point on the chart is the last sample, not the last frame.
- The library keeps totals rounded to whole numbers. The chart and the CSV file use the samples as the engine wrote them.
- A rate in the dossier is the mean of each game's own rate, with the median beside it. It is not total over total minutes, which would let one long game outweigh several short ones. The ratio of units lost per unit killed is built the same way, and a game with no kills has no ratio and is counted in its own cell.
- Player statistics and the stream count different things. The trailer's APM comes from the engine's counter of commands a player gave from the interface. The stream lists every order packet, including ones widgets send, and one packet can carry many orders. Commands per minute counts orders and not packets.
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

A reader must skip a kind it does not know and ignore a field it does not know. The Rust reader counts an unknown kind as unknown and stops nothing, but it does not keep what the line held: the store writes each line back out from what the reader understood. So a new kind needs a variant in `LogLine`, and a new field needs a field on its struct, or a stored analysis loses them. `the_new_lines_serialise_back_as_the_logger_wrote_them` is the test to copy.

When a new line has a count the replay's trailer also holds, compare the two in `demo/analysis/divergence.rs`. Units given, sent, captured and lost to capture are checked that way, so a log missing one of those lines is not kept. When the gadget starts recording a new kind or a new field, raise `LOGGER_VERSION` in `demo/analysis/log.rs`. Stored analyses carry the version, and an older one shows as outdated. The test `the_logger_writes_the_kinds_this_version_stands_for` fails when the gadget's set of kinds changes and the version did not.

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
- Gex, at [varunda/gex](https://github.com/varunda/gex), under the MIT licence. It is the most complete example of the event log. Its parser walks the same stream messages and a 909 line Lua widget under a headless engine records unit creation, deaths with attacker and weapon, damage, transports, projectiles, commander positions every 5 seconds, all unit positions every 30 seconds, and an army, defence, utility and economy value split every 15 seconds. It contributed the value split, the speed technique of setting the maximum and minimum speed to 9999 to turn a 6 minute duel into a 22 second analysis, and storing a unit definition set once per distinct set so a replay of a game version that is no longer installed can still be read. Coilbox keeps the definition set too, and takes it from the engine during an analysis where Gex does.

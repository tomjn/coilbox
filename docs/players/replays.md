# Replays

Every game the engine records ends up as a replay. Coilbox lists them on the Replays page, and each one opens a page that shows who played, how the match went, what each player built and what was said. From there you can watch the replay in the engine.

Open it from Records > Replays in the sidebar.

## Find a replay

Each row shows the map, when the match was played, how long it lasted, how many played and the file size. The game and its version are under that. A badge beside the map's name says where the match came from, such as Skirmish, Multiplayer, Campaign, Conquest, Warpath or Refight. The newest replay you have not watched carries an Unwatched badge.

To find one:

- Type in Filter replays… to match part of the file name. A replay's file name holds its date, map and engine.
- Pick a sort from the list beside it. Newest is the default. You can also sort by Oldest, Name A–Z, Name Z–A, Largest, Smallest, Longest and Shortest.
- Any length narrows the list to matches over 30 minutes, 1 hour or 2 hours.
- All origins narrows the list to one kind of match, such as Skirmish or Multiplayer.
- Short replays shows the matches under a minute long. They are hidden at first, because they are mostly games that were quit or crashed.
- Remixed shows only your remixes. It only appears once you have one.
- Watched shows only the replays you have marked watched. It only appears once you have marked one.

The list at the top left picks which engine's content folder to read. Rescan reads the folder again, for example after you copy a replay in.

The page remembers your filters and sort, so they are still there next time.

## The figures in the list

Each row also shows figures from the end of the match, such as Damage dealt and Units built. These are the whole match's totals.

- To sort by a figure, pick Most or Least and the figure's name from the sort list, for example Most damage dealt.
- Select My figures to show and sort by your own army's figures instead of the whole match's.
- A Skill column appears when the lobby recorded ratings. It shows the average rating of the players, with the lowest and highest under it.

A replay with no figure, for example one with no statistics, sorts last either way.

## Keep track of replays

- The eye at the end of a row is Mark watched. Select it again to mark the replay unwatched.
- Sets group replays together, such as a tournament or a night of games. Sets at the top of the page lists your sets. Show narrows the list to a set, and Add the shown puts every replay the list is showing into it. To add one replay, select the stack of layers at the end of its row. Deleting a set never deletes the replays in it.
- Gather replays moves replays out of each engine's own folder into your content folder, so they are all in one place before you remove an old engine.
- Clear unfinished deletes the empty files left by games that did not finish recording. It only appears when there are some. A game running right now has an empty file too, so do not clear while one is running.

## Open a replay

Select a row to open the replay's page. Its parts come in this order:

1. The buttons at the top.
2. Details.
3. Players.
4. Match statistics.
5. Build orders.
6. Analysis and recording.
7. Timeline and Chat log.
8. Your notes.
9. The map.

Replays above the map's name goes back to the list.

If the replay's game, map or engine is not on your computer, a box near the top says which, for example "Game not installed", with a button to download it.

## Watch a replay

Select Watch at the top right. The engine opens and plays the match from the start.

Watch uses the engine the match was recorded on. If you do not have it, coilbox offers to download it first. If it cannot be downloaded, Watch is greyed out, and pointing at it says which engine version you need. Watch is also greyed out while a game is already running.

Watch with rewind, beside it, lets you seek and play backward. See [Replay rewind](replay-rewind.md).

The other buttons at the top:

- Refight this setup sets up the same match again, with every player replaced by an AI. Pick the AI, then select Refight now. You start as a spectator.
- Remix writes a copy of the replay that plays on another version of the game you have installed. The original is left alone. A remix can fall out of step when the versions differ.
- Delete removes the replay file for good, with its analysis and its recorded track.

## Details

Details lists the game and its version, the engine, when it was played, how long it lasted, the result and the file size.

The result names the winning side, for example "Team 1 won". It can also say "Nobody won" or "Unknown". See [When a replay has no result or no chart](#when-a-replay-has-no-result-or-no-chart).

## Players

Players lists everyone who played, grouped by side. The winning side has a Winner badge, and each player's row says Won or Lost.

- Select a player's name to open their page in Player stats. See [Career and player stats](career-and-stats.md#another-player-s-page).
- Rating appears when the lobby recorded one.
- APM is actions per minute.
- The other columns are each player's totals at the end of the match, such as Metal produced, Damage dealt and Units lost. Select a column's name to sort by it.

The box at the start of a row shows or hides that player on the chart below. The crosshair at the end of a row highlights them on the chart.

## Match statistics

The tiles at the top show the duration, the result, the number of players and the match's totals.

Under them is the match chart. It draws one figure over the length of the match.

- Pick the figure from the buttons under the chart, grouped under Economy, Military and Units. Each button has a small picture of that figure's shape.
- Cumulative shows the running total. Per minute shows how fast it was going at each moment.
- Players draws a line for each player. Teams draws one for each side.
- Chart and Table switch between the chart and a table of the same figures.
- In-game colours draws each line in that player's colour from the match.
- Highlight me picks out your own line. It appears when you played in the match and Players is picked.
- Export CSV saves the figures as a file for a spreadsheet.

Show commands per minute adds a small chart of how many orders each team gave.

Value of living units by kind shows what each player's army was worth over time, split by kind of unit. It needs the replay to be analysed first. See [Analyse a replay](#analyse-a-replay).

## Build orders

Select Show build orders to read them. Each player then has a row with the number of orders they gave. Select a row to open it.

- Opening is the player's orders in sequence, with repeats shown as a count, and what they cost.
- All orders lists every order with the time it was given.
- Opening length in minutes limits the opening to the first part of the match. Leave it empty for the whole match.

These are orders, not what was built. An order that was cancelled or never carried out is listed like any other.

Naming the units needs the replay's game installed. If you have another version, the names and costs come from that version and the page warns they may be wrong. If you have none, each order shows a unit number.

## Analyse a replay

A replay holds what players asked for, not what happened. To find out where units were made and lost, coilbox plays the match again in the engine without a window. This is the analysis. The same run records the match for replay rewind.

Nothing runs until you ask. In the Analysis and recording section, select Analyse and record this replay. If the replay's engine is not installed, the button reads "Analyse and record with" and then the installed engine it will use instead. The confirmation shows the time and the disk space it expects. Select Start.

The run plays the whole match from the start, faster than the match did. A longer match takes longer. The confirmation estimates the time from earlier runs of the same game on your computer. If there are none yet, it says the time is unknown. Measured times are on the [Replay rewind](replay-rewind.md#why-a-replay-has-to-be-recorded-first) page.

While it runs, the section shows how far it has got and Cancel. You can leave the page and it carries on. The result is kept, so each replay is analysed once.

The analysis needs the replay's engine, game and map installed. The result is only kept if the run plays out exactly as the recorded match did. If it does not, the section says so and keeps nothing.

After an analysis, five more map layers turn on. A Recorded events list appears, with what the run saw, such as units made and lost. Value of living units by kind fills in too.

## Timeline and chat log

The timeline is a strip across the length of the match. Its marks show chat, pauses and players leaving. Point at a mark to read it. Select a chat mark to open the chat log at that line.

Select Show chat log to read every message, with the time it was sent and who it was for.

## Your notes

Your notes holds Mark watched, your tags and your sets for this replay. Type a tag in Add tag… and press Enter. Tags show in the list, and a tag filter appears on the Replays page once you have one.

## The map

The map section shows the minimap beside a 3D view of the map. Fullscreen preview opens the 3D view on its own.

The buttons under the map turn layers on and off.

| Layer | Shows |
| --- | --- |
| Start boxes | Where each side was allowed to start |
| Start positions | A dot where each player started. Point at a dot to see who it was and how they opened |
| Buildings ordered | A mark for each building a player ordered, in their colour |
| Building density | Where buildings were ordered most |
| Order density | Where players aimed their orders |
| Bases | A close view of each player's start, with the buildings they ordered there |
| Deaths | Where units died |
| Damage dealt | Where damage landed, or where it came from |
| Buildings finished | An outline for each building that was finished |
| Starting unit deaths | Where each player's first unit, usually the commander, ended |
| Starting unit paths | Where each player's first unit went |

The last five layers need an analysis. Until then they are greyed out, and Go to the analysis section takes you there.

With Buildings ordered, Building density, Order density, Bases or one of the analysis layers on, a bar under the map limits them to part of the match. Drag its ends, or pick Whole match, First 5 minutes or Last 5 minutes.

## When a replay has no result or no chart

The engine writes the result and the statistics at the end of the match. If the match never reached its end, or the engine did not write them, the replay has none.

- "Unknown" in Result means the replay does not say who won. It is not a loss.
- "This replay has no statistics." under Match statistics means the engine wrote no figures. There is then no chart, no tiles and no totals in Players.
- "Recording did not finish" on a row means the file is empty. A game that was closed or crashed before it ended leaves a file like this, and so does a game still running. Nothing in it can be played.

Build orders, the chat log and the start positions come from the recording itself, so they are usually still there.

## Which figure to trust

Some figures are the engine's own count and some are what players ordered, so two numbers on the page can disagree. [Replay data sources](../reference/replay-data-sources.md) says where each figure comes from and how far to trust it.

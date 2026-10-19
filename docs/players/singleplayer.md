# Singleplayer battles

A singleplayer battle is you against AI opponents on one map. You set it up on the Singleplayer page, start it, and coilbox opens the game. When the game closes, coilbox tells you who won.

Open it from Play > Singleplayer in the sidebar.

## Choose a game

The game is in the card at the bottom right of the page, under the map. It shows the game's loading screen and its name and version.

1. Select Choose game.
2. Pick a game from the list. Type in the search box to narrow it down.

Changing the game resets the game options, because each game has its own.

## Choose a map

The map card is at the top right. It shows the minimap, the map's name, its size, how many start positions it has, its wind range and, on maps with water, its tidal strength.

1. Select Choose map.
2. Pick a map from the list.

The Map, Metal and Height buttons under the map change what the minimap shows. Metal shows where the metal is. Height shows the high and low ground.

## Add and remove opponents

The player list is on the left. You are the row called You. Every other row is an AI.

- To add an opponent, select + Add AI opponent.
- To remove one, select the cross at the end of its row.
- To remove every AI at once, select Clear AIs.
- To change which AI plays a row, select its name and pick another. The list splits into Engine AIs and Game AIs (Lua). The game AIs are written for that game.

Under each AI's name is Bonus. Select it to give that AI extra resource income, as a percentage. 0 means no bonus. With more than one AI, Bonus for every AI under the list sets them all at once.

To watch instead of play, turn on Spectate at the top of the page. The AIs then fight each other.

## Set factions, teams and allies

Each row has four settings.

| Column | What it does |
| --- | --- |
| Colour | The square at the start of the row. Select it to pick the player's colour. |
| Faction | Which side the player fights as. Random picks one when the battle starts. |
| Team | Players on the same team share one army and control it together. Give each player their own team unless you want that. |
| Ally | Players with the same letter are on the same side and do not fight each other. Give yourself and your allies one letter, and your enemies another. |

When two rows share a team, the second row takes its colour, faction and ally from the first.

## Choose start positions

Start positions is under the map. It decides where each team begins.

- Fixed (map). Each team starts at the map's numbered position with the same number as the team. Team 1 starts at position 1. To start somewhere else, change your team number.
- Choose in-game (start boxes). Each side picks its start point once the game loads, inside a box you draw.
- Random. The game places each team at one of the map's positions.

With start boxes, the letters under Start boxes are the allies. Pick a letter, then drag on the minimap to draw that ally's box. Drag a box to move it, drag its handles to resize it, or select its cross to remove it. Swap moves the boxes between allies and Clear all removes them. If you draw no boxes, every team may start anywhere.

## Change the game options

Game options is under the player list. Select it to open it. The line beside the name says how many options you have changed.

The options under Mod options come from the game, so every game has different ones. Change one by typing a number, ticking a box or picking from a list. Reset beside Game options puts every option back to the game's default.

The map card shows the map's details but has no settings of its own.

## What you need to start

Start Game stays greyed out until all of these are true:

- An engine is installed.
- A game and a map are chosen.
- At least two players will play. Spectating does not count as playing.
- Every AI row has an AI picked.

If no engine is installed, the page says so and offers Download engine. Select it to download one and start playing.

The game and map lists only show what you have installed. If a list is empty, get games from Library > Games and maps from Library > Maps in the sidebar, then come back.

Some games need another archive to run. If that archive is missing, the page shows "This game is missing something it depends on" and names it. Open game downloads takes you to the page where you can get it.

## Start the battle

Select Start Game. The game opens in its own window.

While it runs, the setup on the Singleplayer page is frozen. If the game stops responding and never closes, End game on the page closes it.

Host, beside Start Game, takes the same setup to a multiplayer battle instead, so friends can join.

## After the battle

When the game closes, coilbox checks the replay to work out who won. Match debrief then opens on the right. It shows:

- Victory, Defeat or Outcome unknown.
- How long the battle lasted.
- View replay, which opens the replay of the battle you just played.

It also lets you play again:

- Rematch starts the same battle again.
- Rematch with tweak changes every AI's bonus and starts again. Pick an easier or harder setting from the list above it first.
- Save as preset keeps this setup so you can come back to it.

If the game crashes, The game stopped unexpectedly opens instead. It says what was being played and shows the end of the game's log. Copy details copies that report, ready to paste into a bug report.

## Save and keep a setup

The page remembers your setup, so it is still there next time you open coilbox. To keep several setups and switch between them, use the Presets button, the bookmark at the top of the page. See [Battle presets](presets.md).

## Load a saved game

You save a game from inside the game, not from coilbox. Type /save and a name into the game's chat box, for example /save mybase.

To carry on from a save:

1. Open Play > Save Games in the sidebar.
2. The page lists the saves of your preferred engine. If you played on another engine, make that one your preferred engine in Settings, then Library > Engines. See [Engines](library.md#engines).
3. Find the save. Each one shows the map, the date it was saved and the game. Use the filter box and the sort list to find it in a long list.
4. Select Resume.

The game opens where you left it. If you just saved a game and it is not in the list, select Rescan.

To delete a save, select the bin beside it, then Delete. A deleted save cannot be brought back.

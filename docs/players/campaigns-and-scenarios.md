# Campaigns and scenarios

A campaign is a set of missions you play in order. Each mission has a briefing, and winning one opens the next. A scenario is a single mission you play on its own, with no campaign around it. Both open the game like a singleplayer battle, and coilbox keeps track of how you did.

Campaigns and Scenarios are both in the Play group of the sidebar. Each one only appears once you have something to play there:

- Campaigns appears once at least one campaign is installed. Some games come with one, or somebody can send you one.
- Scenarios appears once at least one scenario is ready to play.

To make your own, see [Campaigns](../developers/campaigns.md) and [Scenarios](../developers/scenarios.md) in the game developer guides.

## Play a campaign

1. Open Play > Campaigns in the sidebar.
2. Select a campaign. Its page lists the missions in order, with how many you have completed.
3. Select a mission to open its briefing.
4. Select Start Mission. The game opens in its own window.

On the campaign's page, each mission shows its state:

- A tick means you have completed it.
- A padlock means it is locked. Win the mission before it to open it.
- An arrow means you can play it now.

A campaign that came with your copy of coilbox or your game is marked Bundled. A campaign marked Draft is unfinished, and the line under it says which mission cannot be played.

## Read the briefing

The briefing fills the screen. It shows the campaign's name, the mission's title, and the briefing text the author wrote. Some missions also have:

- Objectives, a list of what you need to do.
- A voiceover or a video. Use its play and mute buttons.
- A picture, a spinning map or a unit beside the briefing.

Battle history lists your earlier attempts at this mission. Select Back at the top left to return to the campaign's page.

Some missions play differently at each difficulty. Those show Difficulty above Start Mission, with Easy, Normal and Hard. The level you pick applies to the rest of the campaign, and you can change it on any later briefing. A campaign where you never pick a level plays at Normal.

## If the mission needs something you do not have

A mission plays on one game and one map. If either is missing, or you have no engine, the briefing is replaced by a card that names what is needed.

1. Select Download & Install under each item.
2. Wait for the download to finish. The briefing then appears.

If the download cannot find it by name, select Find it in Downloads to look for it yourself.

If the card says Unfinished mission instead, the author never chose a game or a map for it. Nothing you install will fix that. Ask whoever made the campaign.

## After the mission

When the game closes, coilbox reads the replay to see whether you won. While it does, the screen says Checking result.

- Victory means the mission is complete. Select Continue to go to the next mission's briefing, or Back to campaign.
- Defeat means you did not win. You lose no progress. Select Retry to go back to the briefing and try again, or Back to campaign.

When coilbox read the result from the replay, the screen says "Result detected from the replay."

### When coilbox cannot tell who won

Sometimes the replay does not say who won. This happens when you quit before the mission ended, or when no replay was written. Coilbox then asks "How did it go?" Select Victory or Defeat to record the result yourself.

If the game crashes before it records anything, you go back to the briefing with a message saying what went wrong.

## How your progress is kept

Coilbox saves your progress for each campaign as you play. It is still there the next time you open coilbox.

- Winning a mission marks it complete and opens the next one.
- Losing a mission does not undo anything. Missions you have already won stay won.
- You can replay any mission you have completed.
- Some campaigns let you skip a mission. The mission after it opens even before you win the one you skipped.

On the Campaigns page, Continue appears beside the campaign you played most recently, if you left a mission there unfinished. Select it to go straight to that mission's briefing.

## Play a scenario

1. Open Play > Scenarios in the sidebar.
2. Find the scenario. Each row shows its name, its description, the game and map it plays on, and what is in it.
3. Select Play. A panel opens on the right.
4. If the scenario plays differently at each difficulty, pick Easy, Normal or Hard under "How hard should it be?"
5. Select Play in the panel.

A scenario that comes inside your game is marked From and the game's name.

When the game closes, the panel says "You won. Play it again from here." or "The game has closed. Play it again from here." If coilbox could not tell how the game ended, it says so and offers I won, so you can record the win yourself.

If you are missing the game, the map or an engine, the row says what is missing and offers Download game, Download map, Download game and map or Download engine. The Play button works once the download is done.

## What a scenario needs from the game

A game has to be set up to play scenarios. Some games are and some are not. Before you select Play, the panel says which kind you have:

- "This mission comes with" and the game's name. The mission is part of the game, and the game plays it.
- The game's name and "plays this scenario itself". The game is set up to play scenarios.
- The game's name and "cannot play a scenario on its own, so coilbox sets up what it needs". Coilbox makes a small extra game that adds the scenario to yours. Your copy of the game is not changed.

In the last case the scenario still plays, but it may not play as its author meant. You may notice:

- The game asks its usual questions at the start, such as which faction to play or where to start, even though the mission has already placed your units.
- The game ends by its own rules before you finish the mission's objectives.

None of this is something you can fix. It is up to the people who make the game. You can still play the scenario.

If the panel says "This scenario was made for a newer version of coilbox", update coilbox to play it. If it says the scenario has problems and did not start, the scenario itself has a fault. Tell whoever shared it.

## Import a scenario somebody shared

A scenario can come to you as a code, a link, a file or an item on the community hub.

To import a code or a file:

1. Open Play > Scenarios.
2. Select Import at the top of the page.
3. Paste the code into the box and select Import scenario. For a file, select Import from file… and pick the file.

If the scenario plays on a game or a map you do not have, coilbox offers to download them first. Nothing is imported until they are all installed, so cancelling leaves nothing behind.

Importing always adds a new copy. Importing a scenario you already have gives you two.

A coilbox link asks you to confirm, then opens the Scenarios page with the import ready to run.

To import from the [community hub](https://coilbox-hub.vercel.app), open Coilbox hub in the sidebar, find the scenario and select Import. Coilbox takes you to the Scenarios page and imports it in the same way.

## Import a campaign somebody shared

Campaigns come as a single file. They are not on the community hub and do not have codes.

1. Turn on Advanced mode in Settings > General.
2. Open Campaign Builder > Campaigns in the sidebar.
3. Select Import and pick the campaign file.

If the campaign uses a game or a map you do not have, coilbox offers to download it. The campaign then appears under Play > Campaigns.

A campaign that came with your game, or with a copy of coilbox set up for your game, needs no importing. It is already in the list.

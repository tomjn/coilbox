# Battle presets

A preset is a saved battle setup you can load and fight again later. All your presets live in one place, the Presets drawer on the Singleplayer page. You can save into it from several places in Coilbox, so you can keep a good multiplayer match, or a conquest or warpath fight, and play it again on your own.

## Saving a preset

Look for the bookmark. You can save a preset from these places:

| Where | What it saves |
| --- | --- |
| Singleplayer, Presets drawer, Save current setup | The setup you have built on the page. |
| Multiplayer battle room, Presets button under the map, Save this battle | The battle, turned into a singleplayer skirmish (see below). Only the host sees the Presets button, or everyone in a battle run by a bot. |
| Galactic conquest, the bookmark box beside a node's battle overlay | The node's matchup, map, opponents and any unit restrictions. |
| Warpath, the bookmark box beside an encounter overlay | The encounter's matchup, plus the run's tech restrictions and perks. |

On the conquest and warpath overlays the bookmark sits in its own box just under the back arrow, so you can save before or after the fight. Coilbox asks for a name and fills in a suggestion, such as the map and opponent. The preset goes into your Singleplayer presets. A message confirms it, and the bookmark fills in to show this battle is already saved. If you save after the fight, the preset keeps the battle as you fought it, not the node's next state, which may already have changed.

## Replaying a preset

Open Singleplayer, select Presets, and pick a preset. Choose which parts you want, then select Load. It loads the game, map, opponents and options onto the page, ready for Start Game. Every saved battle plays as a singleplayer skirmish, wherever it came from.

## What a preset holds

- The game and map.
- The opponents. For each AI or converted player, it keeps the faction or side, colour, team and handicap.
- Mod options and the start position mode.
- Any restrictions the original battle had, so it plays the same way again:
  - Disabled units. This is a shared unit ban, from conquest node restrictions, warpath's tech ceiling, or a multiplayer host's unit restrictions.
  - Advantage and income. These are warpath's personal perks, applied to your team again.

When a loaded preset has restrictions, the Singleplayer page shows a small Restricted battle banner that sums them up, for example 12 units disabled and +15% advantage. You cannot see restrictions anywhere else on the page, so the banner tells you they are there. Select Clear to drop them and fight the same matchup with no restrictions.

## Saving a multiplayer battle

A singleplayer skirmish has one human, you, and the rest are AIs. So Coilbox converts a multiplayer battle when you save it:

- You stay yourself, and keep your team, ally, side and colour.
- Every other human becomes an AI opponent or ally, and keeps their team, ally, side and colour. A 4v4 stays a 4v4.
- Bots keep their AI if you have it installed. If you do not, Coilbox picks one that works, so the battle still starts.
- Spectators are dropped, because they were not fighting.
- The host's unit restrictions carry over as the disabled units.

The battle room used to have a second, host only store called Option presets, which held mod and map options and nothing else. It is gone. A preset holds map options now, so there was nothing left that Option presets could do and presets cannot.

## Sharing presets

In the Singleplayer Presets drawer, select a preset to open it. It has two ways to share it:

- Export saves the preset to a `.json` file you can send to someone.
- Copy link copies a coilbox link. When someone opens it, coilbox offers to import the preset.

To add a preset someone sent you as a file, select Import at the top of the drawer and pick the file. Coilbox adds it as a new preset, so it never replaces one you already have. Restrictions travel with the preset, so a shared conquest or warpath fight plays the same way on someone else's computer.

## Following a preset pack

A community can publish a set of presets at a web address and keep improving them. Following that address puts its presets in your drawer and keeps them current, without changing anything you saved.

1. In the Singleplayer Presets drawer, select Followed packs.
2. Paste the pack's address and select Follow.

The pack's presets appear in the drawer with the pack's name on them. Its games and maps are not downloaded in advance.

Coilbox refreshes followed packs when it starts and when you select Refresh. If a refresh fails, for example because you are offline, the presets you already have stay and still load. The Followed packs page shows when each pack last updated and why its last refresh failed.

A preset that changed in a refresh is marked Updated until you open it. A preset can hold unit tweaks, which are Lua the game runs, so its unit tweaks cannot reach a battle until you have opened that version. That applies to a preset from a pack you just followed too.

You cannot edit or delete a followed preset. Open it and select Save a copy to get one of your own, which a refresh never changes. Unfollowing a pack removes its presets and keeps your copies.

Coilbox only follows packs from `raw.githubusercontent.com` and `gist.githubusercontent.com`, over https, and it refuses an address that redirects anywhere else. A distribution can [replace that list](../developers/distribution-profile.md#presetpackhosts-array-of-strings). The address must return a [setup pack](library.md#import-a-setup-pack) as JSON, holding at least one game or map and at least one preset.

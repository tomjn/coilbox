# Compatibility mode

Compatibility mode lets you play an old Spring game on a current engine. Many Spring games are one or two decades old. Their Lua calls functions the engine has since removed, their unit files set tags it no longer reads, and their models are in Total Annihilation's `.3do` format.

With compatibility mode on, coilbox writes a second game that loads the old one and adds fixes on top. It launches that game in place of the old one. The old game's files are never changed.

Each game has its own switch, and coilbox builds nothing until you turn it on.

## Check a game

1. Open Library > Games and select the game.
2. On the Overview tab, find the Compatibility section.

The section only appears when coilbox finds something. If a game has no Compatibility section, the report found nothing and the game needs no switch.

An archive's page in Library > Archives has a Convert models button for a game with `.3do` models. It opens this section.

## Read the report

Each row is one kind of finding. The number on the right is how many there are, where counting them means something. A row with an arrow opens to show the details, such as each file and line behind a count of Lua calls.

A warning triangle is a problem: something the current engine no longer does. An info icon is worth knowing and changes nothing on its own.

Engine versions in the details name the engine as it was called at the time. Up to 105.0 that is Spring, for example "removed in Spring 105.0". From 105.1.1 on it is Recoil.

### Problems

| Row | What it means | What compatibility mode does |
| --- | --- | --- |
| .3do models | Models in Total Annihilation's format, with a count | Converts them to `.s3o` and points the game's units, features and weapons at the copies |
| .fbi or .tdf unit definitions | Unit files in the old text formats | Leaves the files alone. The def fixes still run on the units they define |
| Lua calls to removed or changed APIs | Calls to functions the engine removed or renamed. The details give each file, line and the change | Puts back the functions listed in [What it changes](#what-it-changes). Calls to anything else stay broken |
| Removed def tags in use | Unit or weapon definitions that set a tag the engine stopped reading, with the units that set it | Puts back the tags listed in [What it changes](#what-it-changes) |
| No luaui/widgets folder, or No luaui folder | The game ships no widgets of its own | Nothing |
| modinfo.tdf instead of modinfo.lua | The game describes itself in the old file format | Nothing |
| gamedata/messages.tdf | The file that says how a team's death is announced. The engine stopped reading it in Spring 95.0 | A gadget reads it again |

### Information

| Row | What it means |
| --- | --- |
| Lua calls to functions whose behaviour changed | Calls to a function whose arguments changed. Only some calls are affected, such as one that leaves an argument out |
| Compatibility gadgets a build turns on | The fix gadgets that would run for this game, with the units or weapons each would act on. The aircraft gadget's list can name planes it then leaves alone, because it checks more when the game loads than the report can |
| Dependencies not scanned for Lua | Games this one depends on that are not installed, so their Lua was not checked |
| Could not check everything | A read failed. The details say which |

### Maps

A map's page has a Compatibility section too. It lists things such as SM3 maps, `.3do` feature models and `.pcx` textures. Compatibility mode does not change maps, and a map page has no switch.

## Turn it on

1. In the game's Compatibility section, turn on Compatibility mode.
2. Wait while it shows Building.

When the build ends, the section shows the folder it wrote and what is in it: how many models were converted, how many prelude functions and def overrides were written, and which gadgets are enabled. If something could not be done, a line under that says why.

The switch cannot be used until coilbox has read the game's checksum, which takes a moment after the page opens.

The new game is a folder in the `games` folder of your content folder. Its name is `coilbox-compat-`, the old game's file name in lower case without its extension, and the compatibility version. For example, `xta-9.65.sd7` at version 5 becomes `coilbox-compat-xta-9.65-5.sdd`.

Library > Games lists that folder as a game of its own, with a note saying coilbox wrote it. The places where you pick a game to play do not list it. Pick the old game, and coilbox uses the compatibility version for you.

## Play with it

With the switch on, these launch the compatibility version in place of the old game:

- A [singleplayer battle](singleplayer.md).
- Play when you [test a Unit tweaks project](../developers/unit-tweaks.md#test-a-project).

These still launch the old game without fixes, even with the switch on:

- Campaigns, Galactic conquest and Warpath.
- Scenarios.
- The unit builder's test game.
- Refight from a replay.
- A multiplayer battle you host.

Issue #4664 covers those.

If the compatibility version is missing or out of date, the launch stops and says why, for example "Compatibility mode is on for XTA 9.65, but its mutator is out of date". Coilbox never launches the old game without its fixes while the switch is on. Rebuild it from the game's page.

## Rebuild after an update

A Rebuild button appears beside the switch when the folder no longer matches what coilbox would build now. The line under the switch says why:

- "built from compatibility version 4, now 5" means a newer coilbox has more fixes.
- "written by an older coilbox" means a newer coilbox writes the files differently.
- "the game has changed since it was built" means the old game's archive is not the one it was built from.
- "the palette its models take their colours from has changed" means the Total Annihilation `palette.pal` the models were coloured from is different now, or has gone. That file can come from the engine or another archive rather than the game, so a new engine can cause it.
- "its record of what it was built from is missing" means the folder's record file is gone or unreadable.

So after you update coilbox, a game with the switch on may refuse to launch until you rebuild it.

Rebuild builds the newest version and leaves the switch as it was. A newer version is a new folder, and the older folder stays until you select Remove.

## Turn it off or remove it

Turning the switch off sends launches back to the old game. The folder is kept, so turning it on again needs no build if nothing has changed.

Remove deletes every compatibility folder coilbox built for the game and turns the switch off. It never touches the old game.

## Multiplayer

Every player in a battle needs the same compatibility version of the game. Coilbox writes the same files on every computer from the same game and the same version. So nobody downloads a compatibility version. Each player's coilbox builds its own.

When you join a battle whose game is named like `XTA 9.65 (compat 5)`:

- If you do not have the old game, coilbox gets it as it would any missing game. See [Get the map and game](multiplayer.md#get-the-map-and-game).
- If you have the old game, coilbox builds version 5 for you, and the room shows Building until it is done. Your own switch for the game does not change.
- If your coilbox is newer than the host's, it builds the host's older version.
- If the host's coilbox is newer than yours, the room says "Host is on a newer coilbox" and you cannot start. Update coilbox opens the updater.
- If the build fails, the room says why and offers Try again.

So everyone needs the same version of coilbox as the host, or a newer one.

Coilbox cannot host a compatibility mode battle yet. A battle you host uses the old game, and the host's game list does not offer the compatibility version.

## What it cannot fix

- Only what is listed in [What it changes](#what-it-changes). The report can show Lua calls and def tags that have no fix.
- Maps.
- A game that ships its own `gamedata/defs_post.lua`, or whose own `gamedata/defs.lua` never loads it, gets no converted models and none of the def fixes that run there. Issue #4628 covers converting those models.
- A game that ships its own `gamedata/weapondefs_post.lua`, or whose own `gamedata/weapondefs.lua` never loads it, gets none of the weapon def fixes.
- A `.3do` face that names a colour from the Total Annihilation palette is drawn flat grey when no `palette.pal` can be found.

When a model or def fix is skipped, the build result under the switch says which and why.

If one of the fixes fails while the game runs, the game still loads. The engine's log has a line that starts "coilbox compat fix", with the fix's name and the error.

## What it changes

This is compatibility version 13, the newest.

Lua functions it puts back:

- `Spring.GetUnitTravel` and `Spring.SetUnitTravel`, removed in Spring 105.0. They work again, and keep their values per unit.
- `Spring.SetUnitToFeature`, removed in Spring 105.0.
- `Spring.SetUnitLineage` and `Spring.GetUnitLineage`, last in Spring 0.82.7.1. They work again, and keep each unit's lineage, but a team's units no longer die with its lineage root.
- `gl.Smoothing`, removed in Spring 104.0. It does nothing.
- `Spring.SetSunParameters` and `Spring.SetSunManualControl`, removed in Spring 104.0. They do nothing.
- `Spring.UpdateInfoTexture`, removed in Spring 99.0. It does nothing and returns false.
- `Spring.MakeFont`, last in Spring 0.81.2.1. It makes no font and returns nil.
- `snext`, `spairs` and `sipairs`, removed in Recoil 2025.01.1. In a game's unsynced gadgets they are `next`, `pairs` and `ipairs` again, as they were from Spring 97.0.

Call-ins whose arguments moved:

- `UnitDamaged`, changed in Spring 95.0, and `AllowCommand`, changed in Spring 105.0. The game's handlers get the arguments in the old order. Coilbox reads the game's Lua first, and leaves this out for a game whose handlers already take the new order.
- `Spring.GetTeamInfo`, changed in Spring 105.0. The game gets the team's custom keys 7th and its income multiplier 8th, as before. Coilbox leaves this out for a game whose Lua already reads them the new way round.

Values the engine now keeps differently:

- `Spring.SetUnitRulesParam`, and the game, team and feature versions, changed in Spring 105.0. A number written as text, such as `"30"`, is stored as a number again, so the game reads back a number it can compare.

Gadgets, which each decide when the game loads whether the game needs them:

- `coilbox_compat_aircraft_crash`. A plane that is shot down falls out of the sky, as it did before Spring 83.0, instead of exploding where it was hit. It does nothing for a plane whose script crashes it. It also does nothing in a game that crashes planes itself, or whose own gadgets call a function that engines before Spring 83.0 did not have.
- `coilbox_compat_only_forward_aim`. A weapon that only fires forward fires once its target is in front of it, as it did before Spring 105.0.
- `coilbox_compat_messages_tdf`. A team's death is announced with the lines in the game's `gamedata/messages.tdf`, as it was before Spring 95.0.
- `coilbox_compat_model_center_offset`. A unit's `modelCenterOffset` moves its middle again, as it did before Spring 89.0.

Unit and weapon definitions:

- The `commander` tag, removed in Spring 85.0, is copied to `customParams.iscommander`, which games made since read.
- `modelCenterOffset`, removed in Spring 89.0, is copied to the unit's custom parameters for the gadget above.
- A bomb's burst is worked out from its reload time as it was before Spring 92.0, unless the weapon sets `manualBombSettings` to true.
- `areaOfEffect` and `maxVelocity`, which Lua lost in Spring 87.0, are kept in each weapon's custom parameters under those names in lower case.
- A unit whose `iconType` names an icon the game's `gamedata/icontypes.lua` does not have reads as `default` in Lua, as it did before Recoil 2025.06.07. The engine draws it with the default icon either way.
- A unit, feature or weapon whose model is not in the game is drawn as a plain grey box the size of its footprint, because the engine stops loading a game on any model it cannot find. A wreck keeps its metal and still blocks the ground it covers. The build result names each one. A name close to a model the game has is not taken for it, so XTA's `arm_infinity_dead` gets a box even though the game has `arm_infinite_DEAD`.

For how fixes are added and why a fix never changes once it ships, see [Compatibility mode fixes](../developers/compatibility-mode.md).

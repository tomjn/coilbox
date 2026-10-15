# Change a game's units with Unit tweaks

Unit tweaks changes a game's units and weapons without touching the game's own files. You make your changes in a project, try them in a skirmish, then package them for other people.

A project belongs to one game. It records only the fields you change, so everything else still follows the game when the game updates.

This page covers what is on each screen. The unit and weapon fields themselves belong to the engine's own guides. See [Unit definition guides](#unit-definition-guides) at the end.

## Turn on Unit tweaks

Unit tweaks is hidden until you turn on Advanced mode.

1. Open Settings, then General.
2. Under Advanced tools, turn on Advanced mode.

Unit tweaks now appears in the sidebar, under workshop. It opens on a list of your projects, grouped by game.

## Start a project

1. Open Unit tweaks.
2. Select New project.
3. Pick the game under Game. A project cannot be moved to another game later.
4. Type a Name, and a Description if you want one.
5. Select Start editing.

The project opens on its Units section. Coilbox saves every change as you make it.

You can also start from a unit. Open the unit's page in the Library and select Edit in Unit tweaks. Coilbox opens that unit in your most recent project for the game. If the game has no project yet, the editor opens on the unit and your first change starts one.

The other buttons at the top of the Unit tweaks page start a project from something you already have:

- Import opens a project file somebody sent you.
- Decode reads tweak slot text, such as a whole `!bset` line or a battle's mod options, and shows it as Lua. Pick a game and select Start a project from this to edit it.
- Randomise rolls a game's units into rarity tiers from a seed. Two people who use the same seed and rules on the same game get the same result.

### Manage your projects

Select a project to open it. The menu on each project has Rename, Duplicate, Share and Delete. Delete asks first, and nothing brings a deleted project back.

Search projects and the sort menu beside it help you find one in a long list.

## The project page

Across the top of every project are:

- Undo and Redo.
- Checkpoints, which saves the whole project under a name so you can go back to it. Type a Name and select Save checkpoint. Coilbox also saves one on a timer, marked Auto. Restore puts the project back to a checkpoint as one step you can undo.
- Test, which plays the project in a skirmish. See [Test a project](#test-a-project).
- Reference, which opens the table of the project's units. See [Compare units in the Reference table](#compare-units-in-the-reference-table).

Under the title, the project's sections are Units, Changes, Weapons, Collections, Checks and Package. A number beside Changes or Checks says how many there are.

## Edit a unit

The Units section lists the game's units on the left. Search units narrows the list. The two menus beside it filter by faction, and by All units or Changed only.

Select a unit to see its fields. Above them are:

- View unit details, which opens the unit's page in the Library.
- Disabled, a switch that takes the unit out of the game. A disabled unit comes off every build menu in the game. Its definition stays, so you can switch it back on, and you can still edit it.
- Copy unit, which adds a new unit based on this one. Give it an Internal name and a Name in game, then select Add unit. If the internal name is one the game already uses, the button says Replace instead, because the copy takes that unit's place.

The unit's fields are on three tabs: Fields, Weapons and Explosions.

### The Fields tab

Fields are grouped by what they do, such as Cost and production, Durability and Movement. Select a group's heading to open or close it. Help beside a field explains it.

Relevant shows the fields the unit's own definition sets, plus any you have changed. All adds every field the engine reads.

Type a new value into a field to change it. The game's value stays on screen beside yours. The reset button beside a changed field removes your change, so the field follows the game again.

A field the game's own Lua changes as it loads says so under the field. The game does the same to a value you type, so coilbox works out a value that loads as the one you typed when you test or package.

Fields only this game declares lists the custom fields the game adds that the engine does not know about.

A unit that builds other units also has a Build menu, where you can add and remove what it builds.

### The Weapons tab

The Weapons tab shows the unit's weapon slots, numbered as in the unit definition. Select a slot to edit it.

Each slot has two parts:

- The mount, such as Only shoots at, belongs to the unit's own weapon list.
- The weapon definition is what the weapon does: damage, range, reload time and the rest. The unit carries its own copy, so a change here reaches no other unit.

Equip a library weapon puts a weapon from the project's [weapon library](#weapons) into the slot. It can also copy the slot's weapon into the library, so you can give it to other units.

Add a class to the damage table adds an armour class to the weapon's damage table, so you can set its damage against that class.

### The Explosions tab

The Explosions tab shows what happens when the unit dies and when it self destructs. Select Dies or Self-destructs to edit that explosion.

An explosion is often shared by many units. The tab says how many. Give the unit its own copy, or change a field, and the change reaches only this unit.

## Changes

Changes lists every change in the project, grouped by unit. Each row shows the game's value and the project's value. Select a field to open it in the unit editor, or use the button beside it to put the game's value back.

## Weapons

The Weapons section is the project's weapon library. It holds weapons the project owns, under names of their own.

1. Under Add a weapon from, type part of a weapon's name or key into Find a weapon.
2. Select the weapon.
3. Give the copy a name, using lowercase letters, numbers and underscores.
4. Select Add to library.

Edit the weapon in the library, then equip it into a slot from a unit's Weapons tab. A change in the library reaches every slot that fires the weapon. A library weapon that no slot fires is not in the game.

## Collections

A collection is a named set of units, such as every tier two unit. Collections can be nested, and a parent includes everything its children hold.

1. Open Collections.
2. Type a Name under New collection and select Create.
3. Select the collection, then tick its units in the list on the right.

Rule (optional) adds every unit that matches a search, such as `cost < 200`, on top of the ones you tick. The collection keeps up to date as values change.

If another project for the same game has collections, Add from another project copies one into this project.

You can use a collection to filter the Reference table, to change a set of units at once, and to package only some of a project.

## Checks

Checks says whether the project is ready to play or hand out. It opens with Needs attention, split into Blockers and Worth a look. A blocker is something that would reach the game broken. Test and Package also check the project before they run, and stop on a problem in the Lua they would write.

The rest of the page covers:

- Game definitions, which says whether coilbox could read the game's units.
- Still fits, which says whether the installed game is the build the project was written against, and what to do if it is not.
- Delivery routes, which says how a change can reach this game: a mutator archive, tweak slots or editing the game's own files. See [Which games it works with](#which-games-it-works-with).
- Post-processing, which shows what the game's own Lua does to its units as they load.
- Preflight, which lists what passed when coilbox checked the Lua it generates.
- Change ledger, which shows which file or tweak slot each change ends up in. By unit and By output group it two ways.

### Edit the game's own files

If the game is a loose `.sdd` folder in a content folder's `games` folder, Delivery routes also offers Write changes into the game. It writes your field changes and copies straight into the game's unit files, and copies each library weapon into a file under `weapons/`. Use it on a game you are developing.

Coilbox keeps the original of every file it changes. Undo puts the originals back. Accept keeps the changes and deletes the originals, so nothing can undo the write after that.

## Compare units in the Reference table

Select Reference at the top of a project. The table lists every unit with the project's changes applied: health, metal cost, build time, sight, speed, range, DPS and figures worked out from them, such as cost per HP.

- Select a column heading to sort by it.
- Search units takes a name or a rule such as `hp > 3000` or `speed < 50 and cost > 200`.
- Filter by faction and Filter by collection narrow the table. The collection filter appears once the project has a collection.
- The scatter plot above the table plots one column against another. Pick them with X axis and Y axis.

Select a number to change it. The change goes into the project like one made in the unit editor.

Tick units to select them. A bar appears with:

- Compare, which shows two or more units side by side.
- Change values, which changes one column across every selected unit. Pick the Column, the operation (Change by %, Add or Set to) and the Value, and choose Rounding. Check the preview, then select Apply to, which ends with the number of units it changes. With Follow game updates ticked, a percentage or an added amount stays tied to the game's value when the game updates.
- Clear, which empties the selection.

## Test a project

Select Test at the top of a project to play it in a skirmish on your own machine. Nothing is uploaded or shared.

1. Pick a map under Map.
2. To skip building it, tick Start with, followed by the unit's name, on the map. The unit you are editing is placed when the game starts, beside the game's own version if it has one.
3. Select Play.

If the game has tweak slots, a Route choice appears:

- Local tweak-slot mod option passes your changes to the game as a mod option, with no generated game.
- Generated test game writes a game of its own, `coilbox-workshop-test.sdd`, into your `games` folder. It works for every game. Coilbox rewrites it on every test, and deleting it undoes everything this route wrote.

Coilbox checks the project first. A blocker stops the launch and says why.

## Package a project

The Package section hands the project to somebody else. Choose Mutator archive or Tweak slots at the top.

If the project has collections, a menu offers Whole project or one collection, so you can package only that collection's units.

The right side of the page, Generated Lua, shows every file the project compiles to. Worth knowing lists anything about this game to be aware of. What the compiler chose says why each change is written the way it is.

### Mutator archive

A mutator archive is a small game that depends on the original game and adds only your changes. Every game the engine can run accepts one.

1. Choose Archive (.sdz) for one file to hand out, or Folder (.sdd) for a loose folder you keep under version control.
2. Select Save as .sdz… or Save as .sdd…, and choose where to write it.

The file is named after the project with its version number, such as `my-balance-patch-v1.sdz`. The version goes up by one every time you package, so two players can never have different builds under the same name. When it finishes, the page says where it wrote the archive.

The archive holds a `modinfo.lua` with the project's name, its version and the game it depends on. With it come the files your changes need. Field changes go in `gamedata/unitdefs_post.lua`, copied units in `units/`, library weapons in `weapons/`, and custom explosion effects in `effects/`.

If the game has its own `gamedata/unitdefs_post.lua`, the archive's file takes its place, and the game's own post-processing does not run. Checks lists this as a blocker. For a game like that, use tweak slots if it has them.

### How a player uses the archive

1. Put the `.sdz` in the `games` folder of their Spring data folder.
2. Make sure the game it depends on is installed, at the exact version the project was made against.
3. Start a game and pick the archive from the game list. It appears under the project's name.

### Tweak slots

Tweak slots send your changes to somebody else's lobby, for a game that reads them. Use this when you are not the host.

1. Choose Tweak slots.
2. Select Pack for tweak slots.
3. Select Copy beside each line, and paste the lines into the battle room's chat in order.

Each line is a `!bset tweakdefs` command for a numbered slot. A host that answers `!bset` sets the slot, which is how SPADS autohosts work. If the project needs more slots than the game has, the page says so before you paste anything.

A custom explosion effect cannot go in a tweak slot, because the engine only reads one from a file. Use a mutator archive for a project that has one.

## Share a project

To give somebody the project itself, so they can open and edit it, select Share in the project's menu on the Unit tweaks page. You can share it as a code, a link, a file or on the Coilbox hub. See [Share your own](../players/hub.md#share-your-own).

Your friend opens a file with Import on the Unit tweaks page. The project opens against the game it names.

## Which games it works with

Unit tweaks works with any game the engine runs. Coilbox reads each game's own unit definitions, so nothing needs adding to a game first.

How a change reaches a game depends on the game:

- A mutator archive works for every game. It is the default.
- Tweak slots need the game to declare `tweakdefs` mod options in its `modoptions.lua`. The slots are older than Beyond All Reason, and any game can declare them. Coilbox has checked how Beyond All Reason and Zero-K read them. For any other game, the page says the route is unchecked, so check your changes in a game.
- Editing the game's own files needs the game to be a loose `.sdd` folder in a content folder's `games` folder.

Checks > Delivery routes says which of these the game you picked supports, and why.

## Unit definition guides

The engine's wiki covers every field in detail.

- [UnitDefs](https://springrts.com/wiki/Gamedev:UnitDefs) lists the fields of a unit definition.
- [WeaponDefs](https://springrts.com/wiki/Gamedev:WeaponDefs) lists the fields of a weapon definition.
- [modinfo.lua](https://springrts.com/wiki/Modinfo.lua) explains the file that names a game and the games it depends on.
